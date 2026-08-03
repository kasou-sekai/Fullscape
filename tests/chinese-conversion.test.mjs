import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";

const buildDirectory = await mkdtemp(join(tmpdir(), "fullscape-chinese-test-"));
const bundlePath = join(buildDirectory, "chinese-conversion.mjs");
await build({
    entryPoints: ["src/utils/chinese-conversion.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: bundlePath,
});
const { getChineseLyricsPresentation, isChineseLyrics } = await import(
    pathToFileURL(bundlePath).href
);

after(async () => {
    await rm(buildDirectory, { recursive: true, force: true });
});

test("does not classify predominantly English lyrics as Chinese", () => {
    const lyrics = `I can see it in your eyes tonight
We keep dancing until morning light
This is a purely English lyric with 中文字符 in its metadata`;

    assert.equal(isChineseLyrics(lyrics), false);
    assert.deepEqual(getChineseLyricsPresentation(lyrics, "simplified"), {
        sourceScript: null,
        displayScript: null,
        conversion: "original",
    });
});

test("uses the whole song to exclude Japanese kanji-only lines from conversion", () => {
    const lyrics = `君の声を聞かせて
東京
夢の中でまた会えるなら
僕はここで待っている`;

    assert.equal(isChineseLyrics(lyrics), false);
    assert.equal(getChineseLyricsPresentation(lyrics, "simplified").conversion, "original");
});

test("skips conversion when Chinese lyrics already use the requested script", () => {
    const simplified = "我喜欢在夜晚听着音乐，看见远方灯光。";
    const traditional = "我喜歡在夜晚聽著音樂，看見遠方燈光。";

    assert.deepEqual(getChineseLyricsPresentation(simplified, "simplified"), {
        sourceScript: "simplified",
        displayScript: "simplified",
        conversion: "original",
    });
    assert.deepEqual(getChineseLyricsPresentation(traditional, "traditional"), {
        sourceScript: "traditional",
        displayScript: "traditional",
        conversion: "original",
    });
});

test("converts Chinese lyrics only when the requested script differs", () => {
    const simplified = "我喜欢在夜晚听着音乐，看见远方灯光。";

    assert.deepEqual(getChineseLyricsPresentation(simplified, "traditional"), {
        sourceScript: "simplified",
        displayScript: "traditional",
        conversion: "traditional",
    });
});

test("keeps predominantly Chinese lyrics Chinese when they contain a short Japanese phrase", () => {
    const lyrics = `我喜欢在夜晚听着音乐，看见远方灯光
让回忆随着旋律慢慢流淌，不再迷惘
最后轻轻说一句ありがとう，然后继续歌唱`;

    assert.equal(isChineseLyrics(lyrics), true);
});
