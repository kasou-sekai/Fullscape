import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "fullscape-lifecycle-test-"));
await build({
    stdin: {
        contents:
            'export { Lyrics } from "./src/ui/components/Lyrics/Lyrics"; export { default as config } from "./src/utils/config"; export * as cache from "./src/services/lyrics-cache";',
        resolveDir: process.cwd(),
        loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: join(directory, "renderer.mjs"),
});
const originalSpicetify = globalThis.Spicetify;
const originalImage = globalThis.Image;
globalThis.Spicetify = { SVGIcons: {} };
globalThis.Image = class {};
const { Lyrics, config, cache } = await import(pathToFileURL(join(directory, "renderer.mjs")));
globalThis.Spicetify = originalSpicetify;
globalThis.Image = originalImage;
after(() => rm(directory, { recursive: true, force: true }));

function environment() {
    const saved = Object.fromEntries(
        ["localStorage", "document", "Spicetify", "fetch"].map((key) => [key, globalThis[key]]),
    );
    const storage = new Map();
    globalThis.localStorage = {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
    };
    globalThis.document = { dispatchEvent() {} };
    globalThis.Spicetify = {
        Player: { data: { item: { uri: "spotify:track:current", metadata: {} } } },
    };
    return () => Object.assign(globalThis, saved);
}

const flush = async () => {
    for (let index = 0; index < 10; index++) await Promise.resolve();
};

test("disabled shared bridge keeps cache writes local", async () => {
    const restore = environment();
    try {
        config.set("sharedLyricsBridge", false);
        let requests = 0;
        globalThis.fetch = async () => {
            requests++;
            throw new Error("Unexpected bridge request");
        };
        cache.setCachedLyrics("spotify:track:local-only", "spotify", [
            { time: 100, text: "Local lyric" },
        ]);
        cache.syncCachedLyricsToShared(
            cache.getCachedLyricsFullEntry("spotify:track:local-only", "spotify"),
        );
        await flush();
        assert.equal(requests, 0);
        assert.equal(
            cache.getCachedLyricsFullEntry("spotify:track:local-only", "spotify").lines.length,
            1,
        );
    } finally {
        restore();
    }
});

test("cached manual hide survives loading without retries or external requests", async () => {
    const restore = environment();
    const keys = [
        "renderStatus",
        "applyLines",
        "scheduleRefetch",
        "loadInterludeTempo",
        "getPreparedLyrics",
        "currentTrackUri",
    ];
    const saved = Object.fromEntries(keys.map((key) => [key, Lyrics[key]]));
    try {
        config.set("sharedLyricsBridge", false);
        config.set("thirdPartyLyrics", false);
        config.set("lyricsDisplay", true);
        cache.setCachedLyrics(
            "spotify:track:current",
            "spotify",
            [{ time: 100, text: "Hidden lyric" }],
            undefined,
            false,
            { cacheSource: "manual", hidden: true },
        );
        let hidden = false;
        Lyrics.renderStatus = (_text, unavailable) => {
            hidden = unavailable;
        };
        Lyrics.applyLines = () => assert.fail("Hidden lyrics were displayed");
        Lyrics.scheduleRefetch = () => assert.fail("Manual hide scheduled a retry");
        Lyrics.getPreparedLyrics = () => assert.fail("Manual hide requested external lyrics");
        Lyrics.loadInterludeTempo = () => assert.fail("Manual hide requested audio analysis");
        globalThis.fetch = () => assert.fail("Manual hide fetched lyrics");
        await Lyrics.loadLyrics("spotify:track:current");
        assert.equal(hidden, true);
        assert.equal(
            cache.getCachedLyricsFullEntry("spotify:track:current", "spotify").hidden,
            true,
        );
    } finally {
        Object.assign(Lyrics, saved);
        restore();
    }
});

test("polling stays single while pending and ignores stopped generations", async () => {
    const restore = environment();
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const keys = ["bestSharedPreferredEntry", "applySharedLyricsEntry", "currentTrackUri"];
    const saved = Object.fromEntries(keys.map((key) => [key, Lyrics[key]]));
    const timers = new Map();
    const pending = [];
    let nextTimer = 1;
    try {
        config.set("sharedLyricsBridge", true);
        config.set("lyricsDisplay", true);
        globalThis.setTimeout = (fn) => {
            const id = nextTimer++;
            timers.set(id, fn);
            return id;
        };
        globalThis.clearTimeout = (id) => timers.delete(id);
        Lyrics.currentTrackUri = "spotify:track:current";
        Lyrics.bestSharedPreferredEntry = () => new Promise((resolve) => pending.push(resolve));
        let applied = 0;
        Lyrics.applySharedLyricsEntry = () => {
            applied++;
        };
        const runTimer = () => {
            const [id, callback] = timers.entries().next().value;
            timers.delete(id);
            callback();
        };
        Lyrics.startSharedCacheSync();
        runTimer();
        Lyrics.startSharedCacheSync();
        assert.equal(timers.size, 0, "start during pending poll created a second chain");
        Lyrics.stopSharedCacheSync();
        Lyrics.startSharedCacheSync();
        runTimer();
        assert.equal(pending.length, 2);
        pending[0]({
            kind: "spotify",
            cacheSource: "manual",
            lines: [{ time: 100, text: "Stale" }],
        });
        await flush();
        assert.equal(applied, 0, "stopped poll applied stale lyrics");
        assert.equal(timers.size, 0, "stopped poll resurrected its timer");
        assert.equal(Lyrics.sharedSyncInFlight, true, "old poll cleared the new poll's lock");
        pending[1]({
            kind: "spotify",
            cacheSource: "manual",
            lines: [{ time: 100, text: "Current" }],
        });
        await flush();
        assert.equal(applied, 1);
        assert.equal(timers.size, 1);
        Lyrics.stopSharedCacheSync();
        assert.equal(timers.size, 0);
    } finally {
        Lyrics.stopSharedCacheSync();
        Object.assign(Lyrics, saved);
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
        restore();
    }
});

test("Spotify callers share pending lease setup and retry after failure", async () => {
    const restore = environment();
    const saved = {
        beginBridgeLease: Lyrics.beginBridgeLease,
        getLyricsWithRetry: Lyrics.getLyricsWithRetry,
    };
    try {
        config.set("sharedLyricsBridge", false);
        let resolveLease;
        let leases = 0;
        let releases = 0;
        let requests = 0;
        Lyrics.beginBridgeLease = () => {
            leases++;
            return new Promise((resolve) => {
                resolveLease = resolve;
            });
        };
        Lyrics.getLyricsWithRetry = async () => {
            requests++;
            throw new Error("Spotify unavailable");
        };
        const track = { uri: "spotify:track:dedupe", image: "image" };
        const first = Lyrics.getSpotifyLyrics(track);
        const second = Lyrics.getSpotifyLyrics(track);
        assert.equal(leases, 1);
        resolveLease(() => {
            releases++;
        });
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            await Promise.all([first, second]);
        } finally {
            console.warn = originalWarn;
        }
        assert.equal(requests, 1);
        assert.equal(releases, 1);
        assert.equal(Lyrics.spotifyRequests.has(track.uri), false);
        Lyrics.beginBridgeLease = async () => {
            leases++;
            return () => {
                releases++;
            };
        };
        Lyrics.getLyricsWithRetry = async () => {
            requests++;
            return { lyrics: { lines: [{ startTimeMs: "100", words: "Recovered" }] } };
        };
        const result = await Lyrics.getSpotifyLyrics(track);
        assert.equal(result[0].text, "Recovered");
        assert.equal(requests, 2);
        assert.equal(leases, 2);
        assert.equal(releases, 2);
    } finally {
        Object.assign(Lyrics, saved);
        restore();
    }
});

test("enhancement callers share lease setup and release once, including a failed setup retry", async () => {
    const restore = environment();
    const saved = {
        beginBridgeLease: Lyrics.beginBridgeLease,
        getSpotifyLyrics: Lyrics.getSpotifyLyrics,
    };
    try {
        config.set("sharedLyricsBridge", false);
        config.set("thirdPartyLyrics", true);
        config.set("relaxedLyricsMatching", false);
        Lyrics.getSpotifyLyrics = async () => [];
        const track = {
            uri: "spotify:track:enhanced-dedupe",
            title: "Song",
            artists: "Artist",
            album: "Album",
            duration: 200000,
        };
        let leases = 0;
        let releases = 0;
        let rejectLease;
        Lyrics.beginBridgeLease = () => {
            leases++;
            return new Promise((_resolve, reject) => {
                rejectLease = reject;
            });
        };
        const failed = [
            Lyrics.getPreparedLyrics(track, false, true),
            Lyrics.getPreparedLyrics(track, false, true),
        ];
        await flush();
        assert.equal(leases, 1);
        rejectLease(new Error("Lease unavailable"));
        const failures = await Promise.allSettled(failed);
        assert.ok(failures.every((result) => result.status === "rejected"));
        assert.equal(Lyrics.enhancedRequests.size, 0);
        let resolveLease;
        Lyrics.beginBridgeLease = () => {
            leases++;
            return new Promise((resolve) => {
                resolveLease = resolve;
            });
        };
        let requests = 0;
        globalThis.fetch = async () => {
            requests++;
            return { ok: true, text: async () => "{}" };
        };
        const retried = [
            Lyrics.getPreparedLyrics(track, false, true),
            Lyrics.getPreparedLyrics(track, false, true),
        ];
        await flush();
        assert.equal(leases, 2);
        resolveLease(() => {
            releases++;
        });
        await Promise.all(retried);
        assert.equal(requests, 3, "one enrichment searches NetEase and both QQ endpoints once");
        assert.equal(releases, 1);
        assert.equal(Lyrics.enhancedRequests.size, 0);
    } finally {
        Object.assign(Lyrics, saved);
        restore();
    }
});
