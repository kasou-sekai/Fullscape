type Point = { x: number; y: number };
type Tile = Point & { width: number };
type QueueLayoutMeasurements = { viewportHeight?: number; queueLabelHeight?: number };

/** Read complete right-hand rows beside Up Next, then each remaining row left to right. */
function getReadingOrder(tiles: Tile[]) {
    if (tiles.length < 2) return tiles.map((_, index) => index);

    const lead = tiles[0];
    const lanes = new Map<number, { tile: Tile; index: number }[]>();
    tiles.slice(1).forEach((tile, offset) => {
        const lane = lanes.get(tile.x) || [];
        lane.push({ tile, index: offset + 1 });
        lanes.set(tile.x, lane);
    });
    const columns = [...lanes.entries()]
        .sort(([a], [b]) => a - b)
        .map(([x, items]) => ({ x, items: items.sort((a, b) => a.tile.y - b.tile.y) }));
    const rightColumns = columns.filter(({ x }) => x >= lead.x + lead.width);
    const order = [0];
    const readRow = (row: typeof columns) => {
        row.forEach(({ items }) => {
            const item = items.shift();
            if (item) order.push(item.index);
        });
    };

    // Only artwork counts toward the boundary; the lead caption does not.
    const leftmostRight = rightColumns[0];
    while (leftmostRight?.items.length) {
        const { tile } = leftmostRight.items[0];
        if (tile.y + tile.width > lead.y + lead.width + 0.01) break;
        readRow(rightColumns);
    }
    while (columns.some(({ items }) => items.length)) readRow(columns);
    return order;
}

/**
 * Packs the queue around two visual anchors: the immediate next track and the
 * remaining queue. Each column starts at a different height, so the rhythm
 * reads as one wall instead of two matching pairs of columns.
 */
export function layoutQueue(
    width: number,
    count: number,
    leadCaption = 62,
    { viewportHeight = Infinity, queueLabelHeight = 36 }: QueueLayoutMeasurements = {},
) {
    const columns = width >= 600 ? 4 : width >= 320 ? 3 : 2;
    const gap = Math.min(width / 3, columns === 4 ? 18 : 14);
    // Keep most of the featured square in view even in a short two-column window.
    const gridWidth = columns === 2 ? Math.min(width, Math.max(186, viewportHeight - 70)) : width;
    const gridLeft = (width - gridWidth) / 2;
    const unit = (gridWidth - gap * (columns - 1)) / columns;
    const pitch = unit + gap;
    const labelHeight = columns === 4 ? 42 : 36;
    const leadSize = 2 * unit + gap;
    const leadY = labelHeight + gap;
    const leadBottom = leadY + leadSize;
    const captionBottom = leadBottom + 10 + leadCaption;
    const queueLabelY = columns === 2 && count > 1 ? captionBottom + 8 : 0;
    const tiles: Tile[] = count ? [{ x: gridLeft, y: leadY, width: leadSize }] : [];
    let height = count ? captionBottom : labelHeight;

    const firstBelow = leadBottom + gap;
    // The caption occupies the right half under the feature. Leave the left
    // column free and give the other streams their own starting heights.
    const belowCaption = Math.max(firstBelow, captionBottom);
    const laneTops = {
        4: [firstBelow, belowCaption, 0, leadY],
        3: [firstBelow, belowCaption, firstBelow + gap],
        2: [queueLabelY, queueLabelY + queueLabelHeight + 8],
    }[columns];

    if (columns === 3) {
        for (let index = 1; index < Math.min(count, 3); index++) {
            const y = labelHeight + 6 + (index - 1) * pitch;
            tiles.push({ x: gridLeft + 2 * pitch, y, width: unit });
            height = Math.max(height, y + unit);
        }
    }

    const laneOrder = columns === 4 ? [2, 3, 0, 1] : columns === 3 ? [0, 1, 2] : [0, 1];
    const firstRemaining = tiles.length;
    for (let index = firstRemaining; index < count; index++) {
        const lane = laneOrder[(index - firstRemaining) % columns];
        const y = laneTops[lane];
        tiles.push({ x: gridLeft + lane * pitch, y, width: unit });
        height = Math.max(height, y + unit);
        laneTops[lane] += pitch;
    }

    return {
        tiles,
        readingOrder: columns === 4 ? getReadingOrder(tiles) : tiles.map((_, index) => index),
        height,
        columns,
        labels: {
            upNext: { x: gridLeft, y: 0 },
            queue: { x: gridLeft + (columns - 1) * pitch, y: queueLabelY, width: unit },
        },
    };
}
