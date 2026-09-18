import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";
import { encryptQrc } from "qrc-decoder";

const buildDirectory = await mkdtemp(join(tmpdir(), "fullscape-lyrics-test-"));
const bundlePath = join(buildDirectory, "third-party-lyrics.mjs");
await build({
    entryPoints: ["src/services/third-party-lyrics.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: bundlePath,
});
const { parseQQMusicLyrics, enhanceWithThirdPartyLyrics, getThirdPartyLyricsDebug } = await import(
    pathToFileURL(bundlePath).href
);

after(async () => {
    await rm(buildDirectory, { recursive: true, force: true });
});

test("keeps QRC lines after raw quotes inside LyricContent", () => {
    const decrypted = `<?xml version="1.0" encoding="utf-8"?>
<QrcInfos>
<LyricInfo LyricCount="1">
<Lyric_1 LyricType="1" LyricContent="[0,1000]before(0,1000)
[1000,1000]"quoted"(1000,1000)
[2000,1000]after(2000,1000)"/>
</LyricInfo>
</QrcInfos>`;
    const encrypted = encryptQrc(decrypted);
    const response = `<content><![CDATA[${encrypted}]]></content>`;

    const parsed = parseQQMusicLyrics(response);

    assert.deepEqual(
        parsed.dynamicLines.map((line) => line.text),
        ["before", '"quoted"', "after"],
    );
});

const track = { title: "Example", artists: "Artist", album: "Album", duration: 180000 };
const song = {
    id: 1,
    name: "Example",
    dt: 180000,
    ar: [{ name: "Artist" }],
    al: { name: "Album" },
};

test("retries resolved Cosmos errors through the proxy and matches NetEase", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => {
        if (!String(url).startsWith("https://cors-proxy.spicetify.app/"))
            throw new TypeError("CORS");
        if (String(url).includes("cloudsearch"))
            return new Response(JSON.stringify({ code: 200, result: { songs: [song] } }));
        if (String(url).includes("song/lyric"))
            return new Response(JSON.stringify({ code: 200, lrc: { lyric: "[00:10.00]Hello" } }));
        return new Response(JSON.stringify({ code: 403, message: "Forbidden" }));
    });
    globalThis.localStorage = { getItem: () => null };
    globalThis.Spicetify = {
        CosmosAsync: {
            get: async () => ({ code: 403, error: "Forbidden" }),
            post: async () => ({ code: 403, error: "Forbidden" }),
        },
    };
    const lines = await enhanceWithThirdPartyLyrics([], track);
    assert.equal(lines[0].text, "Hello");
    assert.equal(getThirdPartyLyricsDebug().status, "matched");
});

test("provider business failures remain retryable rather than an empty match", async (t) => {
    t.mock.method(
        globalThis,
        "fetch",
        async () => new Response(JSON.stringify({ code: 0, req_1: { code: 2000 } })),
    );
    globalThis.localStorage = { getItem: () => null };
    await enhanceWithThirdPartyLyrics([], track);
    assert.equal(getThirdPartyLyricsDebug().status, "error");
});

test("lyric download failures remain retryable", async (t) => {
    t.mock.method(globalThis, "fetch", async (url) => {
        if (String(url).includes("cloudsearch"))
            return new Response(JSON.stringify({ code: 200, result: { songs: [song] } }));
        if (String(url).includes("song/lyric")) throw new Error("offline");
        return new Response(JSON.stringify({ code: 0, data: {} }));
    });
    globalThis.localStorage = { getItem: () => null };
    globalThis.Spicetify = {
        CosmosAsync: {
            get: async () => {
                throw new Error("offline");
            },
        },
    };
    await enhanceWithThirdPartyLyrics([], track);
    assert.equal(getThirdPartyLyricsDebug().status, "error");
    assert.equal(getThirdPartyLyricsDebug().candidates[0].fetchError, true);
});
