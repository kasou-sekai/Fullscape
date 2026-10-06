import assert from "node:assert/strict";
import { test, after, beforeEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const dir = await mkdtemp(join(tmpdir(), "fullscape-upnext-"));
await build({
    stdin: {
        contents:
            'export {UpNext} from "./src/ui/components/UpNext/UpNext"; export {DOM} from "./src/ui/elements";',
        resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    outfile: join(dir, "upnext.mjs"),
    logLevel: "silent",
});
let images = [];
globalThis.Image = class {
    constructor() {
        images.push(this);
    }
};
globalThis.Spicetify = { SVGIcons: {}, Player: {}, Queue: { nextTracks: [] } };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = { matchMedia: () => ({ matches: true }) };
const { UpNext, DOM } = await import(pathToFileURL(join(dir, "upnext.mjs")));
after(() => {
    UpNext.teardown();
    return rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
    UpNext.teardown();
    images = [];
    for (const key of [
        "upNextLabel",
        "upNextPrimaryText",
        "upNextSecondaryText",
        "upNextCover",
        "upNextContainer",
        "upNextTitleViewport",
        "upNextTitleTrack",
    ]) {
        DOM[key] = {
            style: { removeProperty() {} },
            dataset: {},
            innerText: "",
            textContent: "",
            clientWidth: 400,
            offsetWidth: 0,
        };
    }
});
function next(title) {
    Spicetify.Queue.nextTracks = [
        { contextTrack: { metadata: { title, image_xlarge_url: `${title}.png` } } },
    ];
}

test("a slow artwork request cannot overwrite newer Up Next metadata", async () => {
    next("first");
    const first = UpNext.updateUpNextInfo();
    next("second");
    const second = UpNext.updateUpNextInfo();
    images[1].onload();
    assert.equal(await second, true);
    images[0].onload();
    assert.equal(await first, false);
    assert.match(DOM.upNextPrimaryText.innerText, /^second/);
    assert.equal(DOM.upNextCover.style.backgroundImage, 'url("second.png")');
});

test("hiding or exiting invalidates an artwork request before it can publish", async () => {
    for (const stop of [() => UpNext.hideUpNext(), () => UpNext.teardown()]) {
        next("pending");
        const request = UpNext.updateUpNextInfo();
        stop();
        images.at(-1).onload();
        assert.equal(await request, false);
        assert.equal(DOM.upNextPrimaryText.innerText, "");
    }
});
