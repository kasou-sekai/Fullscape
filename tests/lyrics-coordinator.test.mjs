import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
const { outputFiles } = await build({
    stdin: {
        contents:
            'export {LyricsCoordinator} from "./src/services/lyrics-coordinator"; export {MATCHER_VERSION} from "./src/services/lyrics-matcher-version";',
        resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
    plugins: [
        {
            name: "host",
            setup(builder) {
                builder.onResolve({ filter: /.*/ }, (args) => {
                    const path = resolve(dirname(args.importer || "."), args.path);
                    if (path === resolve("src/utils/config"))
                        return { path: "config", namespace: "host" };
                    if (path === resolve("src/services/lyrics-cache"))
                        return { path: "cache", namespace: "host" };
                });
                builder.onLoad({ filter: /.*/, namespace: "host" }, ({ path }) => ({
                    contents:
                        path === "config"
                            ? "export default {get:key=>globalThis.fixture.config[key]};"
                            : "export const supportsRichLyricsBridge=async()=>globalThis.fixture.supported; export const fetchBridge=(...args)=>globalThis.fixture.fetch(...args); export const getCachedLyricsFullEntry=()=>globalThis.fixture.ordinary ?? null; export const getEffectiveCacheSource=entry=>entry?.cacheSource;",
                }));
            },
        },
    ],
});
const { LyricsCoordinator, MATCHER_VERSION } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);
const track = {
    uri: "spotify:track:coordinator",
    title: "Example",
    artists: "Artist",
    album: "Album",
    duration: 180000,
};
const reference = [{ time: 10000, text: "Hello ocean" }];
const entry = {
    kind: "enhanced",
    trackUri: track.uri,
    cachedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    sourceFamily: "apple-music",
    validatedMatcherVersion: MATCHER_VERSION,
    documentRevision: "abc",
    lines: [
        {
            time: 10000,
            text: "Hello ocean",
            duration: 5000,
            presentation: {
                key: "L1",
                end: 15,
                isBackground: false,
                element: { name: "p", attributes: {}, children: [] },
            },
        },
    ],
};
test("prefetch and activation coalesce; only activation receives the rich document", async () => {
    const bodies = [];
    let baselineCount = 0;
    let providerCount = 0;
    globalThis.fixture = {
        supported: true,
        config: { sharedLyricsBridge: true, lyricsSource: "auto" },
        fetch: async (url, init) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            let status;
            if (!body.referenceKnown) status = "reference-required";
            else if (url.endsWith("/activate")) status = "ready";
            else {
                if (providerCount === 0) {
                    providerCount++;
                    await new Promise((r) => setTimeout(r, 20));
                }
                status = "ready";
            }
            return new Response(
                JSON.stringify({
                    status,
                    trackUri: track.uri,
                    generation: body.generation,
                    matcherVersion: MATCHER_VERSION,
                    ...(url.endsWith("/activate") ? { entry } : {}),
                }),
            );
        },
    };
    const coordinator = new LyricsCoordinator();
    coordinator.setNext(track.uri);
    coordinator.setCurrent(track.uri);
    const baseline = async () => {
        baselineCount++;
        return reference;
    };
    const prefetch = coordinator.prepare(track, baseline);
    const active = coordinator.activate(track, baseline, () =>
        assert.fail("fast response should not be delivered twice"),
    );
    assert.equal((await prefetch).status, "ready");
    assert.equal((await active).documentRevision, "abc");
    assert.equal(providerCount, 1);
    assert.ok(baselineCount <= 2);
    assert.equal(bodies.filter((body) => !body.referenceKnown).length, 1);
    assert.equal(
        bodies.every((body) => body.relaxed === true),
        true,
    );
});
test("stale activation cannot publish after a different track takes over", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    let late = 0;
    globalThis.fixture = {
        supported: true,
        config: { sharedLyricsBridge: true, lyricsSource: "apple-music" },
        fetch: async (url, init) => {
            const body = JSON.parse(init.body);
            if (body.referenceKnown) await gate;
            return new Response(
                JSON.stringify({
                    status: body.referenceKnown ? "ready" : "reference-required",
                    trackUri: track.uri,
                    generation: body.generation,
                    matcherVersion: MATCHER_VERSION,
                    entry,
                }),
            );
        },
    };
    const coordinator = new LyricsCoordinator();
    coordinator.setCurrent(track.uri);
    coordinator.setNext(track.uri);
    const pending = coordinator.activate(
        track,
        async () => reference,
        () => late++,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    coordinator.setCurrent("spotify:track:new");
    coordinator.setNext(null);
    release();
    assert.equal(await pending, null);
    assert.equal(late, 0);
});
test("v1-only and disabled source do not fetch Apple Music or baseline lyrics", async () => {
    globalThis.fixture = {
        supported: false,
        config: { sharedLyricsBridge: true, lyricsSource: "auto" },
        fetch: () => assert.fail("unexpected bridge request"),
    };
    const coordinator = new LyricsCoordinator();
    const legacyTrack = { ...track, uri: "spotify:track:legacy" };
    coordinator.setCurrent(legacyTrack.uri);
    assert.equal(
        await coordinator.activate(
            legacyTrack,
            () => assert.fail("unexpected baseline request"),
            () => {},
        ),
        null,
    );
    globalThis.fixture.config.lyricsSource = "standard";
    globalThis.fixture.supported = true;
    assert.equal(
        await coordinator.prepare(track, () => assert.fail("unexpected baseline request")),
        null,
    );
});

test("offline rich cache preserves source choice and hidden lyrics", async () => {
    globalThis.fixture = {
        supported: false,
        config: { sharedLyricsBridge: true, lyricsSource: "auto" },
        fetch: () => assert.fail("offline bridge should not be queried"),
    };
    const coordinator = new LyricsCoordinator();
    coordinator.setCurrent(track.uri);
    const activate = () =>
        coordinator.activate(
            track,
            () => assert.fail("unexpected baseline"),
            () => {},
        );
    assert.equal((await activate()).documentRevision, "abc");
    globalThis.fixture.ordinary = { cacheSource: "manual" };
    assert.equal(await activate(), null);
    globalThis.fixture.config.lyricsSource = "apple-music";
    assert.equal((await activate()).documentRevision, "abc");
    globalThis.fixture.ordinary.hidden = true;
    assert.equal(await activate(), null);
});
