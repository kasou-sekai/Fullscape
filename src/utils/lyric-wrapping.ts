type Position = { node: Node; offset: number };

// Read the browser's actual line breaks, including its shaping, word-breaking
// rules and ruby layout. Do not estimate widths from character counts.
export function freezeMeasuredLyricRows(source: HTMLElement, target: HTMLElement) {
    const range = document.createRange();
    const starts: Position[] = [{ node: source, offset: 0 }];
    let baseline: number | null = null;
    const tolerance = Number.parseFloat(getComputedStyle(source).fontSize) * 0.5;
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
                range.setStart(node, offset);
                range.setEnd(node, offset + character.length);
                record({ node, offset }, range.getBoundingClientRect());
                offset += character.length;
            }
        }
    };
    source.childNodes.forEach(visit);

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
    target.replaceChildren(rows);
}
