type Position = { node: Node; offset: number };

const graphemeSegmenter =
    typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;

export function wrapOversizedLyricReadings(block: HTMLElement) {
    const rubies = Array.from(block.querySelectorAll<HTMLElement>(".rnp-furigana-ruby"));
    if (!rubies.length) return false;
    rubies.forEach((ruby) => ruby.classList.remove("rnp-furigana-wrapped"));
    const width = block.clientWidth;
    if (!width) return false;
    const oversized = rubies.filter((ruby) => ruby.offsetWidth > width + 1);
    oversized.forEach((ruby) => ruby.classList.add("rnp-furigana-wrapped"));
    return oversized.length > 0;
}

// Read the browser's actual line breaks, including its shaping, word-breaking
// rules and ruby layout. Do not estimate widths from character counts.
export function freezeMeasuredLyricRows(source: HTMLElement, target: HTMLElement) {
    const range = document.createRange();
    let starts: Position[] = [];
    let baseline: number | null = null;
    let availableWidth = 0;
    let wrappedAtom = false;
    const style = getComputedStyle(source);
    const tolerance = Number.parseFloat(style.fontSize) * 0.5;
    const lineHeight = Number.parseFloat(style.lineHeight);
    const wrappedReading = wrapOversizedLyricReadings(source);
    const record = (position: Position, rect: DOMRect) => {
        if (!rect.width || !rect.height) return;
        if (baseline !== null && rect.bottom > baseline + tolerance) starts.push(position);
        baseline = rect.bottom;
    };
    const visit = (node: Node) => {
        if (node instanceof HTMLElement) {
            if (node.tagName === "RT" || node.tagName === "WBR") return;
            // Never split a timed word or ruby across rows: keep the original
            // animation node and annotation intact in the resulting fragment.
            if (node.matches("ruby, .rnp-lyrics-semantic-word, .rnp-karaoke-word")) {
                range.selectNode(node);
                const parent = node.parentNode;
                if (!parent) return;
                const rect = range.getBoundingClientRect();
                // A wide word can wrap internally. Freezing a row around that
                // word would disable its breaks and push its text past the edge.
                if (
                    rect.width > availableWidth + 1 ||
                    (rect.width >= availableWidth - 1 && node.offsetHeight > lineHeight + 2)
                ) {
                    wrappedAtom = true;
                }
                record(
                    { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) },
                    rect,
                );
                return;
            }
            node.childNodes.forEach(visit);
        } else if (node.nodeType === Node.TEXT_NODE) {
            let offset = 0;
            const text = node.textContent ?? "";
            for (const item of graphemeSegmenter?.segment(text) ?? text) {
                const character = typeof item === "string" ? item : item.segment;
                // A preserved trailing space can hang on a third visual row.
                // It belongs to the preceding fragment, not an empty lyric row.
                if (/[^\S\n]/u.test(character)) {
                    offset += character.length;
                    continue;
                }
                range.setStart(node, offset);
                range.setEnd(node, offset + character.length);
                record({ node, offset }, range.getBoundingClientRect());
                offset += character.length;
            }
        }
    };
    const measure = () => {
        starts = [{ node: source, offset: 0 }];
        baseline = null;
        availableWidth = source.clientWidth;
        wrappedAtom = false;
        source.childNodes.forEach(visit);
        return starts.length;
    };
    const rowCount = measure();
    const naturalWrap = wrappedReading || wrappedAtom;
    target.classList.toggle("rnp-lyrics-natural-wrap", naturalWrap);
    if (naturalWrap) {
        range.selectNodeContents(source);
        target.replaceChildren(range.cloneContents());
        return;
    }
    const originalWidth = source.style.width;
    // Chromium does not reliably balance preserved spaces and timed inline
    // boxes. Find the narrowest measured width that keeps the existing row
    // count; the browser still chooses legal word/ruby boundaries itself.
    if (
        rowCount > 1 &&
        rowCount <= 6 &&
        source.matches(".rnp-lyrics-line-karaoke, .rnp-lyrics-line-original") &&
        !source.textContent?.includes("\n") &&
        !source.querySelector("br")
    ) {
        let upper = source.getBoundingClientRect().width;
        let lower = upper / rowCount;
        for (let attempt = 0; attempt < 9 && upper - lower > 1; attempt++) {
            const width = (lower + upper) / 2;
            source.style.width = `${width}px`;
            if (measure() <= rowCount && !wrappedAtom) upper = width;
            else lower = width;
        }
        source.style.width = `${Math.ceil(upper)}px`;
        measure();
    }

    const rows = document.createDocumentFragment();
    starts.forEach((start, index) => {
        const end = starts[index + 1] ?? { node: source, offset: source.childNodes.length };
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const row = document.createElement("span");
        row.className = "rnp-lyrics-fixed-row";
        row.append(range.cloneContents());
        rows.append(row);
        // A preserved newline already ends the row; inserting another break would
        // add an empty line. Inline rows keep the browser's original ruby leading.
        if (index < starts.length - 1 && !row.textContent?.endsWith("\n")) {
            rows.append(document.createElement("br"));
        }
    });
    source.style.width = originalWidth;
    target.replaceChildren(rows);
}
