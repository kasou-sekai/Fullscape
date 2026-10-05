import assert from "node:assert/strict";
import { test, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "fullscape-queue-adapter-"));
await build({
    entryPoints: ["src/services/queue-adapter.ts"],
    bundle: true,
    format: "esm",
    outfile: join(dir, "adapter.mjs"),
});
const { QueueAdapter } = await import(pathToFileURL(join(dir, "adapter.mjs")));
after(() => rm(dir, { recursive: true, force: true }));
const track = (uri, uid) => ({ contextTrack: { uri, uid, metadata: { title: uid } } });
test("internal delimiters and placeholders are never exposed as songs", () => {
    globalThis.Spicetify = {
        Player: { data: {} },
        Queue: {
            nextTracks: [
                track("spotify:delimiter", "d"),
                track("spotify:delimeter", "x"),
                track("spotify:track:a", "a"),
                track("spotify:separator", "s"),
                track("spotify:episode:b", "b"),
            ],
        },
    };
    const snapshot = QueueAdapter.read();
    assert.deepEqual(
        [...snapshot.next, ...snapshot.later].map((x) => x.uid),
        ["a", "b"],
    );
});
test("queue playback targets the live UID and never starts a single-song context", async () => {
    const nextTracks = [
        track("spotify:track:a", "first"),
        track("spotify:track:a", "second"),
        track("spotify:track:b", "third"),
    ];
    let args;
    globalThis.Spicetify = {
        Player: { data: {}, playUri: () => assert.fail("must not reset context") },
        Queue: { nextTracks },
        Platform: {
            PlayerAPI: {
                skipToNext: async (value) => {
                    args = value;
                },
            },
        },
    };
    const selected = QueueAdapter.read().next[1];
    assert.equal((await QueueAdapter.play(selected)).ok, true);
    assert.deepEqual(args, { uri: "spotify:track:a", uid: "second" });
    assert.equal(Spicetify.Queue.nextTracks, nextTracks);
});
test("stale entries and unsupported hosts never fall back to destructive playback", async () => {
    globalThis.Spicetify = {
        Player: { data: {}, playUri: () => assert.fail("must not reset context") },
        Queue: { nextTracks: [track("spotify:track:a", "a")] },
        Platform: { PlayerAPI: { skipToNext: () => assert.fail("stale skip") } },
    };
    const entry = QueueAdapter.read().next[0];
    Spicetify.Queue.nextTracks = [];
    assert.equal((await QueueAdapter.play(entry)).ok, false);
    Spicetify.Platform.PlayerAPI = {};
    assert.equal((await QueueAdapter.play(entry)).ok, false);
});
test("native queue reordering is available only through an explicit host mutation", async () => {
    const nextTracks = [track("spotify:track:a", "a"), track("spotify:track:b", "b")];
    let args;
    globalThis.Spicetify = {
        Player: { data: {} },
        Queue: { nextTracks },
        Platform: {
            PlayerAPI: {
                moveInQueue: async (...values) => {
                    args = values;
                },
            },
        },
    };
    const entry = QueueAdapter.read().next[1];
    assert.equal(QueueAdapter.canReorder(), true);
    assert.deepEqual(await QueueAdapter.reorder(entry, 0), { ok: true });
    assert.deepEqual(args, [{ uid: "b", uri: "spotify:track:b" }, 0]);

    Spicetify.Platform.PlayerAPI = {};
    assert.equal(QueueAdapter.canReorder(), false);
    assert.deepEqual(await QueueAdapter.reorder(entry, 0), { ok: false, reason: "unsupported" });
});
