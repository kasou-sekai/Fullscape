import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "fullscape-language-test-"));
await build({
    entryPoints: [
        "src/utils/text-language.ts",
        "src/utils/text-presentation.ts",
        "src/utils/chinese-conversion.ts",
    ],
    bundle: true,
    format: "esm",
    platform: "browser",
    outdir: directory,
    outExtension: { ".js": ".mjs" },
});
const { detectTextLanguage } = await import(pathToFileURL(join(directory, "text-language.mjs")));
const { getTextLanguageTag, applyTextLanguage } = await import(
    pathToFileURL(join(directory, "text-presentation.mjs"))
);
const { getTranslationPresentation } = await import(
    pathToFileURL(join(directory, "chinese-conversion.mjs"))
);
await build({
    stdin: {
        contents:
            'export { Lyrics } from "./src/ui/components/Lyrics/Lyrics"; export { default as config } from "./src/utils/config";',
        resolveDir: process.cwd(),
        loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: join(directory, "renderer.mjs"),
});
const previousSpicetify = globalThis.Spicetify;
globalThis.Spicetify = { SVGIcons: {} };
const previousImage = globalThis.Image;
globalThis.Image = class Image {};
const { Lyrics, config } = await import(pathToFileURL(join(directory, "renderer.mjs")));
globalThis.Image = previousImage;
globalThis.Spicetify = previousSpicetify;
after(() => rm(directory, { recursive: true, force: true }));

test("recognizes short Chinese, Japanese, Korean and English titles", () => {
    for (const [text, language] of [
        ["爱", "zh"],
        ["君の声", "ja"],
        ["봄날", "ko"],
        ["Hello", "en"],
        ["ｶﾀｶﾅ", "ja"],
        ["봄", "ko"],
    ]) {
        assert.equal(detectTextLanguage(text), language, text);
    }
});

test("uses song context for Han-only titles without overriding distinctive scripts", () => {
    assert.equal(detectTextLanguage("東京", "ja"), "ja");
    assert.equal(detectTextLanguage("約束", "ko"), "ko");
    assert.equal(detectTextLanguage("Hello", "ja"), "en");
    assert.equal(detectTextLanguage("君の声", "zh"), "ja");
    assert.equal(getTextLanguageTag("東京", "ja", "traditional"), "ja");
});

test("keeps Japanese and Korean lyrics containing English choruses in their script", () => {
    assert.equal(detectTextLanguage("君の声を聞かせて\n東京\nI love you"), "ja");
    assert.equal(detectTextLanguage("너의 목소리를 들려줘\nI love you"), "ko");
    assert.equal(
        detectTextLanguage(
            "I can see it in your eyes tonight and keep dancing until morning 中文字符",
        ),
        "en",
    );
});

test("does not infer a language from punctuation, digits or unsupported scripts", () => {
    for (const text of ["", "123 🎵…", "Привет", "مرحبا", "Привет Hello мир"]) {
        assert.equal(detectTextLanguage(text), "unknown", text);
        assert.equal(getTextLanguageTag(text), "und", text);
    }
});

test("uses the same language tag for title DOM and lyric presentation", () => {
    for (const text of ["我喜欢音乐", "我喜歡音樂", "君の声", "봄날", "Hello"]) {
        const element = { textContent: text, dataset: {} };
        applyTextLanguage(element);
        assert.equal(element.lang, getTextLanguageTag(text));
        assert.equal(element.dataset.textLanguage, element.lang);
    }
    assert.equal(getTextLanguageTag("我喜欢音乐", "zh", "traditional"), "zh-TW");
});

test("normalizes translations to simplified by default and follows the conversion setting independently", () => {
    const traditional = "我喜歡音樂，看見遠方燈光。";
    const simplified = "我喜欢音乐，看见远方灯光。";
    assert.deepEqual(getTranslationPresentation(traditional, "original"), {
        text: simplified,
        language: "zh-CN",
    });
    assert.deepEqual(getTranslationPresentation(traditional, "simplified"), {
        text: simplified,
        language: "zh-CN",
    });
    assert.deepEqual(getTranslationPresentation(simplified, "traditional"), {
        text: traditional,
        language: "zh-TW",
    });
});

test("renders Japanese originals and independently converted Chinese translations with matching font tags", () => {
    const storage = new Map();
    const previousStorage = globalThis.localStorage;
    const previousDocument = globalThis.document;
    globalThis.document = { dispatchEvent() {} };
    globalThis.localStorage = {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
    };
    try {
        config.set("showLyricsTranslation", true);
        config.set("showLyricsFurigana", false);
        const line = { text: "君の声", translation: "我喜歡音樂", time: 0 };
        for (const [setting, tag, text] of [
            ["original", "zh-CN", "我喜欢音乐"],
            ["simplified", "zh-CN", "我喜欢音乐"],
            ["traditional", "zh-TW", "我喜歡音樂"],
        ]) {
            config.set("lyricsChineseConversion", setting);
            const html = Lyrics.renderLineContent(line, 0, "original", "ja", "ja");
            assert.match(
                html,
                /class="rnp-lyrics-line-original" lang="ja" data-text-language="ja"/,
            );
            assert.ok(
                html.includes(
                    `class="rnp-lyrics-line-translated" lang="${tag}" data-text-language="${tag}">${text}</div>`,
                ),
            );
        }
        const mixed = Lyrics.renderLineContent(
            { text: "夢の中で", time: 0 },
            0,
            "simplified",
            "zh",
            "zh-CN",
        );
        assert.match(mixed, /lang="ja" data-text-language="ja"/);
        assert.equal(mixed.replace(/<[^>]*>/g, ""), "夢の中で");
        const chinese = Lyrics.renderLineContent(
            { text: "夢", time: 0 },
            0,
            "original",
            "zh",
            "zh-TW",
        );
        assert.match(chinese, /lang="zh-TW" data-text-language="zh-TW"/);
        assert.equal(chinese.replace(/<[^>]*>/g, ""), "夢");
    } finally {
        globalThis.localStorage = previousStorage;
        globalThis.document = previousDocument;
    }
});
