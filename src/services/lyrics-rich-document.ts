import type { EnhancedLyricLine } from "./third-party-lyrics";

export type TimedTextElement = {
    name: string;
    attributes: Record<string, string>;
    text?: string;
    children: TimedTextElement[];
};
/** Source presentation end is absolute seconds. Renderer times are always ms. */
export type RichPresentation = {
    key?: string;
    agent?: string;
    alignment?: "left" | "center" | "right";
    isBackground: boolean;
    parentKey?: string;
    /** Identifies the source TTML division, including repeated sections of the same type. */
    sectionIndex?: number;
    end?: number;
    timingMode?: string;
    element: TimedTextElement;
};

export function hasAuthoredRichWordTiming(line: EnhancedLyricLine): boolean {
    const presentation = line.presentation;
    if (!presentation) return true;
    if (["line", "none"].includes(presentation.timingMode?.toLowerCase())) return false;
    const visit = (node: TimedTextElement, root = false): boolean => {
        const attr = (key: string) =>
            Object.entries(node.attributes).find(([name]) => name.split(":").pop() === key)?.[1];
        if (!root && attr("role") === "x-bg") return false;
        if (["text", "textContainer", "delimiter"].includes(attr("ruby"))) return false;
        return (
            (node.name === "span" && attr("role") !== "x-bg" && attr("begin") !== undefined) ||
            node.children.some((child) => visit(child))
        );
    };
    return visit(presentation.element, true);
}

/** Repair legacy rich caches whose timed spans omit the literal TTML gaps. */
export function preserveRichUntimedText(line: EnhancedLyricLine): EnhancedLyricLine {
    if (line.presentation && !hasAuthoredRichWordTiming(line)) return { ...line, words: undefined };
    const words = line.words;
    if (
        !line.presentation ||
        !words?.length ||
        words.map((word) => word.text).join("") === line.text
    )
        return line;
    let cursor = 0;
    const starts: number[] = [];
    for (const word of words) {
        if (!word.text) return line;
        const start = line.text.indexOf(word.text, cursor);
        if (start < 0) return line;
        starts.push(start);
        cursor = start + word.text.length;
    }
    return {
        ...line,
        words: words.map((word, index) => ({
            ...word,
            text: line.text.slice(
                index === 0 ? 0 : starts[index],
                starts[index + 1] ?? line.text.length,
            ),
        })),
    };
}

export function groupRichLines(lines: EnhancedLyricLine[]) {
    lines = lines.map(preserveRichUntimedText);
    const main = lines
        .filter((line) => !line.presentation?.isBackground)
        .map((line) => ({ ...line, backgrounds: [] as EnhancedLyricLine[] }));
    for (const line of lines.filter((line) => line.presentation?.isBackground)) {
        const parent = main.find((item) => item.presentation?.key === line.presentation?.parentKey);
        if (parent) parent.backgrounds.push(line);
    }
    return main;
}

export function richLineEnd(line: EnhancedLyricLine) {
    return typeof line.presentation?.end === "number"
        ? line.presentation.end * 1000
        : (line.time ?? 0) + (line.duration ?? 0);
}

export function richGroupEnd(line: EnhancedLyricLine) {
    return Math.max(richLineEnd(line), ...(line.backgrounds ?? []).map(richLineEnd));
}

export function activeRichLines(lines: EnhancedLyricLine[], progress: number) {
    const active = lines.flatMap((line, index) =>
        [line, ...(line.backgrounds ?? [])].some(
            (voice) =>
                voice.time !== null && voice.time <= progress && progress < richLineEnd(voice),
        )
            ? [index]
            : [],
    );
    if (active.length) return active;
    // Keep the last completed voice lit through the gap, without extending its
    // syllable timing or retaining older voices when another voice is singing.
    let latestEnd = -Infinity;
    let held: number[] = [];
    lines.forEach((line, index) => {
        const completed = [line, ...(line.backgrounds ?? [])].filter(
            (voice) =>
                voice.time !== null && voice.time <= progress && richLineEnd(voice) <= progress,
        );
        if (!completed.length) return;
        const end = Math.max(...completed.map(richLineEnd));
        if (end < latestEnd) return;
        if (end > latestEnd) held = [];
        latestEnd = end;
        held.push(index);
    });
    return held;
}

export function validRichLines(lines: unknown): lines is EnhancedLyricLine[] {
    if (!Array.isArray(lines) || !lines.length || lines.length > 5000) return false;
    let nodes = 0;
    let lineCount = 0;
    let words = 0;
    let textLength = 0;
    const record = (value: unknown): value is Record<string, unknown> =>
        Boolean(value && typeof value === "object" && !Array.isArray(value));
    const finite = (value: unknown): value is number =>
        typeof value === "number" && Number.isFinite(value);
    const text = (value: unknown): value is string => {
        if (typeof value !== "string" || value.length > 16384) return false;
        textLength += value.length;
        return textLength <= 2_000_000;
    };
    const optionalText = (value: unknown) => value === undefined || text(value);
    const validNode = (node: TimedTextElement, depth: number): boolean => {
        if (
            !record(node) ||
            depth >= 64 ||
            ++nodes > 100000 ||
            !text(node.name) ||
            !Array.isArray(node.children) ||
            !record(node.attributes) ||
            !optionalText(node.text)
        )
            return false;
        return (
            Object.entries(node.attributes).length <= 128 &&
            Object.entries(node.attributes).every(([name, value]) => text(name) && text(value)) &&
            node.children.every((child) => validNode(child, depth + 1))
        );
    };
    const validLine = (line: unknown, depth: number): boolean =>
        depth < 64 &&
        ++lineCount <= 5000 &&
        record(line) &&
        text(line.text) &&
        [line.translation, line.romanization, line.furigana].every(optionalText) &&
        (line.duration === undefined ||
            line.duration === null ||
            (finite(line.duration) && line.duration >= 0)) &&
        finite(line.time) &&
        line.time >= 0 &&
        record(line.presentation) &&
        [
            line.presentation.key,
            line.presentation.parentKey,
            line.presentation.agent,
            line.presentation.timingMode,
        ].every(optionalText) &&
        (line.presentation.alignment === undefined ||
            ["left", "center", "right"].includes(line.presentation.alignment as string)) &&
        typeof line.presentation.isBackground === "boolean" &&
        finite(line.presentation.end) &&
        Number.isFinite(line.presentation.end * 1000) &&
        line.presentation.end * 1000 >= line.time &&
        validNode(line.presentation.element as TimedTextElement, 0) &&
        (line.words === undefined ||
            (Array.isArray(line.words) &&
                line.words.length <= 2000 &&
                (words += line.words.length) <= 50000 &&
                line.words.every(
                    (word) =>
                        record(word) &&
                        finite(word.time) &&
                        word.time >= 0 &&
                        finite(word.duration) &&
                        word.duration >= 0 &&
                        Number.isFinite(word.time + word.duration) &&
                        text(word.text),
                ))) &&
        (line.backgrounds === undefined ||
            (Array.isArray(line.backgrounds) &&
                line.backgrounds.length <= 5000 &&
                line.backgrounds.every((background) => validLine(background, depth + 1))));
    return lines.every((line) => validLine(line, 0));
}

/** Parse ruby from the preserved tree using UTF-16 ranges, not code points. */
export function richRuby(line: EnhancedLyricLine) {
    let text = "";
    const annotations: Array<{ start: number; end: number; reading: string }> = [];
    const attr = (node: TimedTextElement, key: string) =>
        Object.entries(node.attributes).find(([name]) => name.split(":").pop() === key)?.[1];
    const content = (node: TimedTextElement): string =>
        node.text ?? node.children.map(content).join("");
    const visit = (node: TimedTextElement) => {
        if (attr(node, "role") === "x-bg" && !line.presentation?.isBackground) return;
        const ruby = attr(node, "ruby");
        if (["text", "textContainer", "delimiter"].includes(ruby)) return;
        if (node.text !== undefined) {
            if (!/^\s*\n\s*$/.test(node.text)) text += node.text;
            return;
        }
        const start = text.length;
        node.children.forEach(visit);
        if (ruby === "container") {
            const reading = node.children
                .filter((child) => ["text", "textContainer"].includes(attr(child, "ruby")))
                .map(content)
                .join("");
            if (reading && text.length > start)
                annotations.push({ start, end: text.length, reading });
        }
    };
    if (line.presentation?.element) visit(line.presentation.element);
    return text === line.text ? { text, annotations } : { text: line.text, annotations: [] };
}
