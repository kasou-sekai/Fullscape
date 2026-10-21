import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

// Run the actual app lifecycle and Lyrics renderer with a minimal Spotify/DOM host.
// Keep unrelated UI components outside this test; no production test exports are needed.
const appPath = resolve("src/app.tsx");
const appModules = {
    react: "export default {};",
    "react-dom": "export default { unmountComponentAtNode() {} };",
    "./constants/apple-system-symbols": "export const APPLE_SYMBOLS = {};",
    "./constants": "export default {}; export const CLASSES_TO_ADD = [];",
    "./utils/motion": "export const initializeMotionTokens = () => {}; export const animateFeedback = () => {}; export const cancelFeedback = () => {}; export const prefersReducedMotion = () => true; export const MOTION = {};",
    "./utils/selectors": "export default { getExtraBarSelector: () => globalThis.host.extraBar ?? null };",
    "./resources/strings": 'export default { "en-US": { sideView: {} } };',
    "./utils/overflow-scroll":
        "export const createOverflowScrollAnimation = () => {}; export const getOverflowScrollTiming = () => {};",
    "./services/html-creator": 'export const getHtmlContent = () => "markup";',
    "./services/mousetrap-record": "export const initMoustrapRecord = () => {};",
    "./services/lyrics-cache": "export const startSharedBridgePresence = () => {};",
    "./services/release-updater":
        "export const ReleaseUpdater = { reportRuntimeVersion() {}, shouldStartBundledVersion: async () => true, consumeLoadFailure: () => null };",
    "./ui/components/ProgressBar/ProgressBar": "export default () => {};",
    "./ui/components/Config/Config":
        "export const ConfigManager = { openConfig() {}, init(render, activate, deactivate) { globalThis.host.callbacks = { render, activate, deactivate }; } };",
    "./ui/components/Queue/Queue":
        "export const Queue = { teardown() {}, attach() {}, cancelHandoff() {}, scheduleUpdate() {} };",
    "./ui/components/Cover/Cover": "export const Cover = { teardown() {}, attach() {} };",
    "./ui/components/UpNext/UpNext":
        "export const UpNext = { updateUpNext() {}, updateUpNextShow() {}, teardown() {} };",
    "./ui/components/PlayerControls/PlayerControls":
        "export const PlayerControls = { showLyricsTools() {}, updatePlayerControls() {}, hidePlayerControls() {} };",
    "./utils/background": "export const Background = { stop() {}, updateBackground() {} };",
};
const { outputFiles } = await build({
    stdin: {
        contents:
            'export { default as main } from "./src/app"; export { Lyrics } from "./src/ui/components/Lyrics/Lyrics";',
        resolveDir: process.cwd(),
    },
    bundle: true,
    format: "cjs",
    platform: "browser",
    write: false,
    plugins: [
        {
            name: "lifecycle-host",
            setup(builder) {
                builder.onResolve({ filter: /.*/ }, (args) => {
                    const target = resolve(dirname(args.importer || appPath), args.path);
                    if (target === resolve("src/utils/config"))
                        return { path: "config", namespace: "host" };
                    if (target === resolve("src/ui/elements"))
                        return { path: "dom", namespace: "host" };
                    if (args.importer !== appPath) return;
                    if (args.path.endsWith(".scss")) return { path: "style", namespace: "host" };
                    if (Object.hasOwn(appModules, args.path))
                        return { path: args.path, namespace: "host" };
                });
                builder.onLoad({ filter: /.*/, namespace: "host" }, ({ path }) => ({
                    contents:
                        path === "config"
                            ? "export default globalThis.host.config;"
                            : path === "dom"
                              ? "export const DOM = globalThis.host.DOM;"
                              : path === "style"
                                ? ""
                                : appModules[path],
                }));
            },
        },
    ],
});

function createHost(playing) {
    const noop = () => {};
    class Element {
        children = new Map();
        isConnected = true;
        style = { setProperty: noop, removeProperty: noop };
        classList = { add: noop, remove: noop, toggle: noop, contains: () => false };
        markup = "";
        get innerHTML() {
            return this.markup;
        }
        set innerHTML(value) {
            this.markup = value;
            for (const child of this.children.values()) child.isConnected = false;
            this.children.clear();
        }
        querySelector(selector) {
            if (!this.children.has(selector)) this.children.set(selector, new Element());
            return this.children.get(selector);
        }
        append(...nodes) {
            this.appended = nodes;
        }
        querySelectorAll() {
            return [];
        }
        setAttribute() {}
        addEventListener() {}
        removeEventListener() {}
        remove() {
            this.isConnected = false;
        }
    }
    let nextId = 0;
    const frames = new Map();
    const timers = new Map();
    const shortcuts = new Map();
    const settings = {
        lyricsDisplay: true,
        sharedLyricsBridge: true,
        upnextDisplay: "never",
        playerControls: "never",
        progressBarDisplay: "never",
    };
    const globalSettings = { locale: "en-US", activationTypes: "keys", autoLaunch: "never" };
    const host = {
        globalSettings,
        observers: [],
        createElement: () => new Element(),
        DOM: { container: new Element(), style: new Element(), init: noop },
        config: {
            get: (key) => settings[key],
            getGlobal: (key) => globalSettings[key],
        },
    };
    const sandbox = {
        host,
        module: { exports: {} },
        console,
        URL,
        URLSearchParams,
        AbortController,
        TextEncoder,
        TextDecoder,
        fetch: async () => new Response(JSON.stringify({ token: "test", protocolVersion: 1 })),
        navigator: { language: "en-US" },
        localStorage: { getItem: () => null, setItem: noop },
        document: {
            body: new Element(),
            querySelector: () => null,
            createElement: () => new Element(),
            getElementById: (id) => host.extraBar?.appended?.find((node) => node.id === id) ?? null,
            addEventListener: noop,
            removeEventListener: noop,
        },
        MutationObserver: class {
            constructor(callback) { host.observers.push(callback); }
            observe() {}
        },
        window: { innerWidth: 1200, innerHeight: 800, addEventListener: noop, removeEventListener: noop },
        Spicetify: {
            CosmosAsync: { get: async () => null },
            Mousetrap: { bind: (key, handler) => shortcuts.set(key, handler), unbind: (key) => shortcuts.delete(key) },
            Player: {
                data: { item: { uri: "spotify:track:example" } },
                isPlaying: () => playing,
                getProgress: () => 10,
                addEventListener: noop,
                removeEventListener: noop,
            },
            Platform: { PlayerAPI: { _events: { addListener: noop, removeListener: noop } } },
        },
        requestAnimationFrame: (callback) => {
            const id = ++nextId;
            frames.set(id, callback);
            return id;
        },
        cancelAnimationFrame: (id) => frames.delete(id),
        setTimeout: (callback, delay) => {
            const id = ++nextId;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout: (id) => timers.delete(id),
        clearInterval: noop,
    };
    runInNewContext(outputFiles[0].text, sandbox);
    return {
        ...sandbox.module.exports,
        host,
        settings,
        shortcuts,
        frames,
        timers,
        player: sandbox.Spicetify.Player,
        platform: sandbox.Spicetify.Platform,
        body: sandbox.document.body,
    };
}

for (const playing of [true, false]) {
    test(`disabling lyrics stops the ${playing ? "animation frame" : "paused timer"} before replacing its DOM`, async () => {
        const { main, Lyrics, host, settings, frames, timers } = createHost(playing);
        await main();
        const previousContainer = host.DOM.lyrics;
        // Seed a synced renderer, then use its real scheduling and teardown methods.
        Lyrics.isSynced = true;
        Lyrics.startLoop();
        Lyrics.currentTrackUri = "spotify:track:example";
        Lyrics.startSharedCacheSync();
        let disconnected = false;
        Lyrics.resizeObserver = {
            disconnect() {
                disconnected = true;
            },
        };
        assert.equal(
            playing
                ? frames.size
                : [...timers.values()].filter(({ delay }) => delay === 250).length,
            1,
        );
        assert.ok(timers.size > 0);
        settings.lyricsDisplay = false;
        host.callbacks.render();
        assert.equal(frames.size, 0);
        assert.equal(timers.size, 0);
        assert.equal(disconnected, true);
        assert.equal(previousContainer.isConnected, false);
        assert.equal(Lyrics.container, null);
        assert.equal(host.DOM.lyrics, null);
        settings.lyricsDisplay = true;
        host.callbacks.render();
        assert.notEqual(host.DOM.lyrics, previousContainer);
        assert.equal(Lyrics.container, host.DOM.lyrics);
        await host.callbacks.deactivate();
    });
}

test("exit cleans up an existing renderer even if lyrics were already disabled", async () => {
    const { main, Lyrics, host, settings, frames, timers } = createHost(true);
    await main();
    Lyrics.isSynced = true;
    Lyrics.startLoop();
    assert.equal(frames.size, 1);
    settings.lyricsDisplay = false;
    await host.callbacks.deactivate();
    assert.equal(frames.size, 0);
    assert.equal(timers.size, 0);
    assert.equal(Lyrics.container, null);
});

test("a lyrics response arriving after disable cannot render or restart work", async () => {
    const { main, Lyrics, host, settings, frames, timers, player, platform } = createHost(true);
    settings.sharedLyricsBridge = false;
    player.data.item.metadata = {
        title: "Example",
        image_xlarge_url: "https://example.test/cover.jpg",
    };
    let respond;
    let markStarted;
    const response = new Promise((resolve) => {
        respond = resolve;
    });
    const started = new Promise((resolve) => {
        markStarted = resolve;
    });
    const builder = {
        build() {
            return this;
        },
        withHost() {
            return this;
        },
        withPath() {
            return this;
        },
        withQueryParameters() {
            return this;
        },
        withEndpointIdentifier() {
            return this;
        },
        send() {
            markStarted();
            return response;
        },
    };
    platform.Registry = { resolve: () => builder };
    await main();
    const previousContainer = host.DOM.lyrics;
    const loading = Lyrics.loadLyrics(player.data.item.uri);
    await started;
    const beforeDisable = previousContainer.innerHTML;
    settings.lyricsDisplay = false;
    host.callbacks.render();
    respond({ body: { lyrics: { lines: [{ startTimeMs: "0", words: "stale response" }] } } });
    await loading;
    // Let the completed request's shared-cache publication settle as well.
    await new Promise(setImmediate);
    assert.equal(previousContainer.innerHTML, beforeDisable);
    assert.equal(Lyrics.container, null);
    assert.equal(Lyrics.lines.length, 0);
    assert.equal(frames.size, 0);
    assert.equal(Lyrics.updateTimer, null);
    assert.equal(Lyrics.refetchTimer, null);
    assert.equal(Lyrics.sharedSyncTimer, null);
    assert.equal(timers.size, 0);
    settings.lyricsDisplay = true;
    host.callbacks.render();
    assert.notEqual(host.DOM.lyrics, previousContainer);
    assert.equal(host.DOM.lyrics.innerHTML, "");
    await host.callbacks.deactivate();
});

// Use the real readiness check: there is no Spotify bottom bar in this host.
test("registers F and completes rendering without a Spotify bottom bar or Mousetrap prototype", async () => {
    const { main, host, shortcuts } = createHost(true);
    await main();
    assert.equal(typeof shortcuts.get("f"), "function");
    assert.ok(host.DOM.title);
    assert.ok(host.callbacks.activate);
});

test("F mounts the display on body when Spotify no longer has the legacy root", async () => {
    const { main, host, shortcuts, settings, body } = createHost(true);
    settings.lyricsDisplay = false;
    await main();
    await shortcuts.get("f")();
    assert.deepEqual(body.appended, [host.DOM.style, host.DOM.container]);
    assert.equal(typeof shortcuts.get("esc"), "function");
    await shortcuts.get("esc")();
    assert.equal(host.DOM.container.isConnected, false);
});

test("a delayed or replaced bottom bar gets one working button and keeps the F fallback", async () => {
    const { main, host, shortcuts, settings, body } = createHost(true);
    host.globalSettings.activationTypes = "btns";
    settings.lyricsDisplay = false;
    await main();
    assert.equal(typeof shortcuts.get("f"), "function");
    assert.equal(host.observers.length, 1);
    host.extraBar = host.createElement();
    host.observers[0]();
    const firstButton = host.extraBar.appended[0];
    assert.equal(firstButton.id, "fullscape-default-button");
    assert.equal(firstButton.type, "button");
    host.observers[0]();
    assert.equal(host.extraBar.appended[0], firstButton);
    host.extraBar = host.createElement();
    host.observers[0]();
    const replacementButton = host.extraBar.appended[0];
    assert.notEqual(replacementButton, firstButton);
    await replacementButton.onclick();
    assert.deepEqual(body.appended, [host.DOM.style, host.DOM.container]);
    await shortcuts.get("esc")();
});

test("timing corrections also update the lyric templates used after a resize", () => {
    const { Lyrics } = createHost(true);
    const block = {};
    const word = {
        dataset: { time: "100" },
        classList: { remove() {} },
        style: { removeProperty() {} },
    };
    const line = {
        dataset: {},
        querySelectorAll: (selector) => selector === ".rnp-lyrics-line-content > div"
            ? [block]
            : selector === ".rnp-karaoke-word" ? [word] : [],
    };
    Lyrics.lineNodes = [line];
    Lyrics.wrappingTemplates.set(block,
        '<span data-time="100" data-duration="200">word</span><rt data-time="100">reading</rt>');
    Lyrics.updateTimingInPlace([{ time: 350 }], 250);
    assert.equal(word.dataset.time, "350");
    assert.equal(Lyrics.wrappingTemplates.get(block),
        '<span data-time="350" data-duration="200">word</span><rt data-time="350">reading</rt>');
});
