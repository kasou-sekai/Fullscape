import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
    entryPoints: ["src/ui/components/Focus/lyric-structure.ts"],
    format: "esm",
    write: false,
});
const { columnEnds, groupVerses, splitCandidates, surroundEnds } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

const untimed = (texts) => texts.map((text) => ({ text, startTime: null }));
const textOf = (verses) => verses.map(({ lines }) => lines.map(({ text }) => text));

test("recurring refrains form whole paragraphs and retain their original text", () => {
    const refrain = ["Down by the river,", "We wait for the light", "We let it carry us home"];
    const repeated = ["Down by the river", "WE WAIT FOR THE LIGHT!", refrain[2]];
    const opening = ["The old station is empty", "Two trains went past"];
    const bridge = ["Turning the page", "The clock ran slow"];
    const ending = ["Another year is gone"];
    const verses = groupVerses(
        untimed([...opening, ...refrain, ...bridge, ...repeated, ...ending]),
        0,
    );
    assert.deepEqual(textOf(verses), [opening, refrain, bridge, repeated, ending]);
});

test("an authored long stanza stays intact and interludes break between verses", () => {
    const stanza = Array.from({ length: 14 }, (_, index) => `Line ${index + 1} of the opening`);
    const second = ["An evening in winter", "A cold wind from the west"];
    const lines = untimed([...stanza, "", ...second, "♪", "Somewhere after the rain"]);
    const verses = groupVerses(lines, 0);
    assert.deepEqual(textOf(verses), [stanza, second, ["♪"], ["Somewhere after the rain"]]);
    assert.deepEqual(
        verses.map(({ space }) => space),
        ["none", "verse", "interlude", "verse"],
    );
});

test("page candidates only use stanza boundaries", () => {
    const first = ["A room before dawn", "The windows are bright"];
    const middle = Array.from({ length: 12 }, (_, index) => `A different line ${index}`);
    const last = ["Until the evening comes"];
    const verses = groupVerses(untimed([...first, "", ...middle, "", ...last]), 0);
    const candidates = splitCandidates(verses);
    assert.equal(candidates.length, 2);
    for (const [left, right] of candidates) {
        assert.deepEqual([...left, ...right], verses);
        assert.ok([...left, ...right].includes(verses[1]));
    }
    assert.deepEqual(splitCandidates([verses[1]]), []);
});

test("sizes columns by keeping contiguous stanzas together, including oversized stanzas", () => {
    assert.deepEqual(columnEnds([18, 21, 4, 24], 2), [2, 4]);
    assert.deepEqual(columnEnds([1, 1, 100, 1, 1], 3), [2, 3, 5]);
    assert.deepEqual(columnEnds([6, 6, 6, 6], 4), [1, 2, 3, 4]);
});

test("the center title layout requires usable, comparable stanzas on four sides", () => {
    const lyrics = groupVerses(
        untimed(["Evening sky", "", "Morning wind", "", "Open window", "", "Lights nearby"]),
        0,
    );
    assert.deepEqual(surroundEnds(lyrics), [1, 2, 3, 4]);
    assert.equal(surroundEnds(lyrics.slice(0, 3)), null);
    const long = {
        ...lyrics[0],
        lines: untimed(Array.from({ length: 14 }, (_, index) => `An unmatched line ${index}`)),
    };
    assert.equal(surroundEnds([long, ...lyrics.slice(1)]), null);
});
