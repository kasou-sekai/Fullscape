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
    "real browser retains lyric breaks and highlight weights across activation and resize",
    {
        skip:
            !browser &&
            "Set FULLSCAPE_TEST_BROWSER to a Chromium browser to run layout regression tests",
    },
    async () => {
        const directory = mkdtempSync(join(tmpdir(), "fullscape-wrapping-"));
        try {
            const bundle = await build({
                stdin: {
                    contents: `export { freezeMeasuredLyricRows } from "./src/utils/lyric-wrapping";
                               export { applyTypography } from "./src/utils/typography";`,
                    resolveDir: process.cwd(),
                },
                bundle: true,
                format: "iife",
                globalName: "Wrapping",
                write: false,
            });
            const css = sass.compile("src/styles/base.scss").css;
            const html = `<!doctype html><meta charset="utf-8"><style>${css}
            #fullscape-display {display:block;font-weight:600}
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
                ['JapaneseTail', 'karaoke', ['みつめ', 'られても', 'なんにも', '出ないです', 'よ…？'].map((word,i) => '<span class="rnp-lyrics-semantic-word"><span class="rnp-karaoke-word" data-time="'+i*100+'" data-duration="100"><span>'+word+'</span></span></span>').join(''), 'ja'],
                ['EnglishTail', 'karaoke', ['You ', 'know ', 'you ', 'love ', 'me, ', 'I ', 'know ', 'you ', 'care'].map((word,i) => '<span class="rnp-lyrics-break-segment"><span class="rnp-lyrics-semantic-word"><span class="rnp-karaoke-word" data-time="'+i*100+'" data-duration="100"><span>'+word+'</span></span></span></span>').join(''), 'en'],
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
                    const originalText = block.textContent;
                    const originalTimes = [...block.querySelectorAll('[data-time]')].map(n => [n.dataset.time,n.dataset.duration,n.textContent]);
                    const naturalPositions = positions(block);
                    const naturalRows = naturalPositions.filter((p,i,a) => !i || Math.abs(p[1]-a[i-1][1])>20).map(p => p[0]);
                    const clone = line.cloneNode(true);
                    clone.classList.add('rnp-lyrics-measuring'); clone.style.visibility = 'hidden'; root.append(clone);
                    Wrapping.freezeMeasuredLyricRows(clone.firstElementChild.firstElementChild, block);
                    clone.remove();
                    const active = positions(block);
                    const activeRows = active.filter((p,i,a) => !i || Math.abs(p[1]-a[i-1][1])>20).map(p => p[0]);
                    const originalSpacing = JSON.stringify(naturalPositions) === JSON.stringify(active);
                    const activeWeight = getComputedStyle(block).fontWeight;
                    const activeWordWeights = [...block.querySelectorAll(".rnp-karaoke-word > span")].map(node => getComputedStyle(node).fontWeight);
                    const times = [...block.querySelectorAll('[data-time]')].map(n => n.dataset.time);
                    line.classList.remove('active');
                    const normal = positions(block);
                    const regular = getComputedStyle(block).fontWeight;
                    const unchanged = JSON.stringify(active) === JSON.stringify(normal);
                    const originalBreaks = JSON.stringify(naturalRows) === JSON.stringify(activeRows);
                    const expectedTimes = name === 'JapaneseTail' ? 5 : name === 'EnglishTail' ? 9 : 11;
                    const karaokeIntact = kind !== 'karaoke' || times.length === expectedTimes && new Set(times).size === expectedTimes;
                    const rows = [];
                    for (const [character,bottom] of active) {
                        if (!rows.length || Math.abs(bottom-rows.at(-1).bottom)>20) rows.push({bottom,text:''});
                        rows.at(-1).text += character;
                    }
                    const preserved = originalText === block.textContent && JSON.stringify(originalTimes) === JSON.stringify([...block.querySelectorAll('[data-time]')].map(n => [n.dataset.time,n.dataset.duration,n.textContent]));
                    const balancedTail = !['JapaneseTail','EnglishTail'].includes(name) || rows.length < 2 || Math.min(...rows.map(row=>row.text.length)) >= Math.max(...rows.map(row=>row.text.length)) * 0.45;
                    results.push({name,kind,width,activeWeight,activeWordWeights,regular,unchanged,originalBreaks,originalSpacing,karaokeIntact,balancedTail,preserved,rows,naturalRows,activeRows,naturalPositions,active});
                }
            }
            root.innerHTML = '<div class="rnp-lyrics-line active"><div class="rnp-lyrics-line-content"><div class="rnp-lyrics-line-original" id="original" lang="ja" data-text-language="ja"><ruby>世界<rt id="ruby" lang="ja">せかい</rt></ruby></div><div id="translation" lang="zh-CN" data-text-language="zh-CN">世界</div><div id="romaji" lang="en" data-text-language="en">sekai</div></div></div>';
            document.querySelector('#fullscape-display').insertAdjacentHTML('afterbegin', '<div id="fullscape-title-text-track" lang="zh-TW" data-text-language="zh-TW">歌名</div><button><span id="queue-artist" lang="ko">가수</span></button><span id="up-next" lang="en" data-text-language="en">Coming up</span>');
            document.body.insertAdjacentHTML('beforeend', '<generic-modal><div id="fullscape-config-container" data-locale="zh-TW"><select id="font-option"><option>字型</option></select></div></generic-modal><p id="spotify">Spotify</p>');
            function fonts() {
                return Object.fromEntries(['original','ruby','translation','romaji','fullscape-title-text-track','queue-artist','up-next','font-option','spotify'].map(id => {
                    const { fontFamily, fontWeight } = getComputedStyle(document.getElementById(id));
                    return [id, { fontFamily, fontWeight }];
                }));
            }
            const defaults = fonts();
            Wrapping.applyTypography({ preset: 'serif', family: '', weight: 0 });
            const serif = fonts();
            Wrapping.applyTypography({ preset: 'custom', family: 'Times New Roman', weight: 800 });
            const custom = fonts();
            Wrapping.applyTypography({ preset: 'default', family: 'Times New Roman', weight: 300 });
            const weightOnly = fonts();
            Wrapping.applyTypography({ preset: 'default', family: '', weight: 0 });
            const restored = fonts();
            document.body.innerHTML = '<pre id="results">'+JSON.stringify(results)+'</pre>';
            const report = document.createElement('pre');
            report.id = 'typography';
            report.textContent = JSON.stringify({ defaults, serif, custom, weightOnly, restored });
            document.body.append(report);
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
            const typography = result.stdout.match(/<pre id="typography">(.*?)<\/pre>/s);
            assert.ok(typography, result.stdout);
            const { defaults, serif, custom, weightOnly, restored } = JSON.parse(typography[1]);
            assert.deepEqual(restored, defaults);
            for (const [id, font] of Object.entries({
                original: "Noto Serif CJK JP",
                ruby: "Noto Serif CJK JP",
                translation: "Noto Serif CJK SC",
                romaji: "Noto Serif",
                "fullscape-title-text-track": "Noto Serif CJK TC",
                "queue-artist": "Noto Serif CJK KR",
                "up-next": "Noto Serif",
                "font-option": "Noto Serif CJK TC",
            })) {
                assert.ok(serif[id].fontFamily.startsWith(`"${font}"`), JSON.stringify(serif[id]));
                assert.equal(serif[id].fontWeight, defaults[id].fontWeight);
                assert.deepEqual(custom[id], {
                    fontFamily: '"Times New Roman", sans-serif',
                    fontWeight: "800",
                });
                assert.deepEqual(weightOnly[id], {
                    fontFamily: defaults[id].fontFamily,
                    fontWeight: "300",
                });
            }
            assert.deepEqual(custom.spotify, defaults.spotify);
            assert.deepEqual(serif.spotify, defaults.spotify);
            assert.deepEqual(weightOnly.spotify, defaults.spotify);
            assert.equal(results.length, 27);
            const tails = results.filter((result) =>
                ["JapaneseTail", "EnglishTail"].includes(result.name),
            );
            assert.ok(
                tails.some((result) => result.rows.length > 1),
                "Tail regressions must exercise wrapped text",
            );
            console.log(
                "Balanced lyric tails:",
                tails.map(({ name, width, rows }) => ({
                    name,
                    width,
                    rows: rows.map((row) => row.text),
                })),
            );
            for (const result of results) {
                const expectedActiveWeight = ["original", "karaoke"].includes(result.kind)
                    ? "600"
                    : "400";
                assert.equal(result.activeWeight, expectedActiveWeight, JSON.stringify(result));
                assert.ok(result.activeWordWeights.every((weight) => weight === "600"));
                assert.equal(result.regular, "400", JSON.stringify(result));
                assert.ok(
                    result.unchanged &&
                        result.karaokeIntact &&
                        result.balancedTail &&
                        result.preserved,
                    JSON.stringify(result),
                );
            }
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    },
);
