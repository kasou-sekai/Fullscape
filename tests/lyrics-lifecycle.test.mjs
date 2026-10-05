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
    "./utils/utils": "export default { allNotExist: () => [], isModeActivated: () => false };",
    "./utils/selectors": "export default { getExtraBarSelector: () => null };",
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
        "export const ConfigManager = { init(render, activate, deactivate) { globalThis.host.callbacks = { render, activate, deactivate }; } };",
    "./ui/components/Queue/Queue":
        "export const Queue = { teardown() {}, attach() {}, cancelHandoff() {}, scheduleUpdate() {} };",
    "./ui/components/Cover/Cover": "export const Cover = { teardown() {}, attach() {} };",
    "./ui/components/UpNext/UpNext":
        "export const UpNext = { updateUpNext() {}, updateUpNextShow() {} };",
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
        classList = { add: noop, remove: noop, toggle: noop };
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
    const settings = {
        lyricsDisplay: true,
        sharedLyricsBridge: true,
        upnextDisplay: "never",
        playerControls: "never",
    };
    const host = {
        DOM: { container: new Element(), style: new Element(), init: noop },
        config: {
            get: (key) => settings[key],
            getGlobal: (key) =>
                ({ locale: "en-US", activationTypes: "keys", autoLaunch: "never" })[key],
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
        document: { body: new Element(), querySelector: () => null, removeEventListener: noop },
        window: { innerWidth: 1200, innerHeight: 800, removeEventListener: noop },
        Spicetify: {
            CosmosAsync: { get: async () => null },
            Mousetrap: { bind: noop, unbind: noop },
            Player: {
                data: { item: { uri: "spotify:track:example" } },
                isPlaying: () => playing,
                getProgress: () => 10,
                removeEventListener: noop,
            },
            Platform: { PlayerAPI: { _events: { removeListener: noop } } },
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
        frames,
        timers,
        player: sandbox.Spicetify.Player,
        platform: sandbox.Spicetify.Platform,
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
