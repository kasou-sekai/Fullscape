import assert from "node:assert/strict";
import { test, after, beforeEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const dir = await mkdtemp(join(tmpdir(), "fullscape-gallery-"));
await build({
    stdin: {
        contents:
            'export {Queue} from "./src/ui/components/Queue/Queue"; export {DOM} from "./src/ui/elements"; export {QueueAdapter} from "./src/services/queue-adapter";',
        resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    outfile: join(dir, "queue.mjs"),
    loader: { ".scss": "text" },
    logLevel: "silent",
});
globalThis.Image = class {};
globalThis.Spicetify = {
    SVGIcons: {},
    Player: { data: { item: { uri: "old" } } },
    showNotification: () => {},
};
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { Queue, DOM, QueueAdapter } = await import(pathToFileURL(join(dir, "queue.mjs")));
class Node {
    children = [];
    style = {};
    dataset = {};
    attributes = {};
    className = "";
    textContent = "";
    isConnected = true;
    scrollTop = 0;
    rect = { left: 800, top: 140, width: 160, height: 160, bottom: 300 };
    classList = {
        contains: (c) => this.className.split(" ").includes(c),
        add: (c) => {
            this.className += " " + c;
        },
        remove: (c) => {
            this.className = this.className
                .split(" ")
                .filter((x) => x !== c)
                .join(" ");
        },
    };
    append(...nodes) {
        for (const node of nodes) {
            node.parent = this;
            this.children.push(node);
        }
    }
    replaceChildren(...nodes) {
        this.children = [];
        this.append(...nodes);
    }
    setAttribute(k, v) {
        this.attributes[k] = v;
    }
    removeAttribute(k) {
        delete this.attributes[k];
    }
    getBoundingClientRect() {
        return this.rect;
    }
    querySelectorAll(selector) {
        const selectors = selector.split(",").map((part) => part.trim());
        const match = (n) =>
            selectors.some((candidate) =>
                candidate === "img"
                    ? n.tag === "img"
                    : candidate[0] === "."
                      ? n.classList.contains(candidate.slice(1))
                      : false,
            );
        return this.children.flatMap((n) => [
            ...(match(n) ? [n] : []),
            ...n.querySelectorAll(selector),
        ]);
    }
    querySelector(s) {
        return this.querySelectorAll(s)[0] || null;
    }
    remove() {
        if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this);
        this.isConnected = false;
    }
    focus() {}
    animate(frames, options) {
        this.frames = frames;
        this.options = options;
        let resolve, reject;
        const finished = new Promise((a, b) => {
            resolve = a;
            reject = b;
        });
        this.anim = { finished, cancel: () => reject(new Error("cancelled")), finish: resolve };
        return this.anim;
    }
}
let notifications, reduced;
const entry = (id) => ({
    uid: id,
    uri: id,
    title: "Song " + id,
    artists: ["Artist"],
    imageUrl: id + ".png",
    isCurrent: false,
});
beforeEach(() => {
    Queue.teardown();
    notifications = [];
    reduced = false;
    globalThis.document = {
        activeElement: null,
        createElement: (tag) => Object.assign(new Node(), { tag }),
    };
    globalThis.window = { matchMedia: () => ({ matches: reduced }) };
    globalThis.getComputedStyle = () => ({ backgroundImage: "url(old.png)" });
    Spicetify.showNotification = (text) => notifications.push(text);
    Spicetify.Player.data.item.uri = "old";
    DOM.container = new Node();
    DOM.container.className = "side-view-queue";
    DOM.cover = new Node();
    DOM.cover.rect = { left: 120, top: 100, width: 400, height: 400, bottom: 500 };
    DOM.queue = new Node();
    DOM.queue.rect = { left: 700, top: 50, width: 600, height: 600, bottom: 650 };
    DOM.container.append(DOM.queue, DOM.cover);
    QueueAdapter.read = () => ({
        next: [entry("a")],
        later: [entry("b")],
    });
    Queue.attach(DOM.queue);
});
after(async () => {
    Queue.teardown();
    await rm(dir, { recursive: true, force: true });
});
test("gallery excludes the playing song and keeps the Up Next and Queue anchors", () => {
    assert.deepEqual(
        DOM.queue.children.map((n) => n.className),
        ["queue-gallery"],
    );
    assert.deepEqual(
        DOM.queue
            .querySelector(".queue-wall")
            .children.slice(0, 2)
            .map((n) => n.textContent),
        ["Up Next", "Queue"],
    );
    assert.deepEqual(
        DOM.queue.querySelectorAll(".queue-tile").map((n) => n.dataset.uri),
        ["a", "b"],
    );
});
test("queue updates retain unchanged card nodes instead of reloading every cover", () => {
    QueueAdapter.read = () => ({
        next: [entry("a"), entry("b"), entry("c")],
        later: [],
    });
    Queue.update(true);
    const retained = DOM.queue.querySelectorAll(".queue-tile").slice(1);
    QueueAdapter.read = () => ({
        next: [entry("x"), entry("b"), entry("c")],
        later: [],
    });
    Queue.update(true);
    const updated = DOM.queue.querySelectorAll(".queue-tile");
    assert.equal(updated[1], retained[0]);
    assert.equal(updated[2], retained[1]);
});
test("the next card is promoted in place so it can animate to the featured slot", () => {
    const promoted = DOM.queue.querySelectorAll(".queue-tile")[1];
    QueueAdapter.read = () => ({
        next: [entry("b"), entry("c")],
        later: [],
    });
    Queue.update(true);
    const tiles = DOM.queue.querySelectorAll(".queue-tile");
    assert.equal(tiles[0], promoted);
    assert.equal(tiles[0].classList.contains("queue-tile-lead"), true);
    assert.equal(
        tiles[0].querySelector(".queue-lead-copy").parent,
        tiles[0].querySelector(".queue-motion-layer"),
    );
});
test("failed playback never starts a cover handoff", async () => {
    QueueAdapter.play = async () => ({ ok: false });
    const tile = DOM.queue.querySelector(".queue-tile");
    tile.onclick();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(tile.classList.contains("is-selected"), false);
    assert.equal(notifications.length, 1);
    assert.equal(DOM.container.querySelectorAll(".queue-artwork-flight").length, 0);
});
test("confirmed track uses tile geometry and restores cover when cancelled", () => {
    Spicetify.Player.data.item.uri = "a";
    Queue.captureIncoming();
    Queue.landIncoming();
    const overlays = DOM.container.querySelectorAll(".queue-artwork-flight");
    assert.equal(overlays.length, 2);
    assert.equal(overlays[1].style.left, "800px");
    assert.match(overlays[1].frames[1].transform, /translate3d\(-680px,-40px,0\) scale\(2.5,2.5\)/);
    assert.equal(DOM.cover.classList.contains("queue-artwork-landing"), true);
    Queue.cancelHandoff();
    assert.equal(DOM.container.querySelectorAll(".queue-artwork-flight").length, 0);
    assert.equal(DOM.cover.classList.contains("queue-artwork-landing"), false);
});
test("rapid track change removes the prior flight before handing off the next cover", () => {
    Spicetify.Player.data.item.uri = "a";
    Queue.captureIncoming();
    Queue.landIncoming();
    Spicetify.Player.data.item.uri = "b";
    Queue.captureIncoming();
    Queue.landIncoming();
    assert.equal(DOM.container.querySelectorAll(".queue-artwork-flight").length, 2);
    assert.equal(DOM.container.querySelectorAll(".queue-artwork-flight")[1].src, "b.png");
});
test("reduced motion and a stale artwork load do not leave overlays", () => {
    reduced = true;
    Spicetify.Player.data.item.uri = "a";
    Queue.captureIncoming();
    Queue.landIncoming();
    assert.equal(DOM.container.querySelectorAll(".queue-artwork-flight").length, 0);
    reduced = false;
    Queue.captureIncoming();
    Spicetify.Player.data.item.uri = "b";
    Queue.landIncoming();
    assert.equal(DOM.container.querySelectorAll(".queue-artwork-flight").length, 0);
});
