import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const buildDirectory = await mkdtemp(join(tmpdir(), "fullscape-lyrics-cache-"));
const bundlePath = join(buildDirectory, "lyrics-cache.mjs");
await build({
    entryPoints: ["src/services/lyrics-cache.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: bundlePath,
});

const storage = new Map([
    ["fullscape:config", JSON.stringify({ def: { sharedLyricsBridge: true } })],
]);
globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
};
globalThis.Spicetify = { SVGIcons: { album: "", artist: "" } };

const { getCachedLyricsFullEntry, getSharedCachedLyrics, setCachedLyrics } = await import(
    pathToFileURL(bundlePath).href
);

after(async () => {
    await rm(buildDirectory, { recursive: true, force: true });
});

test("shared reads stay local-cache read-only and preserve manual authority", async (t) => {
    const trackUri = "spotify:track:bridge-cache-read-only";
    const cacheKey = "fullscape:lyrics-cache-v1";
    const sharedEntry = {
        kind: "enhanced",
        trackUri,
        cachedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        lines: [{ time: 0, duration: 1_000, text: "shared" }],
        cacheSource: "plugin",
        source: "plugin",
    };
    let requestUrl;
    t.mock.method(globalThis, "fetch", async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/bridge-session") {
            return new Response(JSON.stringify({ token: "session", protocolVersion: 1 }), {
                headers: { "Content-Type": "application/json" },
            });
        }
        assert.equal(url.pathname, "/lyrics-cache");
        requestUrl = url;
        return new Response(JSON.stringify(sharedEntry), {
            headers: { "Content-Type": "application/json" },
        });
    });

    const metadata = { title: "Example", artist: "Artist", album: "Album", duration: 180_000 };
    assert.deepEqual(await getSharedCachedLyrics(trackUri, "enhanced", metadata), sharedEntry);
    assert.equal(requestUrl.searchParams.get("title"), metadata.title);
    assert.equal(requestUrl.searchParams.get("artist"), metadata.artist);
    assert.equal(requestUrl.searchParams.get("album"), metadata.album);
    assert.equal(requestUrl.searchParams.get("duration"), `${metadata.duration}`);
    assert.equal(storage.has(cacheKey), false, "a shared GET must not create a local cache entry");

    assert.equal(
        setCachedLyrics(
            trackUri,
            "enhanced",
            [{ time: 0, duration: 1_000, text: "manual" }],
            undefined,
            false,
            { cacheSource: "manual", isManualSelection: true },
        ),
        true,
    );
    assert.deepEqual(await getSharedCachedLyrics(trackUri, "enhanced", metadata), sharedEntry);
    assert.equal(
        getCachedLyricsFullEntry(trackUri, "enhanced")?.lines[0].text,
        "manual",
        "a shared read must not replace the locally selected manual entry",
    );
    assert.equal(
        setCachedLyrics(
            trackUri,
            "enhanced",
            [{ time: 0, duration: 1_000, text: "automatic" }],
            undefined,
            false,
            { cacheSource: "plugin" },
        ),
        false,
        "automatic writes must remain blocked by a manual cache entry",
    );
    assert.equal(getCachedLyricsFullEntry(trackUri, "enhanced")?.lines[0].text, "manual");
});
