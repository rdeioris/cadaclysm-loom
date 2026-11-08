// The loom's canvas library: LiteGraph.js (MIT; the "core" build, without its stock node
// packs), bundled by esbuild into vendor/litegraph.js by `npm run build`; its licence is in
// THIRD-PARTY.txt.
// The UMD file assigns its classes to `this`, which esbuild's CommonJS wrapper makes the
// module's exports.
import * as lg from "litegraph.js/build/litegraph.core.js";

export const { LiteGraph, LGraph, LGraphCanvas, LGraphNode, LLink, ContextMenu } = lg;
