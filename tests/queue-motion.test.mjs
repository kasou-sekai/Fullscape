import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "fullscape-queue-motion-"));
await build({
    entryPoints: ["src/ui/components/Queue/motion.ts"],
    bundle: true,
    format: "esm",
    outfile: join(dir, "motion.mjs"),
    logLevel: "silent",
});
const { getQueueTileMotion } = await import(pathToFileURL(join(dir, "motion.mjs")));
await rm(dir, { recursive: true, force: true });

const viewport = { top: 100, bottom: 500, height: 400 };

test("queue cards materialize continuously through the bottom edge", () => {
    const hidden = getQueueTileMotion({ top: 500, bottom: 700, height: 200 }, viewport);
    const halfway = getQueueTileMotion({ top: 400, bottom: 600, height: 200 }, viewport);
    const visible = getQueueTileMotion({ top: 300, bottom: 500, height: 200 }, viewport);
    assert.equal(hidden.origin, "center top");
    assert.equal(hidden.progress, 0);
    assert.equal(hidden.translateY, 14);
    assert.equal(halfway.progress, 0.5);
    assert.equal(visible.progress, 1);
    assert.ok(hidden.scaleY < halfway.scaleY && halfway.scaleY < visible.scaleY);
    assert.ok(hidden.blur > halfway.blur && halfway.blur > visible.blur);
});

test("queue cards dematerialize continuously through the top edge", () => {
    const visible = getQueueTileMotion({ top: 100, bottom: 300, height: 200 }, viewport);
    const halfway = getQueueTileMotion({ top: 0, bottom: 200, height: 200 }, viewport);
    const hidden = getQueueTileMotion({ top: -100, bottom: 100, height: 200 }, viewport);
    assert.equal(hidden.origin, "center bottom");
    assert.equal(hidden.progress, 0);
    assert.equal(hidden.translateY, -14);
    assert.equal(halfway.progress, 0.5);
    assert.equal(visible.progress, 1);
    assert.equal(
        halfway.scaleY,
        getQueueTileMotion({ top: 400, bottom: 600, height: 200 }, viewport).scaleY,
    );
});

test("the initial queue view does not fade its top row", () => {
    const protectedTile = getQueueTileMotion(
        { top: 0, bottom: 200, height: 200 },
        viewport,
        0,
    );
    assert.equal(protectedTile.progress, 1);
    assert.equal(protectedTile.blur, 0);
});
