import assert from "node:assert/strict";
import { test, after } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "fullscape-queue-layout-"));
await build({
    entryPoints: ["src/ui/components/Queue/layout.ts"],
    bundle: true,
    format: "esm",
    outfile: join(dir, "layout.mjs"),
});
const { layoutQueue } = await import(pathToFileURL(join(dir, "layout.mjs")));
after(() => rm(dir, { recursive: true, force: true }));
test("masonry never overlaps or overflows at narrow, medium and wide widths", () => {
    for (const width of [220, 320, 399, 400, 559, 560, 740, 1100]) {
        const { tiles, height } = layoutQueue(width, 60);
        for (let i = 0; i < tiles.length; i++) {
            const a = tiles[i];
            assert.ok(a.x >= 0 && a.x + a.width <= width + 0.01);
            assert.ok(a.y + a.width <= height + 0.01);
            for (let j = i + 1; j < tiles.length; j++) {
                const b = tiles[j];
                assert.ok(
                    a.x + a.width <= b.x + 0.01 ||
                        b.x + b.width <= a.x + 0.01 ||
                        a.y + a.width <= b.y + 0.01 ||
                        b.y + b.width <= a.y + 0.01,
                );
            }
        }
    }
});
test("wide layout features the first artwork with staggered columns", () => {
    const width = 640;
    const { tiles, columns, labels } = layoutQueue(width, 13);
    assert.equal(columns, 4);
    assert.ok(tiles[0].width > tiles[1].width * 2);
    assert.notEqual(tiles[1].y, tiles[2].y);
    assert.notEqual(tiles[2].y - 42, tiles[3].y - 42);
    assert.equal(tiles[3].x, 0);
    assert.equal(tiles[4].x, tiles[1].x / 2);
    assert.equal(labels.queue.x + labels.queue.width, width);
    assert.ok(layoutQueue(640, 0).height > 0);
});
test("wide reading order follows visible rows instead of the masonry fill order", () => {
    assert.deepEqual(layoutQueue(640, 11).readingOrder, [0, 1, 2, 5, 6, 3, 4, 9, 10, 7, 8]);
});
test("large artwork reads both complete right-hand rows before restarting on the left", () => {
    for (const caption of [62, 150, 320]) {
        const { tiles, readingOrder } = layoutQueue(1100, 13, caption);
        assert.ok(tiles[5].y + tiles[5].width <= tiles[0].y + tiles[0].width);
        assert.ok(tiles[9].y + tiles[9].width > tiles[0].y + tiles[0].width);
        assert.deepEqual(readingOrder, [0, 1, 2, 5, 6, 3, 4, 9, 10, 7, 8, 11, 12]);
    }
});
test("narrow artwork reads only the fitting right-hand row before restarting on the left", () => {
    const { tiles, readingOrder } = layoutQueue(560, 10);
    assert.ok(tiles[1].y + tiles[1].width <= tiles[0].y + tiles[0].width);
    assert.ok(tiles[3].y + tiles[3].width > tiles[0].y + tiles[0].width);
    assert.deepEqual(readingOrder, [0, 1, 2, 5, 3, 4, 8, 6, 7, 9]);
});
test("reading order includes every tile exactly once at responsive widths", () => {
    for (const width of [220, 320, 419, 420, 559, 600, 740, 1100]) {
        for (const count of [0, 1, 2, 11, 40]) {
            const { readingOrder } = layoutQueue(width, count);
            assert.deepEqual(
                readingOrder.slice().sort((a, b) => a - b),
                [...Array(count).keys()],
            );
        }
    }
});
test("wrapped Up Next metadata reserves its measured vertical space", () => {
    const compact = layoutQueue(640, 13, 62);
    const wrapped = layoutQueue(640, 13, 150);
    assert.ok(wrapped.height > compact.height);
    assert.ok(wrapped.tiles.some((tile, index) => tile.y > compact.tiles[index].y));
});
