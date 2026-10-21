export { lyricsPreferenceScore } from "./lyrics-preference";
import { normalizeChineseForMatch } from "../utils/chinese-conversion";
import type { EnhancedLyricLine, TrackInfo } from "./third-party-lyrics";
type ProviderSong = { name: string; artists: string; album: string; duration?: number };
const DURATION_TOLERANCE_MS = 12000;
const FIRST_LINE_TIME_TOLERANCE_MS = 2500;
const RELAXED_FIRST_LINE_EARLY_TIME_MS = 1000;

/** Same pure decision in Chromium and Shiori's bundled JavaScriptCore runtime. */
export function matchLyrics(
    song: ProviderSong,
    track: TrackInfo,
    reference: EnhancedLyricLine[],
    lines: EnhancedLyricLine[],
    relaxed: boolean,
) {
    if (!lines.length || !getDurationMatchResult(song, track).match) return false;
    const strict =
        isBaseTitleMatch(song.name, track.title) && getArtistOrAlbumMatchResult(song, track).match;
    if (strict && getLyricsMatchResult(reference, lines).match) return true;
    return (
        relaxed &&
        getRelaxedDurationMatchResult(song, track).match &&
        getRelaxedLyricsMatchResult(reference, lines).match
    );
}
export function getLyricsMatchResult(
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

export function getRelaxedLyricsMatchResult(
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

export function hasSyncedLyrics(lines: EnhancedLyricLine[]) {
    return lines.some((line) => line.time !== null && (line.time ?? 0) > 0);
}

export function firstSpotifyLine(lines: EnhancedLyricLine[]) {
    return lines.find((line) => normalizeLyricText(line.text).length >= 2 && line.time !== null);
}

export function previewSpotifyLines(lines: EnhancedLyricLine[]) {
    return lines
        .filter((line) => normalizeLyricText(line.text).length >= 2 && line.time !== null)
        .slice(0, 5);
}

export function firstMeaningfulLine(lines: EnhancedLyricLine[]) {
    return lines.find((line) => isMeaningfulLyric(line.text) && line.time !== null);
}

export function previewMeaningfulLines(lines: EnhancedLyricLine[]) {
    return lines.filter((line) => isMeaningfulLyric(line.text) && line.time !== null).slice(0, 5);
}

export function isMeaningfulLyric(text: string) {
    const normalized = normalizeLyricText(text);
    if (normalized.length < 2) return false;
    return !/^(?:作?词|作?曲|编曲|制作人|监制|出品|录音|混音|母带|词版权|曲版权|录音作品|联合出品|人声|吉他|贝斯|鼓|弦乐|和声|OP|SP|纯音乐|instrumental)\s*[:：]?/i.test(
        text.trim(),
    );
}

export function isCompatibleText(a: string, b: string) {
    const first = normalizeLyricText(a);
    const second = normalizeLyricText(b);
    if (!first || !second) return false;
    if (first === second) return true;
    const minLength = Math.min(first.length, second.length);
    if (minLength < 3) return false;
    if (minLength < Math.min(8, Math.max(first.length, second.length)) * 0.45) return false;
    return first.includes(second) || second.includes(first);
}

export function isContainedLyricText(a: string, b: string) {
    const first = normalizeLyricText(a);
    const second = normalizeLyricText(b);
    return Boolean(first && second && (first.includes(second) || second.includes(first)));
}

export function isWithinRelaxedEarlyTime(time: number) {
    return time >= 0 && time <= RELAXED_FIRST_LINE_EARLY_TIME_MS;
}

export function normalizeLyricText(text: string) {
    return normalizeChineseForMatch(text)
        .toLowerCase()
        .replace(/\[[^\]]+\]/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/[\s\u3000'’"“”.,!?，。！？、:：;；~～\-—_/\\]/g, "")
        .trim();
}

export function isBaseTitleMatch(candidateTitle: string, trackTitle: string) {
    const candidate = normalizeBaseTitle(candidateTitle);
    const current = normalizeBaseTitle(trackTitle);
    return Boolean(candidate && current && candidate === current);
}

export function getDurationMatchResult(song: ProviderSong, track: TrackInfo) {
    const candidateDuration = song.duration ?? 0;
    if (!candidateDuration || !track.duration) {
        return { match: true, reason: "缺少歌曲时长，改用歌手/专辑与歌词校验" };
    }
    const difference = Math.abs(candidateDuration - track.duration);
    return difference <= DURATION_TOLERANCE_MS
        ? { match: true, reason: `时长匹配，差值 ${difference}ms` }
        : { match: false, reason: `歌曲时长不匹配，差值 ${difference}ms` };
}

export function getRelaxedDurationMatchResult(song: ProviderSong, track: TrackInfo) {
    const candidateDuration = song.duration ?? 0;
    if (!candidateDuration || !track.duration) {
        return { match: false, reason: "宽松模式要求双方都有歌曲时长" };
    }
    const difference = Math.abs(candidateDuration - track.duration);
    return difference <= DURATION_TOLERANCE_MS
        ? { match: true, reason: `宽松模式时长匹配，差值 ${difference}ms` }
        : { match: false, reason: `宽松模式歌曲时长不匹配，差值 ${difference}ms` };
}

export function getArtistOrAlbumMatchResult(song: ProviderSong, track: TrackInfo) {
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

export function isLooseTextMatch(a: string, b: string) {
    const first = normalizeLyricText(a);
    const second = normalizeLyricText(b);
    return Boolean(first && second && (first.includes(second) || second.includes(first)));
}

export function normalizeBaseTitle(text: string) {
    return normalizeLyricText(getBaseTrackTitle(text.normalize("NFKC")));
}

export function getBaseTrackTitle(title: string) {
    return title
        .replace(/\s*[[(]?\s*(?:feat(?:uring)?|ft)\.?\s+.*$/i, "")
        .replace(/\s+[-–—]\s*.*$/u, "")
        .trim();
}
