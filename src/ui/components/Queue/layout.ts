type Point = { x: number; y: number };
type Tile = Point & { width: number };

/** Keep Up Next fixed, then read roughly aligned tile tops across each visual row. */
function getReadingOrder(tiles: Tile[], rowTolerance: number) {
    if (tiles.length < 2) return tiles.map((_, index) => index);

    const remaining = tiles
        .slice(1)
        .map((tile, offset) => ({ tile, index: offset + 1 }))
        .sort((a, b) => a.tile.y - b.tile.y || a.tile.x - b.tile.x || a.index - b.index);
    const rows: { top: number; tiles: typeof remaining }[] = [];
    remaining.forEach((item) => {
        const row = rows[rows.length - 1];
        if (!row || item.tile.y - row.top > rowTolerance) {
            rows.push({ top: item.tile.y, tiles: [item] });
        } else row.tiles.push(item);
    });
    return [
        0,
        ...rows.flatMap((row) =>
            row.tiles
                .sort((a, b) => a.tile.x - b.tile.x || a.index - b.index)
                .map(({ index }) => index),
        ),
    ];
}

/**
 * Packs the queue around two visual anchors: the immediate next track and the
 * remaining queue. Each column starts at a different height, so the rhythm
 * reads as one wall instead of two matching pairs of columns.
 */
export function layoutQueue(width: number, count: number, leadCaption = 62) {
    const columns = width >= 600 ? 4 : width >= 420 ? 3 : 2;
    const gap = columns >= 4 ? 18 : 14;
    const unit = Math.max(1, (width - gap * (columns - 1)) / columns);
    const labelHeight: number = columns >= 4 ? 42 : 36;
    const leadSpan = columns >= 4 ? 2 : 1;
    const leadSize = leadSpan * unit + (leadSpan - 1) * gap;
    const tiles: Tile[] = [];
    const heights: number[] = Array.from({ length: columns }, () => 0);
    const leadY = labelHeight + gap;

    if (count) {
        tiles.push({ x: 0, y: leadY, width: leadSize });

        // The outer caption sits on the lead's right half. It only reserves the
        // second lead column, leaving the first column free immediately below
        // the artwork instead of creating a blank row across the wall.
        for (let column = 0; column < leadSpan; column++) {
            heights[column] =
                leadY +
                leadSize +
                gap +
                (column === leadSpan - 1 ? Math.max(0, leadCaption - 8) : 0);
        }
        for (let column = leadSpan; column < columns; column++) {
            // Only the right-most stream reserves room for the QUEUE label.
            heights[column] = column === columns - 1 ? leadY : 0;
        }
    }

    const laneOrder =
        columns === 4
            ? // Fill below the lead after the first right-hand pair, so short
              // queues never leave the entire left half empty.
              [2, 3, 0, 1]
            : columns === 3
              ? [1, 2, 0]
              : [1, 0];
    for (let index = 1; index < count; index++) {
        const column =
            columns === 4
                ? laneOrder[(index - 1) % laneOrder.length]
                : heights.indexOf(Math.min(...heights));
        tiles.push({ x: column * (unit + gap), y: heights[column], width: unit });
        heights[column] += unit + gap;
    }

    return {
        tiles,
        // The first slot is always Up Next; the remainder follows responsive row order.
        readingOrder: getReadingOrder(
            tiles,
            Math.min(leadY + Math.max(0, leadCaption - 8), unit + gap - 1),
        ),
        height: count ? Math.max(...heights) - gap : labelHeight,
        columns,
        labels: {
            upNext: { x: 0, y: 0 },
            // Keep QUEUE over the last column, with its right edge aligned to
            // the wall and the right-hand stream of artwork.
            queue: { x: (columns - 1) * (unit + gap), y: 0, width: unit },
        },
    };
}
