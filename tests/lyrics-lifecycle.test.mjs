import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

// Run the actual app lifecycle and Lyrics renderer with a minimal Spotify/DOM host.
// Keep unrelated UI components outside this test; no production test exports are needed.
const appPath = resolve("src/app.tsx");
const appModules = {
    react: "export default { createElement() {} };",
    "react-dom":
        "export default { render(_, node) { globalThis.host.progressRoot = node; }, unmountComponentAtNode(node) { if (globalThis.host.progressRoot === node) globalThis.host.progressWasUnmounted = node.isConnected; } };",
    "./constants/apple-system-symbols": "export const APPLE_SYMBOLS = {};",
    "./constants": "export default {}; export const CLASSES_TO_ADD = [];",
    "./utils/motion": "export const initializeMotionTokens = () => {}; export const animateFeedback = () => {}; export const cancelFeedback = () => {}; export const prefersReducedMotion = () => true; export const MOTION = {};",
    "./utils/selectors": "export default { getExtraBarSelector: () => globalThis.host.extraBar ?? null };",
    "./utils/overflow-scroll":
        "export const createOverflowScrollAnimation = () => {}; export const getOverflowScrollTiming = () => {};",
    "./services/html-creator": 'export const getHtmlContent = () => "markup";',
    "./services/mousetrap-record": "export const initMoustrapRecord = () => {};",
    "./services/lyrics-bridge": "export const startSharedBridgePresence = () => {};",
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
        "export const PlayerControls = { showLyricsTools() {}, updatePlayerControls() { globalThis.host.controlsUpdated = true; } };",
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
        attributes = new Map();
        isConnected = true;
        dataset = {};
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
        setAttribute(name, value) {
            this.attributes.set(name, value);
        }
        getAttribute(name) {
            return this.attributes.get(name) ?? null;
        }
        toggleAttribute() {}
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
        typography: { preset: "default", family: "", weight: 0 },
        sharedLyricsBridge: true,
        upnextDisplay: "never",
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
            documentElement: new Element(),
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
        window: sandbox.window,
    };
}

test("playback controls and progress stay enabled with legacy settings and re-render cleans up", async () => {
    const { main, host, settings, window } = createHost(true);
    settings.lyricsDisplay = false;
    // Bypass config migration in the fixture to confirm these old values cannot affect playback.
    settings.progressBarDisplay = "never";
    settings.playerControls = "never";
    settings.verticalMonitorSupport = false;
    window.innerWidth = 800;
    window.innerHeight = 1200;
    const classes = new Map();
    host.DOM.container.classList.toggle = (name, active) => classes.set(name, active);
    await main();
    await host.callbacks.activate();
    const previousRoot = host.progressRoot;
    assert.ok(previousRoot?.isConnected);
    assert.equal(host.controlsUpdated, true);
    assert.equal(classes.get("vertical-mode"), true);

    host.callbacks.render();
    assert.equal(host.progressWasUnmounted, true);
    assert.equal(previousRoot.isConnected, false);
});

test("uses spare height on narrower landscape displays and restores the 16:9 reference", async () => {
    const { main, host, window } = createHost(true);
    const classes = new Map();
    const css = new Map();
    host.DOM.container.classList.toggle = (name, active) => classes.set(name, active);
    host.DOM.container.style.setProperty = (name, value) => css.set(name, value);
    await main();

    for (const [width, height, compact, scale, playerWidth] of [
        [1440, 900, true, 5 / 6, 46.8],
        [1280, 960, true, (2 / 3) * 1.18, 42],
        [1000, 1000, true, (1000 / 1920) * 1.18, 42],
        [1920, 1080, false, 1, 50],
        [2560, 1080, false, 1, 50],
        [1080, 1920, false, 1, 50],
    ]) {
        window.innerWidth = width;
        window.innerHeight = height;
        host.callbacks.render();

        assert.equal(classes.get("compact-landscape"), compact);
        assert.ok(Math.abs(Number(css.get("--fullscape-content-scale")) - scale) < 1e-9);
        assert.ok(
            Math.abs(parseFloat(css.get("--fullscape-compact-player-width")) - playerWidth) < 1e-9,
        );
    }
});

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

test("keyboard-only activation hides the native fullscreen button after player bar replacements", async () => {
    const { main, host, shortcuts } = createHost(true);
    host.globalSettings.hideSpotifyFullscreenButton = true;
    const nativeButton = host.createElement();
    host.extraBar = host.createElement();
    host.extraBar.querySelector = (selector) =>
        selector === '[data-testid="fullscreen-mode-button"]' ? nativeButton : null;
    await main();
    assert.equal(nativeButton.style.display, "none");
    assert.equal(host.extraBar.appended, undefined);
    assert.equal(typeof shortcuts.get("f"), "function");

    const legacyButton = host.createElement();
    host.extraBar = host.createElement();
    host.extraBar.querySelector = (selector) =>
        selector === 'button[title="Full screen"]' ? legacyButton : null;
    host.observers[0]();
    assert.equal(legacyButton.style.display, "none");
    assert.equal(host.extraBar.appended, undefined);
});

test("re-render uses the current UI language and the selected lyric size", async () => {
    const { main, host, settings } = createHost(true);
    const css = new Map();
    host.DOM.container.style.setProperty = (name, value) => css.set(name, value);
    settings.lyricsSize = 12;
    await main();
    assert.equal(host.DOM.container.getAttribute("data-locale"), "en-US");
    assert.equal(host.DOM.sideView.getAttribute("aria-label"), "Show queue");
    assert.equal(css.get("--lyrics-font-size"), "12px");

    host.globalSettings.locale = "ja-JP";
    for (const size of [13, 15, 88, 89, 99]) {
        settings.lyricsSize = size;
        host.callbacks.render();
        assert.equal(css.get("--lyrics-font-size"), `${size}px`);
    }
    assert.equal(host.DOM.container.getAttribute("data-locale"), "ja-JP");
    assert.equal(host.DOM.sideView.getAttribute("aria-label"), "キューを表示");
    assert.equal(
        host.DOM.container.querySelector("#fullscape-translation").getAttribute("aria-label"),
        "歌詞の翻訳",
    );
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

test("refreshing a ready Apple document restores polling after its early return", async () => {
    const { Lyrics, host, settings, player, timers } = createHost(false);
    const uri = player.data.item.uri;
    settings.lyricsSource = "apple-music";
    Lyrics.container = host.createElement();
    Lyrics.currentTrackUri = uri;
    Lyrics.getCurrentTrack = () => ({ uri, title: "Example", artists: "Artist" });
    Lyrics.loadInterludeTempo = () => {};
    Lyrics.coordinator.activate = async () => ({ trackUri: uri, lines: [] });
    let rendered = false;
    Lyrics.applyRichEntry = () => {
        rendered = true;
        Lyrics.loadSequence++;
    };
    Lyrics.startSharedCacheSync();
    const previousTimer = Lyrics.sharedSyncTimer;
    await Lyrics.loadLyrics(uri, "all");
    assert.equal(rendered, true);
    assert.equal(timers.has(previousTimer), false);
    assert.ok(Lyrics.sharedSyncTimer);
    assert.ok(timers.has(Lyrics.sharedSyncTimer));
    assert.equal(Lyrics.richDecisionInFlight, false);
    Lyrics.teardown();
});

for (const cached of [false, true]) {
    test(`plain Apple lyrics render when ordinary lyrics are ${cached ? "cached empty" : "unavailable"}`, async () => {
        const { Lyrics, host, settings, player } = createHost(false);
        const uri = player.data.item.uri;
        settings.lyricsSource = "auto";
        const entry = {
            trackUri: uri,
            sourceFamily: "apple-music",
            lines: [{
                time: 1000,
                text: "Hello ocean",
                presentation: {
                    isBackground: false, end: 5, timingMode: "Line",
                    element: { name: "p", attributes: {}, children: [] },
                },
            }],
        };
        Lyrics.container = host.createElement();
        Lyrics.getCurrentTrack = () => ({ uri, title: "Example", artists: "Artist" });
        Lyrics.loadInterludeTempo = () => {};
        Lyrics.coordinator.activate = async () => entry;
        Lyrics.getPreparedLyricsFromCache = () => cached ? [] : null;
        Lyrics.bestSharedPreferredEntry = async () => null;
        Lyrics.getPreparedLyrics = async () => [];
        Lyrics.beginBridgeLease = async () => () => {};
        let rendered = null;
        Lyrics.applyRichEntry = (value) => { rendered = value; Lyrics.loadSequence++; };
        await Lyrics.loadLyrics(uri);
        assert.equal(rendered, entry);
        Lyrics.teardown();
    });
}

test("a saved Shiori lyric blocks provider requests for current and next tracks", async () => {
    const { Lyrics, host, settings, player } = createHost(false);
    const uri = player.data.item.uri;
    const track = { uri, title: "Example", artists: "Artist" };
    const entry = {
        trackUri: uri,
        kind: "enhanced",
        cacheSource: "without-plugin",
        lines: [{ time: 1000, text: "Hello ocean" }],
    };
    settings.lyricsSource = "auto";
    Lyrics.container = host.createElement();
    Lyrics.getCurrentTrack = () => track;
    Lyrics.loadInterludeTempo = () => {};
    Lyrics.coordinator.activate = async (_track, _baseline, _onLate, cachedOnly) => {
        assert.equal(cachedOnly, true);
        return null;
    };
    Lyrics.coordinator.prepareCached = async () => null;
    Lyrics.coordinator.prepare = () => assert.fail("unexpected Apple Music search");
    Lyrics.bestSharedPreferredEntry = async () => entry;
    Lyrics.getPreparedLyrics = () => assert.fail("unexpected external lyrics request");
    Lyrics.beginBridgeLease = () => assert.fail("unexpected fetch lease");
    let rendered;
    Lyrics.applySharedLyricsEntry = (_uri, value) => { rendered = value; };
    await Lyrics.loadLyrics(uri);
    assert.equal(rendered, entry);
    await Lyrics.prefetchNextLyricsFromBestSource(track);
    Lyrics.teardown();
});
