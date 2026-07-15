import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, beforeEach, test } from "node:test";
import { build } from "esbuild";

const buildDirectory = await mkdtemp(join(tmpdir(), "full-screen-updater-test-"));
const bundlePath = join(buildDirectory, "release-updater.mjs");
await build({
    entryPoints: ["src/services/release-updater.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: bundlePath,
});
const { compareVersions, ReleaseUpdater } = await import(pathToFileURL(bundlePath).href);

after(async () => {
    await rm(buildDirectory, { recursive: true, force: true });
});

class MemoryStorage {
    #values = new Map();

    getItem(key) {
        return this.#values.get(key) ?? null;
    }

    setItem(key, value) {
        this.#values.set(key, String(value));
    }

    removeItem(key) {
        this.#values.delete(key);
    }
}

beforeEach(() => {
    globalThis.localStorage = new MemoryStorage();
    globalThis.window = {
        setTimeout,
        clearTimeout,
    };
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { storage: { persist: async () => false } },
    });
    if (!globalThis.crypto?.subtle) {
        Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
    }
});

test("compares stable semantic versions numerically", () => {
    assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
    assert.equal(compareVersions("0.1.2", "0.1.2"), 0);
    assert.equal(compareVersions("0.1.1", "0.1.2"), -1);
});

test("allows a verified release when IndexedDB is unavailable", async () => {
    const source = "void 0;";
    const checksum = createHash("sha256").update(source).digest("hex");
    globalThis.fetch = async (url) =>
        String(url).endsWith(".sha256")
            ? new Response(`${checksum}  fullScreen.js\n`)
            : new Response(source, {
                  headers: { "content-type": "application/javascript" },
              });

    const cached = await ReleaseUpdater.cacheRelease({
        version: "9.8.7",
        tag: "v9.8.7",
        pageUrl: "https://example.test/v9.8.7",
        publishedAt: "2026-01-01T00:00:00Z",
    });

    assert.equal(cached, true);
});

test("rejects a release whose checksum does not match", async () => {
    globalThis.fetch = async (url) =>
        String(url).endsWith(".sha256")
            ? new Response(`${"0".repeat(64)}  fullScreen.js\n`)
            : new Response("void 0;", {
                  headers: { "content-type": "application/javascript" },
              });

    const cached = await ReleaseUpdater.cacheRelease({
        version: "9.8.6",
        tag: "v9.8.6",
        pageUrl: "https://example.test/v9.8.6",
        publishedAt: "2026-01-01T00:00:00Z",
    });

    assert.equal(cached, false);
});

test("requires a matching runtime version from handshake-enabled releases", () => {
    globalThis.document = {
        createElement: () => ({ dataset: {}, textContent: "", remove() {} }),
        head: {
            append(script) {
                Function("window", script.textContent)(globalThis.window);
            },
        },
    };
    const selected = { version: "9.8.4", tag: "v9.8.4" };
    const source = (version) =>
        `window.__fullScreenRuntimeReport={protocol:"full-screen-runtime-handshake-v1",version:${JSON.stringify(version)}};`;

    assert.equal(ReleaseUpdater.executeReleaseSource(selected, source(selected.version)), true);
    assert.equal(ReleaseUpdater.executeReleaseSource(selected, source("9.8.3")), false);
});

test("marks an expired cached update result as stale when the network fails", async () => {
    localStorage.setItem(
        "full-screen:update:release-cache",
        JSON.stringify({
            checkedAt: Date.now() - 7 * 60 * 60 * 1000,
            release: {
                version: "0.1.2",
                tag: "v0.1.2",
                pageUrl: "https://example.test/v0.1.2",
                publishedAt: "2026-01-01T00:00:00Z",
            },
        }),
    );
    globalThis.fetch = async () => {
        throw new Error("offline");
    };

    const result = await ReleaseUpdater.check(true);

    assert.equal(result.status, "current");
    assert.equal(result.stale, true);
    assert.match(result.message, /offline/);
});

test("snoozes an update prompt for 24 hours instead of forever", () => {
    const release = {
        version: "9.8.5",
        tag: "v9.8.5",
        pageUrl: "https://example.test/v9.8.5",
        publishedAt: "2026-01-01T00:00:00Z",
    };

    assert.equal(ReleaseUpdater.shouldPromptFor(release), true);
    ReleaseUpdater.markPrompted(release);
    assert.equal(ReleaseUpdater.shouldPromptFor(release), false);

    localStorage.setItem(
        "full-screen:update:prompted-version",
        JSON.stringify({ version: release.version, promptedAt: Date.now() - 25 * 60 * 60 * 1000 }),
    );
    assert.equal(ReleaseUpdater.shouldPromptFor(release), true);
});

test("does not crash startup or reload when local storage throws", () => {
    globalThis.localStorage = {
        getItem() {
            throw new Error("storage blocked");
        },
        setItem() {
            throw new Error("storage blocked");
        },
        removeItem() {
            throw new Error("storage blocked");
        },
    };
    const release = {
        version: "9.8.3",
        tag: "v9.8.3",
        pageUrl: "https://example.test/v9.8.3",
        publishedAt: "2026-01-01T00:00:00Z",
    };

    assert.doesNotThrow(() => ReleaseUpdater.migrateUpdateModel());
    assert.equal(
        ReleaseUpdater.switchToRelease(release, () => {}),
        false,
    );
});
