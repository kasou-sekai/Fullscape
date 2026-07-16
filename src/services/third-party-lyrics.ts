import { decryptQrc } from "qrc-decoder";
import { normalizeChineseForMatch } from "../utils/chinese-conversion";

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
    al?: { name?: string };
    album?: { name?: string };
};

type QQMusicSong = {
    provider: "qqmusic";
    id: string;
    mid: string;
    name: string;
    duration?: number;
    artists: string;
    album: string;
};

type QQMusicDesktopSearchItem = {
    id?: number | string;
    mid?: string;
    name?: string;
    title?: string;
    interval?: number;
    singer?: Array<{ name?: string; title?: string }>;
    album?: { name?: string; title?: string };
};

type QQMusicSmartboxSearchItem = {
    id?: number | string;
    docid?: number | string;
    mid?: string;
    name?: string;
    singer?: string;
};

type ProviderSong = {
    provider: "netease" | "qqmusic";
    id: number | string;
    mid?: string;
    name: string;
    duration?: number;
    artists: string;
    album: string;
    raw?: NetEaseSong;
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

export type TrackInfo = {
    title: string;
    artists: string;
    album: string;
    duration: number;
};

type ThirdPartyLyrics = {
    lines: EnhancedLyricLine[];
    translations: EnhancedLyricLine[];
    romanizations: EnhancedLyricLine[];
    furigana: EnhancedLyricLine[];
    dynamicLines: EnhancedLyricLine[];
    hasFurigana?: boolean;
};

type ThirdPartyCandidateDebug = ThirdPartyLyricsDebug["candidates"][number];

type MatchedLyricsCandidate = {
    song: ProviderSong;
    parsed: ThirdPartyLyrics;
    lines: EnhancedLyricLine[];
    debug: ThirdPartyCandidateDebug;
};

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
        provider: "netease" | "qqmusic";
        id: number | string;
        name: string;
        artists: string;
        album: string;
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
const QQ_SEARCH_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const QQ_SMARTBOX_URL = "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg";
const QQ_LYRIC_URL = "https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg";
const REQUEST_TIMEOUT_MS = 6000;
const DURATION_TOLERANCE_MS = 12000;
const FIRST_LINE_TIME_TOLERANCE_MS = 2500;
const RELAXED_FIRST_LINE_EARLY_TIME_MS = 1000;
const MERGE_TIME_TOLERANCE_MS = 1500;
const UNTIMED_DECORATION_MAX_DURATION_MS = 20;

let lastDebug: ThirdPartyLyricsDebug = createDebug("idle", "尚未请求第三方歌词", false);

export function getThirdPartyLyricsDebug() {
    return lastDebug;
}

export function publishThirdPartyLyricsDebug(debug: ThirdPartyLyricsDebug, fromCache = false) {
    lastDebug =
        fromCache && !debug.reason.startsWith("本地缓存：")
            ? { ...debug, reason: `本地缓存：${debug.reason}` }
            : debug;
}

export async function enhanceWithThirdPartyLyrics(
    spotifyLines: EnhancedLyricLine[],
    trackOverride?: TrackInfo,
    relaxedMatching = false,
    publishDebug = true,
    captureDebug?: (debug: ThirdPartyLyricsDebug) => void,
): Promise<EnhancedLyricLine[]> {
    const track = trackOverride ?? getCurrentTrackInfo();
    if (!track) {
        const debug = createDebug("skipped", "缺少当前曲目信息", false);
        if (publishDebug) lastDebug = debug;
        captureDebug?.(debug);
        return spotifyLines;
    }

    let debug = createDebug(
        "searching",
        "正在同时搜索网易云与 QQ 音乐候选歌词",
        true,
        track,
        spotifyLines,
    );
    if (publishDebug) lastDebug = debug;

    try {
        const searchResults = await Promise.allSettled([
            searchNetEase(track),
            searchQQMusic(track),
        ]);
        const songs = searchResults.flatMap((result) =>
            result.status === "fulfilled" ? result.value : [],
        );
        const searchErrors = searchResults.flatMap((result, index) =>
            result.status === "rejected"
                ? [`${index === 0 ? "网易云" : "QQ 音乐"}搜索失败：${formatError(result.reason)}`]
                : [],
        );

        const matched = (
            await mapWithConcurrency(songs, 4, (song) =>
                evaluateLyricsCandidate(song, track, spotifyLines, debug, relaxedMatching),
            )
        ).filter((candidate): candidate is MatchedLyricsCandidate => candidate !== null);
        const selected = matched.sort(compareMatchedLyrics)[0];

        if (selected) {
            const features = countMergedFeatures(selected.lines);
            debug = {
                ...debug,
                // A provider failure does not invalidate a fully evaluated
                // match from the other provider. Keep the diagnostic detail,
                // but expose this as a successful result so it is cached and
                // does not trigger duplicate retries.
                status: "matched",
                reason: searchErrors.length
                    ? `暂时使用${providerName(selected.song.provider)}候选；${searchErrors.join("；")}`
                    : `已比较网易云与 QQ 音乐候选，选择${providerName(selected.song.provider)}的最高质量版本`,
                matchedSong: `${providerName(selected.song.provider)}：${selected.song.name} - ${selected.song.artists}`,
                matchedFirst: selected.debug.first,
                merged: features,
            };
            if (publishDebug) lastDebug = debug;
            captureDebug?.(debug);
            return selected.lines;
        }

        debug = {
            ...debug,
            status: searchErrors.length ? "error" : "not-matched",
            reason: [
                songs.length
                    ? relaxedMatching
                        ? "两个来源均没有候选通过严格匹配或时长与首句宽松匹配"
                        : "两个来源均没有候选依次通过纯歌名、时长、首句及歌手/专辑匹配"
                    : "网易云与 QQ 音乐均未返回候选歌曲",
                ...searchErrors,
            ].join("；"),
        };
    } catch (err) {
        debug = {
            ...debug,
            status: "error",
            reason: err instanceof Error ? err.message : String(err),
        };
        console.warn("Failed to enhance lyrics from third-party provider", err);
    }

    if (publishDebug) lastDebug = debug;
    captureDebug?.(debug);
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

    const album = `${meta?.album_title ?? ""}`.trim();
    const duration = Spicetify.Player.data?.duration ?? Number(meta?.duration ?? 0);
    return { title, artists, album, duration };
}

async function evaluateLyricsCandidate(
    song: ProviderSong,
    track: TrackInfo,
    spotifyLines: EnhancedLyricLine[],
    debug: ThirdPartyLyricsDebug,
    relaxedMatching: boolean,
): Promise<MatchedLyricsCandidate | null> {
    const candidateDebug: ThirdPartyCandidateDebug = {
        provider: song.provider,
        id: song.id,
        name: song.name,
        artists: song.artists,
        album: song.album,
        plausible: false,
        match: false,
        reason: "",
    };
    debug.candidates.push(candidateDebug);

    const titleMatches = isBaseTitleMatch(song.name, track.title);
    const titleReason = titleMatches
        ? "纯歌名匹配"
        : `纯歌名不匹配：${getBaseTrackTitle(song.name)} ≠ ${getBaseTrackTitle(track.title)}`;
    if (!titleMatches && !relaxedMatching) {
        candidateDebug.reason = titleReason;
        return null;
    }
    const durationResult = getDurationMatchResult(song, track);
    if (!durationResult.match) {
        candidateDebug.reason = `${titleReason}；${durationResult.reason}`;
        return null;
    }
    const identityResult = getArtistOrAlbumMatchResult(song, track);
    if (!identityResult.match && !relaxedMatching) {
        candidateDebug.reason = `${titleReason}；${durationResult.reason}；${identityResult.reason}`;
        return null;
    }
    const strictMetadataMatches = titleMatches && identityResult.match;
    const relaxedDurationResult = relaxedMatching
        ? getRelaxedDurationMatchResult(song, track)
        : { match: false, reason: "宽松匹配未开启" };
    if (!strictMetadataMatches && !relaxedDurationResult.match) {
        candidateDebug.reason = `${titleReason}；${durationResult.reason}；${identityResult.reason}；${relaxedDurationResult.reason}`;
        return null;
    }

    candidateDebug.plausible = true;
    const preliminaryReason = strictMetadataMatches
        ? `${titleReason}；${durationResult.reason}；${identityResult.reason}`
        : `${titleReason}；${relaxedDurationResult.reason}；忽略歌名、歌手与专辑，尝试宽松首句匹配`;
    candidateDebug.reason = preliminaryReason;

    try {
        const parsed =
            song.provider === "netease"
                ? parseNetEaseLyrics(await fetchNetEaseLyrics(Number(song.id)))
                : await fetchQQMusicLyrics(song);
        parsed.lines = trimLeadingProviderMetadata(parsed.lines, song, spotifyLines);
        parsed.dynamicLines = trimLeadingProviderMetadata(
            parsed.dynamicLines,
            song,
            spotifyLines,
        );
        candidateDebug.counts = {
            lrc: parsed.lines.length,
            translation: parsed.translations.length,
            romanization: parsed.romanizations.length,
            furigana: parsed.furigana.length || Number(Boolean(parsed.hasFurigana)),
            dynamic: parsed.dynamicLines.length,
        };
        if (!parsed.lines.length && !parsed.dynamicLines.length) {
            candidateDebug.reason = `${preliminaryReason}；候选没有可解析的原文歌词`;
            return null;
        }

        const candidateLines = parsed.dynamicLines.length ? parsed.dynamicLines : parsed.lines;
        candidateDebug.first = firstMeaningfulLine(candidateLines) ?? null;
        candidateDebug.preview = previewMeaningfulLines(candidateLines);
        const strictMatchResult = strictMetadataMatches
            ? getLyricsMatchResult(spotifyLines, candidateLines)
            : null;
        const relaxedMatchResult =
            relaxedMatching && !strictMatchResult?.match && relaxedDurationResult.match
                ? getRelaxedLyricsMatchResult(spotifyLines, candidateLines)
                : null;
        const matchResult = strictMatchResult?.match
            ? strictMatchResult
            : (relaxedMatchResult ?? strictMatchResult);
        if (!matchResult) {
            candidateDebug.reason = `${preliminaryReason}；无法执行宽松首句匹配`;
            return null;
        }
        candidateDebug.match = matchResult.match;
        candidateDebug.reason = [
            preliminaryReason,
            strictMatchResult && !strictMatchResult.match ? strictMatchResult.reason : "",
            matchResult.reason,
        ]
            .filter(Boolean)
            .join("；");
        if (!matchResult.match) return null;

        const lines = buildThirdPartyLyrics(parsed);
        return { song, parsed, lines, debug: candidateDebug };
    } catch (err) {
        candidateDebug.reason = `${preliminaryReason}；获取或解析失败：${formatError(err)}`;
        return null;
    }
}

function compareMatchedLyrics(first: MatchedLyricsCandidate, second: MatchedLyricsCandidate) {
    const firstFeatures = getCandidateQuality(first);
    const secondFeatures = getCandidateQuality(second);
    for (let index = 0; index < firstFeatures.length; index++) {
        if (firstFeatures[index] !== secondFeatures[index]) {
            return secondFeatures[index] - firstFeatures[index];
        }
    }
    if (first.song.provider === second.song.provider) return 0;
    return first.song.provider === "qqmusic" ? -1 : 1;
}

function getCandidateQuality(candidate: MatchedLyricsCandidate) {
    const features = countMergedFeatures(candidate.lines);
    return [
        Number(features.karaoke > 0),
        Number(features.furigana > 0 || (candidate.debug.counts?.furigana ?? 0) > 0),
        Number(features.translation > 0),
        features.karaoke,
        features.furigana,
        features.translation,
        features.romanization,
    ];
}

function providerName(provider: ProviderSong["provider"]) {
    return provider === "netease" ? "网易云" : "QQ 音乐";
}

function trimLeadingProviderMetadata(
    lines: EnhancedLyricLine[],
    song: ProviderSong,
    spotifyLines: EnhancedLyricLine[],
) {
    const spotifyFirst = firstMeaningfulLine(spotifyLines);
    const firstLyricIndex = lines.findIndex(
        (line) =>
            isMeaningfulLyric(line.text) &&
            (!isProviderMetadataLine(line.text, song) ||
                isSameNormalizedLyric(line.text, spotifyFirst?.text)),
    );
    return firstLyricIndex > 0 ? lines.slice(firstLyricIndex) : lines;
}

function isSameNormalizedLyric(first: string, second?: string) {
    if (!second) return false;
    const normalizedFirst = normalizeLyricText(first);
    const normalizedSecond = normalizeLyricText(second);
    return Boolean(normalizedFirst && normalizedFirst === normalizedSecond);
}

function isProviderMetadataLine(text: string, song: ProviderSong) {
    if (!isMeaningfulLyric(text)) return true;
    const normalized = normalizeLyricText(text);
    const title = normalizeLyricText(song.name);
    const artists = normalizeLyricText(song.artists);
    return Boolean(
        title &&
            (normalized === title ||
                (artists && normalized === `${title}${artists}`) ||
                (artists && normalized === `${artists}${title}`)),
    );
}

async function searchNetEase(track: TrackInfo): Promise<ProviderSong[]> {
    const params = new URLSearchParams({
        s: `${getBaseTrackTitle(track.title)} ${track.artists}`.trim(),
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
    return (data?.result?.songs ?? []).map((song: NetEaseSong) => ({
        provider: "netease" as const,
        id: song.id,
        name: song.name,
        duration: song.dt ?? song.duration,
        artists: getNetEaseSongArtists(song),
        album: getNetEaseSongAlbum(song),
        raw: song,
    }));
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

async function searchQQMusic(track: TrackInfo): Promise<ProviderSong[]> {
    const query = `${getBaseTrackTitle(track.title)} ${track.artists}`.trim();
    const requestBody = {
        req_1: {
            method: "DoSearchForQQMusicDesktop",
            module: "music.search.SearchCgiService",
            param: {
                num_per_page: 8,
                page_num: 1,
                query,
                search_type: 0,
            },
        },
    };
    const [desktopResult, smartboxResult] = await Promise.allSettled([
        requestJson(QQ_SEARCH_URL, "POST", "搜索 QQ 音乐候选", requestBody, {
            "Content-Type": "application/json",
            Referer: "https://y.qq.com/",
        }),
        requestJson(
            `${QQ_SMARTBOX_URL}?${new URLSearchParams({ key: query }).toString()}`,
            "GET",
            "搜索 QQ 音乐候选（Smartbox）",
            undefined,
            { Referer: "https://y.qq.com/" },
        ),
    ]);
    if (desktopResult.status === "rejected" && smartboxResult.status === "rejected") {
        throw new Error(
            `QQ 音乐搜索失败: MusicU=${formatError(desktopResult.reason)}; Smartbox=${formatError(smartboxResult.reason)}`,
        );
    }

    const songs = new Map<string, QQMusicSong>();
    if (desktopResult.status === "fulfilled") {
        const items = (desktopResult.value?.req_1?.data?.body?.song?.list ??
            []) as QQMusicDesktopSearchItem[];
        items.forEach((item) => {
            const id = `${item.id ?? ""}`;
            const mid = `${item.mid ?? ""}`;
            if (!id || !mid) return;
            songs.set(id, {
                provider: "qqmusic",
                id,
                mid,
                name: `${item.name ?? item.title ?? ""}`,
                duration: Number(item.interval ?? 0) * 1000 || undefined,
                artists: (item.singer ?? [])
                    .map((artist: { name?: string; title?: string }) => artist.name ?? artist.title)
                    .filter(Boolean)
                    .join(", "),
                album: `${item.album?.name ?? item.album?.title ?? ""}`,
            });
        });
    }
    if (smartboxResult.status === "fulfilled") {
        const items = (smartboxResult.value?.data?.song?.itemlist ??
            []) as QQMusicSmartboxSearchItem[];
        items.forEach((item) => {
            const id = `${item.id ?? item.docid ?? ""}`;
            const mid = `${item.mid ?? ""}`;
            if (!id || !mid || songs.has(id)) return;
            songs.set(id, {
                provider: "qqmusic",
                id,
                mid,
                name: `${item.name ?? ""}`,
                artists: `${item.singer ?? ""}`,
                album: "",
            });
        });
    }
    return Array.from(songs.values());
}

async function fetchQQMusicLyrics(song: ProviderSong): Promise<ThirdPartyLyrics> {
    const params = new URLSearchParams({
        musicid: String(song.id),
        version: "15",
        miniversion: "82",
        lrctype: "4",
    });
    const raw = await requestText(
        `${QQ_LYRIC_URL}?${params.toString()}`,
        "GET",
        `获取 QQ 音乐歌词 ${song.id}`,
        undefined,
        { Referer: "https://c.y.qq.com/" },
    );
    return parseQQMusicLyrics(raw);
}

async function requestJson(
    url: string,
    method: "GET" | "POST",
    stage: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = { Referer: "https://music.163.com/" },
) {
    return parseResponseBody(await requestBody(url, method, stage, body, headers));
}

async function requestText(
    url: string,
    method: "GET" | "POST",
    stage: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {},
) {
    const proxyTemplate =
        localStorage.getItem("spicetify:corsProxyTemplate") ??
        "https://cors-proxy.spicetify.app/{url}";
    const proxyUrl = proxyTemplate.replace(/{url}/, new URL(url).toString());
    try {
        const response = await fetchWithTimeout(proxyUrl, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...headers,
            },
            body: method === "POST" && body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
    } catch (proxyErr) {
        throw new Error(`${stage}失败: CORS proxy=${formatError(proxyErr)}`);
    }
}

async function requestBody(
    url: string,
    method: "GET" | "POST",
    stage: string,
    body: Record<string, unknown> | undefined,
    headers: Record<string, string>,
) {
    try {
        const response = await fetchWithTimeout(url, {
            method,
            headers,
            body: method === "POST" && body ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    } catch (directError) {
        try {
            // Use Cosmos only after the direct transport has definitively
            // failed, so one logical request never produces duplicate traffic.
            return await withTimeout(
                method === "POST"
                    ? Spicetify.CosmosAsync.post(url, body ?? {}, headers)
                    : Spicetify.CosmosAsync.get(url, {}, headers),
                REQUEST_TIMEOUT_MS,
            );
        } catch (cosmosError) {
            throw new Error(
                `${stage}失败: direct=${formatError(directError)}; Cosmos=${formatError(cosmosError)}`,
            );
        }
    }
}

async function mapWithConcurrency<T, R>(
    values: T[],
    limit: number,
    transform: (value: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(values.length);
    let nextIndex = 0;
    const worker = async () => {
        while (nextIndex < values.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await transform(values[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
    return results;
}

function parseResponseBody(body: unknown) {
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

export function parseQQMusicLyrics(raw: string): ThirdPartyLyrics {
    const original = decodeQQMusicLyricContent(extractQQMusicContent(raw, "content"));
    const translation = decodeQQMusicLyricContent(extractQQMusicContent(raw, "contentts"));
    const romanization = decodeQQMusicLyricContent(extractQQMusicContent(raw, "contentroma"));
    const normalizedOriginal = normalizeExtendedLrcTimestamps(original);
    const dynamicLines = parseQQMusicQrc(normalizedOriginal);
    const furigana = buildQQMusicFurigana(
        dynamicLines,
        extractQQMusicKana(`${original}\n${translation}\n${romanization}`),
    );

    return {
        lines: parseLrc(normalizedOriginal),
        translations: parseLrc(normalizeExtendedLrcTimestamps(translation)).filter(
            (line) => !isQQMusicTranslationPlaceholder(line.text),
        ),
        romanizations: parseLrc(normalizeExtendedLrcTimestamps(romanization)),
        furigana,
        dynamicLines,
        hasFurigana: furigana.length > 0,
    };
}

function isQQMusicTranslationPlaceholder(text: string) {
    return /^\/{2}$/.test(text.trim());
}

function extractQQMusicContent(raw: string, tag: string) {
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const cdataMatch = raw.match(
        new RegExp(
            `<${escapedTag}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${escapedTag}>`,
            "i",
        ),
    );
    if (cdataMatch) return cdataMatch[1].trim();
    const textMatch = raw.match(
        new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)</${escapedTag}>`, "i"),
    );
    return textMatch?.[1]?.trim() ?? "";
}

function decodeQQMusicLyricContent(content: string) {
    if (!content) return "";
    let decoded = decodeXmlEntities(content.trim());
    if (/^[\da-f]+$/i.test(decoded) && decoded.length % 2 === 0) {
        decoded = decryptQrc(decoded);
    }
    if (!decoded.includes("<?xml")) return decoded;

    const marker = 'LyricContent="';
    const markerIndex = decoded.indexOf(marker);
    if (markerIndex < 0) return decoded;
    const start = markerIndex + marker.length;
    let escaped = false;
    for (let index = start; index < decoded.length; index++) {
        const character = decoded[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === "\\") {
            escaped = true;
            continue;
        }
        if (character !== '"') continue;
        return normalizeQQMusicContent(
            decodeXmlEntities(decoded.slice(start, index))
                .replace(/\\"/g, '"')
                .replace(/\\r\\n|\\n|\\r/g, "\n"),
        );
    }
    return decoded;
}

function decodeXmlEntities(text: string) {
    return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, value: string) => {
        const normalized = value.toLowerCase();
        if (normalized === "amp") return "&";
        if (normalized === "lt") return "<";
        if (normalized === "gt") return ">";
        if (normalized === "quot") return '"';
        if (normalized === "apos") return "'";
        const radix = normalized.startsWith("#x") ? 16 : 10;
        const rawNumber = normalized.replace(/^#x?/, "");
        const codePoint = Number.parseInt(rawNumber, radix);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    });
}

function normalizeQQMusicContent(content: string) {
    return content
        .replace(/\s+(?=\[\d+,\d+\])/g, "\n")
        .replace(/\]\s+\[/g, "]\n[")
        .trim();
}

function normalizeExtendedLrcTimestamps(content: string) {
    return content.replace(
        /\[(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]/g,
        (_tag, hours: string, minutes: string, seconds: string) =>
            `[${Number(hours) * 60 + Number(minutes)}:${seconds}]`,
    );
}

function extractQQMusicKana(content: string) {
    return content.match(/^\[kana:([^\]]+)\]/im)?.[1] ?? "";
}

function buildQQMusicFurigana(lines: EnhancedLyricLine[], kana: string) {
    const compactKana = kana.replace(/\(\d+,\d+\)/g, "");
    const annotations = Array.from(
        compactKana.matchAll(/(\d+)([ぁ-ゖァ-ヺーゝゞヽヾ]+)/gu),
        (match) => ({ length: Number(match[1]), reading: match[2] }),
    ).filter((annotation) => annotation.length > 0 && annotation.reading);
    if (!annotations.length) return [];

    let annotationIndex = 0;
    return lines.flatMap((line) => {
        const characters = Array.from(line.text);
        const output: string[] = [];
        let annotated = false;
        for (let index = 0; index < characters.length; index++) {
            const character = characters[index];
            if (!isJapaneseKanji(character) || annotationIndex >= annotations.length) {
                output.push(character);
                continue;
            }

            const annotation = annotations[annotationIndex++];
            const baseCharacters: string[] = [];
            let cursor = index;
            while (
                cursor < characters.length &&
                baseCharacters.length < annotation.length &&
                isJapaneseKanji(characters[cursor])
            ) {
                baseCharacters.push(characters[cursor]);
                cursor += 1;
            }
            if (baseCharacters.length !== annotation.length) {
                output.push(character);
                annotationIndex -= 1;
                continue;
            }
            output.push(`${baseCharacters.join("")}《${annotation.reading}》`);
            index = cursor - 1;
            annotated = true;
        }
        return annotated ? [{ time: line.time, text: output.join("") }] : [];
    });
}

function isJapaneseKanji(character: string) {
    return /^[\p{Script=Han}々〆ヶ]$/u.test(character);
}

function parseQQMusicQrc(content: string): EnhancedLyricLine[] {
    const lines: EnhancedLyricLine[] = [];
    for (const rawLine of content.split(/\r?\n/)) {
        const lineMatch = rawLine.match(/^\[(\d+),(\d+)\](.*)$/);
        if (!lineMatch) continue;
        const lineStart = Number(lineMatch[1]);
        const lineDuration = Number(lineMatch[2]);
        const body = lineMatch[3] ?? "";
        const words: LyricWord[] = [];
        const fragmentRegex = /(.*?)\((\d+),(\d+)\)/g;
        let match: RegExpExecArray | null;
        while ((match = fragmentRegex.exec(body)) !== null) {
            const text = match[1];
            const time = Number(match[2]);
            const duration = Number(match[3]);
            if (!text || !Number.isFinite(time) || !Number.isFinite(duration)) continue;
            appendLyricWord(words, { time, duration, text });
        }
        const timedWords = mergeUntimedDecorations(words);
        const text = timedWords
            .map((word) => word.text)
            .join("")
            .trim();
        if (!text || !timedWords.length) continue;
        lines.push({
            time: lineStart,
            duration: lineDuration,
            text,
            words: timedWords,
        });
    }
    return lines.sort((first, second) => (first.time ?? 0) - (second.time ?? 0));
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
        const timedWords = mergeUntimedDecorations(words);
        if (!cleanText || !timedWords.length) continue;
        lines.push({
            time: lineStart,
            duration: lineDuration,
            text: cleanText,
            words: timedWords,
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
    return /^[\p{White_Space}\u200b\ufeff]+$/u.test(text);
}

function mergeUntimedDecorations(words: LyricWord[]) {
    const merged: LyricWord[] = [];
    let leadingDecoration = "";
    words.forEach((word) => {
        if (word.duration <= UNTIMED_DECORATION_MAX_DURATION_MS && isLyricDecoration(word.text)) {
            const previous = merged[merged.length - 1];
            if (previous) previous.text += word.text;
            else leadingDecoration += word.text;
            return;
        }

        const nextWord = {
            ...word,
            text: `${leadingDecoration}${word.text}`,
        };
        leadingDecoration = "";
        merged.push(nextWord);
    });

    if (leadingDecoration && merged.length) {
        merged[merged.length - 1].text += leadingDecoration;
    }
    return merged;
}

function isLyricDecoration(text: string) {
    return Boolean(text) && /^[\p{P}\p{S}\p{White_Space}\u200b\ufeff]+$/u.test(text);
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
    const plainLines = alignOriginalLines(renderLines, thirdParty.lines);
    const translationsByPlainLine = alignTimedLines(
        thirdParty.lines,
        thirdParty.translations,
        MERGE_TIME_TOLERANCE_MS,
    );
    const romanizationsByPlainLine = alignTimedLines(
        thirdParty.lines,
        thirdParty.romanizations,
        MERGE_TIME_TOLERANCE_MS,
    );
    const furiganaByPlainLine = alignTimedLines(
        thirdParty.lines,
        thirdParty.furigana,
        MERGE_TIME_TOLERANCE_MS,
    );
    const directTranslations = alignTimedLines(
        renderLines,
        thirdParty.translations,
        MERGE_TIME_TOLERANCE_MS,
    );
    const directRomanizations = alignTimedLines(
        renderLines,
        thirdParty.romanizations,
        MERGE_TIME_TOLERANCE_MS,
    );
    const directFurigana = alignTimedLines(
        renderLines,
        thirdParty.furigana,
        MERGE_TIME_TOLERANCE_MS,
    );

    return renderLines.map((line, index) => {
        if (line.time === null) return line;
        const plain = plainLines[index];
        const plainIndex = plain ? thirdParty.lines.indexOf(plain) : -1;
        const translation =
            (plainIndex >= 0 ? translationsByPlainLine[plainIndex] : null) ??
            directTranslations[index];
        const romanization =
            (plainIndex >= 0 ? romanizationsByPlainLine[plainIndex] : null) ??
            directRomanizations[index];
        const furigana =
            (plainIndex >= 0 ? furiganaByPlainLine[plainIndex] : null) ?? directFurigana[index];
        const synchronizedLine = synchronizeDynamicPunctuation(line, plain?.text);
        return {
            ...synchronizedLine,
            text: synchronizedLine.text || plain?.text || "",
            translation: translation?.text,
            romanization: romanization?.text,
            furigana: furigana?.text,
        };
    });
}

function alignOriginalLines(primary: EnhancedLyricLine[], originals: EnhancedLyricLine[]) {
    const aligned: Array<EnhancedLyricLine | null> = new Array(primary.length).fill(null);
    let originalCursor = 0;

    primary.forEach((line, lineIndex) => {
        if (line.time === null) return;
        let bestIndex = -1;
        let bestDiff = Infinity;
        for (let index = originalCursor; index < originals.length; index++) {
            const candidate = originals[index];
            if (candidate.time === null) continue;
            const diff = Math.abs(candidate.time - line.time);
            if (
                diff <= MERGE_TIME_TOLERANCE_MS &&
                isCompatibleText(line.text, candidate.text) &&
                diff < bestDiff
            ) {
                bestIndex = index;
                bestDiff = diff;
            }
            if (candidate.time > line.time + MERGE_TIME_TOLERANCE_MS) break;
        }

        if (bestIndex < 0) {
            for (let index = originalCursor; index < originals.length; index++) {
                const candidate = originals[index];
                if (candidate.time === null) continue;
                const diff = Math.abs(candidate.time - line.time);
                if (diff < bestDiff && diff <= MERGE_TIME_TOLERANCE_MS) {
                    bestIndex = index;
                    bestDiff = diff;
                }
                if (candidate.time > line.time + MERGE_TIME_TOLERANCE_MS) break;
            }
        }

        if (bestIndex < 0) return;
        aligned[lineIndex] = originals[bestIndex];
        originalCursor = bestIndex + 1;
    });

    return aligned;
}

function alignTimedLines(
    targets: EnhancedLyricLine[],
    sources: EnhancedLyricLine[],
    tolerance: number,
) {
    const aligned: Array<EnhancedLyricLine | null> = new Array(targets.length).fill(null);
    const targetCount = targets.length;
    const sourceCount = sources.length;
    const matches = Array.from({ length: targetCount + 1 }, () =>
        new Array<number>(sourceCount + 1).fill(0),
    );
    const costs = Array.from({ length: targetCount + 1 }, () =>
        new Array<number>(sourceCount + 1).fill(0),
    );
    const choices = Array.from({ length: targetCount }, () =>
        new Array<"target" | "source" | "match">(sourceCount).fill("target"),
    );

    for (let targetIndex = targetCount - 1; targetIndex >= 0; targetIndex--) {
        for (let sourceIndex = sourceCount - 1; sourceIndex >= 0; sourceIndex--) {
            const options: Array<{
                choice: "target" | "source" | "match";
                matches: number;
                cost: number;
            }> = [
                {
                    choice: "target",
                    matches: matches[targetIndex + 1][sourceIndex],
                    cost: costs[targetIndex + 1][sourceIndex],
                },
                {
                    choice: "source",
                    matches: matches[targetIndex][sourceIndex + 1],
                    cost: costs[targetIndex][sourceIndex + 1],
                },
            ];
            const targetTime = targets[targetIndex].time;
            const sourceTime = sources[sourceIndex].time;
            if (targetTime !== null && sourceTime !== null) {
                const diff = Math.abs(targetTime - sourceTime);
                if (diff <= tolerance) {
                    options.push({
                        choice: "match",
                        matches: matches[targetIndex + 1][sourceIndex + 1] + 1,
                        cost: costs[targetIndex + 1][sourceIndex + 1] + diff,
                    });
                }
            }
            const best = options.reduce((current, option) => {
                if (option.matches !== current.matches) {
                    return option.matches > current.matches ? option : current;
                }
                return option.cost < current.cost ? option : current;
            });
            matches[targetIndex][sourceIndex] = best.matches;
            costs[targetIndex][sourceIndex] = best.cost;
            choices[targetIndex][sourceIndex] = best.choice;
        }
    }

    let targetIndex = 0;
    let sourceIndex = 0;
    while (targetIndex < targetCount && sourceIndex < sourceCount) {
        const choice = choices[targetIndex][sourceIndex];
        if (choice === "match") {
            aligned[targetIndex] = sources[sourceIndex];
            targetIndex += 1;
            sourceIndex += 1;
        } else if (choice === "source") {
            sourceIndex += 1;
        } else {
            targetIndex += 1;
        }
    }
    return aligned;
}

function synchronizeDynamicPunctuation(line: EnhancedLyricLine, plainText?: string) {
    if (!plainText || !line.words?.length) return line;
    const lineWords = line.words;
    const dynamicText = lineWords.map((word) => word.text).join("");
    if (
        normalizeTimedText(dynamicText) !== normalizeTimedText(plainText) ||
        countSupplementalCharacters(plainText) <= countSupplementalCharacters(dynamicText)
    ) {
        return line;
    }

    const targetCharacters = Array.from(plainText);
    let targetIndex = 0;
    const words = lineWords.map((word, wordIndex) => {
        const meaningfulCount = Array.from(normalizeTimedText(word.text)).length;
        let consumedMeaningful = 0;
        let text = "";
        while (targetIndex < targetCharacters.length && consumedMeaningful < meaningfulCount) {
            const character = targetCharacters[targetIndex++];
            text += character;
            if (normalizeTimedText(character)) consumedMeaningful += 1;
        }
        while (
            targetIndex < targetCharacters.length &&
            !normalizeTimedText(targetCharacters[targetIndex])
        ) {
            text += targetCharacters[targetIndex++];
        }
        if (wordIndex === lineWords.length - 1 && targetIndex < targetCharacters.length) {
            text += targetCharacters.slice(targetIndex).join("");
            targetIndex = targetCharacters.length;
        }
        return { ...word, text: text || word.text };
    });

    if (targetIndex !== targetCharacters.length) return line;
    return { ...line, text: plainText, words };
}

function normalizeTimedText(text: string) {
    return text
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\p{P}\p{S}\p{Separator}\p{White_Space}\u200b\ufeff]/gu, "");
}

function countSupplementalCharacters(text: string) {
    return Array.from(text).filter((character) => !normalizeTimedText(character)).length;
}

function getLyricsMatchResult(
    spotifyLines: EnhancedLyricLine[],
    thirdPartyLines: EnhancedLyricLine[],
) {
    if (!hasSyncedLyrics(spotifyLines)) {
        return { match: true, reason: "Spotify 无同步歌词，跳过首句比较" };
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

function getRelaxedLyricsMatchResult(
    spotifyLines: EnhancedLyricLine[],
    thirdPartyLines: EnhancedLyricLine[],
) {
    const spotifyFirst = firstMeaningfulLine(spotifyLines);
    const thirdPartyFirst = firstMeaningfulLine(thirdPartyLines);
    if (!spotifyFirst || !thirdPartyFirst) {
        return { match: false, reason: "宽松匹配失败：缺少双方第一句有效歌词" };
    }
    if (spotifyFirst.time === null || thirdPartyFirst.time === null) {
        return { match: false, reason: "宽松匹配失败：第一句有效歌词缺少时间轴" };
    }
    if (!isContainedLyricText(spotifyFirst.text, thirdPartyFirst.text)) {
        return { match: false, reason: "宽松匹配失败：第一句有效歌词不是包含关系" };
    }

    const timeDiff = Math.abs(spotifyFirst.time - thirdPartyFirst.time);
    if (timeDiff <= FIRST_LINE_TIME_TOLERANCE_MS) {
        return { match: true, reason: `宽松匹配成功：首句互相包含，时间差 ${timeDiff}ms` };
    }

    const spotifyStartsEarly = isWithinRelaxedEarlyTime(spotifyFirst.time);
    const thirdPartyStartsEarly = isWithinRelaxedEarlyTime(thirdPartyFirst.time);
    if (spotifyStartsEarly || thirdPartyStartsEarly) {
        return {
            match: true,
            reason: `宽松匹配成功：首句互相包含，时间差 ${timeDiff}ms，但一方首句在前 1 秒内`,
        };
    }
    return { match: false, reason: `宽松匹配失败：第一句时间差过大（${timeDiff}ms）` };
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
    return !/^(?:作?词|作?曲|编曲|制作人|监制|出品|录音|混音|母带|词版权|曲版权|录音作品|联合出品|人声|吉他|贝斯|鼓|弦乐|和声|OP|SP|纯音乐|instrumental)\s*[:：]?/i.test(
        text.trim(),
    );
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

function isContainedLyricText(a: string, b: string) {
    const first = normalizeLyricText(a);
    const second = normalizeLyricText(b);
    return Boolean(first && second && (first.includes(second) || second.includes(first)));
}

function isWithinRelaxedEarlyTime(time: number) {
    return time >= 0 && time <= RELAXED_FIRST_LINE_EARLY_TIME_MS;
}

function normalizeLyricText(text: string) {
    return normalizeChineseForMatch(text)
        .toLowerCase()
        .replace(/\[[^\]]+\]/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/[\s\u3000'’"“”.,!?，。！？、:：;；~～\-—_/\\]/g, "")
        .trim();
}

function isBaseTitleMatch(candidateTitle: string, trackTitle: string) {
    const candidate = normalizeBaseTitle(candidateTitle);
    const current = normalizeBaseTitle(trackTitle);
    return Boolean(candidate && current && candidate === current);
}

function getDurationMatchResult(song: ProviderSong, track: TrackInfo) {
    const candidateDuration = song.duration ?? 0;
    if (!candidateDuration || !track.duration) {
        return { match: true, reason: "缺少歌曲时长，改用歌手/专辑与歌词校验" };
    }
    const difference = Math.abs(candidateDuration - track.duration);
    return difference <= DURATION_TOLERANCE_MS
        ? { match: true, reason: `时长匹配，差值 ${difference}ms` }
        : { match: false, reason: `歌曲时长不匹配，差值 ${difference}ms` };
}

function getRelaxedDurationMatchResult(song: ProviderSong, track: TrackInfo) {
    const candidateDuration = song.duration ?? 0;
    if (!candidateDuration || !track.duration) {
        return { match: false, reason: "宽松模式要求双方都有歌曲时长" };
    }
    const difference = Math.abs(candidateDuration - track.duration);
    return difference <= DURATION_TOLERANCE_MS
        ? { match: true, reason: `宽松模式时长匹配，差值 ${difference}ms` }
        : { match: false, reason: `宽松模式歌曲时长不匹配，差值 ${difference}ms` };
}

function getArtistOrAlbumMatchResult(song: ProviderSong, track: TrackInfo) {
    const candidateArtists = song.artists;
    if (candidateArtists && track.artists && isLooseTextMatch(candidateArtists, track.artists)) {
        return { match: true, reason: "歌手匹配" };
    }

    const candidateAlbum = song.album;
    if (candidateAlbum && track.album && isLooseTextMatch(candidateAlbum, track.album)) {
        return { match: true, reason: "歌手不匹配，但专辑名称匹配" };
    }

    return {
        match: false,
        reason: `歌手和专辑均不匹配：歌手=${candidateArtists || "无"}，专辑=${candidateAlbum || "无"}`,
    };
}

function getNetEaseSongArtists(song: NetEaseSong) {
    return (song.ar ?? song.artists ?? []).map((artist) => artist.name).join(", ");
}

function getNetEaseSongAlbum(song: NetEaseSong) {
    return `${song.al?.name ?? song.album?.name ?? ""}`.trim();
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
    const first = normalizeLyricText(a);
    const second = normalizeLyricText(b);
    return Boolean(first && second && (first.includes(second) || second.includes(first)));
}

function normalizeBaseTitle(text: string) {
    return normalizeLyricText(getBaseTrackTitle(text.normalize("NFKC")));
}

export function getBaseTrackTitle(title: string) {
    return title
        .replace(/\s*[[(]?\s*(?:feat(?:uring)?|ft)\.?\s+.*$/i, "")
        .replace(/\s+[-–—]\s*.*$/u, "")
        .trim();
}

function fixNetEaseTimeTags(text: string) {
    return text.replace(/(\[\d+:\d+):(\d+\])/g, "$1.$2");
}
