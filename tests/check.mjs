// Prüft Speicher-Validierung, Laden nach Neuladen und den CSP-Hash. Start: node tests/check.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function runPage(storedValue) {
  const storage = new Map(storedValue === undefined ? [] : [["ftb-vorschau-v2", storedValue]]);
  const element = () => ({ addEventListener() {}, classList: { toggle() {} }, set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; } });
  const app = element();
  const timers = [];
  const context = {
    console: { warn() {}, log() {} },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { getElementById: id => (id === "app" ? app : element()), querySelectorAll: () => [], createElement: element, body: { appendChild() {} } },
    location: { hash: "#/" },
    window: { addEventListener() {}, scrollTo() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, URL, Blob, Object, JSON, Math, Number, String, Set, Date, SyntaxError
  };
  vm.createContext(context);
  vm.runInContext(script + "\n;globalThis.__state = state; globalThis.__isValidState = isValidState; globalThis.__seed = seedData;"
    + "globalThis.__api = { get verification() { return verification; }, get state() { return state; }, startVerification, createMember, deleteMember, saveOffer, addOfferDate, removeOfferDate, isDateBookable, bookableDates, freeSeats, pageCheckout, handleCheckout, offerById: id => state.offers.find(o => o.id === id), todayIso, dayFromToday, passwordError, confirmEmail, pageInbox, pagePassword, isValidState, stepError, submitVerificationStep, runVerificationCheck, pageVerification, ACTIONS, render };", context);
  const flushTimers = () => { while (timers.length) timers.shift()(); };
  return { context, app, api: context.__api, flushTimers };
}

const tests = {
  "Testdaten bestehen die Prüfung"() {
    const { context } = runPage();
    assert.equal(context.__isValidState(context.__seed()), true);
  },
  "gespeicherter Stand übersteht das Neuladen"() {
    const { context } = runPage();
    const changed = context.__seed();
    changed.orders.push({ id: "bneu1", offerId: "o1", dateId: "d11", buyer: "Test", email: "t@example.com", grossCents: 12000, commissionPercent: 15, date: "2026-11-02" });
    const reloaded = runPage(JSON.stringify(changed)).context.__state;
    assert.equal(reloaded.orders.length, 6);
  },
  "manipulierte ID wird verworfen"() {
    const { context } = runPage();
    const bad = context.__seed();
    bad.offers[0].id = 'x"><img src=x onerror=alert(1)>';
    assert.equal(context.__isValidState(bad), false);
    assert.equal(runPage(JSON.stringify(bad)).context.__state.offers[0].id, "o1");
  },
  "Provision als Text wird verworfen"() {
    const { context } = runPage();
    const bad = context.__seed();
    bad.orders[0].commissionPercent = "<img src=x>";
    assert.equal(context.__isValidState(bad), false);
  },
  "Preis 0 wird verworfen"() {
    const { context } = runPage();
    const bad = context.__seed();
    bad.offers[0].priceCents = 0;
    assert.equal(context.__isValidState(bad), false);
  },
  "kaputtes JSON führt zu Testdaten statt Absturz"() {
    assert.equal(runPage("{kaputt").context.__state.members.length, 5);
  },
  "Freitext aus dem Speicher wird escaped"() {
    const { context } = runPage();
    const tricky = context.__seed();
    tricky.offers[0].title = "<img src=x onerror=alert(1)>";
    const { app } = runPage(JSON.stringify(tricky));
    assert.ok(!app.innerHTML.includes("<img src=x"));
    assert.ok(app.innerHTML.includes("&lt;img src=x"));
  },
  "CSP-Hash passt zum Skript"() {
    const digest = createHash("sha256").update(script).digest("base64");
    assert.ok(html.includes(`'sha256-${digest}'`), "Hash veraltet: python3 scripts/update-csp.py index.html");
  }
};

function fakeForm(fields) {
  const err = { textContent: "" };
  return { err, querySelector: sel => (sel === "#err" ? err : Object.hasOwn(fields, sel) ? { value: fields[sel] } : null) };
}

const PERSON_OK = { "#v-first": "Jonas", "#v-last": "Berger", "#v-street": "Musterstraße 12", "#v-zip": "79098", "#v-city": "Freiburg" };

function verifiedPage({ street = "Musterstraße 12", memberId = "m1" } = {}) {
  const page = runPage();
  const { api, context } = page;
  api.state.currentMemberId = memberId;
  api.startVerification();
  context.location.hash = "#/verifizierung";
  const steps = [{ "#v-email": "a@example.com" }, { "#v-code": "000000" }, {}, { ...PERSON_OK, "#v-street": street }];
  for (const fields of steps) api.submitVerificationStep(fakeForm(fields));
  api.ACTIONS.sample("front"); api.ACTIONS.sample("back"); api.submitVerificationStep(fakeForm({}));
  api.ACTIONS.sample("selfie"); api.submitVerificationStep(fakeForm({}));
  api.submitVerificationStep(fakeForm({ "#v-iban": "DE89 3704 0044 0532 0130 00" }));
  return page;
}

Object.assign(tests, {
  "Verifizierung: ganzer Ablauf schaltet Auszahlungen frei"() {
    const { api, flushTimers } = verifiedPage();
    assert.equal(api.verification.step, "pruefen");
    api.submitVerificationStep(fakeForm({}));
    assert.equal(api.verification.phase, "checking");
    flushTimers();
    assert.equal(api.verification.phase, "done");
    assert.equal(api.state.members.find(m => m.id === "m1").payouts, true);
  },
  "Verifizierung: Schritte lehnen falsche Eingaben ab"() {
    const { api, context } = runPage();
    api.state.currentMemberId = "m1";
    api.startVerification();
    context.location.hash = "#/verifizierung";
    const v = api.verification;
    assert.ok(api.stepError(fakeForm({ "#v-email": "kein-at" })));
    v.step = "code"; assert.ok(api.stepError(fakeForm({ "#v-code": "123456" })));
    v.step = "person"; assert.ok(api.stepError(fakeForm({ ...PERSON_OK, "#v-city": "" })));
    v.step = "ausweis"; v.front = true; assert.ok(api.stepError(fakeForm({})), "Rückseite fehlt");
    v.docType = "Reisepass"; assert.equal(api.stepError(fakeForm({})), "", "Reisepass braucht keine Rückseite");
    v.step = "selfie"; assert.ok(api.stepError(fakeForm({})));
    v.step = "bank"; assert.ok(api.stepError(fakeForm({ "#v-iban": "1234" })));
  },
  "Verifizierung: Postfach verlangt Adressnachweis"() {
    for (const street of ["Postfach 12", "c/o Müller", "Packstation 101"]) {
      const { api, flushTimers } = verifiedPage({ street });
      api.submitVerificationStep(fakeForm({}));
      flushTimers();
      assert.equal(api.verification.phase, "address", street);
      api.ACTIONS["verify-next"]();
      assert.equal(api.verification.phase, "address", "ohne Nachweis kein Weiter");
      api.ACTIONS.sample("address");
      api.ACTIONS["verify-next"]();
      flushTimers();
      assert.equal(api.verification.phase, "done");
    }
  },
  "Verifizierung: Seitenwechsel während der Prüfung schaltet nichts frei"() {
    const { api, context, flushTimers } = verifiedPage();
    const lena = api.state.members.find(m => m.id === "m1");
    lena.payouts = false;
    api.submitVerificationStep(fakeForm({}));
    context.location.hash = "#/bereich";
    flushTimers();
    assert.equal(lena.payouts, false);
    assert.equal(api.verification.phase, "form", "Kreisel bleibt nicht hängen");
  },
  "Verifizierung: Mitgliedswechsel lenkt Freischaltung nicht um"() {
    const { api, flushTimers } = verifiedPage({ memberId: "m1" });
    api.state.currentMemberId = "m4";
    api.submitVerificationStep(fakeForm({}));
    api.runVerificationCheck();
    flushTimers();
    const jonas = api.state.members.find(m => m.id === "m4");
    assert.equal(jonas.payouts, false);
    assert.equal(api.verification, null);
  },
  "Verifizierung: ohne Einrichtungsgebühr kein Start"() {
    const { api } = runPage();
    api.state.currentMemberId = "m4";
    api.startVerification();
    assert.equal(api.verification, null);
  },
  "Verifizierung: unbekannte Werte aus data-id werden ignoriert"() {
    const { api, context } = runPage();
    api.state.currentMemberId = "m1";
    api.startVerification();
    context.location.hash = "#/verifizierung";
    api.ACTIONS.sample("phase"); api.ACTIONS.sample("step");
    api.ACTIONS.kind("<img>"); api.ACTIONS.doctype("<img src=x onerror=alert(1)>");
    const v = api.verification;
    assert.equal(v.phase, "form"); assert.equal(v.step, "konto"); assert.equal(v.kind, "einzel"); assert.equal(v.docType, "Personalausweis");
  },
  "Verifizierung: Adresse und Ausweisart werden escaped"() {
    const { api, context, app } = verifiedPage({ street: "<img src=x onerror=alert(1)>" });
    api.verification.docType = "<b>x</b>";
    context.location.hash = "#/verifizierung";
    api.render();
    assert.ok(!app.innerHTML.includes("<img src=x"));
    assert.ok(!app.innerHTML.includes("<b>x</b>"));
    assert.ok(app.innerHTML.includes("&lt;img src=x"));
  }
});

const NEW_MEMBER = { name: "Mia Sonnenberg", email: "mia@example.com", topic: "Yoga", category: "Gesundheit", city: "Gran Canaria", bio: "Kurz" };

Object.assign(tests, {
  "Mitglied werden: legt gültiges, nicht freigeschaltetes Mitglied an"() {
    const { api } = runPage();
    const { member } = api.createMember(NEW_MEMBER);
    assert.equal(api.state.currentMemberId, member.id);
    assert.equal(member.status, "wartet"); assert.equal(member.setupPaid, false); assert.equal(member.payouts, false);
    assert.equal(api.isValidState(api.state), true);
    assert.equal(runPage(JSON.stringify(api.state)).context.__state.members.length, 6, "übersteht Neuladen");
  },
  "Mitglied werden: lehnt fehlende Felder, falsche E-Mail und fremden Bereich ab"() {
    const { api } = runPage();
    assert.ok(api.createMember({ ...NEW_MEMBER, name: " " }).error);
    assert.ok(api.createMember({ ...NEW_MEMBER, email: "mia" }).error);
    assert.ok(api.createMember({ ...NEW_MEMBER, category: "<img src=x>" }).error);
    assert.equal(api.state.members.length, 5);
  },
  "Mitglied werden: überlange Eingaben werden gekürzt, Speicher bleibt gültig"() {
    const { api } = runPage();
    const { member } = api.createMember({ ...NEW_MEMBER, name: "x".repeat(5000), bio: "y".repeat(5000) });
    assert.ok(member.name.length <= 80 && member.bio.length <= 600);
    assert.equal(api.isValidState(api.state), true);
  },
  "Mitglied löschen: nur ohne Verkäufe, Speicher bleibt gültig"() {
    const { api } = runPage();
    assert.equal(api.deleteMember("m2"), false, "Marco hat Verkäufe");
    const { member } = api.createMember(NEW_MEMBER);
    api.state.setupFees.push({ memberId: member.id, cents: 29900, date: "2026-11-02" });
    api.state.offers.push({ id: "oneu1", memberId: member.id, title: "Yoga", type: "Workshop", priceCents: 4500, durationMin: 60, location: "Online", desc: "", dates: [] });
    assert.equal(api.deleteMember(member.id), true);
    assert.ok(!api.state.offers.some(o => o.memberId === member.id), "Angebote mitgelöscht");
    assert.equal(runPage(JSON.stringify(api.state)).context.__state.members.length, 5, "übersteht Neuladen");
    assert.ok(!api.state.members.some(m => m.id === member.id));
    assert.ok(!api.state.setupFees.some(f => f.memberId === member.id));
    assert.notEqual(api.state.currentMemberId, member.id);
    assert.equal(api.isValidState(api.state), true);
    assert.equal(api.deleteMember("gibtsnicht"), false);
  },
  "Mitglied löschen: letztes Mitglied bleibt"() {
    const { api } = runPage();
    api.state.orders = [];
    for (const id of ["m2", "m3", "m4", "m5"]) assert.equal(api.deleteMember(id), true);
    assert.equal(api.deleteMember("m1"), false);
    assert.equal(api.state.members.length, 1);
  }
});

Object.assign(tests, {
  "Mail: neues Mitglied muss E-Mail bestätigen, vorher keine Gebühr"() {
    const { api } = runPage();
    const { member } = api.createMember(NEW_MEMBER);
    assert.equal(member.emailConfirmed, false);
    assert.equal(member.email, "mia@example.com");
    api.ACTIONS["pay-setup"]();
    assert.equal(member.setupPaid, false);
    assert.ok(api.pageInbox().includes("Passwort festlegen"));
    assert.equal(api.confirmEmail(member.id), true);
    assert.equal(api.confirmEmail(member.id), false, "Link nur einmal gültig");
    assert.ok(api.pageInbox().includes("Keine neuen Nachrichten"));
    assert.ok(api.pagePassword().includes("nicht mehr gültig"));
    assert.equal(api.isValidState(api.state), true);
  },
  "Passwort: Regeln für Länge, Zahl und Wiederholung"() {
    const { api } = runPage();
    assert.ok(api.passwordError("kurz1", "kurz1"));
    assert.ok(api.passwordError("nurbuchstabenhier", "nurbuchstabenhier"));
    assert.ok(api.passwordError("sonnenschein7", "sonnenschein8"));
    assert.equal(api.passwordError("sonnenschein7", "sonnenschein7"), "");
  },
  "Passwort wird nirgends gespeichert"() {
    const { api, context } = runPage();
    const { member } = api.createMember(NEW_MEMBER);
    const form = { querySelector: sel => ({ "#pw1": { value: "geheim12345" }, "#pw2": { value: "geheim12345" }, "#err": { textContent: "" } })[sel], reset() {} };
    context.location.hash = "#/passwort";
    vm.runInContext("submitPassword", context)(form);
    assert.equal(member.emailConfirmed, true);
    assert.ok(!JSON.stringify(api.state).includes("geheim12345"));
  },
  "Mail und Passwortseite escapen Name und E-Mail"() {
    const { api } = runPage();
    api.createMember({ ...NEW_MEMBER, name: "<img src=x onerror=alert(1)> Mia", topic: "<b>t</b>", email: "x@example.com" });
    for (const html of [api.pageInbox(), api.pagePassword()]) {
      assert.ok(!html.includes("<img src=x") && !html.includes("<b>t</b>"));
    }
  },
  "Speicher: emailConfirmed muss Boolean sein"() {
    const { api } = runPage();
    api.createMember(NEW_MEMBER);
    api.state.members.at(-1).emailConfirmed = "ja";
    assert.equal(api.isValidState(api.state), false);
  }
});

function checkoutForm() {
  const fields = { "#buyer": { value: "Max" }, "#email": { value: "max@example.com" }, "#card": { value: "4242 4242 4242 4242" }, "#err": { textContent: "" }, "#pay": { disabled: false, innerHTML: "", textContent: "" } };
  return { fields, querySelector: sel => fields[sel] };
}

Object.assign(tests, {
  "Termine: Demodaten liegen in der Zukunft und sind buchbar"() {
    const { api } = runPage();
    for (const offer of api.state.offers.filter(o => o.memberId !== "m4")) assert.ok(api.bookableDates(offer).length > 0, offer.title);
    assert.equal(api.isValidState(api.state), true);
  },
  "Termine: gebuchter 1:1-Termin ist weg, Gruppentermin zählt Plätze"() {
    const { api } = runPage();
    const coaching = api.offerById("o3");
    assert.equal(api.isDateBookable(coaching, "d31"), false, "d31 ist gebucht");
    assert.equal(api.isDateBookable(coaching, "d32"), true);
    const workshop = api.offerById("o2");
    assert.equal(api.freeSeats(workshop, workshop.dates[0]), 10);
  },
  "Termine: Buchung belegt Platz, doppelte Buchung desselben 1:1-Termins scheitert"() {
    const { api, context, flushTimers } = runPage();
    context.location.hash = "#/kasse/o1/d11";
    const offer = api.offerById("o1");
    const first = checkoutForm();
    api.handleCheckout(first, offer, "d11");
    flushTimers();
    assert.equal(api.state.orders.filter(o => o.dateId === "d11").length, 1);
    const second = checkoutForm();
    api.handleCheckout(second, offer, "d11");
    flushTimers();
    assert.equal(api.state.orders.filter(o => o.dateId === "d11").length, 1);
    assert.ok(second.fields["#err"].textContent.includes("nicht mehr frei"));
  },
  "Termine: Termin während der Zahlung vergeben wird nicht doppelt gebucht"() {
    const { api, flushTimers } = runPage();
    const offer = api.offerById("o1");
    const a = checkoutForm();
    api.handleCheckout(a, offer, "d12");
    api.state.orders.push({ id: "bfremd1", offerId: "o1", dateId: "d12", buyer: "Andere", email: "x@example.com", grossCents: 12000, commissionPercent: 15, date: "2026-11-02" });
    flushTimers();
    assert.equal(api.state.orders.filter(o => o.dateId === "d12").length, 1);
    assert.ok(a.fields["#err"].textContent.includes("vergeben"));
  },
  "Termine: Kasse ohne gültigen Termin zeigt Hinweis statt Kasse"() {
    const { api } = runPage();
    assert.ok(!api.pageCheckout("o1", "gibtsnicht").includes("checkout"));
    assert.ok(!api.pageCheckout("o9", "d91").includes("checkout"), "Mitglied nicht freigegeben");
    assert.ok(api.pageCheckout("o1", "d11").includes('id="checkout"'));
  },
  "Termine: anlegen prüft Datum, Uhrzeit, Plätze und Dubletten; löschen nur ohne Buchungen"() {
    const { api } = runPage();
    api.state.currentMemberId = "m1";
    assert.ok(api.addOfferDate("o2", { date: api.todayIso(), time: "10:00", seats: "5" }).error, "heute nicht");
    assert.ok(api.addOfferDate("o2", { date: "kein-datum", time: "10:00", seats: "5" }).error);
    assert.ok(api.addOfferDate("o2", { date: api.dayFromToday(30), time: "25:00", seats: "5" }).error);
    assert.ok(api.addOfferDate("o2", { date: api.dayFromToday(30), time: "10:00", seats: "0" }).error);
    assert.ok(api.addOfferDate("o2", { date: api.dayFromToday(30), time: "10:00", seats: "9999" }).error);
    const { date } = api.addOfferDate("o2", { date: api.dayFromToday(30), time: "10:00", seats: "15" });
    assert.equal(date.seats, 15);
    assert.ok(api.addOfferDate("o2", { date: api.dayFromToday(30), time: "10:00", seats: "15" }).error, "Dublette");
    assert.equal(api.addOfferDate("o1", { date: api.dayFromToday(30), time: "10:00", seats: "15" }).date.seats, 1, "1:1 immer ein Platz");
    assert.equal(api.removeOfferDate("o2", "d21"), false, "hat Buchungen");
    assert.equal(api.removeOfferDate("o2", date.id), true);
    assert.equal(api.isValidState(api.state), true);
  },
  "Termine: fremde Angebote lassen sich nicht ändern"() {
    const { api } = runPage();
    api.state.currentMemberId = "m1";
    assert.ok(api.addOfferDate("o7", { date: api.dayFromToday(30), time: "10:00", seats: "1" }).error);
    assert.equal(api.removeOfferDate("o7", "d72"), false);
    assert.ok(api.saveOffer("o7", { title: "x", type: "Workshop", price: "10", duration: "60", location: "x", desc: "" }).error);
  },
  "Angebot speichern: prüft Art, Preis, Dauer und kürzt Texte"() {
    const { api } = runPage();
    const base = { title: "Neu", type: "Workshop", price: "49", duration: "90", location: "Köln", desc: "" };
    assert.ok(api.saveOffer(null, { ...base, type: "Reise" }).error);
    assert.ok(api.saveOffer(null, { ...base, price: "0" }).error);
    assert.ok(api.saveOffer(null, { ...base, duration: "5" }).error);
    const { offer } = api.saveOffer(null, { ...base, title: "x".repeat(500) });
    assert.ok(offer.title.length <= 80);
    assert.equal(offer.dates.length, 0);
    assert.equal(api.isValidState(api.state), true);
  },
  "Startseite zeigt nur Angebote freigegebener Mitglieder"() {
    const { app } = runPage();
    assert.ok(app.innerHTML.includes("Face Reading live per Zoom"));
    assert.ok(!app.innerHTML.includes("Handyfoto-Workshop"), "Jonas ist noch nicht freigegeben");
  },
  "Speicher: Buchung mit unbekanntem Termin wird verworfen"() {
    const { api } = runPage();
    api.state.orders[0].dateId = "dgibtsnicht";
    assert.equal(api.isValidState(api.state), false);
  }
});

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log("ok   " + name); }
  catch (error) { failed += 1; console.log("FAIL " + name + "\n     " + error.message); }
}
process.exit(failed ? 1 : 0);
