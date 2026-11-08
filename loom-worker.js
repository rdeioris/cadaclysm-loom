// The loom's worker: the wasm, the blacksmith document the canvas stands for (held here and
// edited by one batch op per change, so its history is the file's), and the wasm View that
// draws the nodes to draw, hosted here (viewer-host.js) on a canvas the page transferred
// to it (viewer-client.js). Nothing is uploaded, and no mesh crosses to the page: only
// each drawn item's counts, for its caption.
//
// Page to worker: `{ kind: "evaluate", seq, nodes, draw, message }` -- the document's nodes
// as the canvas makes them (loom-doc.js), `draw` the ids of the nodes whose solids and
// profiles the page wants drawn; `{ kind: "open", seq, text }` -- a document to hold instead
// (a file, a `?doc=` link, an example), answered `{ kind: "opened", seq, nodes, error }`;
// `{ kind: "save", seq }`, answered `{ kind: "saved", seq, text }`; `{ kind: "body", seq,
// name, bytes }` -- a CAD file the page's Open button read, answered `{ kind: "bodies", seq,
// name, bodies: [body JSON], error }` for the page to hold as `solid.body` nodes; `{ kind:
// "reframe" }` -- a new document: the next part frames the camera afresh; plus the bridge's
// `view.*` messages, handed to the host. Worker to page: `{ kind: "ready", versions, kinds }`
// once (`kinds`: the document's kinds table); per evaluation `{ kind: "result", seq, nodes:
// { id: { state, error, count } }, drawn: [{ node, solids: [{ kind: "solid" | "profile",
// faces, edgeCount }] }], ms, error? }` -- `error` when the document refused the change (it
// is then unchanged) -- or `{ kind: "crashed", message }` when the wasm trapped (the page
// re-makes the worker, and its canvas, and opens its document in it again); plus the host's
// own `view.*` messages, which the page passes to its client's `receive` -- including a
// `view.error` this worker posts itself when showing an evaluation fails (see `show`). `seq`
// is the page's: it drops an answer for a canvas it has since replaced, and the worker
// evaluates the latest it was sent.
//
// The handles a drawing takes off the document (`drawnOf`) are freed once shown: `showSolid`
// meshes in place and keeps what it needs of the solid itself (the View keeps an
// exact source), so the View's items outlive them.
//
// The `view.*` messages that arrive before the wasm's `load()` resolves are queued, in
// order, and replayed once it does: `view.create` calls `View.create()` straight away.
//
// `show` changes the hosted View directly (showSolid, showLines, remove, frame, setGrid),
// outside `view.call`: each such change asks the host for its own draw (`host.markDirty`).
// The cadaclysm web package (`npm run setup` fetches it into ./pkg): its index.js loads
// the module and re-exports cadaclysm.js, the kernel's calls and the View.
import * as wasm from "./pkg/index.js";
import { createViewerHost } from "./viewer-host.js";
import { drawnOf, freeItems, sphereOf, keeps, diffShown } from "./loom-show.js";
import { opsBetween, notDocument } from "./loom-doc.js";

const VIEW_ID = 1;
// The world's grid, 10 mm lines out to +-100 mm about the origin (the forge's): a grid sized
// to the part would move and resize under every edit of the graph.
const GRID = { axes: true, step: 10, extent: 100 };

// The document (a wasm handle) and its nodes as last applied.
let doc = 0;
let nodes = [];

// A license (cadaclysm.lic: its URL or its text) for a site others use; without one the
// module runs in full, with a notice in the console on every file opened and every STEP
// file written. https://cadaclysm.blitter.studio/license
const LICENSE = null;
const wasmReady = wasm.load(LICENSE ? { license: LICENSE } : {});
const ready = (async () => {
    await wasmReady;
    doc = wasm.cadaclysm_blacksmith_document_new("mm");
    const v = wasm.cadaclysm_blacksmith_version();
    self.postMessage({ kind: "ready", versions: { blacksmith: v, wasm: v }, kinds: wasm.cadaclysm_blacksmith_document_kinds() });
})();
ready.catch((e) => self.postMessage({ kind: "boot-failed", message: String(e?.message ?? e) }));

// A wasm error's own words, the call's name taken off: `document_apply: x1: ...` -> `x1: ...`.
export const words = (e) => String(e?.message ?? e).replace(/^(Error: )?document_\w+: /, "");

// The nodes of the document held, as the file has them.
const nodesOf = (d) => JSON.parse(wasm.cadaclysm_blacksmith_document_save(d)).nodes;

// Exported for a test that shims `self` and drives these directly: this
// worker otherwise has nothing importable, and "run nowhere but the page" is otherwise the
// most that could be said of the trap-to-crash wiring below.
export const trapped = (e) => typeof WebAssembly !== "undefined" && e instanceof WebAssembly.RuntimeError;

// ---- the view ---------------------------------------------------------------------------------

// A trap from the scheduled draw (viewer-host's rAF `drawFrame`, outside `run()`'s own try)
// is reported the same way as one from an evaluation or a direct view change, rather than
// left an uncaught worker error that `loom.js` would otherwise read as "the kernel failed to
// load".
export function schedule(fn) {
    const draw = () => {
        try { fn(); } catch (e) {
            if (trapped(e)) self.postMessage({ kind: "crashed", message: String(e?.message ?? e) });
            else throw e;
        }
    };
    if (typeof self.requestAnimationFrame === "function") self.requestAnimationFrame(draw);
    else setTimeout(draw, 16);
}

// The view's items the last evaluation was shown as, by key (loom-show.js keyOf): an item the
// next evaluation draws unchanged stays up, the new ones go up, and the rest come down after
// (showing first keeps the camera: the View only re-frames when its items become empty). A
// slider moved on one node re-shows only what that node changed downstream, not every solid.
let shown = new Map();
// The sphere the camera was last framed on, or null: never framed, nothing drawn since, or
// a new graph loaded (`reframe`) -- the next part then frames afresh.
let framedAt = null;
// An evaluation finished before the view exists: its items (`describe`'s), shown once
// view.ready posts. Its handles stay open until then: the evaluator closes a result's only
// when a later evaluation replaces it, and that later one replaces this too.
let pending = null;

// Shows one evaluation's items (`describe`'s) in the view, if it exists yet, else keeps them
// for view.ready. The new items go up first, then the last evaluation's come down. A throw
// (not a trap) while the new ones go up takes down whatever of them did and leaves the last
// evaluation's showing; one after (an old item's remove, the framing) leaves the new ones
// showing. Either posts a `view.error`; a trap is thrown on, to the crash path.
function show(items) {
    const viewer = host.views.get(VIEW_ID);
    if (!viewer) {
        // Parked with its handles open; one it replaces will never be shown.
        if (pending && pending !== items) freeItems(wasm, pending);
        pending = items;
        return;
    }
    pending = null;
    const ids = [];
    let swapped = false;
    try {
        const { keep, add, remove } = diffShown(shown, items.filter((i) => i.show.kind === "solid" || i.show.segments.length));
        const next = new Map(keep);
        for (const item of add) {
            const s = item.show;
            const id = s.kind === "solid" ? viewer.showSolid(s.handle, { fill: s.fill }) : viewer.showLines(s.segments, s.colour);
            ids.push(id);
            next.set(item.key, id);
        }
        shown = next;
        swapped = true;
        // Each old item comes down on its own: one that fails does not strand the rest.
        let failed = null;
        for (const id of remove) { try { viewer.remove(id); } catch (e) { if (trapped(e)) throw e; failed ??= e; } }
        if (failed) throw failed;
        const sphere = sphereOf(items.map((i) => i.box));
        if (!sphere) framedAt = null;
        else if (!keeps(framedAt, sphere)) { viewer.frame(); framedAt = sphere; }
    } catch (e) {
        if (trapped(e)) throw e;
        if (!swapped) for (const id of ids) { try { viewer.remove(id); } catch { /* already gone */ } }
        self.postMessage({ kind: "view.error", id: VIEW_ID, message: `show: ${e?.message ?? e}` });
    }
    host.markDirty(VIEW_ID);
}

// Wraps the host's own `post`: forwards every message unchanged; on view.ready for the one
// view here, lays its grid out and shows an evaluation left waiting for it. The host has
// put the View into `host.views` by the time it posts view.ready.
function post(message, transfer) {
    self.postMessage(message, transfer);
    if (message.kind !== "view.ready" || message.id !== VIEW_ID) return;
    try {
        host.views.get(VIEW_ID)?.setGrid(GRID);
        host.markDirty(VIEW_ID);
        if (pending) { const parked = pending; try { show(parked); } finally { freeItems(wasm, parked); } }
    } catch (e) {
        if (trapped(e)) self.postMessage({ kind: "crashed", message: String(e?.message ?? e) });
        else self.postMessage({ kind: "view.error", id: VIEW_ID, message: `setGrid: ${e?.message ?? e}` });
    }
}

const host = createViewerHost({ View: wasm.View, post, now: () => performance.now(), schedule });

// ---- the evaluation ---------------------------------------------------------------------------

let latest = null;
let busy = false;

// The last evaluation's items by key (drawnOf's), for an unchanged part to cost nothing.
let lastItems = new Map();

async function run() {
    if (busy) return;
    busy = true;
    try {
        await ready;
        while (latest) {
            const { seq, nodes: wanted, draw, message } = latest;
            latest = null;
            const started = performance.now();
            let items = null;
            try {
                let refused = null;
                const op = opsBetween(nodes, wanted);
                if (op) {
                    try {
                        wasm.cadaclysm_blacksmith_document_apply(doc, JSON.stringify(op), message ?? "");
                        nodes = wanted;
                    } catch (e) {
                        if (trapped(e)) throw e;
                        refused = words(e);
                    }
                }
                const statuses = JSON.parse(wasm.cadaclysm_blacksmith_document_evaluate(doc, false));
                const result = {}, keys = new Map();
                for (const st of statuses) {
                    keys.set(st.id, st.key);
                    let count = 0;
                    if (st.state === "ok") {
                        const kind = wasm.cadaclysm_blacksmith_document_result_kind(doc, st.id);
                        count = kind === "list" || kind === "value" ? countOf(wasm.cadaclysm_blacksmith_document_value(doc, st.id)) : 1;
                    }
                    result[st.id] = { state: st.state, error: st.error ?? (st.by ? `blocked by ${st.by}` : null), count };
                }
                const out = drawnOf(wasm, doc, keys, draw, lastItems, shown);
                items = out.items;
                lastItems = new Map(items.map((i) => [i.key, i]));
                self.postMessage({ kind: "result", seq, nodes: result, drawn: out.drawn, ms: Math.round(performance.now() - started), ...(refused ? { error: refused } : {}) });
            } catch (e) {
                if (trapped(e)) throw e;
                self.postMessage({ kind: "result", seq, nodes: {}, drawn: [], ms: 0, error: words(e) });
                continue;
            }
            // Shown, its handles go; parked for a view not up yet, they stay open until it is.
            try { show(items); } finally { if (pending !== items) freeItems(wasm, items); }
        }
    } catch (e) {
        self.postMessage({ kind: "crashed", message: String(e?.message ?? e) });
    } finally {
        busy = false;
    }
}

// How many items a node's value holds: a list's length, else one.
function countOf(json) {
    try { const v = JSON.parse(json); return Array.isArray(v) ? v.length : 1; } catch { return 1; }
}

// A document to hold instead of the one here: refused in words when it is none.
function open(text) {
    const why = notDocument(text);
    if (why) throw new Error(why);
    const next = wasm.cadaclysm_blacksmith_document_load(text);
    if (doc) wasm.cadaclysm_blacksmith_document_free(doc);
    doc = next;
    nodes = nodesOf(doc);
    lastItems = new Map();
    return nodes;
}

// A CAD file's bodies as `solid.body` fields: read by the kernel, each written as its own
// B-rep JSON (`document_solid_body`).
function bodiesOf(name, bytes) {
    const ext = String(name).replace(/^.*\./, "").toLowerCase();
    const solids = wasm.cadaclysm_blacksmith_open_file(new Uint8Array(bytes), ext);
    try {
        return Array.from(solids, (h) => wasm.cadaclysm_blacksmith_document_solid_body(h));
    } finally {
        for (const h of solids) wasm.cadaclysm_blacksmith_solid_free(h);
    }
}

// ---- messages ---------------------------------------------------------------------------------

const viewQueue = [];
let viewReady = false;
wasmReady.then(() => {
    viewReady = true;
    for (const data of viewQueue.splice(0)) host.handle(data);
}, (e) => self.postMessage({ kind: "view.failed", id: VIEW_ID, message: String(e?.message ?? e) }));

self.onmessage = async ({ data }) => {
    if (typeof data.kind === "string" && data.kind.startsWith("view.")) {
        if (viewReady) host.handle(data); else viewQueue.push(data);
        return;
    }
    if (data.kind === "reframe") { framedAt = null; return; }
    if (data.kind === "open" || data.kind === "save" || data.kind === "body") {
        const answer = { open: "opened", save: "saved", body: "bodies" }[data.kind];
        try {
            await ready;
            if (data.kind === "open") self.postMessage({ kind: answer, seq: data.seq, nodes: open(data.text) });
            else if (data.kind === "save") self.postMessage({ kind: answer, seq: data.seq, text: wasm.cadaclysm_blacksmith_document_save(doc) });
            else self.postMessage({ kind: answer, seq: data.seq, name: data.name, bodies: bodiesOf(data.name, data.bytes) });
        } catch (e) {
            if (trapped(e)) { self.postMessage({ kind: "crashed", message: String(e?.message ?? e) }); return; }
            self.postMessage({ kind: answer, seq: data.seq, name: data.name, error: words(e) });
        }
        return;
    }
    if (data.kind !== "evaluate") return;
    latest = data;
    run();
};
