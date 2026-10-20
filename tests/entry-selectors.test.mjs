import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const { outputFiles } = await build({
    entryPoints: ["src/utils/selectors.ts"],
    bundle: true,
    format: "cjs",
    write: false,
});

function resolveControls(elements) {
    const sandbox = {
        module: { exports: {} },
        document: { querySelector: (selector) => elements[selector] ?? null },
    };
    runInNewContext(outputFiles[0].text, sandbox);
    return sandbox.module.exports.default.getExtraBarSelector();
}

for (const anchor of ["fullscreen-mode-button", "pip-toggle-button", "lyrics-button"]) {
    test(`locates current Spotify controls using ${anchor} without CSS class names`, () => {
        const controls = {};
        const bar = {
            querySelector: (selector) =>
                selector === `[data-testid="${anchor}"]` ? { parentElement: controls } : null,
        };
        assert.equal(resolveControls({ '[data-testid="now-playing-bar"]': bar }), controls);
    });
}

test("uses the legacy element child even when the bar starts with a text node", () => {
    const controls = {};
    assert.equal(
        resolveControls({ ".main-nowPlayingBar-right": { firstElementChild: controls } }),
        controls,
    );
});

test("does not mount into the entire now-playing bar when controls are unavailable", () => {
    const bar = { querySelector: () => ({ parentElement: bar }) };
    assert.equal(resolveControls({ '[data-testid="now-playing-bar"]': bar }), null);
});
