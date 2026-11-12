# cadaclysm loom

A node editor for the [cadaclysm](https://cadaclysm.blitter.studio/) CAD kernel that runs in
the browser. Every box on the canvas is one node of a *blacksmith document*, the same document
model the SDK uses. A wire carries whatever its node makes, and a list wired into a node runs
that node once per item. Drag a slider and the part rebuilds. Save, open or share the document
as a `.json` file that the SDK's `Document` reads, open a CAD file as held bodies, or export the
graph as a Python or JavaScript script that makes the same part.

The kernel runs in a worker in your browser, so nothing is uploaded.

## Architecture

```
index.html ── loom.js ──────────────── LiteGraph canvas (vendor/litegraph.js)
                │  loom-nodes.js        palette: the kernel's node kinds + loom-ui.json
                │  loom-doc.js          graph  <->  document nodes
                │  loom-script.js       export as a Python / JavaScript script
                │  pkg/viewer-client.js the 3D view (an OffscreenCanvas in the worker)
                ▼
            loom-worker.js (module worker) ── pkg/  (the cadaclysm web package)
                document_apply / document_evaluate, the View
```

- **The canvas** is [LiteGraph.js](https://github.com/jagenjo/litegraph.js), bundled by esbuild
  from `loom-vendor.js` into `vendor/litegraph.js`.
- **The palette** is not hard-coded. When the worker is ready it sends the list from
  `cadaclysm_blacksmith_document_kinds()`: every node kind the kernel evaluates, with its
  parameters, their types, defaults, ranges and units, and what it outputs. `loom-nodes.js`
  turns each kind into a box. Its inputs become ports, and its fields become widgets that also
  take a wire. A kernel with new kinds gets new boxes without any change here.
  `loom-ui.json` only holds UI choices: which kinds are shown or hidden, the palette groups,
  short labels, the wire types of record outputs, and the values a fresh box starts with.
- **Graph ↔ document** (`loom-doc.js`). A box is a document node: same id, same kind, its
  wired ports as references and its widgets as parameters. The canvas keeps only box positions,
  in each node's `meta.loom`. Value boxes (Number, Range, …) are `value` nodes. A kind the
  palette hides still opens, as a "Document" box that keeps the node whole. This lets the loom
  open any document, wherever it was made.
- **Evaluation** happens in `loom-worker.js`, a module worker. Edits go in as document operations
  (`document_apply`) and come back from `document_evaluate`, together with each node's state
  and errors. A slider moved on one node re-shows only what changed downstream.
- **Drawing**. The worker owns the package's `View` and draws through an OffscreenCanvas
  (`pkg/viewer-client.js` on the page, `pkg/viewer-host.js` in the worker).
- **Script export** (`loom-script.js`) writes the document as a script of `doc.add(...)` calls,
  in Python for the SDK's Python package or in JavaScript for its JavaScript wrapper.

## Setup

You need Node.js 20 or later.

```bash
npm install
npm run setup
npm run build
```

`npm run setup` puts the cadaclysm web package's `pkg/` folder here. That folder holds the
WebAssembly module (the kernel and the View), its loader and the SDK's JavaScript wrapper. It
also holds the page modules that go with the View, which the loom imports from there instead
of keeping copies: `viewer-host.js` and `viewer-client.js` (a View in a worker, drawing a
canvas the page hands over), `view-activation.js` (tap the view to turn it on) and
`view-show.js` (the palette, outline segments, framing). It is fetched from the [SDK's releases](https://github.com/rdeioris/cadaclysm-sdk/releases) and
never committed. The loom needs the `View` class, which the web package has from 0.14 on.

`npm run build` bundles LiteGraph into `vendor/`.

## Run

```bash
npm start
```

Then open http://localhost:8000/. Any static server works, as long as it serves `.wasm` files
as `application/wasm`. The page is plain ES modules, with no build step beyond `vendor/`.

### Licensing the module

Without a license, the module runs in full and prints a notice in the browser console whenever
a file is opened or a STEP file is written. For a site other people use, put your license
(`cadaclysm.lic`, as its URL or its text) in `LICENSE` at the top of `loom-worker.js`. See
https://cadaclysm.blitter.studio/license. `*.lic` files are git-ignored.

## Test

```bash
npm test
```

The tests run under Node against `pkg/`:

- `test/loom.mjs` checks the palette against the kernel's kinds, that a fresh box of every kind
  evaluates, the graph ↔ document round trip, list ports and lacing, and that the four examples
  build to their pinned figures.
- `test/loom-show.mjs` covers what the view is given.
- `test/loom-script.mjs` runs every example exported as JavaScript under the SDK's wrapper and
  compares the result with the document's own parts.

## Files

| | |
|---|---|
| `index.html`, `loom.js` | the page and the canvas |
| `loom-nodes.js`, `loom-ui.json` | the palette |
| `loom-doc.js` | graph ↔ document nodes |
| `loom-worker.js` | the module worker: evaluation and the View |
| `loom-script.js` | script export |
| `loom-show.js`, `notebook-scene.js`, `notebook-mesh.js` | what each node shows in the view |
| `file-picker.js` | opening documents and CAD files |
| `loom-examples/` | the four examples, as documents |
| `scripts/setup.mjs`, `scripts/serve.mjs` | fetch the package; a static server |

## License

The loom's own code is under the Apache License 2.0 (see [LICENSE](LICENSE)). LiteGraph.js is
MIT, and the Quantico font is under the SIL Open Font License (see
[THIRD-PARTY.txt](THIRD-PARTY.txt)). The cadaclysm web package that `npm run setup` fetches has
its own license and is not part of this repository. The cadaclysm name and logo are not covered
by the Apache license.

Links: [cadaclysm SDK](https://github.com/rdeioris/cadaclysm-sdk) ·
[cadaclysm.blitter.studio](https://cadaclysm.blitter.studio/)
