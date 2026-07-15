import packageJson from "../../package.json";

const REPOSITORY = "kasou-sekai/Spotify-Full-Screen-Playing";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASE_LIST_API = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=50`;
const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const RELEASE_LOAD_TIMEOUT_MS = 15000;
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

        const loaded = await new Promise<boolean>((resolve) => {
            const script = document.createElement("script");
            const timeout = window.setTimeout(() => {
                script.remove();
                resolve(false);
            }, RELEASE_LOAD_TIMEOUT_MS);
            script.async = true;
            script.crossOrigin = "anonymous";
            script.dataset.fullScreenRelease = selected.tag;
            script.src = getReleaseScriptUrl(selected.tag);
            script.onload = () => {
                window.clearTimeout(timeout);
                resolve(true);
            };
            script.onerror = () => {
                window.clearTimeout(timeout);
                script.remove();
                resolve(false);
            };
            (document.head ?? document.documentElement).append(script);
        });

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
