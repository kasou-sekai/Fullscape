import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const { outputFiles } = await build({
    stdin: {
        contents:
            'export * from "./src/services/lyrics-matching"; export * from "./src/services/lyrics-rich-document";',
        resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
});
const api = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);
const main = {
    time: 10000,
    text: "Hello ocean",
    duration: 5000,
    presentation: {
        key: "L1",
        isBackground: false,
        end: 15,
        alignment: "left",
        element: { name: "p", attributes: {}, children: [] },
    },
};
const right = {
    ...main,
    time: 11000,
    text: "other",
    presentation: { ...main.presentation, key: "L2", alignment: "right", end: 16 },
};
const background = {
    ...main,
    time: 12000,
    text: "echo",
    presentation: {
        ...main.presentation,
        key: undefined,
        isBackground: true,
        parentKey: "L1",
        end: 14,
    },
};
test("rich voices overlap and background stays attached to its parent", () => {
    const grouped = api.groupRichLines([main, right, background]);
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].backgrounds[0].text, "echo");
    assert.deepEqual(api.activeRichLines(grouped, 12500), [0, 1]);
    assert.deepEqual(api.activeRichLines(grouped, 15000), [1]);
    assert.equal(api.richLineEnd(main), 15000);
});
test("matching keeps FullScape relaxed timing and duration boundaries", () => {
    const song = { name: "Original", artists: "Artist", album: "Album", duration: 180000 };
    const track = { title: "Localized", artists: "Other", album: "Other", duration: 180000 };
    const match = (time, duration = 180000) =>
        api.matchLyrics(
            { ...song, duration },
            track,
            [{ time, text: "Hello ocean" }],
            [main],
            true,
        );
    assert.equal(match(12500), true);
    assert.equal(match(12501), false);
    assert.equal(match(1000), true);
    assert.equal(match(1001), false);
    assert.equal(match(10000, 192000), true);
    assert.equal(match(10000, 192001), false);
    assert.equal(match(10000, 0), false);
    assert.equal(api.matchLyrics(song, track, [], [main], true), false);
    assert.equal(api.normalizeLyricText("Ｈｅｌｌｏ，海洋！"), "hello海洋");
});
test("rich validation rejects corrupt timing, excessive trees and unsafe typed attributes", () => {
    assert.equal(api.validRichLines([main]), true);
    assert.equal(
        api.validRichLines([{ ...main, presentation: { ...main.presentation, end: 1 } }]),
        false,
    );
    assert.equal(
        api.validRichLines([{ ...main, words: [{ time: NaN, duration: 1, text: "a" }] }]),
        false,
    );
    let tree = { name: "p", attributes: {}, children: [] };
    for (let i = 0; i < 70; i++) tree = { name: "span", attributes: {}, children: [tree] };
    assert.equal(
        api.validRichLines([{ ...main, presentation: { ...main.presentation, element: tree } }]),
        false,
    );
});
