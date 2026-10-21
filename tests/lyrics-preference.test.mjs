import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const { outputFiles } = await build({
    stdin: {
        contents: 'export * from "./src/services/lyrics-preference";',
        resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
});
const api = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);
const node = { name: "p", attributes: {}, children: [] };
const plain = { time: 10000, text: "Hello ocean", duration: 5000 };
const word = { ...plain, words: [{ time: 10000, duration: 5000, text: plain.text }] };
const apple = {
    ...word,
    presentation: { key: "L1", isBackground: false, end: 15, alignment: "left", element: node },
};
test("automatic tiers prioritize Chinese Apple, rich Apple, translated syllables and plain lyrics", () => {
    const variants = [
        [[{ ...apple, text: "你好海洋" }], "apple-music", 60],
        [
            [{ ...apple, presentation: { ...apple.presentation, alignment: "right" } }],
            "apple-music",
            50,
        ],
        [[{ ...word, translation: "你好海洋" }], "standard", 40],
        [[word], "standard", 30],
        [[{ ...plain, translation: "你好海洋" }], "standard", 20],
        [[plain], "standard", 10],
        [[{ ...plain, time: null }], "standard", 5],
    ];
    for (const [lines, family, tier] of variants)
        assert.equal(api.lyricsPreferenceScore(lines, family)[0], tier);
    assert.ok(
        api.compareLyricsPreference(
            [{ ...word, translation: "你好海洋" }],
            [apple],
            "standard",
            "apple-music",
        ) > 0,
    );
    assert.equal(api.lyricsPreferenceScore([{ ...word, translation: "Hello sea" }])[0], 30);
});
test("richness requires actual arrangement, including overlapping voices and small background text", () => {
    assert.equal(api.hasRichArrangement([apple]), false);
    assert.equal(api.hasRichArrangement([apple, { ...apple, time: 12000 }]), true);
    assert.equal(
        api.hasRichArrangement([
            apple,
            { ...apple, time: 15000, presentation: { ...apple.presentation, end: 20 } },
        ]),
        false,
    );
    assert.equal(api.hasRichArrangement([{ ...apple, backgrounds: [word] }]), true);
    assert.equal(
        api.hasRichArrangement([
            {
                ...apple,
                presentation: {
                    ...apple.presentation,
                    element: {
                        ...node,
                        children: [{ ...node, attributes: { "tts:fontSize": "65%" } }],
                    },
                },
            },
        ]),
        true,
    );
    assert.equal(
        api.lyricsPreferenceScore([{ ...apple, text: "君と世界のどこかで" }], "apple-music")[0],
        30,
    );
});
