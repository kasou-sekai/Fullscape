type Point = { x: number; y: number };
type Tile = Point & { width: number };

/**
 * Packs the queue around two visual anchors: the immediate next track and the
 * remaining queue. Each column starts at a different height, so the rhythm
 * reads as one wall instead of two matching pairs of columns.
 */
export function layoutQueue(width: number, count: number) {
    const columns = width >= 600 ? 4 : width >= 420 ? 3 : 2;
    const gap = columns >= 4 ? 18 : 14;
    const unit = Math.max(1, (width - gap * (columns - 1)) / columns);
    const labelHeight: number = columns >= 4 ? 42 : 36;
    const leadSpan = columns >= 4 ? 2 : 1;
    const leadSize = leadSpan * unit + (leadSpan - 1) * gap;
    const leadCaption = 62;
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
                leadY + leadSize + gap + (column === leadSpan - 1 ? leadCaption + gap : 0);
        }
        for (let column = leadSpan; column < columns; column++) {
            // Only the right-most stream reserves room for the QUEUE label.
            heights[column] = column === columns - 1 ? leadY : 0;
        }
    }

    const laneOrder =
        columns === 4
            // Fill below the lead after the first right-hand pair, so short
            // queues never leave the entire left half empty.
            ? [2, 3, 0, 1]
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
