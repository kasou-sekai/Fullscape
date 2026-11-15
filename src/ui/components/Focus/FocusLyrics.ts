import { freezeMeasuredLyricRows } from "../../../utils/lyric-wrapping";
import {
    groupVerses,
    splitCandidates,
    type LyricSplit,
    type Verse,
    type FocusLyricsLine,
} from "./lyric-structure";
import "./focus-lyrics.scss";

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

type Page = 0 | 1;
type Sheet = {
    leaf: HTMLElement;
    paper: HTMLElement;
    print: HTMLElement;
    copy: HTMLElement;
    button: HTMLButtonElement;
    stanzas: HTMLElement[];
    lines: HTMLElement[];
};
type Book = { sheets: Sheet[]; pageStart: number | null };
type PrintLayout = { size: number; columns: number };

const LAYOUTS = ["masthead", "inset", "colophon"] as const;
const TYPE_SIZES = [3.45, 3.1, 2.8, 2.65, 2.5];
const COMPACT_SIZES = [2.3, 2.1];
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
        this.view.classList.toggle(
            "is-serif",
            (hashTrack(`${state.trackKey}:font`) >>> 9) % 3 === 0,
        );
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
        this.view.classList.remove("allow-line-wrap");
        const book = this.typeset(state);
        this.sheets = book.sheets;
        this.pageStart = book.pageStart;

        const automatic = this.currentPlaybackPage();
        if (this.sheets.length === 1) this.requested = 0;
        else if (automatic !== null && automatic !== this.playbackPage) this.requested = automatic;
        this.playbackPage = automatic;
        this.arrange(this.requested);
        this.width = this.view.clientWidth;
    }

    private typeset(state: FocusLyricsState): Book {
        const single = { sheets: [this.createSheet(this.verses, 0, state)], pageStart: null };
        this.mount(single);
        if (!this.verses.length || this.fit(single, TYPE_SIZES)) return single;

        const splits = splitCandidates(this.verses);
        const books = [single, ...splits.map((split) => this.createSpread(split, state))];
        for (const book of books.slice(1)) {
            this.mount(book);
            if (this.fit(book, TYPE_SIZES)) return book;
        }
        for (const book of books) {
            this.mount(book);
            if (this.fit(book, COMPACT_SIZES)) return book;
        }

        // Shrink complete verses before wrapping, and wrap before fragmenting
        // a verse. Keep the candidate with the fewest folded lines.
        this.view.classList.add("allow-line-wrap");
        const wrapped = this.findWrappedLayout(books);
        if (wrapped) return wrapped;

        const split = splitCandidates(this.verses, true)[0];
        const dense = split ? this.createSpread(split, state) : single;
        this.mount(dense);
        this.view.classList.remove("allow-line-wrap");
        if (this.fit(dense, [...TYPE_SIZES, ...COMPACT_SIZES])) return dense;
        this.view.classList.add("allow-line-wrap");
        const wrappedDense = this.findWrappedLayout([dense]);
        if (wrappedDense) return wrappedDense;
        this.fitDense(dense);
        this.freezeWrappedLines(dense);
        return dense;
    }

    private mount(book: Book) {
        this.view.dataset.sheets = String(book.sheets.length);
        this.view.replaceChildren(...book.sheets.map(({ leaf }) => leaf));
    }

    private createSpread([first, second]: LyricSplit, state: FocusLyricsState): Book {
        const firstTimed = second
            .filter(({ marker }) => !marker)
            .flatMap(({ lines }) => lines)
            .find(({ startTime }) => startTime !== null);
        return {
            sheets: [this.createSheet(first, 0, state), this.createSheet(second, 1)],
            pageStart: firstTimed?.startTime ?? null,
        };
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

        const stanzas: HTMLElement[] = [];
        const lines: HTMLElement[] = [];
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
                lines.push(line);
            }
            copy.append(block);
            stanzas.push(block);
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
        return { leaf, paper, print, copy, button, stanzas, lines };
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

    private fit(book: Book, sizes: number[]) {
        for (const size of sizes) {
            if (this.fittingColumns(book, size)) return true;
        }
        return false;
    }

    private fittingColumns(book: Book, size: number, allowVerseBreak = false) {
        const maxColumns = book.sheets.length === 1 ? 2 : 3;
        for (let columns = 1; columns <= maxColumns; columns += 1) {
            if (this.setType(book, { size, columns }, allowVerseBreak)) return columns;
        }
        return 0;
    }

    private findWrappedLayout(books: Book[]) {
        const sizes = [...TYPE_SIZES, ...COMPACT_SIZES];
        let best: { book: Book; type: PrintLayout; wraps: number } | undefined;
        const vertical = this.view.classList.contains("is-vertical");
        for (const book of books) {
            this.mount(book);
            const maxColumns = book.sheets.length === 1 ? 2 : 3;
            for (const size of sizes) {
                for (let columns = 1; columns <= maxColumns; columns += 1) {
                    const type = { size, columns };
                    if (!this.setType(book, type)) continue;
                    const wraps = book.sheets.reduce(
                        (total, { lines }) =>
                            total + lines.filter((line) => wrapsLine(line, vertical)).length,
                        0,
                    );
                    if (!best || wraps < best.wraps) best = { book, type, wraps };
                }
            }
        }
        if (!best) return null;
        this.mount(best.book);
        this.setType(best.book, best.type);
        this.freezeWrappedLines(best.book);
        return best.book;
    }

    private fitDense(book: Book) {
        let low = 0;
        let high = COMPACT_SIZES[COMPACT_SIZES.length - 1];
        let bestColumns = 1;
        // Dense pages may still fit an unusually long verse intact. Only
        // release column boundaries when even the compact size needs it.
        const allowVerseBreak = !this.fittingColumns(book, high * 0.8);
        if (allowVerseBreak) book.sheets.forEach(({ paper }) => paper.classList.add("is-dense"));
        for (let step = 0; step < 11; step += 1) {
            const size = (low + high) / 2;
            const columns = this.fittingColumns(book, size, allowVerseBreak);
            if (columns) {
                low = size;
                bestColumns = columns;
            } else {
                high = size;
            }
        }
        this.setType(book, { size: low, columns: bestColumns }, allowVerseBreak);
    }

    private setType(book: Book, { size, columns }: PrintLayout, allowVerseBreak = false) {
        const wrap = this.view.classList.contains("allow-line-wrap");
        const vertical = this.view.classList.contains("is-vertical");
        for (const { paper } of book.sheets) {
            paper.style.setProperty("--focus-lyric-size", `${size}cqw`);
            paper.style.setProperty("--focus-lyric-columns", String(columns));
        }
        return book.sheets.every(
            ({ print, copy, lines, stanzas }) =>
                print.scrollHeight <= print.clientHeight + 1 &&
                print.scrollWidth <= print.clientWidth + 1 &&
                copy.scrollWidth <= copy.clientWidth + 1 &&
                copy.scrollHeight <= copy.clientHeight + 1 &&
                (allowVerseBreak ||
                    columns === 1 ||
                    stanzas.every((verse) => verse.getClientRects().length <= 1)) &&
                (wrap ||
                    lines.every((line) =>
                        vertical
                            ? line.scrollHeight <= line.clientHeight + 1
                            : line.scrollWidth <= line.clientWidth + 1,
                    )),
        );
    }

    private freezeWrappedLines(book: Book) {
        const vertical = this.view.classList.contains("is-vertical");
        for (const { lines } of book.sheets) {
            for (const line of lines) {
                if (wrapsLine(line, vertical)) freezeMeasuredLyricRows(line, line, true);
            }
        }
    }
}

function wrapsLine(line: HTMLElement, vertical: boolean) {
    const thickness = vertical ? line.offsetWidth : line.offsetHeight;
    return thickness > Number.parseFloat(getComputedStyle(line).lineHeight) * 1.5;
}

function hashTrack(track: string) {
    let hash = 2166136261;
    for (const character of track) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hash >>> 0;
}
