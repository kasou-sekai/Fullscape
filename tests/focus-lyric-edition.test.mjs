import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
    stdin: {
        contents: `export { lyricEdition } from "./src/ui/components/Focus/lyric-edition";
            export { stanzaRows } from "./src/ui/components/Focus/stanza-layout";`,
        resolveDir: process.cwd(),
    },
    bundle: true,
    format: "esm",
    write: false,
});
const { lyricEdition, stanzaRows } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

test("adjacent lyric editions rotate paper and keep the previous layout as a last choice", () => {
    let seed = 42;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
    const first = lyricEdition(undefined, undefined, random);
    const layouts = new Set();
    const papers = new Set();
    let previous = first;
    for (let index = 0; index < 80; index += 1) {
        const edition = lyricEdition(previous.layouts[0], previous.paper, random);
        assert.notEqual(edition.paper, previous.paper);
        assert.notEqual(edition.layouts[0], previous.layouts[0]);
        assert.equal(edition.layouts.at(-1), previous.layouts[0]);
        assert.deepEqual([...edition.layouts].sort(), [...first.layouts].sort());
        layouts.add(edition.layouts[0]);
        papers.add(edition.paper);
        previous = edition;
    }
    assert.equal(layouts.size, first.layouts.length);
    assert.equal(papers.size, 6);
});

const stanza = (inlineSize, blockSize = 40, ownRow = false) => ({
    inlineSize,
    blockSize,
    ownRow,
});

test("measured short stanzas share a row and wide stanzas take the full measure", () => {
    const verses = [stanza(90), stanza(100), stanza(80), stanza(290), stanza(125), stanza(130)];
    const rows = stanzaRows(verses, 380, 20, "stanza-bands");
    assert.deepEqual(
        rows.map(({ fractions }) => fractions.length),
        [3, 1, 2],
    );
    assert.ok(rows[0].fractions.every((fraction) => fraction === 1 / 3));
    assert.deepEqual(rows[1].fractions, [1]);

    const narrowRows = stanzaRows([stanza(70), stanza(70), stanza(70)], 318, 20, "stanza-bands");
    assert.ok(narrowRows.every(({ fractions }) => fractions.length <= 2));
});

test("unequal columns fit wider lyrics while short and tall stanzas keep separate rows", () => {
    const verses = [stanza(228), stanza(72), stanza(65, 200), stanza(70, 22)];
    const rows = stanzaRows(verses, 380, 20, "stanza-columns");
    assert.deepEqual(
        rows.map(({ fractions }) => fractions.length),
        [2, 1, 1],
    );
    assert.ok(rows[0].fractions[0] > 0.65);
    assert.ok(rows[0].fractions[1] * 360 > verses[1].inlineSize);
    assert.deepEqual(
        stanzaRows(verses.slice(0, 2), 380, 20, "stanza-bands").map(
            ({ fractions }) => fractions.length,
        ),
        [1, 1],
    );
});

test("interludes take an independent row and insets alternate around wide text", () => {
    const verses = [stanza(70), stanza(110), stanza(100, 40, true), stanza(90), stanza(340)];
    const columns = stanzaRows(verses, 380, 20, "stanza-bands");
    assert.deepEqual(
        columns.map(({ fractions }) => fractions.length),
        [2, 1, 1, 1],
    );
    const insets = stanzaRows(verses, 380, 20, "stanza-insets");
    assert.deepEqual(
        insets.map(({ align }) => align ?? "full"),
        ["end", "start", "full", "end", "full"],
    );
});
