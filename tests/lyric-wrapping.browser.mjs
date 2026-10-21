import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import * as sass from "sass";

const browser =
    process.env.FULLSCAPE_TEST_BROWSER ??
    [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome",
    ].find((path) => existsSync(path));

test(
    "real browser retains lyric breaks and normal/bold weights across activation and resize",
    {
        skip:
            !browser &&
            "Set FULLSCAPE_TEST_BROWSER to a Chromium browser to run layout regression tests",
    },
    async () => {
        const directory = mkdtempSync(join(tmpdir(), "fullscape-wrapping-"));
        try {
            const bundle = await build({
                entryPoints: ["src/utils/lyric-wrapping.ts"],
                bundle: true,
                format: "iife",
                globalName: "Wrapping",
                write: false,
            });
            const css = sass.compile("src/styles/base.scss").css;
            const html = `<!doctype html><meta charset="utf-8"><style>${css}
            #fullscape-display {display:block}
            #fad-lyrics-container {width:900px;--lyrics-base-font-size:48px;--lyrics-font-scale:1}
            .rnp-lyrics-line,.rnp-lyrics-line * {animation:none!important;transition:none!important;transform:none!important}
            </style>
            <div id="fullscape-display"><div id="fad-lyrics-container"><div class="lyrics-wrapper"><div class="rnp-lyrics"></div></div></div></div>
            <script>${bundle.outputFiles[0].text}</script><script>
            const results = [];
            const root = document.querySelector('.rnp-lyrics');
            const container = document.querySelector('#fad-lyrics-container');
            const samples = [
                ['English', 'original', 'I can feel your touch picking me up from the underground', 'en'],
                ['Long', 'original', 'We could be more than just part time lovers and we could stay together forever', 'en'],
                ['Chinese', 'original', '我們可以相伴永遠 不只是逢場作戲 我們可以一同遠走', 'zh-TW'],
                ['Translation', 'translated', '我們可以相伴永遠 不只是逢場作戲 我們可以一同遠走 我們可以相伴永遠', 'zh-TW'],
                ['Karaoke', 'karaoke', ['I ', 'can ', 'feel ', 'your ', 'touch ', 'picking ', 'me ', 'up ', 'from ', 'the ', 'underground'].map((word,i) => '<span class="rnp-lyrics-semantic-word"><span class="rnp-karaoke-word" data-time="'+i*100+'" data-duration="100"><span>'+word+'</span></span></span>').join(''), 'en'],
                ['Ruby', 'original', '<span class="rnp-lyrics-break-segment"><ruby class="rnp-furigana-ruby">世界<rt>せかい</rt></ruby>のどこかで 君と出会える <ruby class="rnp-furigana-ruby">世界<rt>せかい</rt></ruby>のどこかで 君と出会える</span>', 'ja'],
                ['Newline', 'original', 'First line\\nSecond line with more words in this lyric', 'en'],
            ];
            function positions(block) {
                const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
                const positions = [];
                let node;
                const top = block.getBoundingClientRect().top;
                while(node = walker.nextNode()) {
                    if(node.parentElement.closest('rt')) continue;
                    let offset = 0;
                    for(const character of node.textContent) {
                        const range = document.createRange();
                        range.setStart(node, offset); range.setEnd(node, offset+character.length);
                        const rect = range.getBoundingClientRect();
                        if(character.trim() && rect.width) positions.push([character, Math.round(rect.bottom-top)]);
                        offset += character.length;
                    }
                }
                return positions;
            }
            for(const width of [900, 600, 1100]) {
                container.style.width = width+'px';
                for(const [name,kind,content,language] of samples) {
                    root.innerHTML = '<div class="rnp-lyrics-line active"><div class="rnp-lyrics-line-content"><div class="rnp-lyrics-line-'+kind+'" data-text-language="'+language+'" lang="'+language+'">'+content+'</div></div></div>';
                    const line = root.firstElementChild;
                    const block = line.firstElementChild.firstElementChild;
                    const naturalPositions = positions(block);
                    const naturalRows = naturalPositions.filter((p,i,a) => !i || Math.abs(p[1]-a[i-1][1])>20).map(p => p[0]);
                    const clone = line.cloneNode(true);
                    clone.classList.add('rnp-lyrics-measuring'); clone.style.visibility = 'hidden'; root.append(clone);
                    Wrapping.freezeMeasuredLyricRows(clone.firstElementChild.firstElementChild, block);
                    clone.remove();
                    const active = positions(block);
                    const activeRows = active.filter((p,i,a) => !i || Math.abs(p[1]-a[i-1][1])>20).map(p => p[0]);
                    const originalSpacing = JSON.stringify(naturalPositions) === JSON.stringify(active);
                    const bold = getComputedStyle(block).fontWeight;
                    const times = [...block.querySelectorAll('[data-time]')].map(n => n.dataset.time);
                    line.classList.remove('active');
                    const normal = positions(block);
                    const regular = getComputedStyle(block).fontWeight;
                    const unchanged = JSON.stringify(active) === JSON.stringify(normal);
                    const originalBreaks = JSON.stringify(naturalRows) === JSON.stringify(activeRows);
                    const karaokeIntact = kind !== 'karaoke' || times.length === 11 && new Set(times).size === 11;
                    results.push({name,width,bold,regular,unchanged,originalBreaks,originalSpacing,karaokeIntact,naturalRows,activeRows,naturalPositions,active});
                }
            }
            document.body.innerHTML = '<pre id="results">'+JSON.stringify(results)+'</pre>';
            </script>`;
            const path = join(directory, "test.html");
            writeFileSync(path, html);
            const result = spawnSync(
                browser,
                [
                    "--headless",
                    "--disable-gpu",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-background-networking",
                    "--disable-component-update",
                    "--disable-breakpad",
                    `--user-data-dir=${join(directory, "profile")}`,
                    "--dump-dom",
                    `file://${path}`,
                ],
                { encoding: "utf8", timeout: 30000, maxBuffer: 5_000_000 },
            );
            assert.equal(result.status, 0, result.stderr);
            const match = result.stdout.match(/<pre id="results">(.*?)<\/pre>/s);
            assert.ok(match, result.stdout);
            const results = JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
            assert.equal(results.length, 21);
            for (const result of results) {
                assert.equal(result.bold, "700", JSON.stringify(result));
                assert.equal(result.regular, "400", JSON.stringify(result));
                assert.ok(
                    result.unchanged &&
                        result.originalBreaks &&
                        result.originalSpacing &&
                        result.karaokeIntact,
                    JSON.stringify(result),
                );
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    },
);
