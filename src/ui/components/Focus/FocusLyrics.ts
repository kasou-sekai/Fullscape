import "./focus-lyrics.scss";

export type FocusLyricsLine = {
    startTime: number | null;
    endTime?: number | null;
    text: string;
};

export type FocusLyricsState = {
    trackKey: string;
    title: string;
    artist: string;
    duration: number;
    progress: number;
    lines: readonly FocusLyricsLine[];
    status: "loading" | "empty" | "ready";
    loadingLabel: string;
    emptyLabel: string;
    showSheetLabel: string;
};

type Verse = { lines: FocusLyricsLine[]; space: "none" | "verse" | "interlude"; marker?: boolean };
type Page = 0 | 1;
type Sheet = {
    leaf: HTMLElement;
    paper: HTMLElement;
    print: HTMLElement;
    copy: HTMLElement;
    button: HTMLButtonElement;
};

const MUSIC_MARKER =
    /^(?:[♪♫♬𝄞]+|[[(（【{]?\s*(?:instrumental|music(?:al break)?|intro|outro|interlude|solo|break|bridge)\s*[\])）】}]?\s*[♪♫♬𝄞]*)$/iu;

const LAYOUTS = ["masthead", "inset", "colophon"] as const;
const TYPE_SIZES = [3.45, 3.1, 2.8, 2.65, 2.5];
const FRONT_POSE = "translate(0, 0) rotate(0deg)";
const BACK_POSE = "translate(-5.4%, 3.6%) rotate(-3deg)";
const LIFTED_POSE = "translate(-113%, -8%) rotate(-8deg)";
const LIFTED_SHADOW = "drop-shadow(2px 16px 12px rgb(53 44 33 / 13%))";

export class FocusLyrics {
    private readonly view = document.createElement("section");
    private readonly observer: ResizeObserver;
    private state: FocusLyricsState | null = null;
    private verses: Verse[] = [];
    private sheets: Sheet[] = [];
    private pageStart: number | null = null;
    private playbackPage: Page | null = null;
    private front: Page = 0;
    private requested: Page = 0;
    private animations: Animation[] = [];
    private width = 0;

    constructor(private readonly root: HTMLElement) {
        this.view.className = "focus-lyrics";
        this.view.setAttribute("aria-label", "Song lyrics");
        root.append(this.view);
        this.observer = new ResizeObserver(() => {
            if (this.state && Math.abs(this.view.clientWidth - this.width) > 1) {
                this.render(this.state);
            }
        });
        this.observer.observe(this.view);
        void document.fonts.ready.then(() => {
            if (this.state) this.render(this.state);
        });
    }

    update(state: FocusLyricsState) {
        const previous = this.state;
        this.state = state;
        if (
            previous &&
            previous.trackKey === state.trackKey &&
            previous.title === state.title &&
            previous.artist === state.artist &&
            previous.duration === state.duration &&
            previous.lines === state.lines &&
            previous.status === state.status &&
            previous.loadingLabel === state.loadingLabel &&
            previous.emptyLabel === state.emptyLabel &&
            previous.showSheetLabel === state.showSheetLabel
        ) {
            this.followPlayback();
            return;
        }

        if (previous?.trackKey !== state.trackKey) {
            this.front = 0;
            this.requested = 0;
            this.playbackPage = null;
        }
        this.verses = state.status === "ready" ? groupVerses(state.lines, state.duration) : [];
        const seed = hashTrack(state.trackKey);
        this.view.dataset.layout = LAYOUTS[seed % LAYOUTS.length];
        this.view.classList.toggle("is-serif", Boolean(seed & 8));
        const direction = (seed >>> 12) & 3;
        this.view.classList.toggle(
            "is-vertical",
            (/^ja\b/i.test(this.root.lang) && direction !== 0) ||
                (/^zh\b/i.test(this.root.lang) && direction === 1),
        );
        this.render(state);
    }

    destroy() {
        this.observer.disconnect();
        this.cancelAnimations();
        this.sheets = [];
        this.state = null;
        this.view.remove();
    }

    private render(state: FocusLyricsState) {
        this.cancelAnimations();
        this.pageStart = null;
        const single = this.createSheet(this.verses, 0, state);
        this.sheets = [single];
        this.view.dataset.sheets = "1";
        this.view.replaceChildren(single.leaf);

        if (this.verses.length && !this.fit([single], 2)) {
            const spread = splitVerses(this.verses);
            if (spread) {
                const sheets = [
                    this.createSheet(spread[0], 0, state),
                    this.createSheet(spread[1], 1),
                ];
                this.sheets = sheets;
                this.view.dataset.sheets = "2";
                this.view.replaceChildren(...sheets.map(({ leaf }) => leaf));
                if (!this.fit(sheets, 3)) this.fitDense(sheets);
                this.pageStart =
                    spread[1]
                        .filter((verse) => !verse.marker)
                        .flatMap((verse) => verse.lines)
                        .find((line) => line.startTime !== null)?.startTime ?? null;
            } else {
                this.fitDense([single]);
            }
        }

        const automatic = this.currentPlaybackPage();
        if (this.sheets.length === 1) this.requested = 0;
        else if (automatic !== null && automatic !== this.playbackPage) this.requested = automatic;
        this.playbackPage = automatic;
        this.arrange(this.requested);
        this.width = this.view.clientWidth;
    }

    private createSheet(verses: Verse[], index: Page, state?: FocusLyricsState): Sheet {
        const leaf = document.createElement("div");
        leaf.className = "focus-lyrics-leaf";
        const paper = document.createElement("div");
        paper.className = "focus-lyrics-paper";
        const print = document.createElement("div");
        print.className = "focus-lyrics-print";
        const copy = document.createElement("div");
        copy.className = "focus-lyrics-copy";
        copy.dataset.short = String(
            verses.reduce((count, verse) => count + verse.lines.length, 0) <= 9,
        );

        if (state?.title || state?.artist) {
            const header = document.createElement("header");
            header.className = "focus-lyrics-header";
            if (state.title) {
                const title = document.createElement("h1");
                title.className = "focus-lyrics-title";
                title.dir = "auto";
                title.textContent = state.title;
                header.append(title);
            }
            if (state.artist) {
                const artist = document.createElement("p");
                artist.className = "focus-lyrics-artist";
                artist.dir = "auto";
                artist.textContent = state.artist;
                header.append(artist);
            }
            print.append(header);
        }

        for (const verse of verses) {
            const block = document.createElement("p");
            block.className = "focus-lyrics-verse";
            block.dataset.space = verse.space;
            if (verse.marker) block.classList.add("focus-lyrics-marker");
            for (const { text } of verse.lines) {
                const line = document.createElement("span");
                line.className = "focus-lyrics-line";
                line.dir = "auto";
                line.textContent = text;
                block.append(line);
            }
            copy.append(block);
        }

        if (!verses.length && state) {
            const status = document.createElement("p");
            status.className = "focus-lyrics-status";
            status.setAttribute("role", "status");
            status.textContent = state.status === "loading" ? state.loadingLabel : state.emptyLabel;
            copy.append(status);
        }

        print.append(copy);
        paper.append(print);
        const button = document.createElement("button");
        button.className = "focus-lyrics-sheet-button";
        button.type = "button";
        button.hidden = true;
        button.setAttribute(
            "aria-label",
            this.state?.showSheetLabel.replace("{page}", String(index + 1)) ?? "",
        );
        button.onclick = () => this.requestPage(index);
        leaf.append(paper, button);
        return { leaf, paper, print, copy, button };
    }

    private currentPlaybackPage(): Page | null {
        return this.pageStart === null || !this.state
            ? null
            : this.state.progress >= this.pageStart
              ? 1
              : 0;
    }

    private followPlayback() {
        const page = this.currentPlaybackPage();
        if (page === this.playbackPage) return;
        this.playbackPage = page;
        if (page !== null) this.requestPage(page);
    }

    private requestPage(page: Page) {
        this.requested = page;
        if (page === this.front || this.animations.length) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            this.arrange(page);
        } else {
            void this.slideSheet(page);
        }
    }

    private arrange(page: Page) {
        const keepKeyboardFocus = this.sheets.some(({ button }) =>
            button.matches(":focus-visible"),
        );
        this.front = page;
        this.sheets.forEach(({ leaf, paper, button }, index) => {
            const isFront = page === index;
            leaf.style.transform = isFront ? FRONT_POSE : BACK_POSE;
            leaf.dataset.position = isFront ? "front" : "back";
            paper.inert = !isFront;
            button.hidden = isFront;
        });
        if (keepKeyboardFocus)
            this.sheets[page === 0 ? 1 : 0]?.button.focus({ preventScroll: true });
    }

    private async slideSheet(page: Page) {
        const sheets = this.sheets;
        const previous = sheets[this.front].leaf;
        const incoming = sheets[page].leaf;
        const withdraw = incoming.animate(
            [
                { transform: BACK_POSE, filter: "none" },
                { transform: LIFTED_POSE, filter: LIFTED_SHADOW },
            ],
            { duration: 330, easing: "cubic-bezier(.28,.62,.36,1)", fill: "both" },
        );
        this.animations = [withdraw];
        this.view.dataset.turning = "true";
        if (
            !(await withdraw.finished.then(
                () => true,
                () => false,
            )) ||
            this.sheets !== sheets
        )
            return;

        // The sheets are clear of each other before the incoming sheet is raised.
        incoming.style.zIndex = "3";
        const lower = incoming.animate(
            [
                { transform: LIFTED_POSE, filter: LIFTED_SHADOW },
                {
                    transform: "translate(1.5%, -2.2%) rotate(1.2deg)",
                    filter: "drop-shadow(1px 5px 5px rgb(53 44 33 / 8%))",
                    offset: 0.81,
                },
                { transform: FRONT_POSE, filter: "none" },
            ],
            { duration: 420, easing: "cubic-bezier(.28,.65,.23,1)", fill: "both" },
        );
        const recess = previous.animate([{ transform: FRONT_POSE }, { transform: BACK_POSE }], {
            delay: 255,
            duration: 165,
            easing: "ease-out",
            fill: "both",
        });
        this.animations.push(lower, recess);
        if (
            !(await lower.finished.then(
                () => true,
                () => false,
            )) ||
            this.sheets !== sheets
        )
            return;
        this.arrange(page);
        incoming.style.removeProperty("z-index");
        this.cancelAnimations();
        this.requestPage(this.requested);
    }

    private cancelAnimations() {
        for (const animation of this.animations) animation.cancel();
        this.animations = [];
        delete this.view.dataset.turning;
    }

    private fit(sheets: Sheet[], maxColumns: number) {
        for (const size of TYPE_SIZES) {
            if (this.fittingColumns(sheets, size, maxColumns)) return true;
        }
        return false;
    }

    private fittingColumns(sheets: Sheet[], size: number, maxColumns: number) {
        for (let columns = 1; columns <= maxColumns; columns += 1) {
            if (this.setType(sheets, size, columns)) return columns;
        }
        return 0;
    }

    private fitDense(sheets: Sheet[]) {
        for (const { paper } of sheets) paper.classList.add("is-dense");
        let low = 0;
        let high = TYPE_SIZES[TYPE_SIZES.length - 1];
        let bestColumns = 3;
        for (let step = 0; step < 11; step += 1) {
            const size = (low + high) / 2;
            const columns = this.fittingColumns(sheets, size, 3);
            if (columns) {
                low = size;
                bestColumns = columns;
            } else {
                high = size;
            }
        }
        this.setType(sheets, low, bestColumns);
    }

    private setType(sheets: Sheet[], size: number, columns: number) {
        for (const { paper } of sheets) {
            paper.style.setProperty("--focus-lyric-size", `${size}cqw`);
            paper.style.setProperty("--focus-lyric-columns", String(columns));
        }
        return sheets.every(
            ({ print, copy }) =>
                print.scrollHeight <= print.clientHeight + 1 &&
                print.scrollWidth <= print.clientWidth + 1 &&
                copy.scrollWidth <= copy.clientWidth + 1,
        );
    }
}

function groupVerses(lines: readonly FocusLyricsLine[], duration: number) {
    const verses: Verse[] = [];
    const lyricCount = lines.filter(
        (line) => line.text.trim() && !MUSIC_MARKER.test(line.text.trim()),
    ).length;
    const longGap = Math.max(5800, (duration / Math.max(lyricCount, 1)) * 1.9);
    let previous: FocusLyricsLine | undefined;
    let space: Verse["space"] = "none";
    let current: Verse | undefined;
    for (const line of lines) {
        const text = line.text.trim();
        if (!text) {
            space = "verse";
            current = undefined;
            continue;
        }
        const start = line.startTime;
        const lastStart = previous?.startTime ?? 0;
        const lastEnd = previous?.endTime ?? lastStart + (previous ? 1800 : 0);
        if (start !== null && start - lastEnd >= longGap) {
            space = "interlude";
            current = undefined;
        }
        if (line.startTime !== null) previous = line;

        if (MUSIC_MARKER.test(text)) {
            verses.push({ lines: [{ ...line, text }], space: "interlude", marker: true });
            space = "verse";
            current = undefined;
            continue;
        }
        if (!current || current.lines.length >= 9) {
            current = { lines: [], space };
            verses.push(current);
            space = "none";
        }
        current.lines.push({ ...line, text });
    }
    return verses;
}

function splitVerses(verses: Verse[]): [Verse[], Verse[]] | null {
    // Favor authored breaks, with a split inside the verse when a stanza would dominate a sheet.
    const weights = verses.map(({ lines }) =>
        lines.map(({ text }) => Math.max(1, Array.from(text).length / 26)),
    );
    const total = weights.flat().reduce((sum, weight) => sum + weight, 0);
    let consumed = 0;
    let score = Infinity;
    let split: { verse: number; line: number } | undefined;
    for (let verse = 0; verse < verses.length; verse += 1) {
        for (let line = 0; line < weights[verse].length; line += 1) {
            if (consumed > 0) {
                const penalty = line === 0 && verses[verse].space !== "none" ? 0 : total * 0.045;
                const candidate = Math.abs(consumed - total * 0.46) + penalty;
                if (candidate < score) {
                    score = candidate;
                    split = { verse, line };
                }
            }
            consumed += weights[verse][line];
        }
    }
    if (!split) return null;
    const first = verses.slice(0, split.verse);
    const second = verses.slice(split.verse);
    if (split.line) {
        const verse = verses[split.verse];
        first.push({ ...verse, lines: verse.lines.slice(0, split.line) });
        second[0] = { ...verse, space: "none", lines: verse.lines.slice(split.line) };
    }
    return [first, second];
}

function hashTrack(track: string) {
    let hash = 2166136261;
    for (const character of track) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hash >>> 0;
}
