import packageJson from "../../package.json";

const REPOSITORY = "kasou-sekai/Spotify-Full-Screen-Playing";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASE_LIST_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=50`;
const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RELEASE_LOAD_TIMEOUT_MS = 15000;
const RELEASE_SCRIPT_DB_NAME = "full-screen-release-cache";
const RELEASE_SCRIPT_DB_VERSION = 1;
const RELEASE_SCRIPT_STORE = "scripts";
const MAX_CACHED_RELEASES = 3;
const UPDATE_MODEL_VERSION = "confirm-before-switch-v1";

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
    | { status: "available"; release: ReleaseInfo }
    | { status: "current"; release: ReleaseInfo | null }
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
    cachedAt: number;
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
};

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

function resultForRelease(release: ReleaseInfo | null): UpdateCheckResult {
    if (release && compareVersions(release.version, CURRENT_VERSION) > 0) {
        return { status: "available", release };
    }
    return { status: "current", release };
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

    static migrateUpdateModel() {
        if (localStorage.getItem(STORAGE_KEYS.modelVersion) === UPDATE_MODEL_VERSION) return;
        localStorage.removeItem(STORAGE_KEYS.latestReleaseCache);
        localStorage.removeItem(STORAGE_KEYS.releaseListCache);
        localStorage.removeItem(STORAGE_KEYS.promptedVersion);
        localStorage.setItem(STORAGE_KEYS.modelVersion, UPDATE_MODEL_VERSION);
    }

    static getBundledVersion() {
        return (window as UpdateRuntimeWindow).__fullScreenBundledVersion ?? CURRENT_VERSION;
    }

    static getSelectedRelease(): SelectedRelease | null {
        const selected = parseJson<SelectedRelease>(
            localStorage.getItem(STORAGE_KEYS.selectedRelease),
        );
        if (isSelectedRelease(selected)) {
            const isLegacyDowngrade =
                compareVersions(CURRENT_VERSION, selected.version) > 0 &&
                selected.selectionModel !== "confirmed-version-v1";
            if (!isLegacyDowngrade) return selected;
        }
        if (selected) localStorage.removeItem(STORAGE_KEYS.selectedRelease);
        return null;
    }

    private static openReleaseDatabase() {
        if (this.releaseDbPromise) return this.releaseDbPromise;
        this.releaseDbPromise = new Promise<IDBDatabase | null>((resolve) => {
            if (!("indexedDB" in window)) {
                resolve(null);
                return;
            }
            const request = window.indexedDB.open(
                RELEASE_SCRIPT_DB_NAME,
                RELEASE_SCRIPT_DB_VERSION,
            );
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(RELEASE_SCRIPT_STORE)) {
                    database.createObjectStore(RELEASE_SCRIPT_STORE, { keyPath: "tag" });
                }
            };
            request.onsuccess = () => {
                const database = request.result;
                database.onversionchange = () => {
                    database.close();
                    this.releaseDbPromise = null;
                };
                resolve(database);
            };
            request.onerror = () => {
                console.warn("[Full Screen] Unable to open the local release cache.");
                this.releaseDbPromise = null;
                resolve(null);
            };
            request.onblocked = () => {
                console.warn("[Full Screen] The local release cache is blocked.");
                this.releaseDbPromise = null;
                resolve(null);
            };
        });
        return this.releaseDbPromise;
    }

    private static async readCachedReleaseSource(tag: string) {
        const database = await this.openReleaseDatabase();
        if (!database) return null;
        try {
            return await new Promise<string | null>((resolve) => {
                const request = database
                    .transaction(RELEASE_SCRIPT_STORE, "readonly")
                    .objectStore(RELEASE_SCRIPT_STORE)
                    .get(tag);
                request.onsuccess = () => {
                    const cached = request.result as CachedReleaseScript | undefined;
                    resolve(
                        cached?.tag === tag &&
                            typeof cached.source === "string" &&
                            cached.source.length
                            ? cached.source
                            : null,
                    );
                };
                request.onerror = () => resolve(null);
            });
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

    private static async storeReleaseSource(tag: string, source: string) {
        const database = await this.openReleaseDatabase();
        if (!database) return false;
        let stored = false;
        try {
            stored = await new Promise<boolean>((resolve) => {
                const transaction = database.transaction(RELEASE_SCRIPT_STORE, "readwrite");
                const cachedRelease: CachedReleaseScript = {
                    tag,
                    source,
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

    private static async downloadReleaseSource(tag: string) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), RELEASE_LOAD_TIMEOUT_MS);
        try {
            const response = await fetch(getReleaseScriptUrl(tag), {
                cache: "force-cache",
                headers: { Accept: "application/javascript" },
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`jsDelivr returned HTTP ${response.status}`);
            const source = await response.text();
            return source.trim().length ? source : null;
        } catch (error) {
            console.warn(`[Full Screen] Unable to download ${tag}.`, error);
            return null;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    private static executeReleaseSource(selected: SelectedRelease, source: string) {
        const runtimeWindow = window as UpdateRuntimeWindow;
        delete runtimeWindow.__fullScreenExecutedRelease;
        const script = document.createElement("script");
        script.dataset.fullScreenRelease = selected.tag;
        script.dataset.fullScreenReleaseSource = "indexeddb";
        script.textContent = `${source}\n;window.__fullScreenExecutedRelease=${JSON.stringify(
            selected.tag,
        )};\n//# sourceURL=${getReleaseScriptUrl(selected.tag)}`;
        let executed = false;
        try {
            (document.head ?? document.documentElement).append(script);
            executed = runtimeWindow.__fullScreenExecutedRelease === selected.tag;
        } catch (error) {
            console.warn(`[Full Screen] Unable to execute cached ${selected.tag}.`, error);
        } finally {
            script.remove();
            delete runtimeWindow.__fullScreenExecutedRelease;
        }
        return executed;
    }

    private static async loadSelectedRelease(selected: SelectedRelease) {
        const cached = await this.readCachedReleaseSource(selected.tag);
        if (cached) {
            if (this.executeReleaseSource(selected, cached)) return true;
            await this.deleteCachedReleaseSource(selected.tag);
        }

        const downloaded = await this.downloadReleaseSource(selected.tag);
        if (!downloaded) return false;
        const stored = await this.storeReleaseSource(selected.tag, downloaded);
        if (!stored) {
            console.warn(
                `[Full Screen] ${selected.tag} will run, but could not be saved to the local cache.`,
            );
        }
        return this.executeReleaseSource(selected, downloaded);
    }

    static async cacheRelease(release: ReleaseInfo) {
        if (!isReleaseInfo(release)) return false;
        if (await this.readCachedReleaseSource(release.tag)) return true;
        const source = await this.downloadReleaseSource(release.tag);
        return Boolean(source && (await this.storeReleaseSource(release.tag, source)));
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
                `[Full Screen] ${selected.tag} did not contain the expected version. Falling back to the bundled version.`,
            );
            localStorage.removeItem(STORAGE_KEYS.selectedRelease);
            return true;
        }
        runtimeWindow.__fullScreenLoadingRelease = selected.tag;

        const loaded = await this.loadSelectedRelease(selected);

        if (loaded) return false;

        console.warn(
            `[Full Screen] Unable to load ${selected.tag}; starting bundled v${CURRENT_VERSION}.`,
        );
        const loadFailure: LoadFailure = { version: selected.version, failedAt: Date.now() };
        localStorage.setItem(STORAGE_KEYS.loadFailure, JSON.stringify(loadFailure));
        localStorage.removeItem(STORAGE_KEYS.selectedRelease);
        delete runtimeWindow.__fullScreenLoadingRelease;
        return true;
    }

    static async check(force = false): Promise<UpdateCheckResult> {
        if (!force && this.checkInFlight) return this.checkInFlight;

        const cachedValue = parseJson<ReleaseCache>(
            localStorage.getItem(STORAGE_KEYS.latestReleaseCache),
        );
        const cached =
            cachedValue &&
            Number.isFinite(cachedValue.checkedAt) &&
            (cachedValue.release === null || isReleaseInfo(cachedValue.release))
                ? cachedValue
                : null;
        if (!force && cached && Date.now() - cached.checkedAt < RELEASE_CACHE_TTL_MS) {
            return resultForRelease(cached.release);
        }

        const request = (async (): Promise<UpdateCheckResult> => {
            try {
                const response = await fetch(LATEST_RELEASE_API, {
                    headers: { Accept: "application/vnd.github+json" },
                });
                if (response.status === 404) {
                    const emptyCache: ReleaseCache = { checkedAt: Date.now(), release: null };
                    localStorage.setItem(
                        STORAGE_KEYS.latestReleaseCache,
                        JSON.stringify(emptyCache),
                    );
                    return { status: "current", release: null };
                }
                if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);

                const release = parseRelease((await response.json()) as GitHubRelease);
                if (!release) throw new Error("GitHub returned an unsupported release tag");
                const nextCache: ReleaseCache = { checkedAt: Date.now(), release };
                localStorage.setItem(STORAGE_KEYS.latestReleaseCache, JSON.stringify(nextCache));
                return resultForRelease(release);
            } catch (error) {
                if (cached) return resultForRelease(cached.release);
                return {
                    status: "error",
                    message: error instanceof Error ? error.message : String(error),
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

        const cachedValue = parseJson<ReleaseListCache>(
            localStorage.getItem(STORAGE_KEYS.releaseListCache),
        );
        const cached =
            cachedValue &&
            Number.isFinite(cachedValue.checkedAt) &&
            isReleaseList(cachedValue.releases)
                ? cachedValue
                : null;
        if (!force && cached && Date.now() - cached.checkedAt < RELEASE_CACHE_TTL_MS) {
            return cached.releases;
        }

        const request = (async () => {
            try {
                const response = await fetch(RELEASE_LIST_API, {
                    headers: { Accept: "application/vnd.github+json" },
                });
                if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
                const releases = sortedUniqueReleases(await response.json());
                if (!releases) throw new Error("GitHub returned an unsupported release list");
                const nextCache: ReleaseListCache = { checkedAt: Date.now(), releases };
                localStorage.setItem(STORAGE_KEYS.releaseListCache, JSON.stringify(nextCache));
                return releases;
            } catch (error) {
                if (cached) return cached.releases;
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
        localStorage.setItem(STORAGE_KEYS.selectedRelease, JSON.stringify(selected));
        localStorage.removeItem(STORAGE_KEYS.releaseListCache);
        this.reload(onReloadFailure);
        return true;
    }

    static switchToBundledVersion(onReloadFailure: () => void) {
        localStorage.removeItem(STORAGE_KEYS.selectedRelease);
        this.reload(onReloadFailure);
    }

    static shouldPromptFor(release: ReleaseInfo) {
        return localStorage.getItem(STORAGE_KEYS.promptedVersion) !== release.version;
    }

    static markPrompted(release: ReleaseInfo) {
        localStorage.setItem(STORAGE_KEYS.promptedVersion, release.version);
    }

    static resetPromptedVersion() {
        localStorage.removeItem(STORAGE_KEYS.promptedVersion);
    }

    static consumeLoadFailure(): LoadFailure | null {
        const failure = parseJson<LoadFailure>(localStorage.getItem(STORAGE_KEYS.loadFailure));
        localStorage.removeItem(STORAGE_KEYS.loadFailure);
        return failure && typeof failure.version === "string" ? failure : null;
    }
}
