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
  const context = {
    console: { warn() {}, log() {} },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    document: { getElementById: id => (id === "app" ? app : element()), querySelectorAll: () => [], createElement: element, body: { appendChild() {} } },
    location: { hash: "#/" },
    window: { addEventListener() {}, scrollTo() {} },
    setTimeout, URL, Blob, Object, JSON, Math, Number, String, Set, Date, SyntaxError
  };
  vm.createContext(context);
  vm.runInContext(script + "\n;globalThis.__state = state; globalThis.__isValidState = isValidState; globalThis.__seed = seedData;", context);
  return { context, app };
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

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log("ok   " + name); }
  catch (error) { failed += 1; console.log("FAIL " + name + "\n     " + error.message); }
}
process.exit(failed ? 1 : 0);
