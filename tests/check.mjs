// Prüft Speicher-Validierung, Laden nach Neuladen und den CSP-Hash. Start: node tests/check.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function runPage(storedValue) {
  const storage = new Map(storedValue === undefined ? [] : [["ftb-vorschau-v1", storedValue]]);
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
    + "globalThis.__api = { get verification() { return verification; }, get state() { return state; }, startVerification, stepError, submitVerificationStep, runVerificationCheck, pageVerification, ACTIONS, render };", context);
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
    changed.orders.push({ id: "bneu1", offerId: "o1", buyer: "Test", email: "t@example.com", grossCents: 129000, commissionPercent: 15, date: "2026-11-02" });
    const reloaded = runPage(JSON.stringify(changed)).context.__state;
    assert.equal(reloaded.orders.length, 4);
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
    assert.equal(runPage("{kaputt").context.__state.members.length, 4);
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

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log("ok   " + name); }
  catch (error) { failed += 1; console.log("FAIL " + name + "\n     " + error.message); }
}
process.exit(failed ? 1 : 0);
