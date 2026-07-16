import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { build } from "esbuild";
import { encryptQrc } from "qrc-decoder";

const buildDirectory = await mkdtemp(join(tmpdir(), "fullscape-lyrics-test-"));
const bundlePath = join(buildDirectory, "third-party-lyrics.mjs");
await build({
    entryPoints: ["src/services/third-party-lyrics.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: bundlePath,
});
const { parseQQMusicLyrics } = await import(pathToFileURL(bundlePath).href);

after(async () => {
    await rm(buildDirectory, { recursive: true, force: true });
});

test("keeps QRC lines after raw quotes inside LyricContent", () => {
    const decrypted = `<?xml version="1.0" encoding="utf-8"?>
<QrcInfos>
<LyricInfo LyricCount="1">
<Lyric_1 LyricType="1" LyricContent="[0,1000]before(0,1000)
[1000,1000]"quoted"(1000,1000)
[2000,1000]after(2000,1000)"/>
</LyricInfo>
</QrcInfos>`;
    const encrypted = encryptQrc(decrypted);
    const response = `<content><![CDATA[${encrypted}]]></content>`;

    const parsed = parseQQMusicLyrics(response);

    assert.deepEqual(
        parsed.dynamicLines.map((line) => line.text),
        ["before", '"quoted"', "after"],
    );
});
