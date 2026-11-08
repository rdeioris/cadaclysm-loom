// The loom's export: the document the canvas stands for as a script, in Python or JavaScript,
// that builds the same document node by node and shows what the loom draws. Python through
// the SDK's `Document` (`doc.add(kind, id=..., **fields)`); JavaScript through the kernel's
// document calls (`cadaclysm_blacksmith_document_*`, the module the notebook's JavaScript
// kernel puts on `cadaclysm`). The page's canvas places (`meta.loom`) stay out: the script is
// the model, not the drawing of it.
//
// Environment-free: the page's Export menu and test/loom-script.mjs both call
// `scriptOf(nodes, language)`; the tests run the Python under Pyodide and the JavaScript
// under the JavaScript kernel and compare the part with the document's own evaluation.

export const LANGUAGES = ["python", "javascript"];

const PY_KEYWORDS = new Set(["False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else",
    "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield"]);

// A JSON value as Python writes it.
function py(v) {
    if (v === null || v === undefined) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "number") return Object.is(v, -0) ? "-0.0" : String(v);
    if (typeof v === "string") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(py).join(", ")}]`;
    return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${py(x)}`).join(", ")}}`;
}

// A node's fields: everything but its id, kind and the canvas's own place.
function fieldsOf(node) {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
        if (k === "id" || k === "kind") continue;
        if (k === "meta") {
            const own = { ...v };
            delete own.loom;
            if (Object.keys(own).length) out.meta = own;
            continue;
        }
        out[k] = v;
    }
    return out;
}

// What the loom draws: the nodes marked to preview, else those no other node reads (by id
// or by name in an expression).
export function endsOf(nodes) {
    const marked = nodes.filter((n) => n.meta?.loom?.preview).map((n) => n.id);
    if (marked.length) return marked;
    const ids = new Set(nodes.map((n) => n.id));
    const read = new Set();
    const walk = (v) => {
        if (typeof v === "string") {
            if (ids.has(v)) read.add(v);
            if (v.startsWith("=")) for (const m of v.matchAll(/[A-Za-z_]\w*/g)) if (ids.has(m[0])) read.add(m[0]);
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    for (const n of nodes) walk(fieldsOf(n));
    return nodes.filter((n) => !read.has(n.id) && /^(solid|sheet|profile|path\.end)/.test(n.kind)).map((n) => n.id);
}

/** The script of a document's `nodes`, in `language`. */
export function scriptOf(nodes, language = "python", units = "mm") {
    if (!LANGUAGES.includes(language)) throw new Error(`no export to ${language}`);
    const ends = endsOf(nodes);
    if (language === "python") {
        const lines = [
            "# The loom's document, node by node: the same evaluator the page runs.",
            "from cadaclysm_blacksmith import Document",
            "",
            "",
            "def show(*solids, part=None):",
            "    pass  # the notebook's own `show` draws them; elsewhere, save or measure them here",
            "",
            "",
            `doc = Document(units=${JSON.stringify(units)})`,
        ];
        for (const n of nodes) {
            const args = [JSON.stringify(n.kind), `id=${JSON.stringify(n.id)}`];
            const odd = {};
            for (const [k, v] of Object.entries(fieldsOf(n))) {
                if (/^[A-Za-z_]\w*$/.test(k) && !PY_KEYWORDS.has(k) && k !== "id" && k !== "kind" && k !== "message") args.push(`${k}=${py(v)}`);
                else odd[k] = v;
            }
            if (Object.keys(odd).length) args.push(`**${py(odd)}`);
            lines.push(`doc.add(${args.join(", ")})`);
        }
        lines.push("", "for _r in [doc.result(i) for i in " + py(ends) + "]:", "    show(*(_r if isinstance(_r, list) else [_r]))");
        return lines.join("\n") + "\n";
    }
    const lines = [
        "// The loom's document, node by node: the same evaluator the page runs.",
        "const { Solid, Profile } = require('cadaclysm/blacksmith');",
        "function show() {} // the notebook's own `show` draws them; elsewhere, save or measure them here",
        "",
        `const doc = cadaclysm.cadaclysm_blacksmith_document_new(${JSON.stringify(units)});`,
        "const add = (node) => cadaclysm.cadaclysm_blacksmith_document_apply(doc, JSON.stringify({ op: \"add\", node }), \"\");",
    ];
    for (const n of nodes) lines.push(`add(${JSON.stringify({ id: n.id, kind: n.kind, ...fieldsOf(n) })});`);
    lines.push(
        "cadaclysm.cadaclysm_blacksmith_document_evaluate(doc, false);",
        "// A node's solids and profiles: itself, or each item of its list (`id#i`).",
        "function results(id) {",
        "    const kind = cadaclysm.cadaclysm_blacksmith_document_result_kind(doc, id);",
        "    if (kind === \"solid\" || kind === \"sheet\") return [new Solid(cadaclysm.cadaclysm_blacksmith_document_result_solid(doc, id))];",
        "    if (kind === \"profile\") return [new Profile(cadaclysm.cadaclysm_blacksmith_document_result_profile(doc, id))];",
        "    if (kind === \"list\") return JSON.parse(cadaclysm.cadaclysm_blacksmith_document_value(doc, id)).flatMap((_, i) => results(`${id}#${i}`));",
        "    throw new Error(`${id}: ${cadaclysm.cadaclysm_blacksmith_document_errors(doc)}`);",
        "}",
        `show(...${JSON.stringify(ends)}.flatMap(results));`,
    );
    return lines.join("\n") + "\n";
}
