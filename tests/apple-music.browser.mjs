import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import * as sass from "sass";
const browser =
    process.env.FULLSCAPE_TEST_BROWSER ??
    [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ].find(existsSync);
test(
    "actual renderer keeps duet timing, mirrored rows and animated background slots",
    { skip: !browser },
    async () => {
        const directory = mkdtempSync(join(tmpdir(), "fullscape-rich-browser-"));
        try {
            const bundle = await build({
                stdin: {
                    contents:
                        'export {Lyrics} from "./src/ui/components/Lyrics/Lyrics"; export {groupRichLines} from "./src/services/lyrics-rich-document";',
                    resolveDir: process.cwd(),
                },
                bundle: true,
                format: "iife",
                globalName: "Fixture",
                write: false,
                plugins: [
                    {
                        name: "host",
                        setup(builder) {
                            builder.onResolve({ filter: /.*/ }, (args) => {
                                const path = resolve(dirname(args.importer || "."), args.path);
                                if (path === resolve("src/utils/config"))
                                    return { path: "config", namespace: "host" };
                                if (path === resolve("src/ui/elements"))
                                    return { path: "dom", namespace: "host" };
                            });
                            builder.onLoad({ filter: /.*/, namespace: "host" }, ({ path }) => ({
                                contents:
                                    path === "config"
                                        ? "export default globalThis.hostConfig;"
                                        : "export const DOM=globalThis.hostDOM;",
                            }));
                        },
                    },
                ],
            });
            const css = sass.compile("src/styles/base.scss").css;
            let actual = [];
            if (process.env.FULLSCAPE_APPLE_FIXTURE) {
                const file = JSON.parse(readFileSync(process.env.FULLSCAPE_APPLE_FIXTURE, "utf8"));
                actual = file.lines.map((line) => ({
                    time: line.startMilliseconds,
                    text: line.text,
                    duration: line.durationMilliseconds,
                    words: line.words.map((word) => ({
                        time: word.startMilliseconds,
                        duration: word.durationMilliseconds,
                        text: word.text,
                    })),
                    presentation: line.presentation,
                }));
            }
            const html = `<!doctype html><meta charset="utf-8"><style>${css}
 #fullscape-display{display:block;background:#171421;color:white;width:1050px;height:900px}#fad-lyrics-container{width:950px;height:850px;--lyrics-base-font-size:48px;--lyrics-font-scale:1;--primary-color:white;--tertiary-color:#888;--secondary-color:#aaa;--main-color:255,255,255}.lyrics-wrapper,.rnp-lyrics{height:850px}#results{display:none}</style>
 <div id="fullscape-display"><div id="fad-lyrics-container"></div></div>
 <script>globalThis.progress=0;globalThis.hostConfig={get:key=>({lyricsChineseConversion:'original',karaokeLyrics:true,showLyricsFurigana:true,showLyricsTranslation:true,showLyricsRomanization:true,lyricsSize:48})[key]};globalThis.hostDOM={container:document.getElementById('fullscape-display')};globalThis.Spicetify={Player:{getProgress:()=>globalThis.progress,isPlaying:()=>false,data:{item:{uri:'spotify:track:test'}}}};</script>
 <script>${bundle.outputFiles[0].text}</script><script>
 (async()=>{try{
 const L=Fixture.Lyrics;
 L.container=document.getElementById('fad-lyrics-container');
 const node={name:'p',attributes:{},children:[]};
 const presentation=(key,end,alignment='left')=>({key,end,alignment,isBackground:false,element:node});
 const main={time:1000,text:'Ocean voices in the morning',duration:5000,words:[{time:1000,duration:5000,text:'Ocean voices in the morning'}],presentation:presentation('L1',6)};
 const right={time:1800,text:'Answering voices sing together across the ocean and the sky',duration:5200,words:[{time:1800,duration:5200,text:'Answering voices sing together across the ocean and the sky'}],presentation:presentation('L2',7,'right')};
 const bg={time:2200,text:'quiet background voice',duration:1800,words:[{time:2200,duration:1800,text:'quiet background voice'}],presentation:{...presentation('B1',4),isBackground:true,parentKey:'L1'}};
 const after={time:8000,text:'Another line follows',duration:2000,words:[{time:8000,duration:2000,text:'Another line follows'}],presentation:presentation('L3',10)};
 L.applyLines(Fixture.groupRichLines([main,right,bg,after])); L.stopLoop();
 const wrapper=L.lineNodes[0].querySelector('.rnp-rich-backgrounds');
 const before=Number(getComputedStyle(wrapper).opacity);
 const base=L.lineHeights[0]; const originalWords=[...L.lineNodes[0].querySelectorAll('.rnp-karaoke-word')];
 L.lastKaraokeProgress=null; L.lastRichLayoutProgress=null; progress=1000; L.updateActive(progress);
 const expanded=L.lineHeights[0];
 getComputedStyle(wrapper).opacity;
 const transitions=wrapper.getAnimations();
 for(const animation of transitions){animation.pause();const timing=animation.effect.getTiming();animation.currentTime=Number(timing.delay)+Number(timing.duration)*0.5;}
 const opening=Number(getComputedStyle(wrapper).opacity);
 for(const animation of transitions)animation.finish();
 const visible=Number(getComputedStyle(wrapper).opacity);
 progress=2500; L.updateActive(progress);
 const simultaneous=[...L.richActive];
 const end=L.karaokeWordsByLine[0].filter(word=>!word.node.closest('.rnp-rich-backgrounds')).at(-1).effectiveEnd;
 const rightNode=L.lineNodes[1];
 const origin=getComputedStyle(rightNode).transformOrigin;
 const rightAligned=rightNode.classList.contains('rnp-lyrics-right');
 const hasFrozenRows=rightNode.querySelectorAll('.rnp-lyrics-fixed-row').length;
 const frames=L.buildKaraokeKeyframes(L.karaokeWordsByLine[0][0]);
 const preservedWordNodes=originalWords.every((word,index)=>L.lineNodes[0].querySelectorAll('.rnp-karaoke-word')[index]===word);
 L.lastKaraokeProgress=6500; L.lastRichLayoutProgress=6500; progress=6500; L.updateActive(progress);
 getComputedStyle(wrapper).opacity; wrapper.getAnimations().forEach(animation=>animation.finish());
 const hidden=Number(getComputedStyle(wrapper).opacity);
 const collapsed=L.lineHeights[0];
 const result={before,opening,visible,base,expanded,simultaneous,end,origin,rightAligned,hasFrozenRows,frameCount:frames.length,lift:frames[20]['--karaoke-lift'],hidden,collapsed,preservedWordNodes};
 progress=2500;L.updateActive(progress);getComputedStyle(wrapper).opacity;wrapper.getAnimations().forEach(animation=>animation.finish());
 const oldLoad = L.loadSequence;
 const retainedWords = [...L.lineNodes[0].querySelectorAll('.rnp-karaoke-word')];
 L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',lines:[main,right,bg,after],offsetMilliseconds:100,timingOffsetApplied:false,sourceFamily:'apple-music'});
 result.loadInvalidated = !L.isCurrentLoad(oldLoad);
 result.offsetRetainsNodes = retainedWords.every((word,index)=>L.lineNodes[0].querySelectorAll('.rnp-karaoke-word')[index]===word);
 const actual=${JSON.stringify(actual).replace("<", "\u003c")};
 if(actual.length){
  const grouped=Fixture.groupRichLines(actual);let sample=0;let expected=[];
  for(const line of grouped){const point=line.time+1;const active=grouped.flatMap((candidate,index)=>candidate.time<=point&&point<candidate.presentation.end*1000?[index]:[]);if(active.length>expected.length){expected=active;sample=point;}}
  L.applyLines(grouped);L.stopLoop();progress=sample;L.updateActive(sample);L.stopLoop();
  result.real={lines:L.lineNodes.length,right:L.lineNodes.filter(node=>node.classList.contains('rnp-lyrics-right')).length,expected,active:[...L.richActive],sample};
  L.lineNodes.forEach(node=>{getComputedStyle(node).transform;node.getAnimations().forEach(animation=>{try{animation.finish();}catch{}})});
 }
 const output=document.createElement('script');output.type='application/json';output.id='results';output.textContent=JSON.stringify(result);document.body.append(output);L.stopLoop();
 }catch(e){const output=document.createElement('script');output.id='results';output.textContent=JSON.stringify({error:String(e),stack:e.stack});document.body.append(output);}})();</script>`;
            const path = join(directory, "fixture.html");
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
                    `--user-data-dir=${join(directory, "profile")}`,
                    "--virtual-time-budget=7000",
                    "--window-size=1100,1000",
                    "--screenshot=/tmp/fullscape-rich-regression.png",
                    "--dump-dom",
                    `file://${path}`,
                ],
                { encoding: "utf8", timeout: 30000, maxBuffer: 12000000 },
            );
            assert.equal(result.status, 0, result.stderr);
            const encoded = result.stdout.match(
                /<script[^>]*id="results"[^>]*>([\s\S]*?)<\/script>/,
            )?.[1];
            assert.ok(encoded, result.stdout.slice(-4000));
            const value = JSON.parse(encoded);
            assert.equal(value.error, undefined, JSON.stringify(value));
            assert.equal(value.before, 0);
            assert.ok(value.expanded > value.base, JSON.stringify(value));
            assert.ok(value.opening >= 0 && value.opening < 1, JSON.stringify(value));
            assert.equal(value.visible, 1);
            assert.deepEqual(value.simultaneous, [0, 1]);
            assert.equal(value.end, 6000);
            assert.equal(value.rightAligned, true);
            assert.equal(value.frameCount, 31);
            assert.equal(value.lift, "-0.07em");
            assert.equal(value.hidden, 0);
            assert.equal(value.collapsed, value.base);
            assert.equal(value.preservedWordNodes, true);
            assert.ok(value.hasFrozenRows > 0);
            if (process.env.FULLSCAPE_APPLE_FIXTURE) {
                assert.equal(value.real.lines, 68);
                assert.equal(value.real.right, 14);
                assert.deepEqual(value.real.active, value.real.expected);
                assert.ok(value.real.active.length >= 2);
            }
            assert.equal(value.loadInvalidated, true);
            assert.equal(value.offsetRetainsNodes, true);
            console.log("Rich renderer:", value);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    },
);
