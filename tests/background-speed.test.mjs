import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const { outputFiles } = await build({
    stdin: {
        contents: `
            export { animatedFluidCanvas, animatedRotatedCanvas } from "./src/utils/animation";
            export { default as config } from "./src/utils/config";
        `,
        resolveDir: process.cwd(),
    },
    bundle: true,
    format: "cjs",
    write: false,
    external: ["@kawarp/core"],
});

function createHost() {
    const module = { exports: {} };
    let storedConfig = JSON.stringify({ def: { animationSpeed: 0.4 } });
    let interval;
    let frame;
    const fluidSpeeds = [];
    class Kawarp {
        setOptions(options) {
            if (options.animationSpeed !== undefined) fluidSpeeds.push(options.animationSpeed);
        }
        resize() {}
        loadImageElement() {}
        renderFrame() {}
        start() {}
    }
    runInNewContext(outputFiles[0].text, {
        module,
        require: () => Kawarp,
        localStorage: {
            getItem: () => storedConfig,
            setItem: (_key, value) => {
                storedConfig = value;
            },
        },
        console,
        document: { querySelector: () => null },
        window: { innerWidth: 100, innerHeight: 100, devicePixelRatio: 1 },
        Spicetify: { SVGIcons: {}, Player: { getProgress: () => 0, isPlaying: () => true } },
        setInterval(callback) {
            interval = callback;
            return 1;
        },
        requestAnimationFrame(callback) {
            frame = callback;
            return 1;
        },
    });
    return {
        ...module.exports,
        fluidSpeeds,
        tick: () => interval(),
        draw: (timestamp) => frame(timestamp),
    };
}

test("the fluid renderer uses the reset speed on its next motion update", () => {
    const { animatedFluidCanvas, config, fluidSpeeds, tick } = createHost();
    assert.equal(animatedFluidCanvas({ style: {} }, { style: {} }, {}, ""), true);
    assert.ok(Math.abs(fluidSpeeds.at(-1) - 1.73) < 1e-9);
    config.resetSettings();
    tick();
    assert.ok(Math.abs(fluidSpeeds.at(-1) - 1.25) < 1e-9);
});

test("the fallback canvas uses the reset speed without recreating the animation", () => {
    const { animatedRotatedCanvas, config, draw } = createHost();
    const rotations = [];
    const ctx = {
        rotate: (radians) => rotations.push((radians * 180) / Math.PI),
        clearRect() {},
        save() {},
        restore() {},
        translate() {},
        drawImage() {},
    };
    animatedRotatedCanvas({ getContext: () => ctx }, {});
    draw(100);
    draw(150);
    config.resetSettings();
    draw(200);
    draw(250);
    assert.ok(Math.abs(rotations[4] - rotations[2] - 1.2) < 1e-9);
    assert.ok(Math.abs(rotations[6] - rotations[4] - 0.75) < 1e-9);
});
