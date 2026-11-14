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
            if (url.endsWith("/activate")) status = "ready";
            else if (!body.referenceKnown) status = "reference-required";
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
    assert.equal(baselineCount, 1);
    assert.equal(bodies.filter((body) => !body.referenceKnown && !body.cachedOnly).length, 1);
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

test("display confirmations are separate from prefetch and carry ordered source revisions", async () => {
    const bodies = [];
    globalThis.fixture = {
        supported: true,
        config: { sharedLyricsBridge: true, lyricsSource: "auto" },
        fetch: async (url, init) => {
            assert.ok(url.endsWith("/selection"));
            bodies.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ status: "selected" }));
        },
    };
    const c = new LyricsCoordinator();
    c.setCurrent(track.uri);
    await c.confirmSelection(track, entry);
    await c.confirmSelection(track, entry);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].sourceFamily, "apple-music");
    assert.equal(bodies[0].documentRevision, "abc");
    const ordinary = {
        ...entry,
        sourceFamily: "standard",
        documentRevision: undefined,
        lines: entry.lines.map((line) => ({
            ...line,
            presentation: undefined,
            translation: "你好海洋",
        })),
    };
    await c.confirmSelection(track, ordinary);
    assert.equal(bodies.length, 2);
    assert.ok(bodies[1].selectionRevision > bodies[0].selectionRevision);
    assert.equal(bodies[1].sourceFamily, "standard");
    c.setCurrent("spotify:track:other");
    await c.confirmSelection(track, entry);
    assert.equal(bodies.length, 2);
});

test("a matcher upgrade revalidates stored documents before claiming their revision", async () => {
    const upgradedTrack = { ...track, uri: "spotify:track:matcher-upgrade" };
    let saved = {
        ...entry,
        trackUri: upgradedTrack.uri,
        validatedMatcherVersion: "previous-matcher",
    };
    const request = (result) => {
        const value = { result };
        queueMicrotask(() => value.onsuccess?.());
        return value;
    };
    const database = {
        close() {},
        transaction: () => ({
            objectStore: () => ({
                get: () => request(saved),
                put: (value) => {
                    saved = value;
                },
                getAllKeys: () => request([upgradedTrack.uri]),
            }),
        }),
    };
    const bodies = [];
    globalThis.indexedDB = { open: () => request(database) };
    globalThis.fixture = {
        supported: true,
        config: { sharedLyricsBridge: true, lyricsSource: "auto" },
        fetch: async (url, init) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            const unchanged =
                url.endsWith("/activate") && body.knownRevision === entry.documentRevision;
            return new Response(
                JSON.stringify({
                    status: unchanged ? "unchanged" : "ready",
                    trackUri: upgradedTrack.uri,
                    matcherVersion: MATCHER_VERSION,
                    ...(!unchanged && url.endsWith("/activate")
                        ? {
                              entry: { ...entry, trackUri: upgradedTrack.uri },
                          }
                        : {}),
                }),
            );
        },
    };
    try {
        const freshModule = await import(
            `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}#matcher-upgrade`
        );
        const c = new freshModule.LyricsCoordinator();
        c.setCurrent(upgradedTrack.uri);
        const result = await c.activate(
            upgradedTrack,
            async () => reference,
            () => assert.fail("unexpected late entry"),
        );
        assert.equal(result?.validatedMatcherVersion, MATCHER_VERSION);
        assert.equal(bodies[0].knownRevision, undefined);
        assert.equal(bodies[1].knownRevision, undefined);
        assert.equal((await c.refresh(upgradedTrack, async () => reference)).status, "unchanged");
        assert.equal(bodies.at(-1).knownRevision, entry.documentRevision);
    } finally {
        delete globalThis.indexedDB;
    }
});

test("malformed rich documents cannot enter the offline cache", async () => {
    const malformedTrack = { ...track, uri: "spotify:track:malformed" };
    globalThis.fixture = {
        supported: true,
        config: { sharedLyricsBridge: true, lyricsSource: "apple-music" },
        fetch: async (url) =>
            new Response(
                JSON.stringify({
                    status: "ready",
                    trackUri: malformedTrack.uri,
                    matcherVersion: MATCHER_VERSION,
                    ...(url.endsWith("/activate")
                        ? {
                              entry: {
                                  ...entry,
                                  trackUri: malformedTrack.uri,
                                  lines: entry.lines.map((line) => ({
                                      ...line,
                                      presentation: { ...line.presentation, timingMode: {} },
                                  })),
                              },
                          }
                        : {}),
                }),
            ),
    };
    const c = new LyricsCoordinator();
    c.setCurrent(malformedTrack.uri);
    const activate = () =>
        c.activate(
            malformedTrack,
            async () => reference,
            () => assert.fail("invalid late entry"),
        );
    assert.equal(await activate(), null);
    globalThis.fixture.supported = false;
    assert.equal(await activate(), null);
});

test("rich bridge bodies are bounded even without a Content-Length header", async () => {
    let cancelled = false;
    let chunks = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    globalThis.fixture = {
        supported: true,
        config: { sharedLyricsBridge: true, lyricsSource: "auto" },
        fetch: async () =>
            new Response(
                new ReadableStream({
                    pull(controller) {
                        chunks++;
                        controller.enqueue(chunk);
                    },
                    cancel() {
                        cancelled = true;
                    },
                }),
            ),
    };
    const c = new LyricsCoordinator();
    c.setCurrent(track.uri);
    assert.equal(await c.refresh(track, async () => reference), null);
    assert.equal(cancelled, true);
    assert.ok(chunks <= 18);
});

test(
    "a stalled rich bridge body is cancelled without blocking fallback",
    { timeout: 5000 },
    async () => {
        let cancelled = false;
        globalThis.fixture = {
            supported: true,
            config: { sharedLyricsBridge: true, lyricsSource: "auto" },
            fetch: async () =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            controller.enqueue(new TextEncoder().encode('{"status":'));
                        },
                        cancel() {
                            cancelled = true;
                        },
                    }),
                ),
        };
        const c = new LyricsCoordinator();
        c.setCurrent(track.uri);
        assert.equal(await c.refresh(track, async () => reference), null);
        assert.equal(cancelled, true);
    },
);
