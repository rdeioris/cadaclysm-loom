// Opening and saving an app's file as the forge does: the browser's own pickers where it has
// them (Chrome, Edge), so the first save asks where and the next ones write back to that file,
// and an open remembers the file for the next save; elsewhere (Firefox, Safari, or the page
// in a frame, where the pickers are refused) a file input and a download.

/** One app's file: `description` and `accept` are the pickers' (`{ mime: [".ext"] }`), `name`
 * the file a first save suggests. `open()` gives `{ name, text, file }` (the `File`, for a
 * binary one), or null when cancelled;
 * `save(text, { asNew, name })` gives the file's name, or null when cancelled; `forget()`
 * drops the file, so the next save asks again (a new document, an example opened). */
export function filePicker({ description = "cadaclysm-blacksmith document", accept = { "application/json": [".json"] }, name = "document.json" } = {}) {
    const types = [{ description, accept }];
    const extensions = Object.values(accept).flat();
    let handle = null;
    let opened = null;   // without the pickers: the name of the file opened, which a save downloads as
    const pickers = () => window.self === window.top && window.showOpenFilePicker && window.showSaveFilePicker;
    const cancelled = (e) => e?.name === "AbortError";

    async function open() {
        if (pickers()) {
            let picked;
            try { [picked] = await window.showOpenFilePicker({ multiple: false, types }); }
            catch (e) { if (cancelled(e)) return null; throw e; }
            handle = picked;
            const file = await picked.getFile();
            return { name: file.name, text: await file.text(), file };
        }
        const file = await new Promise((resolve) => {
            const input = Object.assign(document.createElement("input"), { type: "file", accept: extensions.join(",") });
            input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
            input.addEventListener("cancel", () => resolve(null));
            input.click();
        });
        if (!file) return null;
        opened = file.name;
        return { name: file.name, text: await file.text(), file };
    }

    async function save(text, { asNew = false, name: suggested } = {}) {
        if (pickers()) {
            if (!handle || asNew) {
                try { handle = await window.showSaveFilePicker({ suggestedName: suggested ?? handle?.name ?? name, types }); }
                catch (e) { if (cancelled(e)) return null; throw e; }
            }
            const stream = await handle.createWritable();
            await stream.write(text);
            await stream.close();
            return handle.name;
        }
        const fileName = (!asNew && opened) || (suggested ?? name);
        const url = URL.createObjectURL(new Blob([text], { type: Object.keys(accept)[0] }));
        const a = Object.assign(document.createElement("a"), { href: url, download: fileName });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);   // Firefox starts the download after `click` returns
        return fileName;
    }

    return { open, save, forget: () => { handle = opened = null; }, get name() { return handle?.name ?? opened; } };
}

/** The forge's keys: ctrl/cmd-S saves (back to the file), ctrl/cmd-shift-S asks where again,
 * ctrl/cmd-O opens. A page that only opens passes no `save`. */
export function fileKeys({ save, open }) {
    addEventListener("keydown", (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        if (e.code === "KeyS" && save) { e.preventDefault(); save(e.shiftKey); }
        else if (e.code === "KeyO" && !e.shiftKey) { e.preventDefault(); open(); }
    });
}
