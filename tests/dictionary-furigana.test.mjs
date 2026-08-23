import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const buildDirectory = await mkdtemp(join(tmpdir(), "fullscape-dictionary-furigana-test-"));
const bundlePath = join(buildDirectory, "dictionary-furigana.mjs");
const offlineBundlePath = join(buildDirectory, "offline-dictionary-furigana.mjs");
const markupBundlePath = join(buildDirectory, "furigana-markup.mjs");
await build({
    entryPoints: ["src/services/dictionary-furigana.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: bundlePath,
});
await build({
    entryPoints: ["src/services/offline-furigana-dictionary.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: offlineBundlePath,
});
await build({
    entryPoints: ["src/utils/furigana.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: markupBundlePath,
});
const { fetchDictionaryFurigana } = await import(pathToFileURL(bundlePath).href);
const { parseOfflineFuriganaDictionary, renderOfflineFurigana } = await import(
    pathToFileURL(offlineBundlePath).href
);
const { mergeFuriganaAnnotations, parseFuriganaMarkup } = await import(
    pathToFileURL(markupBundlePath).href
);

after(async () => {
    await rm(buildDirectory, { recursive: true, force: true });
});

test("maps dictionary tokens to render-only line annotations", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody;
    globalThis.fetch = async (_input, init) => {
        requestBody = JSON.parse(init.body);
        return new Response(
            JSON.stringify({
                tokens: [
                    { surface: "君", reading: "きみ" },
                    { surface: "の", reading: "の" },
                    { surface: "声", reading: "こえ" },
                    { surface: "を", reading: "を" },
                    { surface: "聞かせて", reading: "きかせて" },
                    { surface: "東京", reading: "とうきょう" },
                ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };

    try {
        const lines = ["君の声を聞かせて", "東京"];
        const result = await fetchDictionaryFurigana(lines);

        assert.deepEqual(requestBody, { text: lines.join("\n") });
        assert.deepEqual(result, [
            {
                text: lines[0],
                annotations: [
                    { start: 0, end: 1, reading: "きみ" },
                    { start: 2, end: 3, reading: "こえ" },
                    { start: 4, end: 5, reading: "き" },
                ],
            },
            {
                text: lines[1],
                annotations: [{ start: 0, end: 2, reading: "とうきょう" }],
            },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("splits furigana around kana inside a dictionary token", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
        new Response(
            JSON.stringify({
                tokens: [{ surface: "浮き足立つ", reading: "うきあしだつ" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );

    try {
        assert.deepEqual(await fetchDictionaryFurigana(["浮き足立つ"]), [
            {
                text: "浮き足立つ",
                annotations: [
                    { start: 0, end: 1, reading: "う" },
                    { start: 2, end: 4, reading: "あしだ" },
                ],
            },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("does not render unchanged kanji from an incomplete dictionary reading", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
        new Response(
            JSON.stringify({
                tokens: [{ surface: "頸動脈", reading: "頸どうみゃく" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );

    try {
        assert.deepEqual(await fetchDictionaryFurigana(["頸動脈"]), [
            {
                text: "頸動脈",
                annotations: [{ start: 1, end: 3, reading: "どうみゃく" }],
            },
        ]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("does not call the dictionary for lines without kanji", async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = async () => {
        requestCount += 1;
        throw new Error("fetch should not be called");
    };

    try {
        assert.deepEqual(await fetchDictionaryFurigana(["かなだけ", "abc"]), [
            { text: "かなだけ", annotations: [] },
            { text: "abc", annotations: [] },
        ]);
        assert.equal(requestCount, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("deduplicates repeated lines before online analysis", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody;
    let requestCount = 0;
    globalThis.fetch = async (_input, init) => {
        requestCount += 1;
        requestBody = JSON.parse(init.body);
        return new Response(
            JSON.stringify({ tokens: [{ surface: "重複", reading: "ちょうふく" }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };

    try {
        const expected = {
            text: "重複",
            annotations: [{ start: 0, end: 2, reading: "ちょうふく" }],
        };
        assert.deepEqual(await fetchDictionaryFurigana(["重複", "重複"]), [expected, expected]);
        assert.deepEqual(requestBody, { text: "重複" });
        assert.equal(requestCount, 1);

        assert.deepEqual(await fetchDictionaryFurigana(["重複"]), [expected]);
        assert.equal(requestCount, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("can restrict dictionary rendering to offline data", async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = async () => {
        requestCount += 1;
        throw new Error("online lookup should be disabled");
    };

    try {
        assert.deepEqual(await fetchDictionaryFurigana(["東京"], { allowOnline: false }), [
            { text: "東京", annotations: [] },
        ]);
        assert.equal(requestCount, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("accepts the CORS-friendly Yomi response shape", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody;
    let requestCount = 0;
    globalThis.fetch = async (_input, init) => {
        requestCount += 1;
        requestBody = new URLSearchParams(init.body).toString();
        if (requestCount === 1) {
            return new Response("service unavailable", { status: 503 });
        }
        return new Response(
            JSON.stringify(
                JSON.stringify({
                    words: [
                        { surface: "東京", reading_raw: "とうきょう" },
                        { surface: "で", reading_raw: "で" },
                    ],
                }),
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };

    try {
        assert.deepEqual(await fetchDictionaryFurigana(["東京で"]), [
            {
                text: "東京で",
                annotations: [{ start: 0, end: 2, reading: "とうきょう" }],
            },
        ]);
        assert.match(requestBody, /text=%E6%9D%B1%E4%BA%AC%E3%81%A7/);
        assert.match(requestBody, /mode=furigana/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("parses and renders the downloadable JmdictFurigana format", () => {
    const index = parseOfflineFuriganaDictionary(
        "\uFEFF君|きみ|0:きみ\n声|こえ|0:こえ\n東京|とうきょう|0-1:とうきょう\n浮き足立つ|うきあしだつ|0:う;2:あし;3:だ\n",
    );

    assert.deepEqual(renderOfflineFurigana(["君の声と東京"], index), [
        {
            text: "君の声と東京",
            annotations: [
                { start: 0, end: 1, reading: "きみ" },
                { start: 2, end: 3, reading: "こえ" },
                { start: 4, end: 6, reading: "とうきょう" },
            ],
        },
    ]);
    assert.deepEqual(renderOfflineFurigana(["浮き足立つ"], index), [
        {
            text: "浮き足立つ",
            annotations: [
                { start: 0, end: 1, reading: "う" },
                { start: 2, end: 3, reading: "あし" },
                { start: 3, end: 4, reading: "だ" },
            ],
        },
    ]);
});

test("prefers the offline reading candidate with more complete coverage", () => {
    const index = parseOfflineFuriganaDictionary(
        "東京|とう|0:とう\n東京|とうきょう|0-1:とうきょう\n",
    );

    assert.deepEqual(renderOfflineFurigana(["東京"], index), [
        {
            text: "東京",
            annotations: [{ start: 0, end: 2, reading: "とうきょう" }],
        },
    ]);
});

test("merges supplemental readings without replacing preferred overlaps", () => {
    assert.deepEqual(
        mergeFuriganaAnnotations(
            [{ start: 0, end: 1, reading: "きみ" }],
            [
                { start: 0, end: 2, reading: "くんせい" },
                { start: 2, end: 3, reading: "こえ" },
            ],
        ),
        [
            { start: 0, end: 1, reading: "きみ" },
            { start: 2, end: 3, reading: "こえ" },
        ],
    );
});

test("parses furigana markup for Han characters outside the basic CJK block", () => {
    assert.deepEqual(parseFuriganaMarkup("𠮷野家《よしのや》"), {
        text: "𠮷野家",
        annotations: [{ start: 0, end: 4, reading: "よしのや" }],
    });
});
