import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "fullscape-lyrics-timeline-"));
await build({
    entryPoints: ["src/ui/components/Lyrics/timeline.ts"],
    bundle: true,
    format: "esm",
    outfile: join(directory, "timeline.mjs"),
});
const {
    buildLyricsTimeline,
    findActiveInterlude,
    findActiveLineIndex,
    getInterludeBreatheDuration,
} = await import(pathToFileURL(join(directory, "timeline.mjs")));

after(() => rm(directory, { recursive: true, force: true }));

test("builds inferred interludes from a stable plain lyric cadence", () => {
    const times = [0, 3000, 6000, 9000, 12000, 24000, 27000, 30000, 33000, 36000, 39000];
    const lines = times.map((time) => ({ time, text: `line ${time}` }));
    const timeline = buildLyricsTimeline(lines);

    assert.deepEqual(timeline.timedLines[0], { index: 0, time: 0 });
    assert.deepEqual(timeline.interludes, [
        { start: 15000, end: 24000, anchorIndex: 4, nextIndex: 5 },
    ]);
    assert.equal(findActiveLineIndex(timeline.timedLines, -1), -1);
    assert.equal(findActiveLineIndex(timeline.timedLines, 12000), 4);
    assert.deepEqual(findActiveInterlude(timeline.interludes, 15000), timeline.interludes[0]);
    assert.equal(findActiveInterlude(timeline.interludes, 24000), null);
});

test("keeps authored background end times in rich lyric gaps", () => {
    const lines = [
        {
            time: 0,
            text: "main voice",
            presentation: { isBackground: false, end: 3 },
            backgrounds: [
                {
                    time: 5000,
                    text: "background voice",
                    presentation: { isBackground: true, end: 8 },
                },
            ],
        },
        { time: 15000, text: "next voice", presentation: { isBackground: false, end: 16 } },
    ];
    const timeline = buildLyricsTimeline(lines);

    assert.deepEqual(timeline.interludes, [
        { start: 8000, end: 15000, anchorIndex: 0, nextIndex: 1 },
    ]);
});

test("derives the interlude breathing period from a clamped tempo", () => {
    assert.equal(getInterludeBreatheDuration(120), 4000);
    assert.equal(getInterludeBreatheDuration(10), 10000);
    assert.equal(getInterludeBreatheDuration(400), (60000 / 220) * 8);
    assert.equal(getInterludeBreatheDuration(null), 4000);
});
