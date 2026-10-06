import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const dir = await mkdtemp(join(tmpdir(), "fullscape-motion-"));
await build({
    entryPoints: ["src/utils/motion.ts"],
    bundle: true,
    format: "esm",
    outfile: join(dir, "motion.mjs"),
    logLevel: "silent",
});
const { animateFeedback, frameSmoothing } = await import(pathToFileURL(join(dir, "motion.mjs")));
after(() => rm(dir, { recursive: true, force: true }));
let reduced = false;
globalThis.window = { matchMedia: () => ({ matches: reduced }) };

function animatedElement() {
    const calls = [];
    return {
        calls,
        animate() {
            let resolve, reject;
            const finished = new Promise((a, b) => {
                resolve = a;
                reject = b;
            });
            const animation = {
                finished,
                cancels: 0,
                cancel() {
                    this.cancels++;
                    reject(new Error("cancelled"));
                },
                finish: resolve,
            };
            calls.push(animation);
            return animation;
        },
    };
}

test("rapid feedback replaces the prior animation without its completion discarding the newer one", async () => {
    const element = animatedElement();
    animateFeedback(element, []);
    animateFeedback(element, []);
    assert.equal(element.calls[0].cancels, 1);
    await new Promise((resolve) => setImmediate(resolve));
    animateFeedback(element, []);
    assert.equal(element.calls[1].cancels, 1);
    element.calls[2].finish();
});

test("reduced motion cancels existing feedback and does not start new motion", async () => {
    const element = animatedElement();
    animateFeedback(element, []);
    reduced = true;
    animateFeedback(element, []);
    assert.equal(element.calls.length, 1);
    assert.equal(element.calls[0].cancels, 1);
    reduced = false;
    await new Promise((resolve) => setImmediate(resolve));
});

test("manual scroll smoothing has the same convergence at 60 and 120 Hz", () => {
    const converge = (fps) => {
        let position = 0;
        for (let frame = 0; frame < fps / 5; frame++)
            position += (1 - position) * frameSmoothing(1000 / fps);
        return position;
    };
    assert.ok(Math.abs(converge(60) - converge(120)) < 1e-9);
    assert.equal(frameSmoothing(0), 0);
    assert.ok(frameSmoothing(5000) < 1);
});
