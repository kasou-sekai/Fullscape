import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
    entryPoints: ["src/app.tsx"],
    bundle: true,
    write: false,
    format: "esm",
    plugins: [
        {
            name: "app-lifecycle-dependencies",
            setup(builder) {
                builder.onResolve({ filter: /.*/ }, (args) => {
                    if (args.kind === "entry-point") return;
                    return { path: args.path, namespace: "lifecycle-stub" };
                });
                builder.onLoad({ filter: /.*/, namespace: "lifecycle-stub" }, ({ path }) => ({
                    contents: path.endsWith(".scss")
                        ? ""
                        : `
                    const h = globalThis.appLifecycleHarness;
                    export default h.defaults[${JSON.stringify(path)}] || {};
                    export const DOM = h.DOM;
                    export const ConfigManager = { init(...callbacks) { h.callbacks = callbacks; }, openConfig() {} };
                    export const Lyrics = h.Lyrics;
                    export const Cover = h.noop;
                    export const Queue = h.noop;
                    export const UpNext = h.noop;
                    export const PlayerControls = h.noop;
                    export const Background = h.noop;
                    export const ReleaseUpdater = h.release;
                    export const CLASSES_TO_ADD = ["fullscape-activated"];
                    export const APPLE_SYMBOLS = {};
                    export const MOTION = {};
                    export const prefersReducedMotion = () => true;
                    export const initializeMotionTokens = () => {};
                    export const animateFeedback = () => {};
                    export const cancelFeedback = () => {};
                    export const getHtmlContent = () => "display markup";
                    export const startSharedBridgePresence = () => {};
                    export const createOverflowScrollAnimation = () => {};
                    export const getOverflowScrollTiming = () => {};
                `,
                }));
            },
        },
    ],
    logLevel: "silent",
});

test("rebuilding active markup disposes its progress root and lyrics before replacement", async () => {
    const originalGlobals = new Map();
    const replaceGlobal = (name, value) => {
        originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    };
    const events = [];
    const mountedRoots = new Set();
    const queueListeners = [];
    class Element {
        style = { setProperty() {}, removeProperty() {} };
        attributes = {};
        nodes = new Map();
        classes = new Set();
        isConnected = false;
        classList = {
            add: (...names) => names.forEach((name) => this.classes.add(name)),
            remove: (...names) => names.forEach((name) => this.classes.delete(name)),
            contains: (name) => this.classes.has(name),
            toggle: (name, enabled) =>
                enabled ? this.classes.add(name) : this.classes.delete(name),
        };
        set innerHTML(value) {
            if (this === harness.DOM.container) {
                events.push("replace");
                assert.equal(mountedRoots.size, 0, "React cleanup must precede DOM replacement");
                assert.equal(
                    harness.lyricsAttached,
                    false,
                    "lyrics cleanup must precede replacement",
                );
            }
            this.nodes.clear();
        }
        querySelector(selector) {
            if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
            return this.nodes.get(selector);
        }
        querySelectorAll() {
            return [];
        }
        setAttribute(name, value) {
            this.attributes[name] = value;
        }
        addEventListener() {}
        removeEventListener() {}
        remove() {
            this.isConnected = false;
        }
        append(...nodes) {
            nodes.forEach((node) => {
                node.isConnected = true;
            });
        }
    }
    const settings = {
        lyricsDisplay: true,
        progressBarDisplay: "always",
        upnextDisplay: "never",
        playerControls: "never",
    };
    const globals = { locale: "en-US", activationTypes: "keys", autoLaunch: "never" };
    const noop = new Proxy({}, { get: (target, key) => (target[key] ||= () => {}) });
    const harness = {
        noop,
        lyricsAttached: false,
        DOM: {
            init() {
                this.container = new Element();
                this.style = new Element();
            },
        },
        Lyrics: {
            attach() {
                harness.lyricsAttached = true;
            },
            teardown() {
                events.push("lyrics teardown");
                harness.lyricsAttached = false;
            },
            prefetchNextLyrics() {},
        },
        release: {
            reportRuntimeVersion() {},
            initializeUpdateModel() {},
            shouldStartBundledVersion: async () => true,
            consumeLoadFailure: () => null,
        },
        defaults: {
            react: { createElement: () => ({}) },
            "react-dom": {
                render(_component, root) {
                    mountedRoots.add(root);
                },
                unmountComponentAtNode(root) {
                    events.push("unmount");
                    mountedRoots.delete(root);
                },
            },
            "./utils/config": { get: (key) => settings[key], getGlobal: (key) => globals[key] },
            "./utils/utils": {
                allNotExist: () => [],
                isModeActivated: () => document.body.classList.contains("fullscape-activated"),
                exitFullscreen() {},
            },
            "./utils/selectors": { getExtraBarSelector: () => new Element() },
            "./resources/strings": {
                "en-US": { sideView: { showQueue: "Show queue", showLyrics: "Show lyrics" } },
                "zh-CN": { sideView: { showQueue: "显示队列", showLyrics: "显示歌词" } },
            },
        },
    };
    try {
        replaceGlobal("appLifecycleHarness", harness);
        replaceGlobal("document", {
            body: new Element(),
            querySelector: () => new Element(),
            addEventListener() {},
            removeEventListener() {},
        });
        replaceGlobal("window", {
            innerWidth: 1200,
            innerHeight: 800,
            addEventListener() {},
            removeEventListener() {},
        });
        replaceGlobal("Spicetify", {
            Mousetrap: { bind() {}, unbind() {} },
            Player: {
                data: { item: {} },
                isPlaying: () => true,
                addEventListener() {},
                removeEventListener() {},
            },
            Platform: {
                PlayerAPI: {
                    _events: {
                        addListener(event, callback) {
                            if (event === "queue_update") queueListeners.push(callback);
                        },
                        removeListener(event, callback) {
                            if (event !== "queue_update") return;
                            const index = queueListeners.indexOf(callback);
                            if (index >= 0) queueListeners.splice(index, 1);
                        },
                    },
                },
            },
        });
        // Deferred entry refreshes are unrelated to markup lifecycle and remain pending here.
        replaceGlobal("setTimeout", () => 1);
        replaceGlobal("clearTimeout", () => {});
        const { default: main } = await import(
            `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
        );
        await main();
        const [render, activate, deactivate] = harness.callbacks;
        await activate();
        const oldRoot = harness.DOM.container.querySelector("#fullscape-progress-parent");
        assert.ok(mountedRoots.has(oldRoot));
        assert.equal(harness.lyricsAttached, true);
        events.length = 0;
        settings.lyricsDisplay = false;
        globals.locale = "zh-CN";
        render();
        assert.ok(events.indexOf("unmount") < events.indexOf("replace"));
        assert.ok(events.indexOf("lyrics teardown") < events.indexOf("replace"));
        assert.equal(mountedRoots.has(oldRoot), false);
        assert.equal(harness.DOM.container.attributes["data-locale"], "zh-CN");
        assert.equal(harness.DOM.sideView.attributes["aria-label"], "显示队列");
        await activate();
        assert.equal(queueListeners.length, 1, "rebuild must not accumulate queue listeners");
        await deactivate();
        assert.equal(queueListeners.length, 0);
        assert.equal(mountedRoots.size, 0);
        assert.equal(harness.lyricsAttached, false);
    } finally {
        for (const [name, descriptor] of originalGlobals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
});
