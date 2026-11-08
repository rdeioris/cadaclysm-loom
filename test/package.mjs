// The cadaclysm web package under Node, for the tests: the module from ./pkg (`npm run setup`)
// loaded from its bytes -- Node has no fetch for a file: URL -- and the SDK's JavaScript
// wrapper (Solid, Profile and the rest) over it, as a page gets them from pkg/index.js and
// pkg/blacksmith.js.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as wasm from "../pkg/index.js";
import { loadBlacksmith } from "../pkg/blacksmith.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..", "pkg");

/** `{ wasm, bs }`: the module's exports, and the wrapper's. */
export async function loadPackage() {
    await wasm.load({ wasm: readFileSync(join(pkg, "cadaclysm_bg.wasm")) });
    const bs = await loadBlacksmith(wasm, { source: readFileSync(join(pkg, "cadaclysm_blacksmith.js"), "utf8") });
    return { wasm, bs };
}
