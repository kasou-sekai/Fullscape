type Position = { node: Node; offset: number };

// Read the browser's actual line breaks, including its shaping, word-breaking
// rules and ruby layout. Do not estimate widths from character counts.
export function freezeMeasuredLyricRows(
    source: HTMLElement,
    target: HTMLElement,
    balance = source.matches(".rnp-lyrics-line-karaoke, .rnp-lyrics-line-original"),
) {
    const range = document.createRange();
    let starts: Position[] = [];
    let baseline: number | null = null;
    const style = getComputedStyle(source);
    const writingMode = style.writingMode;
    const tolerance = Number.parseFloat(style.fontSize) * 0.5;
    const record = (position: Position, rect: DOMRect) => {
        if (!rect.width || !rect.height) return;
        const blockEnd =
            writingMode === "vertical-rl"
                ? -rect.left
                : writingMode === "vertical-lr"
                  ? rect.right
                  : rect.bottom;
        if (baseline !== null && blockEnd > baseline + tolerance) starts.push(position);
        baseline = blockEnd;
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
                record(
                    { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) },
                    range.getBoundingClientRect(),
                );
                return;
            }
            node.childNodes.forEach(visit);
        } else if (node.nodeType === Node.TEXT_NODE) {
            let offset = 0;
            for (const character of node.textContent ?? "") {
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
        source.childNodes.forEach(visit);
        return starts.length;
    };
    const rowCount = measure();
    const originalSize = source.style.inlineSize;
    // Chromium does not reliably balance preserved spaces and timed inline
    // boxes. Find the narrowest measured width that keeps the existing row
    // count; the browser still chooses legal word/ruby boundaries itself.
    if (
        rowCount > 1 &&
        rowCount <= 6 &&
        balance &&
        !source.textContent?.includes("\n") &&
        !source.querySelector("br")
    ) {
        const bounds = source.getBoundingClientRect();
        let upper = writingMode.startsWith("vertical") ? bounds.height : bounds.width;
        let lower = upper / rowCount;
        for (let attempt = 0; attempt < 9 && upper - lower > 1; attempt++) {
            const width = (lower + upper) / 2;
            source.style.inlineSize = `${width}px`;
            if (measure() <= rowCount) upper = width;
            else lower = width;
        }
        source.style.inlineSize = `${Math.ceil(upper)}px`;
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
    source.style.inlineSize = originalSize;
    target.replaceChildren(rows);
}
