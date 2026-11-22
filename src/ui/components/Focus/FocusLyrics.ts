import { freezeMeasuredLyricRows } from "../../../utils/lyric-wrapping";
import { lyricEdition, type LyricLayout } from "./lyric-edition";
import { isStanzaLayout, stanzaRows, type StanzaLayout } from "./stanza-layout";
import {
    columnEnds,
    groupVerses,
    splitCandidates,
    surroundEnds,
    type LyricSplit,
    type Verse,
    type FocusLyricsLine,
} from "./lyric-structure";
import "./focus-lyrics.scss";

export type FocusLyricsState = {
    trackKey: string;
    title: string;
    artist: string;
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
    columns: HTMLElement[];
    ends: number[];
};
type Book = { sheets: Sheet[]; pageStart: number | null };
type PrintLayout = { size: number; columns: number };

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
    private resizeFrame: number | undefined;
    private edition = lyricEdition();
    private preferredLayout: LyricLayout | undefined;
    private renderedLayout: LyricLayout = "folio";

    constructor(private readonly root: HTMLElement) {
        this.view.className = "focus-lyrics";
        this.view.setAttribute("aria-label", "Song lyrics");
        root.append(this.view);
        this.observer = new ResizeObserver(() => {
            if (this.resizeFrame !== undefined || Math.abs(this.view.clientWidth - this.width) <= 1)
                return;
            this.resizeFrame = requestAnimationFrame(() => {
                this.resizeFrame = undefined;
                if (this.state && Math.abs(this.view.clientWidth - this.width) > 1)
                    this.render(this.state);
            });
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
            if (previous) this.edition = lyricEdition(this.renderedLayout, this.edition.paper);
            this.preferredLayout = undefined;
        }
        this.verses = state.status === "ready" ? groupVerses(state.lines) : [];
        this.render(state);
    }

    destroy() {
        this.observer.disconnect();
        if (this.resizeFrame !== undefined) cancelAnimationFrame(this.resizeFrame);
        this.cancelAnimations();
        this.sheets = [];
        this.state = null;
        this.view.remove();
    }

    private render(state: FocusLyricsState) {
        this.cancelAnimations();
        this.view.classList.remove("allow-line-wrap", "is-extended");
        const { paper, serif, direction, centered } = this.edition;
        const vertical =
            (/^ja\b/i.test(this.root.lang) && direction < 0.64) ||
            (/^zh\b/i.test(this.root.lang) && direction < 0.28);
        this.view.dataset.paper = paper;
        this.view.classList.toggle("is-serif", serif);
        this.view.classList.toggle("is-vertical", vertical);
        this.view.style.setProperty(
            "--focus-edition-align",
            centered ? (vertical ? "end" : "center") : "start",
        );
        const book = this.typeset(state);
        if (this.verses.length) this.preferredLayout ??= this.renderedLayout;
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
        const layouts = this.availableLayouts(state);
        const fallback = layouts.find((layout) => !spaceIntensive(layout)) ?? "folio";
        if (!this.verses.length) {
            this.changeLayout(fallback);
            this.mount(single);
            return single;
        }

        let spreads: Book[] | undefined;
        const getSpreads = () =>
            (spreads ??= splitCandidates(this.verses).map((split) =>
                this.createSpread(split, state),
            ));
        // Allow a few expressive layouts to compete before fitting a full,
        // compact reading layout. Keep the preferred design across resizes.
        for (const layout of layouts.slice(0, 3)) {
            this.changeLayout(layout);
            if (layout === "surround") {
                const ends = surroundEnds(this.verses);
                const surrounded = ends && this.fitSurround(state, ends);
                if (surrounded) return surrounded;
                continue;
            }
            const columns = layout === "broadsheet" || layout === "staggered" ? 2 : 1;
            const tryBook = (book: Book) => {
                this.mount(book);
                return isStanzaLayout(layout)
                    ? this.fitStanzaRows(book, layout)
                    : this.fit(book, TYPE_SIZES, columns);
            };
            if (tryBook(single)) return single;
            for (const book of getSpreads()) {
                if (tryBook(book)) return book;
            }
            if (layout === fallback) break;
        }

        const books = [single, ...getSpreads()];
        const needsStandardFit = this.renderedLayout !== fallback;
        this.changeLayout(fallback);
        this.mount(single);
        if (needsStandardFit) {
            for (const book of books) {
                this.mount(book);
                if (this.fit(book, TYPE_SIZES)) return book;
            }
        }
        for (const book of books) {
            this.mount(book);
            if (this.fit(book, COMPACT_SIZES)) return book;
        }

        // Shrink complete verses before wrapping. Even the densest
        // arrangement moves only whole verses between columns or sheets.
        this.view.classList.add("allow-line-wrap");
        const adaptive = layouts.find(isStanzaLayout);
        if (adaptive) {
            this.changeLayout(adaptive);
            for (const book of books) {
                this.mount(book);
                if (this.fitStanzaRows(book, adaptive)) {
                    this.freezeWrappedLines(book);
                    return book;
                }
            }
            this.changeLayout(fallback);
        }
        return this.findWrappedLayout(books) ?? this.extendPaper(books);
    }

    private changeLayout(layout: LyricLayout) {
        this.renderedLayout = layout;
        this.view.dataset.layout = layout;
    }

    private availableLayouts(state: FocusLyricsState) {
        const vertical = this.view.classList.contains("is-vertical");
        const width = this.view.clientWidth;
        const stanzas = this.verses.filter(({ marker }) => !marker);
        const layouts = this.edition.layouts.filter((layout) => {
            switch (layout) {
                case "sidebar":
                    return Boolean(
                        state.title && !vertical && width >= 400 && state.lines.length <= 44,
                    );
                case "surround":
                    return Boolean(state.title && width >= 420 && stanzas.length >= 4);
                case "staggered":
                case "broadsheet":
                    return !vertical && width >= 360 && stanzas.length >= 3;
                case "stanza-bands":
                case "stanza-columns":
                case "stanza-insets":
                    return width >= 340 && stanzas.length >= 3;
                case "banner":
                    return Boolean(state.title && !vertical);
                case "tategaki":
                    return Boolean(state.title && vertical);
                default:
                    return true;
            }
        });
        const favorite = this.preferredLayout;
        if (favorite && layouts.includes(favorite))
            return [favorite, ...layouts.filter((layout) => layout !== favorite)];

        // Irregular material benefits from measuring the stanzas before trying
        // a uniform page. Keep the shuffled order among the adaptive layouts.
        if (hasVariedStanzas(stanzas)) {
            const adaptive = layouts.filter(isStanzaLayout).slice(0, 2);
            return [
                ...adaptive,
                ...layouts.filter((layout) => !adaptive.some((row) => row === layout)),
            ];
        }
        return layouts;
    }

    private fitStanzaRows(book: Book, layout: StanzaLayout) {
        const vertical = this.view.classList.contains("is-vertical");
        for (const size of TYPE_SIZES) {
            let adapted = false;
            for (const sheet of book.sheets) {
                sheet.paper.style.setProperty("--focus-lyric-size", `${size}cqw`);
                sheet.copy.dataset.flow = "stanzas";
                delete sheet.copy.dataset.columns;
                sheet.columns = [];
                sheet.ends = [];

                const inlineSize = vertical ? sheet.copy.clientHeight : sheet.copy.clientWidth;
                const gutter = Number.parseFloat(getComputedStyle(sheet.copy).columnGap) || 0;
                sheet.copy.classList.add("is-measuring-stanzas");
                sheet.copy.replaceChildren(...sheet.stanzas);
                const measures = sheet.stanzas.map((stanza) => ({
                    inlineSize: vertical ? stanza.offsetHeight : stanza.offsetWidth,
                    blockSize: vertical ? stanza.offsetWidth : stanza.offsetHeight,
                    ownRow:
                        stanza.dataset.space === "interlude" ||
                        stanza.classList.contains("focus-lyrics-marker"),
                }));
                sheet.copy.classList.remove("is-measuring-stanzas");

                let start = 0;
                const rows = stanzaRows(measures, inlineSize, gutter, layout).map(
                    ({ fractions, align }) => {
                        const row = document.createElement("div");
                        row.className = "focus-lyrics-stanza-row";
                        if (align) {
                            row.style.inlineSize = `${fractions[0] * 100}%`;
                            row.style.alignSelf = align;
                        }
                        row.style.gridTemplateColumns = fractions
                            .map(
                                (fraction) =>
                                    `minmax(0, ${fractions.length === 1 ? 1 : fraction}fr)`,
                            )
                            .join(" ");
                        row.append(...sheet.stanzas.slice(start, start + fractions.length));
                        start += fractions.length;
                        adapted ||= Boolean(align) || fractions.length > 1;
                        return row;
                    },
                );
                sheet.copy.replaceChildren(...rows);
            }
            if (adapted && this.fits(book)) return true;
        }
        return false;
    }

    private fitSurround(state: FocusLyricsState, ends: number[]): Book | null {
        const sheet = this.createSheet(this.verses, 0, state);
        const book = { sheets: [sheet], pageStart: null };
        this.mount(book);
        this.createColumns(sheet, ends.length);
        this.placeStanzas(sheet, ends);
        const header = sheet.print.querySelector<HTMLElement>(".focus-lyrics-header");
        if (!header) return null;
        for (const size of TYPE_SIZES) {
            sheet.paper.style.setProperty("--focus-lyric-size", `${size}cqw`);
            if (!fitsBox(header) || header.offsetHeight > sheet.columns[1].clientHeight) continue;
            if (sheet.columns.every(fitsBox) && sheet.lines.every(fitsBox)) return book;
        }
        return null;
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
            if (verse.trailingInterlude) block.classList.add("focus-lyrics-trailing-interlude");
            if (verse.marker) block.classList.add("focus-lyrics-marker");
            for (const [index, { text, interludeBefore }] of verse.lines.entries()) {
                const line = document.createElement("span");
                line.className = "focus-lyrics-line";
                if (verse.heading && index === 0) line.classList.add("focus-lyrics-marker");
                if (index && interludeBefore) line.classList.add("is-after-interlude");
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
        return { leaf, paper, print, copy, button, stanzas, lines, columns: [], ends: [] };
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

    private fit(book: Book, sizes: number[], minimumColumns = 1) {
        const maxColumns = book.sheets.length === 1 || this.renderedLayout === "staggered" ? 2 : 3;
        if (book.sheets.some(({ stanzas }) => stanzas.length < minimumColumns)) return false;
        for (const size of sizes) {
            for (let columns = minimumColumns; columns <= maxColumns; columns += 1) {
                if (this.setType(book, { size, columns })) return true;
            }
        }
        return false;
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

    private extendPaper(books: Book[]) {
        this.view.classList.add("is-extended");
        this.view.classList.remove("is-vertical");
        this.changeLayout("folio");
        let best = { book: books[0], type: { size: 3.1, columns: 1 }, height: Infinity };
        for (const book of books) {
            this.mount(book);
            const maxColumns = this.view.clientWidth >= 440 ? 2 : 1;
            for (let columns = 1; columns <= maxColumns; columns += 1) {
                const type = { size: 3.1, columns };
                if (!this.setType(book, type)) continue;
                const height = Math.max(...book.sheets.map(({ paper }) => paper.offsetHeight));
                if (height < best.height) best = { book, type, height };
            }
        }
        this.mount(best.book);
        this.setType(best.book, best.type);
        this.freezeWrappedLines(best.book);
        const height = Math.max(
            ...best.book.sheets.map(({ paper }) => Math.max(paper.offsetHeight, paper.offsetWidth)),
        );
        for (const { paper } of best.book.sheets) paper.style.minHeight = `${height}px`;
        return best.book;
    }

    private createColumns(sheet: Sheet, count: number) {
        delete sheet.copy.dataset.flow;
        if (sheet.columns.length === count) return;
        sheet.copy.dataset.columns = String(count);
        sheet.copy.style.setProperty("--focus-lyric-columns", String(count));
        sheet.columns = Array.from({ length: count }, () => {
            const column = document.createElement("div");
            column.className = "focus-lyrics-column";
            return column;
        });
        sheet.columns[0].append(...sheet.stanzas);
        sheet.copy.replaceChildren(...sheet.columns);
        sheet.ends = [sheet.stanzas.length];
    }

    private placeStanzas(sheet: Sheet, ends: number[]) {
        if (
            ends.length === sheet.ends.length &&
            ends.every((end, index) => end === sheet.ends[index])
        )
            return;
        sheet.columns.forEach((column, index) => {
            column.replaceChildren(...sheet.stanzas.slice(ends[index - 1] ?? 0, ends[index]));
        });
        sheet.ends = ends;
    }

    private setType(book: Book, { size, columns }: PrintLayout) {
        const vertical = this.view.classList.contains("is-vertical");
        for (const sheet of book.sheets) {
            sheet.paper.style.setProperty("--focus-lyric-size", `${size}cqw`);
            const count = Math.min(columns, sheet.stanzas.length);
            this.createColumns(sheet, count);
            if (count > 1) {
                const weights = sheet.stanzas.map((verse) => {
                    const bounds = verse.getBoundingClientRect();
                    return vertical ? bounds.width : bounds.height;
                });
                this.placeStanzas(sheet, columnEnds(weights, count));
            }
        }
        return this.fits(book);
    }

    private fits(book: Book) {
        const wrap = this.view.classList.contains("allow-line-wrap");
        return book.sheets.every(
            ({ print, copy, lines, columns: boxes }) =>
                fitsBox(print) &&
                fitsBox(copy) &&
                boxes.every(fitsBox) &&
                (wrap || lines.every(fitsBox)),
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

function fitsBox(box: HTMLElement) {
    return box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1;
}

function wrapsLine(line: HTMLElement, vertical: boolean) {
    const style = getComputedStyle(line);
    const thickness = vertical ? line.offsetWidth : line.offsetHeight;
    const spacing =
        Number.parseFloat(style.paddingBlockStart) + Number.parseFloat(style.paddingBlockEnd);
    return thickness - spacing > Number.parseFloat(style.lineHeight) * 1.5;
}

function spaceIntensive(layout: LyricLayout) {
    return (
        isStanzaLayout(layout) ||
        ["surround", "sidebar", "staggered", "broadsheet", "banner"].includes(layout)
    );
}

function hasVariedStanzas(stanzas: Verse[]) {
    if (stanzas.length < 3) return false;
    const lengths = stanzas.map(({ lines }) => lines.length);
    if (Math.max(...lengths) >= Math.min(...lengths) * 2 + 1) return true;
    const widths = stanzas.map(({ lines }) => Math.max(...lines.map(({ text }) => text.length)));
    return Math.max(...widths) >= Math.min(...widths) * 2 + 6;
}
