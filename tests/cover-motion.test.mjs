import assert from "node:assert/strict";
import { test, after, beforeEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const dir = await mkdtemp(join(tmpdir(), "fullscape-cover-"));
await build({
    stdin: {
        contents:
            'export {Cover} from "./src/ui/components/Cover/Cover"; export {DOM} from "./src/ui/elements";',
        resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    outfile: join(dir, "cover.mjs"),
    logLevel: "silent",
});
globalThis.Image = class {};
globalThis.Spicetify = { SVGIcons: {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
let reduced = false;
globalThis.window = { matchMedia: () => ({ matches: reduced }) };
const { Cover, DOM } = await import(pathToFileURL(join(dir, "cover.mjs")));
class Node {
    style = {};
    children = [];
    parentElement = { style: {} };
    classList = { remove() {} };
    setAttribute() {}
    append(...children) {
        children.forEach((child) => {
            child.owner = this;
            this.children.push(child);
        });
    }
    remove() {
        this.owner.children = this.owner.children.filter((node) => node !== this);
    }
    animate(frames, options) {
        let resolve, reject;
        const finished = new Promise((a, b) => {
            resolve = a;
            reject = b;
        });
        this.animation = {
            frames,
            options,
            finished,
            cancelled: false,
            cancel() {
                this.cancelled = true;
                reject(new Error("cancelled"));
            },
            finish: resolve,
        };
        return this.animation;
    }
}
globalThis.document = { createElement: () => new Node() };
beforeEach(() => {
    Cover.teardown();
    DOM.container = new Node();
    DOM.cover = new Node();
    DOM.coverImg = { src: "old.png", naturalWidth: 100, naturalHeight: 100 };
    DOM.cover.style.backgroundImage = 'url("old.png")';
    Cover.updateImage();
    reduced = false;
});
after(() => {
    Cover.teardown();
    return rm(dir, { recursive: true, force: true });
});
function swap(source, handoff = false) {
    const previous = Cover.artworkSource;
    DOM.coverImg.src = source + ".png";
    DOM.cover.style.backgroundImage = `url("${source}.png")`;
    Cover.updateImage(previous, handoff);
}
test("track artwork uses outgoing and incoming motion and restores the base image on completion", async () => {
    swap("new");
    assert.equal(DOM.cover.children.length, 2);
    const [old, incoming] = DOM.cover.children;
    assert.equal(old.style.backgroundImage, 'url("old.png")');
    assert.equal(incoming.style.backgroundImage, 'url("new.png")');
    assert.equal(incoming.animation.frames[0].opacity, 0);
    assert.match(incoming.animation.frames[0].transform, /translateY/);
    assert.equal(DOM.cover.style.backgroundImage, "none");
    old.animation.finish();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(DOM.cover.children.length, 0);
    assert.equal(DOM.cover.style.backgroundImage, 'url("new.png")');
});
test("rapid track changes cannot clear the newer artwork transition", async () => {
    swap("first");
    const first = DOM.cover.children.map((node) => node.animation);
    swap("second");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(first.every((animation) => animation.cancelled));
    assert.equal(DOM.cover.children.length, 2);
    assert.equal(DOM.cover.children[0].style.backgroundImage, 'url("first.png")');
    Cover.teardown();
    assert.equal(DOM.cover.children.length, 0);
    assert.equal(DOM.cover.style.backgroundImage, 'url("second.png")');
});
test("reduced motion and queue handoffs use the decoded base cover without a competing transition", () => {
    reduced = true;
    swap("reduced");
    assert.equal(DOM.cover.children.length, 0);
    reduced = false;
    swap("queue", true);
    assert.equal(DOM.cover.children.length, 0);
    assert.equal(DOM.cover.style.backgroundImage, 'url("queue.png")');
});
