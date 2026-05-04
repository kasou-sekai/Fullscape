export type LyricWord = {
    time: number;
    duration: number;
    text: string;
};

export type EnhancedLyricLine = {
    time: number | null;
    text: string;
    translation?: string;
    romanization?: string;
    furigana?: string;
    words?: LyricWord[];
    duration?: number | null;
};

type NetEaseSong = {
    id: number;
    name: string;
    dt?: number;
    duration?: number;
    ar?: { name: string }[];
    artists?: { name: string }[];
};

type NetEaseLyricsResponse = {
    lrc?: { lyric?: string };
    klyric?: { lyric?: string };
    tlyric?: { lyric?: string };
    romalrc?: { lyric?: string };
    yromalrc?: { lyric?: string };
    furigana?: { lyric?: string };
    yfurigana?: { lyric?: string };
    fulrc?: { lyric?: string };
    yfulrc?: { lyric?: string };
    yrc?: { lyric?: string };
};

type TrackInfo = {
    title: string;
    artists: string;
    duration: number;
};

type ThirdPartyLyrics = {
    lines: EnhancedLyricLine[];
    translations: EnhancedLyricLine[];
    romanizations: EnhancedLyricLine[];
    furigana: EnhancedLyricLine[];
    dynamicLines: EnhancedLyricLine[];
};

type ThirdPartyCandidateDebug = ThirdPartyLyricsDebug["candidates"][number];

export type ThirdPartyLyricsDebug = {
    enabled: boolean;
    status: "idle" | "searching" | "matched" | "not-matched" | "error" | "skipped";
    reason: string;
    track?: TrackInfo;
    spotifyFirst?: EnhancedLyricLine | null;
    spotifyPreview: EnhancedLyricLine[];
    matchedSong?: string;
    matchedFirst?: EnhancedLyricLine | null;
    merged: {
        translation: number;
        romanization: number;
        furigana: number;
        karaoke: number;
    };
    candidates: Array<{
        id: number;
        name: string;
        artists: string;
        plausible: boolean;
        first?: EnhancedLyricLine | null;
        preview?: EnhancedLyricLine[];
        match: boolean;
        reason: string;
        counts?: {
            lrc: number;
            translation: number;
            romanization: number;
            furigana: number;
            dynamic: number;
        };
    }>;
};

const NETEASE_SEARCH_URL = "https://music.163.com/api/cloudsearch/pc";
const NETEASE_LYRIC_URL = "https://music.163.com/api/song/lyric";
const REQUEST_TIMEOUT_MS = 6000;
const FIRST_LINE_TIME_TOLERANCE_MS = 2500;
const MERGE_TIME_TOLERANCE_MS = 1500;

let lastDebug: ThirdPartyLyricsDebug = createDebug("idle", "尚未请求第三方歌词", false);

export function getThirdPartyLyricsDebug() {
    return lastDebug;
}

export async function enhanceWithThirdPartyLyrics(
    spotifyLines: EnhancedLyricLine[],
): Promise<EnhancedLyricLine[]> {
    const track = getCurrentTrackInfo();
    if (!track) {
        lastDebug = createDebug("skipped", "缺少当前曲目信息", false);
        return spotifyLines;
    }

    lastDebug = createDebug("searching", "正在搜索网易云候选歌词", true, track, spotifyLines);

    try {
        const songs = await searchNetEase(track);
        for (const song of songs) {
            const candidateDebug: ThirdPartyCandidateDebug = {
                id: song.id,
                name: song.name,
                artists: getSongArtists(song),
                plausible: isPlausibleSong(song, track),
                match: false,
                reason: "",
            };
            lastDebug.candidates.push(candidateDebug);

            if (!candidateDebug.plausible) {
                candidateDebug.reason = "标题/艺人/时长初筛未通过";
                continue;
            }
            const rawLyrics = await fetchNetEaseLyrics(song.id);
            const parsed = parseNetEaseLyrics(rawLyrics);
            candidateDebug.counts = {
                lrc: parsed.lines.length,
                translation: parsed.translations.length,
                romanization: parsed.romanizations.length,
                furigana: parsed.furigana.length,
                dynamic: parsed.dynamicLines.length,
            };
            if (!parsed.lines.length && !parsed.dynamicLines.length) {
                candidateDebug.reason = "候选没有可解析的原文歌词";
                continue;
            }

            const candidateLines = parsed.dynamicLines.length ? parsed.dynamicLines : parsed.lines;
            candidateDebug.first = firstMeaningfulLine(candidateLines) ?? null;
            candidateDebug.preview = previewMeaningfulLines(candidateLines);
            const matchResult = getLyricsMatchResult(spotifyLines, candidateLines);
            candidateDebug.match = matchResult.match;
            candidateDebug.reason = matchResult.reason;

            if (matchResult.match) {
                const merged = buildThirdPartyLyrics(parsed);
                lastDebug = {
                    ...lastDebug,
                    status: "matched",
                    reason: "已匹配，当前使用第三方歌词作为主歌词",
                    matchedSong: `${song.name} - ${getSongArtists(song)}`,
                    matchedFirst: candidateDebug.first,
                    merged: countMergedFeatures(merged),
                };
                return merged;
            }
        }
        lastDebug = {
            ...lastDebug,
            status: "not-matched",
            reason: songs.length ? "没有候选通过第一句歌词匹配" : "网易云未返回候选歌曲",
        };
    } catch (err) {
        lastDebug = {
            ...lastDebug,
            status: "error",
            reason: err instanceof Error ? err.message : String(err),
        };
        console.warn("Failed to enhance lyrics from third-party provider", err);
    }

    return spotifyLines;
}

function createDebug(
    status: ThirdPartyLyricsDebug["status"],
    reason: string,
    enabled: boolean,
    track?: TrackInfo,
    spotifyLines: EnhancedLyricLine[] = [],
): ThirdPartyLyricsDebug {
    return {
        enabled,
        status,
        reason,
        track,
        spotifyFirst: firstSpotifyLine(spotifyLines) ?? null,
        spotifyPreview: previewSpotifyLines(spotifyLines),
        merged: {
            translation: 0,
            romanization: 0,
            furigana: 0,
            karaoke: 0,
        },
        candidates: [],
    };
}

function getCurrentTrackInfo(): TrackInfo | null {
    const item = Spicetify.Player.data?.item;
    const meta = item?.metadata;
    const title = `${meta?.title ?? ""}`.trim();
    if (!title) return null;

    const artists = Object.keys(meta ?? {})
        .filter((key) => key.startsWith("artist_name"))
        .sort()
        .map((key) => meta?.[key])
        .filter(Boolean)
        .join(", ");

    const duration = Spicetify.Player.data?.duration ?? Number(meta?.duration ?? 0);
    return { title, artists, duration };
}

async function searchNetEase(track: TrackInfo): Promise<NetEaseSong[]> {
    const params = new URLSearchParams({
        s: `${trimSearchTitle(track.title)} ${track.artists}`.trim(),
        type: "1",
        limit: "8",
        offset: "0",
        total: "true",
    });
    const data = await requestJson(
        `${NETEASE_SEARCH_URL}?${params.toString()}`,
        "GET",
        "搜索网易云候选",
    );
    return data?.result?.songs ?? [];
}

async function fetchNetEaseLyrics(id: number): Promise<NetEaseLyricsResponse> {
    const params = new URLSearchParams({
        id: String(id),
        lv: "1",
        kv: "1",
        tv: "-1",
        rv: "1",
        yv: "1",
        ytv: "1",
        yrv: "1",
    });
    return requestJson(`${NETEASE_LYRIC_URL}?${params.toString()}`, "GET", `获取网易云歌词 ${id}`);
}

async function requestJson(url: string, method: "GET" | "POST", stage: string) {
    const headers = {
        Referer: "https://music.163.com/",
    };

    try {
        const cosmosPromise =
            method === "POST"
                ? Spicetify.CosmosAsync.post(url, {}, headers)
                : Spicetify.CosmosAsync.get(url, {}, headers);
        return parseResponseBody(await withTimeout(cosmosPromise, REQUEST_TIMEOUT_MS));
    } catch (cosmosErr) {
        try {
            const response = await fetchWithTimeout(url, { method, headers });
            return response.json();
        } catch (fetchErr) {
            throw new Error(
                `${stage}失败: Cosmos=${formatError(cosmosErr)}; fetch=${formatError(fetchErr)}`,
            );
        }
    }
}

function parseResponseBody(body: any) {
    if (typeof body === "string") return JSON.parse(body);
    return body;
}

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    return fetch(input, { ...init, signal: controller.signal }).finally(() => {
        clearTimeout(timeoutId);
    });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error("request timed out")), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timeoutId);
                resolve(value);
            },
            (err) => {
                clearTimeout(timeoutId);
                reject(err);
            },
        );
    });
}

function formatError(err: unknown) {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

function parseNetEaseLyrics(raw: NetEaseLyricsResponse): ThirdPartyLyrics {
    const lrc = fixNetEaseTimeTags(raw.lrc?.lyric ?? "");
    const tlyric = fixNetEaseTimeTags(raw.tlyric?.lyric ?? "");
    const romalrc = fixNetEaseTimeTags(raw.yromalrc?.lyric ?? raw.romalrc?.lyric ?? "");
    const furigana = fixNetEaseTimeTags(
        raw.yfurigana?.lyric ?? raw.furigana?.lyric ?? raw.yfulrc?.lyric ?? raw.fulrc?.lyric ?? "",
    );
    const yrc = raw.yrc?.lyric ?? "";
    const klyric = raw.klyric?.lyric ?? "";

    return {
        lines: parseLrc(lrc),
        translations: parseLrc(tlyric),
        romanizations: parseLrc(romalrc),
        furigana: parseLrc(furigana).concat(parseLrcAttachment(lrc, "fu")),
        dynamicLines: parseDynamicLyrics(yrc, "yrc").concat(parseDynamicLyrics(klyric, "klyric")),
    };
}

function parseLrc(lrc: string): EnhancedLyricLine[] {
    const lines: EnhancedLyricLine[] = [];
    for (const rawLine of lrc.split(/\r?\n/)) {
        const timeTags = Array.from(rawLine.matchAll(/\[([-+]?\d+):(\d+(?:\.\d+)?)\]/g));
        if (!timeTags.length) continue;
        const text = rawLine.replace(/\[[-+]?\d+:\d+(?:\.\d+)?\]/g, "").trim();
        if (!text) continue;
        for (const match of timeTags) {
            const min = Number(match[1]);
            const sec = Number(match[2]);
            if (!Number.isFinite(min) || !Number.isFinite(sec)) continue;
            lines.push({ time: Math.round((min * 60 + sec) * 1000), text });
        }
    }
    return lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

function parseLrcAttachment(lrc: string, tag: string): EnhancedLyricLine[] {
    const lines: EnhancedLyricLine[] = [];
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const attachmentRegex = new RegExp(
        `^((?:\\[[+-]?\\d+:\\d+(?:\\.\\d+)?\\])+?)\\[${escapedTag}\\](.*)$`,
    );
    for (const rawLine of lrc.split(/\r?\n/)) {
        const attachmentMatch = rawLine.match(attachmentRegex);
        if (!attachmentMatch) continue;
        const timeTags = Array.from(attachmentMatch[1].matchAll(/\[([-+]?\d+):(\d+(?:\.\d+)?)\]/g));
        const text = attachmentMatch[2].trim();
        if (!timeTags.length || !text) continue;
        for (const match of timeTags) {
            const min = Number(match[1]);
            const sec = Number(match[2]);
            if (!Number.isFinite(min) || !Number.isFinite(sec)) continue;
            lines.push({ time: Math.round((min * 60 + sec) * 1000), text });
        }
    }
    return lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

function parseDynamicLyrics(content: string, format: "yrc" | "klyric"): EnhancedLyricLine[] {
    const lines: EnhancedLyricLine[] = [];
    for (const rawLine of content.split(/\r?\n/)) {
        const lineMatch = rawLine.match(/^\[(\d+),(\d+)\](.*)$/);
        if (!lineMatch) continue;
        const lineStart = Number(lineMatch[1]);
        const lineDuration = Number(lineMatch[2]);
        const body = lineMatch[3] ?? "";
        const words: LyricWord[] = [];
        let text = "";

        if (format === "yrc") {
            for (const match of body.matchAll(/\((\d+),(\d+),0\)([^(]*)/g)) {
                const wordStart = Number(match[1]);
                const duration = Number(match[2]);
                const word = match[3] ?? "";
                if (!word || !Number.isFinite(wordStart) || !Number.isFinite(duration)) continue;
                text += word;
                appendLyricWord(words, { time: wordStart, duration, text: word });
            }
        } else {
            let offset = 0;
            for (const match of body.matchAll(/\(0,(\d+)\)([^(]+)(?:\(0,1\) )?/g)) {
                const duration = Number(match[1]);
                const word = match[2] ?? "";
                if (!word || !Number.isFinite(duration)) continue;
                appendLyricWord(words, { time: lineStart + offset, duration, text: word });
                text += word;
                offset += duration;
            }
        }

        const cleanText = text.trim();
        if (!cleanText || !words.length) continue;
        lines.push({
            time: lineStart,
            duration: lineDuration,
            text: cleanText,
            words,
        });
    }
    return lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

function appendLyricWord(words: LyricWord[], word: LyricWord) {
    if (isLyricWhitespace(word.text)) {
        const prev = words[words.length - 1];
        if (prev) {
            prev.text += word.text;
            prev.duration += word.duration;
        }
        return;
    }

    words.push(word);
}

function isLyricWhitespace(text: string) {
    return /^[\s\u1680\u2000-\u200a\u202f\u205f\u3000]+$/.test(text);
}

function buildThirdPartyLyrics(thirdParty: ThirdPartyLyrics): EnhancedLyricLine[] {
    const primaryLines = thirdParty.dynamicLines.length
        ? thirdParty.dynamicLines
        : thirdParty.lines;
    const firstEffectiveIndex = primaryLines.findIndex(
        (line) => line.time !== null && isMeaningfulLyric(line.text),
    );
    const renderLines =
        firstEffectiveIndex > 0 ? primaryLines.slice(firstEffectiveIndex) : primaryLines;

    return renderLines.map((line) => {
        if (line.time === null) return line;
        const plain = findNearestLine(thirdParty.lines, line.time, MERGE_TIME_TOLERANCE_MS);
        const translation = findNearestLine(
            thirdParty.translations,
            line.time,
            MERGE_TIME_TOLERANCE_MS,
        );
        const romanization = findNearestLine(
            thirdParty.romanizations,
            line.time,
            MERGE_TIME_TOLERANCE_MS,
        );
        const furigana = findNearestLine(thirdParty.furigana, line.time, MERGE_TIME_TOLERANCE_MS);

        return {
            ...line,
            text: line.text || plain?.text || "",
            translation: translation?.text,
            romanization: romanization?.text,
            furigana: furigana?.text,
        };
    });
}

function getLyricsMatchResult(
    spotifyLines: EnhancedLyricLine[],
    thirdPartyLines: EnhancedLyricLine[],
) {
    if (!hasSyncedLyrics(spotifyLines)) {
        return { match: true, reason: "Spotify 无同步歌词，候选已通过曲名/艺人/时长初筛" };
    }
    const spotifyFirst = firstSpotifyLine(spotifyLines);
    const thirdPartyFirst = firstMeaningfulLine(thirdPartyLines);
    if (!spotifyFirst || !thirdPartyFirst)
        return { match: false, reason: "缺少双方第一句有效歌词" };
    if (spotifyFirst.time === null || thirdPartyFirst.time === null) {
        return { match: false, reason: "第一句歌词缺少时间轴" };
    }
    const timeDiff = Math.abs(spotifyFirst.time - thirdPartyFirst.time);
    if (timeDiff > FIRST_LINE_TIME_TOLERANCE_MS) {
        return { match: false, reason: `第一句时间差过大：${timeDiff}ms` };
    }
    if (!isCompatibleText(spotifyFirst.text, thirdPartyFirst.text)) {
        return { match: false, reason: "第一句文本不匹配" };
    }
    return { match: true, reason: `第一句匹配，时间差 ${timeDiff}ms` };
}

function hasSyncedLyrics(lines: EnhancedLyricLine[]) {
    return lines.some((line) => line.time !== null && (line.time ?? 0) > 0);
}

function firstSpotifyLine(lines: EnhancedLyricLine[]) {
    return lines.find((line) => normalizeLyricText(line.text).length >= 2 && line.time !== null);
}

function previewSpotifyLines(lines: EnhancedLyricLine[]) {
    return lines
        .filter((line) => normalizeLyricText(line.text).length >= 2 && line.time !== null)
        .slice(0, 5);
}

function firstMeaningfulLine(lines: EnhancedLyricLine[]) {
    return lines.find((line) => isMeaningfulLyric(line.text) && line.time !== null);
}

function previewMeaningfulLines(lines: EnhancedLyricLine[]) {
    return lines.filter((line) => isMeaningfulLyric(line.text) && line.time !== null).slice(0, 5);
}

function isMeaningfulLyric(text: string) {
    const normalized = normalizeLyricText(text);
    if (normalized.length < 2) return false;
    return !/^(作词|作曲|编曲|制作人|监制|出品|录音|混音|母带|词版权|曲版权|录音作品|联合出品|人声|吉他|贝斯|鼓|弦乐|和声|OP|SP|纯音乐|instrumental)/i.test(
        text.trim(),
    );
}

function findNearestLine(lines: EnhancedLyricLine[], time: number | null, tolerance: number) {
    if (time === null) return null;
    let nearest: EnhancedLyricLine | null = null;
    let nearestDiff = Infinity;
    for (const line of lines) {
        if (line.time === null) continue;
        const diff = Math.abs(line.time - time);
        if (diff < nearestDiff) {
            nearest = line;
            nearestDiff = diff;
        }
    }
    return nearest && nearestDiff <= tolerance ? nearest : null;
}

function isCompatibleText(a: string, b: string) {
    const first = normalizeLyricText(a);
    const second = normalizeLyricText(b);
    if (!first || !second) return false;
    if (first === second) return true;
    const minLength = Math.min(first.length, second.length);
    if (minLength < 3) return false;
    if (minLength < Math.min(8, Math.max(first.length, second.length)) * 0.45) return false;
    return first.includes(second) || second.includes(first);
}

function normalizeLyricText(text: string) {
    return text
        .toLowerCase()
        .replace(/\[[^\]]+\]/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/[\s\u3000'’"“”.,!?，。！？、:：;；~～\-—_/\\]/g, "")
        .trim();
}

function isPlausibleSong(song: NetEaseSong, track: TrackInfo) {
    const duration = song.dt ?? song.duration ?? 0;
    if (duration && track.duration && Math.abs(duration - track.duration) > 12000) return false;

    const titleMatches = isLooseTextMatch(song.name, track.title);
    const artistNames = getSongArtists(song);
    const artistMatches =
        !track.artists || !artistNames || isLooseTextMatch(artistNames, track.artists);
    return titleMatches && artistMatches;
}

function getSongArtists(song: NetEaseSong) {
    return (song.ar ?? song.artists ?? []).map((artist) => artist.name).join(", ");
}

function countMergedFeatures(lines: EnhancedLyricLine[]) {
    return {
        translation: lines.filter((line) => Boolean(line.translation)).length,
        romanization: lines.filter((line) => Boolean(line.romanization)).length,
        furigana: lines.filter((line) => Boolean(line.furigana)).length,
        karaoke: lines.filter((line) => Boolean(line.words?.length)).length,
    };
}

function isLooseTextMatch(a: string, b: string) {
    const first = normalizeSearchText(a);
    const second = normalizeSearchText(b);
    return first.includes(second) || second.includes(first);
}

function normalizeSearchText(text: string) {
    return normalizeLyricText(trimSearchTitle(text));
}

function trimSearchTitle(title: string) {
    return title
        .replace(/\s*[-–—]\s*(remaster(?:ed)?|live|mono|stereo|explicit|radio edit).*$/i, "")
        .replace(
            /\s*\((?:feat\.?|with|from|remaster(?:ed)?|live|mono|stereo|explicit|radio edit)[^)]*\)/gi,
            "",
        )
        .trim();
}

function fixNetEaseTimeTags(text: string) {
    return text.replace(/(\[\d+:\d+):(\d+\])/g, "$1.$2");
}
