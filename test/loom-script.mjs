// The loom's export under Node: every example document exported as JavaScript runs under
// the SDK's JavaScript wrapper, and the parts it shows are the document's own (the same
// faces, the same volume to the bit: one evaluator); a laced node's parts show one by one;
// the canvas's places stay out of the script, in Python as in JavaScript.
//
// Run: node test/loom-script.mjs   (after npm run setup)
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert";
import { loadPackage } from "./package.mjs";
import { scriptOf, endsOf, LANGUAGES } from "../loom-script.js";
import { EXAMPLES } from "../loom-examples.js";

const here = dirname(fileURLToPath(import.meta.url));
const { wasm, bs } = await loadPackage();

const documents = EXAMPLES.map((e) => ({ id: e.id, text: readFileSync(join(here, "..", "loom-examples", `${e.id}.json`), "utf8") }));
// What the page draws of a document, measured: each end's parts' faces and volumes.
function partsOf(text) {
    const d = wasm.cadaclysm_blacksmith_document_load(text);
    wasm.cadaclysm_blacksmith_document_evaluate(d, false);
    const out = [];
    const walk = (id) => {
        const kind = wasm.cadaclysm_blacksmith_document_result_kind(d, id);
        if (kind === "solid" || kind === "sheet") { const s = new bs.Solid(wasm.cadaclysm_blacksmith_document_result_solid(d, id)); out.push([s.faces, s.mass().volume]); }
        else if (kind === "list") JSON.parse(wasm.cadaclysm_blacksmith_document_value(d, id)).forEach((_, i) => walk(`${id}#${i}`));
    };
    for (const id of endsOf(JSON.parse(text).nodes)) walk(id);
    wasm.cadaclysm_blacksmith_document_free(d);
    return out;
}

// ---- the text -------------------------------------------------------------------------------

assert.deepStrictEqual(LANGUAGES, ["python", "javascript"]);
const plate = JSON.parse(documents[0].text).nodes;
let text = scriptOf(plate, "python");
assert.match(text, /^from cadaclysm_blacksmith import Document$/m);
assert.match(text, /^doc = Document\(units="mm"\)$/m);
assert.match(text, /^doc\.add\("profile\.rect", id="rect", w="=w", h="=h"\)$/m, "a wire from a slider is an expression naming it");
assert.doesNotMatch(text, /meta=/, "the canvas's places stay out");
text = scriptOf(plate, "javascript");
assert.match(text, /^add\(\{"id":"rect","kind":"profile\.rect","w":"=w","h":"=h"\}\);$/m);
assert.doesNotMatch(text, /"meta"/);
// A field Python cannot spell as a keyword argument goes in a dict.
assert.match(scriptOf([{ id: "r", kind: "solid.revolve_in_plane", from: [0, 0], to: [0, 1] }], "python"), /\*\*\{"from": \[0, 0\]\}/);
assert.throws(() => scriptOf(plate, "lua"), /no export to lua/);

// ---- the scripts run: JavaScript under the kernel ---------------------------------------------

function runJs(script) {
    const shown = [];
    const requireStub = (name) => {
        if (name === "cadaclysm/blacksmith") return bs;
        throw new Error(`runJs: no module ${name}`);
    };
    globalThis.cadaclysm = wasm;
    new Function("require", "show", script.replace(/^function show\(\) \{\}[^\n]*\n/m, ""))(requireStub, (...items) => shown.push(...items));
    return shown.map((s) => [s.faces, s.mass().volume]);
}
for (const { id, text: doc } of documents) {
    assert.deepStrictEqual(runJs(scriptOf(JSON.parse(doc).nodes, "javascript")), partsOf(doc), `${id}: the JavaScript export makes the same parts`);
}

// A laced node: three boxes, shown one by one.
const laced = [{ id: "w", kind: "value", value: "=[1, 2, 3]" }, { id: "c", kind: "solid.cuboid", x: "=w", y: 1, z: 1 }];
assert.deepStrictEqual(runJs(scriptOf(laced, "javascript")).map(([f]) => f), [6, 6, 6]);

console.log(`loom-script: ok (${EXAMPLES.length} examples in JavaScript)`);
