import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
    entryPoints: ["src/ui/components/Focus/lyric-structure.ts"],
    bundle: true,
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
    );
    assert.deepEqual(textOf(verses), [opening, refrain, bridge, repeated, ending]);
});

test("adjacent refrains split at a lyric onset, keeping simultaneous lines together", () => {
    const refrain = ["The old road shines", "A train crosses the river", "All the lights go out"];
    const lyrics = [...refrain, ...refrain];
    assert.deepEqual(textOf(groupVerses(untimed(lyrics))), [refrain, refrain]);

    const starts = [0, 3000, 6000, 6000, 9000, 12000];
    const overlapping = lyrics.map((text, index) => ({ text, startTime: starts[index] }));
    assert.deepEqual(textOf(groupVerses(overlapping)), [lyrics]);
});

test("an authored long stanza stays intact and interludes break between verses", () => {
    const stanza = Array.from({ length: 14 }, (_, index) => `Line ${index + 1} of the opening`);
    const second = ["An evening in winter", "A cold wind from the west"];
    const lines = untimed([...stanza, "", ...second, "♪", "Somewhere after the rain"]);
    const verses = groupVerses(lines);
    assert.deepEqual(textOf(verses), [stanza, second, ["Somewhere after the rain"]]);
    assert.deepEqual(
        verses.map(({ space }) => space),
        ["none", "verse", "interlude"],
    );
});

test("standalone Spotify notes mark one gap and lyric text with a note is retained", () => {
    const verses = groupVerses(
        untimed(["♪", "First verse ♪", "♫", "♩  ♪\uFE0F", "", "Next verse", "♪"]),
    );
    assert.deepEqual(textOf(verses), [["First verse ♪"], ["Next verse"]]);
    assert.deepEqual(
        verses.map(({ space }) => space),
        ["interlude", "interlude"],
    );
    assert.equal(verses.at(-1).trailingInterlude, true);
    assert.deepEqual(groupVerses(untimed(["♪", "♫"])), []);
});

test("an isolated two-line hook stays in context and a varied refrain keeps its full ending", () => {
    const phrases = [
        "街の明かりは消えてゆく",
        "ひとりで夜明けを待つ",
        "数えきれない静かな夜",
        "風が遠くで歌う",
        "街の明かりは消えてゆく",
        "ひとりで夜明けを待つ",
        "青い川の向こうへ",
        "あの日の影を抱いて",
        "明日を待つ私の声",
        "形のない音に溶けてゆく",
        "忘れた言葉を拾う",
        "続いていく長い道",
        "青い川の向こうへ",
        "あの日の影を抱いて",
        "明日を待つ私の声",
        "形のない音に溶けてゆけ",
        "夜の幕が下りる",
    ];
    assert.deepEqual(textOf(groupVerses(untimed(phrases))), [
        phrases.slice(0, 6),
        phrases.slice(6, 10),
        phrases.slice(10, 12),
        phrases.slice(12, 16),
        phrases.slice(16),
    ]);
});

test("supplied blank lines keep authored paragraphs even when they contain an exact repeat", () => {
    const chorus = ["Have a little faith", "Inside the harbor", "No one will be lost"];
    const first = ["Opening verse", ...chorus, "The end of this verse"];
    const second = ["Another shore", ...chorus, "In the morning light"];
    assert.deepEqual(textOf(groupVerses(untimed([...first, "", ...second]))), [first, second]);
});

test("classic interludes keep their blank space even next to an authored blank", () => {
    const lines = [
        { text: "Opening", startTime: 8000, interludeBefore: true },
        { text: "Still singing", startTime: 10000 },
        {
            text: "Singing again",
            startTime: 20000,
            sectionBreakBefore: true,
            interludeBefore: true,
        },
    ];
    const verses = groupVerses(lines);
    assert.deepEqual(
        verses.map(({ lines, space }) => [lines.length, space]),
        [
            [2, "interlude"],
            [1, "interlude"],
        ],
    );
});

test("explicit section headings separate lyrics and stay out of repeat matching", () => {
    const chorus = ["The water is rising", "The fire is fading", "The morning is near"];
    const lines = untimed(["[Verse 1: Singer]", ...chorus, "【サビ】", "", ...chorus]);
    const verses = groupVerses(lines);
    assert.deepEqual(textOf(verses), [
        ["[Verse 1: Singer]", ...chorus],
        ["【サビ】", ...chorus],
    ]);
    assert.ok(verses.every(({ heading }) => heading));
});

test("a pause after singing creates ordinary stanza spacing and a held voice suppresses it", () => {
    const lines = Array.from({ length: 10 }, (_, index) => {
        const startTime = index * 3000;
        return {
            text: `Unrelated lyric ${index}`,
            startTime,
            endTime: startTime + (index === 3 ? 1500 : 2800),
        };
    });
    assert.deepEqual(
        groupVerses(lines).map(({ lines, space }) => [lines.length, space]),
        [
            [4, "none"],
            [6, "verse"],
        ],
    );
    lines[2].endTime = lines[4].startTime + 100;
    assert.deepEqual(
        groupVerses(lines).map(({ lines }) => lines.length),
        [10],
    );
});

test("start-only lyrics can break at a clear change in local cadence", () => {
    const times = [0, 1800, 3600, 5400, 9300, 11100, 12900, 14700];
    const lines = times.map((startTime, index) => ({
        startTime,
        text: `Unrelated lyric ${index}`,
    }));
    assert.deepEqual(
        groupVerses(lines).map(({ lines }) => lines.length),
        [4, 4],
    );
    assert.deepEqual(
        groupVerses(untimed(lines.map(({ text }) => text))).map(({ lines }) => lines.length),
        [8],
    );
});

test("source sections govern layout even with repeats, blanks, and long pauses", () => {
    const refrain = ["The old road shines", "A train crosses the river", "All the lights go out"];
    const lyrics = [
        ...refrain.map((text) => ({ text, startTime: null, sectionIndex: 0 })),
        { text: "♪", startTime: null, sectionIndex: 0 },
        ...refrain.map((text) => ({ text, startTime: null, sectionIndex: 0 })),
        { text: "Another morning", startTime: 30000, sectionIndex: 1, interludeBefore: true },
        { text: "", startTime: null },
        { text: "The clouds break", startTime: 32000, sectionIndex: 1, sectionBreakBefore: true },
    ];
    const verses = groupVerses(lyrics);
    assert.deepEqual(textOf(verses), [
        [...refrain, ...refrain],
        ["Another morning", "The clouds break"],
    ]);
    assert.deepEqual(
        verses.map(({ space }) => space),
        ["none", "interlude"],
    );
    assert.equal(verses[0].lines[3].interludeBefore, true);
});

test("separate source sections survive a duet line starting after the next section begins", () => {
    const lines = [
        { text: "First voice", startTime: 0, sectionIndex: 0 },
        { text: "New phrase", startTime: 5000, sectionIndex: 1 },
        { text: "Earlier voice continues", startTime: 5100, sectionIndex: 0 },
        { text: "Following line", startTime: 7000, sectionIndex: 1 },
    ];
    assert.deepEqual(textOf(groupVerses(lines)), [
        ["First voice", "Earlier voice continues"],
        ["New phrase", "Following line"],
    ]);
});

test("page candidates only use stanza boundaries", () => {
    const first = ["A room before dawn", "The windows are bright"];
    const middle = Array.from({ length: 12 }, (_, index) => `A different line ${index}`);
    const last = ["Until the evening comes"];
    const verses = groupVerses(untimed([...first, "", ...middle, "", ...last]));
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
    );
    assert.deepEqual(surroundEnds(lyrics), [1, 2, 3, 4]);
    assert.equal(surroundEnds(lyrics.slice(0, 3)), null);
    const long = {
        ...lyrics[0],
        lines: untimed(Array.from({ length: 14 }, (_, index) => `An unmatched line ${index}`)),
    };
    assert.equal(surroundEnds([long, ...lyrics.slice(1)]), null);
});
