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
test("wrapped Up Next metadata reserves its measured vertical space", () => {
    const compact = layoutQueue(640, 13, 62);
    const wrapped = layoutQueue(640, 13, 150);
    assert.ok(wrapped.height > compact.height);
    assert.ok(wrapped.tiles.some((tile, index) => tile.y > compact.tiles[index].y));
});
