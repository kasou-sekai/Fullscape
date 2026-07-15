import packageJson from "../../package.json";

const REPOSITORY = "kasou-sekai/Spotify-Full-Screen-Playing";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASE_LIST_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=50`;
const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const UPDATE_PROMPT_SNOOZE_MS = 24 * 60 * 60 * 1000;
const RELEASE_LOAD_TIMEOUT_MS = 15000;
const RELEASE_DB_OPEN_TIMEOUT_MS = 5000;
const MAX_RELEASE_SCRIPT_BYTES = 5 * 1024 * 1024;
const RELEASE_SCRIPT_DB_NAME = "full-screen-release-cache";
const RELEASE_SCRIPT_DB_VERSION = 2;
const RELEASE_SCRIPT_STORE = "scripts";
const MAX_CACHED_RELEASES = 3;
const UPDATE_MODEL_VERSION = "verified-release-cache-v2";
const RELEASE_RUNTIME_HANDSHAKE = "full-screen-runtime-handshake-v1";

const STORAGE_KEYS = {
    selectedRelease: "full-screen:update:selected-release",
    latestReleaseCache: "full-screen:update:release-cache",
    releaseListCache: "full-screen:update:release-list-cache",
    promptedVersion: "full-screen:update:prompted-version",
    loadFailure: "full-screen:update:load-failure",
    modelVersion: "full-screen:update:model-version",
} as const;

export const CURRENT_VERSION = packageJson.version;

export type ReleaseInfo = {
    version: string;
    tag: string;
    pageUrl: string;
    publishedAt: string;
};

export type SelectedRelease = Pick<ReleaseInfo, "version" | "tag"> & {
    selectionModel?: "confirmed-version-v1";
};

export type UpdateCheckResult =
    | { status: "available"; release: ReleaseInfo; stale?: boolean; message?: string }
    | { status: "current"; release: ReleaseInfo | null; stale?: boolean; message?: string }
    | { status: "error"; message: string };

type ReleaseCache = {
    checkedAt: number;
    release: ReleaseInfo | null;
};

type ReleaseListCache = {
    checkedAt: number;
    releases: ReleaseInfo[];
};

type LoadFailure = {
    version: string;
    failedAt: number;
};

type CachedReleaseScript = {
    tag: string;
    source: string;
    checksum: string;
    cachedAt: number;
};

type VerifiedReleaseSource = Pick<CachedReleaseScript, "source" | "checksum">;

type PromptRecord = {
    version: string;
    promptedAt: number;
};

type GitHubRelease = {
    tag_name?: unknown;
    html_url?: unknown;
    published_at?: unknown;
    draft?: unknown;
    prerelease?: unknown;
};

type UpdateRuntimeWindow = Window & {
    __fullScreenBundledVersion?: string;
    __fullScreenLoadingRelease?: string;
    __fullScreenExecutedRelease?: string;
    __fullScreenRuntimeReport?: {
        protocol: string;
        version: string;
    };
};

function storageGet(key: string) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.warn("[Full Screen] Unable to read update state from local storage.", error);
        return null;
    }
}

function storageSet(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (error) {
        console.warn("[Full Screen] Unable to save update state to local storage.", error);
        return false;
    }
}

function storageRemove(key: string) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (error) {
        console.warn("[Full Screen] Unable to remove update state from local storage.", error);
        return false;
    }
}

function parseJson<T>(value: string | null): T | null {
    if (!value) return null;
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

function parseVersion(value: unknown) {
    if (typeof value !== "string") return null;
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!match) return null;
    return match.slice(1).map(Number) as [number, number, number];
}

export function compareVersions(left: string, right: string) {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    if (!leftParts || !rightParts) return 0;
    for (let index = 0; index < leftParts.length; index += 1) {
        if (leftParts[index] !== rightParts[index]) {
            return leftParts[index] > rightParts[index] ? 1 : -1;
        }
    }
    return 0;
}

function parseRelease(payload: GitHubRelease): ReleaseInfo | null {
    if (payload.draft || payload.prerelease || typeof payload.tag_name !== "string") return null;
    const tag = payload.tag_name;
    const version = tag.startsWith("v") ? tag.slice(1) : tag;
    if (!parseVersion(version) || tag !== `v${version}`) return null;
    return {
        version,
        tag,
        pageUrl:
            typeof payload.html_url === "string"
                ? payload.html_url
                : `https://github.com/${REPOSITORY}/releases/tag/${tag}`,
        publishedAt: typeof payload.published_at === "string" ? payload.published_at : "",
    };
}

function isSelectedRelease(value: SelectedRelease | null): value is SelectedRelease {
    return Boolean(value && parseVersion(value.version) && value.tag === `v${value.version}`);
}

function isReleaseInfo(value: ReleaseInfo | null): value is ReleaseInfo {
    return Boolean(
        value &&
            parseVersion(value.version) &&
            value.tag === `v${value.version}` &&
            typeof value.pageUrl === "string" &&
            typeof value.publishedAt === "string",
    );
}

function isReleaseList(value: unknown): value is ReleaseInfo[] {
    return Array.isArray(value) && value.every((release) => isReleaseInfo(release));
}

function getReleaseScriptUrl(tag: string) {
    return `https://cdn.jsdelivr.net/gh/${REPOSITORY}@${encodeURIComponent(tag)}/dist/fullScreen.js`;
}

function getReleaseChecksumUrl(tag: string) {
    return `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/fullScreen.js.sha256`;
}

function resultForRelease(
    release: ReleaseInfo | null,
    metadata: { stale?: boolean; message?: string } = {},
): UpdateCheckResult {
    if (release && compareVersions(release.version, CURRENT_VERSION) > 0) {
        return { status: "available", release, ...metadata };
    }
    return { status: "current", release, ...metadata };
}

function isUsableCacheTimestamp(value: number, now = Date.now()) {
    return Number.isFinite(value) && value >= 0 && value <= now + 5 * 60 * 1000;
}

async function sha256Hex(data: BufferSource) {
    if (!globalThis.crypto?.subtle) throw new Error("SHA-256 verification is unavailable");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
    );
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), RELEASE_LOAD_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error(`Request timed out after ${RELEASE_LOAD_TIMEOUT_MS / 1000} seconds`);
        }
        throw error;
    } finally {
        window.clearTimeout(timeout);
    }
}

function sortedUniqueReleases(payload: unknown) {
    if (!Array.isArray(payload)) return null;
    const releases = payload
        .map((release) => parseRelease(release as GitHubRelease))
        .filter((release): release is ReleaseInfo => release !== null);
    const unique = [...new Map(releases.map((release) => [release.tag, release])).values()];
    return unique.sort((left, right) => compareVersions(right.version, left.version));
}

export class ReleaseUpdater {
    private static checkInFlight: Promise<UpdateCheckResult> | null = null;
    private static listInFlight: Promise<ReleaseInfo[]> | null = null;
    private static releaseDbPromise: Promise<IDBDatabase | null> | null = null;
    private static storagePersistenceRequested = false;
    private static releaseListWarning: string | null = null;

    static migrateUpdateModel() {
        if (storageGet(STORAGE_KEYS.modelVersion) === UPDATE_MODEL_VERSION) return;
        storageRemove(STORAGE_KEYS.latestReleaseCache);
        storageRemove(STORAGE_KEYS.releaseListCache);
        storageRemove(STORAGE_KEYS.promptedVersion);
        storageSet(STORAGE_KEYS.modelVersion, UPDATE_MODEL_VERSION);
    }

    static reportRuntimeVersion() {
        (window as UpdateRuntimeWindow).__fullScreenRuntimeReport = {
            protocol: RELEASE_RUNTIME_HANDSHAKE,
            version: CURRENT_VERSION,
        };
    }

    static getBundledVersion() {
        return (window as UpdateRuntimeWindow).__fullScreenBundledVersion ?? CURRENT_VERSION;
    }

    static getSelectedRelease(): SelectedRelease | null {
        const selected = parseJson<SelectedRelease>(storageGet(STORAGE_KEYS.selectedRelease));
        if (isSelectedRelease(selected)) {
            const isLegacyDowngrade =
                compareVersions(CURRENT_VERSION, selected.version) > 0 &&
                selected.selectionModel !== "confirmed-version-v1";
            if (!isLegacyDowngrade) return selected;
        }
        if (selected) storageRemove(STORAGE_KEYS.selectedRelease);
        return null;
    }

    private static openReleaseDatabase() {
        if (this.releaseDbPromise) return this.releaseDbPromise;
        this.releaseDbPromise = new Promise<IDBDatabase | null>((resolve) => {
            if (!("indexedDB" in window)) {
                resolve(null);
                return;
            }
            let settled = false;
            const finish = (database: IDBDatabase | null) => {
                if (settled) {
                    database?.close();
                    return;
                }
                settled = true;
                window.clearTimeout(timeout);
                resolve(database);
            };
            const request = window.indexedDB.open(
                RELEASE_SCRIPT_DB_NAME,
                RELEASE_SCRIPT_DB_VERSION,
            );
            const timeout = window.setTimeout(() => {
                console.warn("[Full Screen] Timed out opening the local release cache.");
                finish(null);
            }, RELEASE_DB_OPEN_TIMEOUT_MS);
            request.onupgradeneeded = (event) => {
                const database = request.result;
                if (!database.objectStoreNames.contains(RELEASE_SCRIPT_STORE)) {
                    database.createObjectStore(RELEASE_SCRIPT_STORE, { keyPath: "tag" });
                } else if (event.oldVersion < RELEASE_SCRIPT_DB_VERSION) {
                    request.transaction?.objectStore(RELEASE_SCRIPT_STORE).clear();
                }
            };
            request.onsuccess = () => {
                const database = request.result;
                database.onversionchange = () => {
                    database.close();
                    this.releaseDbPromise = null;
                };
                finish(database);
            };
            request.onerror = () => {
                console.warn("[Full Screen] Unable to open the local release cache.");
                finish(null);
            };
            request.onblocked = () => {
                console.warn("[Full Screen] The local release cache is blocked.");
            };
        });
        void this.releaseDbPromise.then((database) => {
            if (!database) this.releaseDbPromise = null;
        });
        return this.releaseDbPromise;
    }

    private static async readCachedReleaseSource(tag: string) {
        const database = await this.openReleaseDatabase();
        if (!database) return null;
        try {
            const cached = await new Promise<CachedReleaseScript | null>((resolve) => {
                const request = database
                    .transaction(RELEASE_SCRIPT_STORE, "readonly")
                    .objectStore(RELEASE_SCRIPT_STORE)
                    .get(tag);
                request.onsuccess = () => {
                    resolve((request.result as CachedReleaseScript | undefined) ?? null);
                };
                request.onerror = () => resolve(null);
            });
            if (
                !cached ||
                cached.tag !== tag ||
                typeof cached.source !== "string" ||
                !cached.source.trim() ||
                !/^[a-f0-9]{64}$/.test(cached.checksum)
            ) {
                if (cached) await this.deleteCachedReleaseSource(tag);
                return null;
            }
            const actualChecksum = await sha256Hex(new TextEncoder().encode(cached.source));
            if (actualChecksum !== cached.checksum) {
                console.warn(`[Full Screen] Discarding corrupt cached ${tag}.`);
                await this.deleteCachedReleaseSource(tag);
                return null;
            }
            return { source: cached.source, checksum: cached.checksum };
        } catch {
            return null;
        }
    }

    private static async pruneReleaseCache(database: IDBDatabase) {
        try {
            await new Promise<void>((resolve) => {
                const transaction = database.transaction(RELEASE_SCRIPT_STORE, "readwrite");
                const store = transaction.objectStore(RELEASE_SCRIPT_STORE);
                const request = store.getAll();
                request.onsuccess = () => {
                    const cached = (request.result as CachedReleaseScript[]).sort(
                        (left, right) => right.cachedAt - left.cachedAt,
                    );
                    cached
                        .slice(MAX_CACHED_RELEASES)
                        .forEach((release) => store.delete(release.tag));
                };
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => resolve();
                transaction.onabort = () => resolve();
            });
        } catch {
            // The selected release remains cached even when cleanup cannot run.
        }
    }

    private static requestPersistentStorage() {
        if (this.storagePersistenceRequested) return;
        this.storagePersistenceRequested = true;
        void navigator.storage?.persist?.().catch(() => false);
    }

    private static async storeReleaseSource(tag: string, releaseSource: VerifiedReleaseSource) {
        const database = await this.openReleaseDatabase();
        if (!database) return false;
        let stored = false;
        try {
            stored = await new Promise<boolean>((resolve) => {
                const transaction = database.transaction(RELEASE_SCRIPT_STORE, "readwrite");
                const cachedRelease: CachedReleaseScript = {
                    tag,
                    source: releaseSource.source,
                    checksum: releaseSource.checksum,
                    cachedAt: Date.now(),
                };
                transaction.objectStore(RELEASE_SCRIPT_STORE).put(cachedRelease);
                transaction.oncomplete = () => resolve(true);
                transaction.onerror = () => resolve(false);
                transaction.onabort = () => resolve(false);
            });
        } catch {
            stored = false;
        }
        if (!stored) return false;
        await this.pruneReleaseCache(database);
        this.requestPersistentStorage();
        return true;
    }

    private static async deleteCachedReleaseSource(tag: string) {
        const database = await this.openReleaseDatabase();
        if (!database) return;
        try {
            await new Promise<void>((resolve) => {
                const transaction = database.transaction(RELEASE_SCRIPT_STORE, "readwrite");
                transaction.objectStore(RELEASE_SCRIPT_STORE).delete(tag);
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => resolve();
                transaction.onabort = () => resolve();
            });
        } catch {
            // A failed delete is harmless; the network path remains available.
        }
    }

    private static async downloadReleaseSource(tag: string, bypassCache = false) {
        try {
            const cacheMode: RequestCache = bypassCache ? "reload" : "no-cache";
            const [scriptResponse, checksumResponse] = await Promise.all([
                fetchWithTimeout(getReleaseScriptUrl(tag), {
                    cache: cacheMode,
                    headers: { Accept: "application/javascript" },
                }),
                fetchWithTimeout(getReleaseChecksumUrl(tag), {
                    cache: cacheMode,
                    headers: { Accept: "text/plain" },
                }),
            ]);
            if (!scriptResponse.ok) {
                throw new Error(`jsDelivr returned HTTP ${scriptResponse.status}`);
            }
            if (!checksumResponse.ok) {
                throw new Error(`GitHub checksum returned HTTP ${checksumResponse.status}`);
            }
            if (scriptResponse.headers.get("content-type")?.includes("text/html")) {
                throw new Error("The release script response was HTML instead of JavaScript");
            }
            const contentLength = Number(scriptResponse.headers.get("content-length"));
            if (Number.isFinite(contentLength) && contentLength > MAX_RELEASE_SCRIPT_BYTES) {
                throw new Error("The release script is unexpectedly large");
            }

            const [scriptBytes, checksumText] = await Promise.all([
                scriptResponse.arrayBuffer(),
                checksumResponse.text(),
            ]);
            if (!scriptBytes.byteLength || scriptBytes.byteLength > MAX_RELEASE_SCRIPT_BYTES) {
                throw new Error("The release script is empty or unexpectedly large");
            }
            const checksum = checksumText.match(/\b[a-f0-9]{64}\b/i)?.[0]?.toLowerCase();
            if (!checksum) throw new Error("The release checksum is invalid");
            const actualChecksum = await sha256Hex(scriptBytes);
            if (actualChecksum !== checksum) {
                throw new Error("The release script does not match its SHA-256 checksum");
            }
            const source = new TextDecoder("utf-8", { fatal: true }).decode(scriptBytes);
            if (!source.trim()) throw new Error("The release script is empty");
            const verifiedSource: VerifiedReleaseSource = { source, checksum };
            return verifiedSource;
        } catch (error) {
            console.warn(`[Full Screen] Unable to download ${tag}.`, error);
            return null;
        }
    }

    private static executeReleaseSource(selected: SelectedRelease, source: string) {
        const runtimeWindow = window as UpdateRuntimeWindow;
        delete runtimeWindow.__fullScreenExecutedRelease;
        delete runtimeWindow.__fullScreenRuntimeReport;
        const script = document.createElement("script");
        script.dataset.fullScreenRelease = selected.tag;
        script.dataset.fullScreenReleaseSource = "indexeddb";
        script.textContent = `${source}\n;window.__fullScreenExecutedRelease=${JSON.stringify(
            selected.tag,
        )};\n//# sourceURL=${getReleaseScriptUrl(selected.tag)}`;
        let executed = false;
        try {
            (document.head ?? document.documentElement).append(script);
            const reachedEnd = runtimeWindow.__fullScreenExecutedRelease === selected.tag;
            const report = runtimeWindow.__fullScreenRuntimeReport;
            executed = source.includes(RELEASE_RUNTIME_HANDSHAKE)
                ? reachedEnd &&
                  report?.protocol === RELEASE_RUNTIME_HANDSHAKE &&
                  report.version === selected.version
                : reachedEnd;
            if (!executed) {
                console.warn(`[Full Screen] ${selected.tag} failed its runtime version handshake.`);
            }
        } catch (error) {
            console.warn(`[Full Screen] Unable to execute cached ${selected.tag}.`, error);
        } finally {
            script.remove();
            delete runtimeWindow.__fullScreenExecutedRelease;
            delete runtimeWindow.__fullScreenRuntimeReport;
        }
        return executed;
    }

    private static async loadSelectedRelease(selected: SelectedRelease) {
        const cached = await this.readCachedReleaseSource(selected.tag);
        if (cached) {
            if (this.executeReleaseSource(selected, cached.source)) return true;
            await this.deleteCachedReleaseSource(selected.tag);
        }

        const downloaded = await this.downloadReleaseSource(selected.tag, Boolean(cached));
        if (!downloaded) return false;
        const stored = await this.storeReleaseSource(selected.tag, downloaded);
        if (!stored) {
            console.warn(
                `[Full Screen] ${selected.tag} will run, but could not be saved to the local cache.`,
            );
        }
        const executed = this.executeReleaseSource(selected, downloaded.source);
        if (!executed && stored) await this.deleteCachedReleaseSource(selected.tag);
        return executed;
    }

    static async cacheRelease(release: ReleaseInfo) {
        if (!isReleaseInfo(release)) return false;
        if (await this.readCachedReleaseSource(release.tag)) return true;
        const source = await this.downloadReleaseSource(release.tag);
        if (!source) return false;
        if (!(await this.storeReleaseSource(release.tag, source))) {
            console.warn(
                `[Full Screen] ${release.tag} was verified but could not be saved; it will be downloaded again after reload.`,
            );
        }
        return true;
    }

    /**
     * Load only a version the user previously confirmed. Merely detecting a newer
     * release never changes the selected version.
     */
    static async shouldStartBundledVersion(): Promise<boolean> {
        const runtimeWindow = window as UpdateRuntimeWindow;
        runtimeWindow.__fullScreenBundledVersion ??= CURRENT_VERSION;

        const selected = this.getSelectedRelease();
        if (!selected || selected.version === CURRENT_VERSION) return true;

        if (runtimeWindow.__fullScreenLoadingRelease === selected.tag) {
            console.error(
                `[Full Screen] ${selected.tag} did not contain the expected version and will not start.`,
            );
            return false;
        }
        runtimeWindow.__fullScreenLoadingRelease = selected.tag;

        const loaded = await this.loadSelectedRelease(selected);

        if (loaded) return false;

        console.warn(
            `[Full Screen] Unable to load ${selected.tag}; starting bundled v${CURRENT_VERSION}.`,
        );
        const loadFailure: LoadFailure = { version: selected.version, failedAt: Date.now() };
        storageSet(STORAGE_KEYS.loadFailure, JSON.stringify(loadFailure));
        storageRemove(STORAGE_KEYS.selectedRelease);
        delete runtimeWindow.__fullScreenLoadingRelease;
        return true;
    }

    static async check(force = false): Promise<UpdateCheckResult> {
        if (!force && this.checkInFlight) return this.checkInFlight;

        const cachedValue = parseJson<ReleaseCache>(storageGet(STORAGE_KEYS.latestReleaseCache));
        const now = Date.now();
        const cached =
            cachedValue &&
            isUsableCacheTimestamp(cachedValue.checkedAt, now) &&
            (cachedValue.release === null || isReleaseInfo(cachedValue.release))
                ? cachedValue
                : null;
        if (!force && cached && now - cached.checkedAt < RELEASE_CACHE_TTL_MS) {
            return resultForRelease(cached.release);
        }

        const request = (async (): Promise<UpdateCheckResult> => {
            try {
                const response = await fetchWithTimeout(LATEST_RELEASE_API, {
                    cache: force ? "no-store" : "default",
                    headers: { Accept: "application/vnd.github+json" },
                });
                if (response.status === 404) {
                    const emptyCache: ReleaseCache = { checkedAt: Date.now(), release: null };
                    storageSet(STORAGE_KEYS.latestReleaseCache, JSON.stringify(emptyCache));
                    return { status: "current", release: null };
                }
                if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);

                const release = parseRelease((await response.json()) as GitHubRelease);
                if (!release) throw new Error("GitHub returned an unsupported release tag");
                const nextCache: ReleaseCache = { checkedAt: Date.now(), release };
                storageSet(STORAGE_KEYS.latestReleaseCache, JSON.stringify(nextCache));
                return resultForRelease(release);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (cached) return resultForRelease(cached.release, { stale: true, message });
                return {
                    status: "error",
                    message,
                };
            }
        })();

        if (!force) this.checkInFlight = request;
        const result = await request;
        if (!force) this.checkInFlight = null;
        return result;
    }

    static async listStableReleases(force = false): Promise<ReleaseInfo[]> {
        if (!force && this.listInFlight) return this.listInFlight;
        this.releaseListWarning = null;

        const cachedValue = parseJson<ReleaseListCache>(storageGet(STORAGE_KEYS.releaseListCache));
        const now = Date.now();
        const cached =
            cachedValue &&
            isUsableCacheTimestamp(cachedValue.checkedAt, now) &&
            isReleaseList(cachedValue.releases)
                ? cachedValue
                : null;
        if (!force && cached && now - cached.checkedAt < RELEASE_CACHE_TTL_MS) {
            return cached.releases;
        }

        const request = (async () => {
            try {
                const response = await fetchWithTimeout(RELEASE_LIST_API, {
                    cache: force ? "no-store" : "default",
                    headers: { Accept: "application/vnd.github+json" },
                });
                if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
                const releases = sortedUniqueReleases(await response.json());
                if (!releases) throw new Error("GitHub returned an unsupported release list");
                const nextCache: ReleaseListCache = { checkedAt: Date.now(), releases };
                storageSet(STORAGE_KEYS.releaseListCache, JSON.stringify(nextCache));
                return releases;
            } catch (error) {
                if (cached) {
                    this.releaseListWarning =
                        error instanceof Error ? error.message : String(error);
                    return cached.releases;
                }
                throw error;
            }
        })();

        if (!force) this.listInFlight = request;
        try {
            return await request;
        } finally {
            if (!force) this.listInFlight = null;
        }
    }

    static getReleaseListWarning() {
        return this.releaseListWarning;
    }

    private static reload(onReloadFailure: () => void) {
        let unloading = false;
        let fallbackShown = false;
        const showFallback = () => {
            if (fallbackShown) return;
            fallbackShown = true;
            onReloadFailure();
        };
        window.addEventListener(
            "beforeunload",
            () => {
                unloading = true;
            },
            { once: true },
        );
        window.setTimeout(() => {
            if (!unloading) showFallback();
        }, 1800);

        try {
            window.location.reload();
        } catch {
            showFallback();
        }
    }

    static switchToRelease(release: ReleaseInfo, onReloadFailure: () => void) {
        const selected: SelectedRelease = {
            version: release.version,
            tag: release.tag,
            selectionModel: "confirmed-version-v1",
        };
        if (!isReleaseInfo(release) || !isSelectedRelease(selected)) return false;
        if (!storageSet(STORAGE_KEYS.selectedRelease, JSON.stringify(selected))) return false;
        storageRemove(STORAGE_KEYS.releaseListCache);
        this.reload(onReloadFailure);
        return true;
    }

    static switchToBundledVersion(onReloadFailure: () => void) {
        if (!storageRemove(STORAGE_KEYS.selectedRelease)) return false;
        this.reload(onReloadFailure);
        return true;
    }

    static shouldPromptFor(release: ReleaseInfo) {
        const prompted = parseJson<PromptRecord>(storageGet(STORAGE_KEYS.promptedVersion));
        return !(
            prompted?.version === release.version &&
            isUsableCacheTimestamp(prompted.promptedAt) &&
            Date.now() - prompted.promptedAt < UPDATE_PROMPT_SNOOZE_MS
        );
    }

    static markPrompted(release: ReleaseInfo) {
        const prompted: PromptRecord = { version: release.version, promptedAt: Date.now() };
        storageSet(STORAGE_KEYS.promptedVersion, JSON.stringify(prompted));
    }

    static resetPromptedVersion() {
        storageRemove(STORAGE_KEYS.promptedVersion);
    }

    static consumeLoadFailure(): LoadFailure | null {
        const failure = parseJson<LoadFailure>(storageGet(STORAGE_KEYS.loadFailure));
        storageRemove(STORAGE_KEYS.loadFailure);
        return failure && typeof failure.version === "string" ? failure : null;
    }
}
