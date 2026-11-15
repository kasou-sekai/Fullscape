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
                        'export {Lyrics} from "./src/ui/components/Lyrics/Lyrics"; export {groupRichLines,validRichLines} from "./src/services/lyrics-rich-document"; export {MATCHER_VERSION} from "./src/services/lyrics-matcher-version"; export {publishThirdPartyLyricsDebug} from "./src/services/third-party-lyrics"; export {lyricsPreferenceScore} from "./src/services/lyrics-preference"; export {initializeMotionTokens} from "./src/utils/motion";',
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
            const loadEntry = process.env.FULLSCAPE_LOAD_FIXTURE
                ? JSON.parse(readFileSync(process.env.FULLSCAPE_LOAD_FIXTURE, "utf8")).entry
                : null;
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
            let spacingFixtures = [];
            if (process.env.FULLSCAPE_SPACING_FIXTURE) {
                const applePath = process.env.FULLSCAPE_SPACING_FIXTURE;
                const ordinaryPath = resolve(dirname(applePath), "..", applePath.split("/").pop());
                spacingFixtures = [applePath, ordinaryPath].map((path) => {
                    const file = JSON.parse(readFileSync(path, "utf8"));
                    return {
                        source: file.sourceName,
                        lines: file.lines.slice(0, 3).map((line) => ({
                            time: line.startMilliseconds,
                            text: line.text,
                            duration: line.durationMilliseconds,
                            words: line.words.map((word) => ({
                                time: word.startMilliseconds,
                                duration: word.durationMilliseconds,
                                text: word.text,
                            })),
                            presentation: line.presentation,
                        })),
                    };
                });
            }
            let lineFixture = [];
            if (process.env.FULLSCAPE_LINE_FIXTURE) {
                const file = JSON.parse(readFileSync(process.env.FULLSCAPE_LINE_FIXTURE, "utf8"));
                lineFixture = file.lines.map((line) => ({
                    time: line.startMilliseconds,
                    text: line.text,
                    duration: line.durationMilliseconds,
                    presentation: line.presentation,
                    words: line.words.map((word) => ({
                        time: word.startMilliseconds,
                        duration: word.durationMilliseconds,
                        text: word.text,
                    })),
                }));
            }
            const html = `<!doctype html><meta charset="utf-8"><style>${css}
 #fullscape-display{display:block;background:#171421;color:white;width:1050px;height:900px}#fad-lyrics-container{width:950px;height:850px;--lyrics-font-size:48px;--primary-color:white;--tertiary-color:#888;--secondary-color:#aaa;--main-color:255,255,255}.lyrics-wrapper,.rnp-lyrics{height:850px}#results{display:none}</style>
 <div id="fullscape-display"><div id="fad-lyrics-container"></div></div>
 <script>globalThis.progress=0;globalThis.preferenceMode='auto';globalThis.hostConfig={get:key=>({lyricsDisplay:!!globalThis.testSyncEnabled,sharedLyricsBridge:!!globalThis.testSyncEnabled,lyricsSource:globalThis.preferenceMode,lyricsChineseConversion:'original',karaokeLyrics:true,showLyricsFurigana:true,showLyricsTranslation:true,showLyricsRomanization:true,lyricsSize:48})[key]};globalThis.hostDOM={container:document.getElementById('fullscape-display')};globalThis.Spicetify={Player:{getProgress:()=>globalThis.progress,isPlaying:()=>false,data:{item:{uri:'spotify:track:test'}}}};</script>
 <script>${bundle.outputFiles[0].text}</script><script>
 (async()=>{try{
 Fixture.initializeMotionTokens();
 const L=Fixture.Lyrics;
 L.container=document.getElementById('fad-lyrics-container');
 const node={name:'p',attributes:{},children:[{name:'span',attributes:{begin:'1',end:'6'},children:[]}]};
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
 const rightInset=L.lineNodes[0].offsetWidth-rightNode.offsetWidth;
 progress=7500; L.updateActive(progress);
 const held=[...L.richActive];const heldLit=rightNode.classList.contains('active');
 progress=8000; L.updateActive(progress);
 const following=[...L.richActive];
 const result={before,opening,visible,base,expanded,simultaneous,end,origin,rightAligned,rightInset,held,heldLit,following,hasFrozenRows,frameCount:frames.length,lift:frames[20]['--karaoke-lift'],hidden,collapsed,preservedWordNodes};
 progress=2500;L.updateActive(progress);getComputedStyle(wrapper).opacity;wrapper.getAnimations().forEach(animation=>animation.finish());
 const oldLoad = L.loadSequence;
 const retainedWords = [...L.lineNodes[0].querySelectorAll('.rnp-karaoke-word')];
 L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',lines:[main,right,bg,after],offsetMilliseconds:100,timingOffsetApplied:false,sourceFamily:'apple-music'});
 result.loadInvalidated = !L.isCurrentLoad(oldLoad);
 result.offsetRetainsNodes = retainedWords.every((word,index)=>L.lineNodes[0].querySelectorAll('.rnp-karaoke-word')[index]===word);
 result.offsetTimeline={line:L.lines[0].time,end:L.lines[0].presentation.end,word:Number(L.lineNodes[0].querySelector('.rnp-karaoke-word').dataset.time),background:L.lines[0].backgrounds[0].time,clock:L.karaokeWordsByLine[0][0].animation.currentTime};
 const negative=L.linesForEntry({lines:Fixture.groupRichLines([main,bg]),offsetMilliseconds:2000,sourceName:'Apple Music'});
 result.earlyOffset={line:negative[0].time,word:negative[0].words[0].time,background:negative[0].backgrounds[0].time};
 const delayed=L.linesForEntry({lines:[main],offsetMilliseconds:-500,sourceName:'Apple Music'});
 result.delayedOffset=delayed[0].time;
 result.appliedOffset=L.linesForEntry({lines:[main],offsetMilliseconds:100,timingOffsetApplied:true,sourceName:'Apple Music'})[0].time;
 const legacy={...main,text:'Hello ocean! Again',words:['Hello','ocean','Again'].map((text,index)=>({time:1000+index*500,duration:500,text}))};
 L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',metadata:{title:'Example',artist:'Artist'},lines:[legacy],sourceFamily:'apple-music'});L.stopLoop();
 Fixture.publishThirdPartyLyricsDebug({status:'matched',matchedSong:'网易云：Old cached source'});
 result.displayedSource=L.getDiagnostics().sourceFamily;
 result.matchedSource=L.getDiagnostics().thirdParty.matchedSong;
 const lyric=L.lineNodes[0].querySelector('.rnp-lyrics-line-karaoke');
 result.legacyText=lyric.textContent;
 const walker=document.createTreeWalker(lyric,NodeFilter.SHOW_TEXT);let textNode;let gapWidth=0;
 while(textNode=walker.nextNode()){for(let i=0;i<textNode.textContent.length;i++){if(textNode.textContent[i]===' '){const range=document.createRange();range.setStart(textNode,i);range.setEnd(textNode,i+1);gapWidth=Math.max(gapWidth,range.getBoundingClientRect().width);}}}
 result.gapWidth=gapWidth;
 const spacingFixtures=${JSON.stringify(spacingFixtures).replace("<", "\u003c")};
 result.spacing=spacingFixtures.map(fixture=>{
  L.appleCandidate=null;L.ordinaryCandidate=null;L.currentRichEntry=null;
  L.applyLines(Fixture.groupRichLines(fixture.lines));L.stopLoop();
  const intact=L.lineNodes.every((node,index)=>node.querySelector('.rnp-lyrics-line-karaoke,.rnp-lyrics-line-original').textContent===fixture.lines[index].text);
  return {source:fixture.source,intact};
 });
 const paragraph={...legacy,presentation:{...legacy.presentation,timingMode:'Line',element:{name:'p',attributes:{begin:'1',end:'6'},children:[]}}};
 L.appleCandidate=null;L.ordinaryCandidate=null;L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',lines:[paragraph],sourceFamily:'apple-music'});L.stopLoop();
 result.lineOnlyWords=L.lineNodes[0].querySelectorAll('.rnp-karaoke-word').length;
 result.lineOnlyText=L.lineNodes[0].querySelector('.rnp-lyrics-line-original').textContent;
 const translated={...legacy,presentation:undefined,translation:'你好海洋'};
 L.appleCandidate=null;L.ordinaryCandidate=null;
 L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',metadata:{title:'Example',artist:'Artist'},lines:[legacy],sourceFamily:'apple-music'});L.stopLoop();
 L.applyLines([translated]);L.stopLoop();
 result.translatedWins=L.getDiagnostics().sourceFamily==='standard';
 L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',lines:[legacy],sourceFamily:'apple-music'});L.stopLoop();
 result.simpleAppleStaysBelowTranslation=L.getDiagnostics().sourceFamily==='standard';
 const richLegacy={...legacy,presentation:{...legacy.presentation,alignment:'right'}};
 L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',lines:[richLegacy],sourceFamily:'apple-music'});L.stopLoop();
 result.richAppleWins=L.getDiagnostics().sourceFamily==='apple-music';
 globalThis.preferenceMode='apple-music';
 L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',lines:[legacy],sourceFamily:'apple-music'});L.stopLoop();
 result.explicitAppleWins=L.getDiagnostics().sourceFamily==='apple-music';
 globalThis.preferenceMode='auto';
 const originalRefresh=L.coordinator.refresh;
 const originalShared=L.bestSharedPreferredEntry;
 const originalConfirm=L.confirmDisplayedSelection;
 L.currentTrackUri='spotify:track:test';L.coordinator.setCurrent('spotify:track:test');
 L.currentRichEntry.cacheSource='manual';L.appleCandidate=L.currentRichEntry;
 L.coordinator.refresh=async()=>({status:'standard'});
 L.bestSharedPreferredEntry=async()=>({kind:'enhanced',trackUri:'spotify:track:test',cacheSource:'manual',sourceName:'NetEase',lines:[translated],offsetMilliseconds:500,metadata:{title:'Example',artist:'Artist'}});
 L.confirmDisplayedSelection=()=>{};globalThis.testSyncEnabled=true;
 await L.syncSharedCacheForCurrentTrack();L.stopLoop();
 result.manualOffsetHandoff={family:L.getDiagnostics().sourceFamily,time:L.lines[0].time};
 L.appleCandidate=null;L.ordinaryCandidate=null;
 L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',lines:[legacy],sourceFamily:'apple-music'});L.stopLoop();
 L.coordinator.refresh=async()=>({status:'unchanged'});
 L.bestSharedPreferredEntry=async()=>({kind:'enhanced',trackUri:'spotify:track:test',cacheSource:'plugin',sourceName:'NetEase',lines:[translated],metadata:{title:'Example',artist:'Artist'}});
 await L.syncSharedCacheForCurrentTrack();L.stopLoop();
 result.preferredOrdinaryHandoff=L.getDiagnostics().sourceFamily;
 globalThis.testSyncEnabled=false;L.currentTrackUri=null;L.coordinator.refresh=originalRefresh;L.bestSharedPreferredEntry=originalShared;L.confirmDisplayedSelection=originalConfirm;
 const lineFixture=${JSON.stringify(lineFixture).replace("<", "\u003c")};
 if(lineFixture.length){
  L.appleCandidate=null;L.ordinaryCandidate=null;L.applyRichEntry({kind:'enhanced',trackUri:'spotify:track:test',lines:lineFixture,sourceFamily:'apple-music'});L.stopLoop();
  result.lineFixture={lines:L.lineNodes.length,words:L.lineNodes.reduce((sum,node)=>sum+node.querySelectorAll('.rnp-karaoke-word').length,0),tier:Fixture.lyricsPreferenceScore(lineFixture,'apple-music')[0]};
 }
 L.appleCandidate=null;L.ordinaryCandidate=null;
 const distant={...after,time:20000,words:after.words.map(word=>({...word,time:20000})),presentation:{...after.presentation,end:22}};
 L.applyLines(Fixture.groupRichLines([main,right,distant]));L.stopLoop();progress=10000;L.updateActive(progress);L.stopLoop();
 result.interlude={visible:!!L.activeInterlude,active:[...L.richActive],opacity:Number(L.interludeNode.style.opacity)};
 progress=20000;L.updateActive(progress);L.stopLoop();result.interludeReturn=[...L.richActive];
 progress=6500;L.updateActive(progress);L.stopLoop();result.seekBack={interlude:!!L.activeInterlude,active:[...L.richActive]};
 const sustained={...main,presentation:{...main.presentation,end:18},words:main.words.map(word=>({...word,duration:17000}))};
 L.applyLines(Fixture.groupRichLines([sustained,right,distant]));L.stopLoop();progress=10000;L.updateActive(progress);L.stopLoop();
 result.sustainedVoice={interlude:!!L.activeInterlude,active:[...L.richActive],gaps:L.interludes.length};
 const actual=${JSON.stringify(actual).replace("<", "\u003c")};
 if(actual.length){
  const grouped=Fixture.groupRichLines(actual);let sample=0;let expected=[];
  for(const line of grouped){const point=line.time+1;const active=grouped.flatMap((candidate,index)=>candidate.time<=point&&point<candidate.presentation.end*1000?[index]:[]);if(active.length>expected.length){expected=active;sample=point;}}
  L.applyLines(grouped);L.stopLoop();progress=sample;L.updateActive(sample);L.stopLoop();
  result.real={lines:L.lineNodes.length,right:L.lineNodes.filter(node=>node.classList.contains('rnp-lyrics-right')).length,expected,active:[...L.richActive],sample};
  L.lineNodes.forEach(node=>{getComputedStyle(node).transform;node.getAnimations().forEach(animation=>{try{animation.finish();}catch{}})});
 }
 L.appleCandidate=null;L.ordinaryCandidate=null;L.currentRichEntry=null;
 const secondBackground={...bg,presentation:{...bg.presentation,parentKey:'L2'}};
 progress=1000;L.applyLines(Fixture.groupRichLines([main,right,bg,secondBackground,after]));L.stopLoop();
 L.manualScrollActive=true;L.manualScrollRenderPosition=1;L.manualScrollTargetPosition=1;L.applyTransforms(true);
 const secondHeightBefore=L.lineHeights[1];
 progress=2500;L.updateActive(progress);L.stopLoop();
 result.manualBackgroundLayout={before:secondHeightBefore,after:L.lineHeights[1],expected:L.baseLineHeights[1]+L.backgroundHeights[1],aria:L.lineNodes[1].querySelector('.rnp-rich-backgrounds').getAttribute('aria-hidden'),position:L.manualScrollRenderPosition};
 L.resetLyricsInteraction(false);
 const tail={...bg,duration:7000,words:[{time:2200,duration:7000,text:bg.text}],presentation:{...bg.presentation,end:9.2}};
 progress=2500;L.applyLines(Fixture.groupRichLines([main,right,tail,after]));L.stopLoop();
 const tailWord=L.karaokeWordsByLine[0].find(word=>word.node.closest('.rnp-rich-backgrounds'));
 const tailAnimation=tailWord.animation;
 progress=6500;L.updateActive(progress);L.stopLoop();
 const tailWrapper=L.lineNodes[0].querySelector('.rnp-rich-backgrounds');
 getComputedStyle(tailWrapper).opacity;tailWrapper.getAnimations().forEach(animation=>animation.finish());
 result.backgroundTail={active:[...L.richActive],opacity:Number(getComputedStyle(tailWrapper).opacity),animationRetained:!!tailAnimation&&tailWord.animation===tailAnimation,mainEnd:Fixture.groupRichLines([main,tail])[0].presentation.end};
 progress=9500;L.updateActive(progress);L.stopLoop();
 result.backgroundTail.finished=tailWord.animation===null&&!L.lineNodes[0].classList.contains('active');
 L.applyLines(Fixture.groupRichLines([main,right,tail,distant]));L.stopLoop();progress=8000;L.updateActive(progress);L.stopLoop();
 result.backgroundTail.interludeWhileSinging=!!L.activeInterlude;
 progress=10000;L.updateActive(progress);L.stopLoop();result.backgroundTail.interludeAfterEnd=!!L.activeInterlude;
 const loadFixture=${JSON.stringify(loadEntry).replace(/</g, "\\u003c")};
 const loadEntry=loadFixture??{kind:'enhanced',trackUri:'spotify:track:plain-apple-load',sourceFamily:'apple-music',lines:[{...main,words:undefined,presentation:{...main.presentation,timingMode:'Line'}},{...after,words:undefined,presentation:{...after.presentation,timingMode:'Line'}}]};
 loadEntry.validatedMatcherVersion=Fixture.MATCHER_VERSION;loadEntry.expiresAt=Date.now()+60000;
 Spicetify.Player.data.item.uri=loadEntry.trackUri;
 globalThis.testSyncEnabled=true;globalThis.preferenceMode='auto';
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/bridge-session'))return new Response(JSON.stringify({token:'fixture',protocolVersion:1,capabilities:['apple-music-v2']}));
  const body=JSON.parse(init?.body??'{}');
  return new Response(JSON.stringify({status:'ready',trackUri:loadEntry.trackUri,matcherVersion:Fixture.MATCHER_VERSION,generation:body.generation,...(String(url).endsWith('/activate')?{entry:loadEntry}:{})}));
 };
 L.appleCandidate=null;L.ordinaryCandidate=null;L.currentRichEntry=null;L.currentTrackUri=null;
 L.stopSharedCacheSync();L.startSharedCacheSync=()=>{};L.loadInterludeTempo=()=>{};L.confirmDisplayedSelection=()=>{};
 L.getCurrentTrack=()=>({uri:loadEntry.trackUri,title:'Example',artists:'Artist',album:'Album',duration:180000});
 let providerCalls=0;
 L.getSpotifyLyrics=async()=>{providerCalls++;return [];};
 L.getPreparedLyrics=async()=>{providerCalls++;return [];};
 progress=9000;await L.loadLyrics(loadEntry.trackUri);L.stopLoop();
 result.plainAppleLoad={valid:Fixture.validRichLines(loadEntry.lines),expected:Fixture.groupRichLines(loadEntry.lines).length,rendered:L.lineNodes.length,synced:L.isSynced,providerCalls};
 const loadedRoot=L.lyricsRoot;
 await Promise.resolve();
 result.plainAppleLoad.retained=L.lyricsRoot===loadedRoot&&L.lineNodes.length===result.plainAppleLoad.expected;
 globalThis.fetch=originalFetch;globalThis.testSyncEnabled=false;L.stopLoop();
 result.lineSpacing=[42,64].map(size=>{
  L.container.style.setProperty('--lyrics-font-size',size+'px');
  progress=1000;
  L.applyLines([{time:0,text:'First line'},{time:3000,text:'Second line'}]); L.stopLoop();
  L.updateActive(progress); L.applyTransforms(true);
  const [first,second]=L.lineNodes.map(node=>new DOMMatrixReadOnly(node.style.transform));
  return {
   size:L.getFontSize(),
   gap:Math.round(second.m42-first.m42-L.lineHeights[0]*first.m22),
  };
 });
 result.interludeAlignment=['left','right','center'].map(alignment=>{
  const next={...distant,presentation:{...distant.presentation,alignment}};
  progress=10000; L.applyLines(Fixture.groupRichLines([main,right,next])); L.stopLoop();
  L.updateActive(progress); L.applyTransforms(true);
  const dots=L.interludeNode.getBoundingClientRect();
  const firstDot=L.interludeDotNodes[0].getBoundingClientRect();
  const lastDot=L.interludeDotNodes.at(-1).getBoundingClientRect();
  progress=next.time; L.updateActive(progress); L.applyTransforms(true); L.stopLoop();
  const line=L.lineNodes[2].querySelector('.rnp-lyrics-line-content').getBoundingClientRect();
  const row=L.lineNodes[2].getBoundingClientRect();
  const dotsX=alignment==='right'?lastDot.right:alignment==='center'?(firstDot.left+lastDot.right)/2:firstDot.left;
  const lineX=alignment==='right'?line.right:alignment==='center'?(line.left+line.right)/2:line.left;
  return {alignment, horizontal:Math.round(dotsX-lineX), vertical:Math.round((dots.top+dots.bottom-row.top-row.bottom)/2)};
 });
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
            assert.ok(value.rightInset >= 20 && value.rightInset <= 48, JSON.stringify(value));
            assert.deepEqual(value.held, [1]);
            assert.equal(value.heldLit, true);
            assert.deepEqual(value.interlude, { visible: true, active: [], opacity: 1 });
            assert.deepEqual(value.interludeReturn, [2]);
            assert.deepEqual(value.seekBack, { interlude: false, active: [1] });
            assert.deepEqual(value.sustainedVoice, { interlude: false, active: [0], gaps: 0 });
            assert.deepEqual(value.following, [2]);
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
            assert.deepEqual(value.offsetTimeline, {
                line: 900,
                end: 5.9,
                word: 900,
                background: 2100,
                clock: 1600,
            });
            assert.deepEqual(value.earlyOffset, { line: -1000, word: -1000, background: 200 });
            assert.equal(value.delayedOffset, 1500);
            assert.equal(value.appliedOffset, 1000);
            assert.deepEqual(value.manualOffsetHandoff, { family: "standard", time: 500 });
            assert.equal(value.preferredOrdinaryHandoff, "standard");
            assert.equal(value.displayedSource, "apple-music");
            if (process.env.FULLSCAPE_LINE_FIXTURE)
                assert.deepEqual(value.lineFixture, { lines: 48, words: 0, tier: 10 });
            assert.equal(value.lineOnlyWords, 0);
            assert.equal(value.lineOnlyText, "Hello ocean! Again");
            assert.equal(value.translatedWins, true);
            assert.equal(value.simpleAppleStaysBelowTranslation, true);
            assert.equal(value.richAppleWins, true);
            assert.equal(value.explicitAppleWins, true);
            assert.match(value.matchedSource, /^Apple Music：Example/);
            assert.equal(value.legacyText, "Hello ocean! Again");
            assert.ok(value.gapWidth > 3, JSON.stringify(value));
            assert.ok(value.manualBackgroundLayout.after > value.manualBackgroundLayout.before);
            assert.equal(value.manualBackgroundLayout.after, value.manualBackgroundLayout.expected);
            assert.equal(value.manualBackgroundLayout.aria, "false");
            assert.equal(value.manualBackgroundLayout.position, 1);
            assert.deepEqual(value.backgroundTail, {
                active: [0, 1],
                opacity: 1,
                animationRetained: true,
                mainEnd: 6,
                finished: true,
                interludeWhileSinging: false,
                interludeAfterEnd: true,
            });
            assert.equal(value.plainAppleLoad.valid, true);
            assert.ok(value.plainAppleLoad.expected > 0);
            assert.equal(value.plainAppleLoad.rendered, value.plainAppleLoad.expected);
            assert.equal(value.plainAppleLoad.synced, true);
            assert.equal(value.plainAppleLoad.providerCalls, 0);
            assert.equal(value.plainAppleLoad.retained, true);
            assert.deepEqual(value.lineSpacing, [
                { size: 42, gap: 22 },
                { size: 64, gap: 22 },
            ]);
            assert.deepEqual(value.interludeAlignment, [
                { alignment: "left", horizontal: 0, vertical: 0 },
                { alignment: "right", horizontal: 0, vertical: 0 },
                { alignment: "center", horizontal: 0, vertical: 0 },
            ]);
            if (process.env.FULLSCAPE_SPACING_FIXTURE) {
                assert.equal(value.spacing.length, 2);
                assert.ok(
                    value.spacing.every((fixture) => fixture.intact),
                    JSON.stringify(value),
                );
            }
            console.log("Rich renderer:", value);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    },
);
