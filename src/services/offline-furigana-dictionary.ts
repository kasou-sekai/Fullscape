import type { FuriganaAnnotation, FuriganaRenderData } from "../utils/furigana";

export const OFFLINE_FURIGANA_DICTIONARY_URL =
    "https://github.com/Doublevil/JmdictFurigana/releases/latest/download/JmdictFurigana.txt";
export const OFFLINE_FURIGANA_DICTIONARY_SIZE = "12 MB";

const DATABASE_NAME = "fullscape-furigana-dictionary";
const DATABASE_VERSION = 1;
const STORE_NAME = "packages";
const PACKAGE_KEY = "jmdict-furigana";
const KANJI_PATTERN = /[\p{Script=Han}々〆ヶ]/u;

type DictionaryEntry = {
    annotations: FuriganaAnnotation[];
};

type DictionaryRecord = {
    key: string;
    text: string;
    downloadedAt: number;
};

type DictionaryIndex = Map<string, DictionaryEntry[]>;

const maximumSurfaceLengths = new WeakMap<DictionaryIndex, number>();

let dictionaryIndex: DictionaryIndex | null = null;
let dictionaryDownloadedAt: number | null = null;
let dictionaryLoad: Promise<DictionaryIndex | null> | null = null;
let dictionaryDownload: Promise<void> | null = null;

export type OfflineFuriganaDictionaryStatus = {
    available: boolean;
    downloadedAt: number | null;
};

export function parseOfflineFuriganaDictionary(text: string): DictionaryIndex {
    const index: DictionaryIndex = new Map();
    let maximumSurfaceLength = 0;
    text.split(/\r?\n/u).forEach((rawLine) => {
        const line = rawLine.replace(/^\uFEFF/u, "");
        const firstSeparator = line.indexOf("|");
        const secondSeparator = line.indexOf("|", firstSeparator + 1);
        if (firstSeparator <= 0 || secondSeparator <= firstSeparator) return;

        const surface = line.slice(0, firstSeparator);
        if (!KANJI_PATTERN.test(surface)) return;
        const specification = line.slice(secondSeparator + 1);
        const annotations = parseFuriganaSpecification(surface, specification);
        if (!annotations.length) return;

        const entries = index.get(surface) ?? [];
        const duplicate = entries.some(
            (entry) => JSON.stringify(entry.annotations) === JSON.stringify(annotations),
        );
        if (!duplicate) entries.push({ annotations });
        index.set(surface, entries);
        maximumSurfaceLength = Math.max(maximumSurfaceLength, Array.from(surface).length);
    });
    maximumSurfaceLengths.set(index, maximumSurfaceLength);
    return index;
}

export function renderOfflineFurigana(
    lines: string[],
    index: DictionaryIndex,
): FuriganaRenderData[] {
    return lines.map((text) => renderOfflineLine(text, index));
}

export async function getOfflineFuriganaDictionaryStatus(): Promise<OfflineFuriganaDictionaryStatus> {
    if (dictionaryIndex) {
        return { available: true, downloadedAt: dictionaryDownloadedAt };
    }
    const record = await readDictionaryRecord();
    if (record) dictionaryDownloadedAt = record.downloadedAt;
    return {
        available: Boolean(record),
        downloadedAt: record?.downloadedAt ?? null,
    };
}

export async function downloadOfflineFuriganaDictionary(): Promise<void> {
    if (dictionaryDownload) return dictionaryDownload;

    dictionaryDownload = (async () => {
        const text = await downloadDictionaryText();
        const index = parseOfflineFuriganaDictionary(text);
        if (!index.size) throw new Error("Downloaded dictionary is empty");

        const downloadedAt = Date.now();
        await writeDictionaryRecord({
            key: PACKAGE_KEY,
            text,
            downloadedAt,
        });
        dictionaryIndex = index;
        dictionaryDownloadedAt = downloadedAt;
    })();

    try {
        await dictionaryDownload;
    } finally {
        dictionaryDownload = null;
    }
}

async function downloadDictionaryText(): Promise<string> {
    try {
        const response = await fetch(OFFLINE_FURIGANA_DICTIONARY_URL);
        if (!response.ok) throw new Error(`Dictionary download failed: ${response.status}`);
        return await response.text();
    } catch (directError) {
        try {
            const proxyTemplate =
                localStorage.getItem("spicetify:corsProxyTemplate") ??
                "https://cors-proxy.spicetify.app/{url}";
            const proxyUrl = proxyTemplate.replace(
                /\{url\}/u,
                new URL(OFFLINE_FURIGANA_DICTIONARY_URL).toString(),
            );
            const proxyResponse = await fetch(proxyUrl);
            if (proxyResponse.ok) return await proxyResponse.text();
        } catch {
            // Try Spicetify's desktop transport below.
        }
        try {
            if (typeof Spicetify === "undefined" || !Spicetify.CosmosAsync?.get) {
                throw directError;
            }
            const response = await withTimeout(
                Spicetify.CosmosAsync.get(OFFLINE_FURIGANA_DICTIONARY_URL, {}, {}),
                45000,
            );
            if (typeof response !== "string") throw new Error("Dictionary response is not text");
            return response;
        } catch {
            throw directError;
        }
    }
}

export async function deleteOfflineFuriganaDictionary(): Promise<void> {
    dictionaryIndex = null;
    dictionaryDownloadedAt = null;
    dictionaryLoad = null;
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(PACKAGE_KEY);
        transaction.oncomplete = () => {
            database.close();
            resolve();
        };
        transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error("Dictionary deletion failed"));
        };
        transaction.onabort = () => {
            database.close();
            reject(transaction.error ?? new Error("Dictionary deletion aborted"));
        };
    });
}

export async function getOfflineFurigana(lines: string[]): Promise<FuriganaRenderData[] | null> {
    const index = await loadDictionaryIndex();
    return index ? renderOfflineFurigana(lines, index) : null;
}

function parseFuriganaSpecification(surface: string, specification: string) {
    const characters = Array.from(surface);
    const offsets = [0];
    characters.forEach((character) => offsets.push(offsets[offsets.length - 1] + character.length));

    return specification.split(";").flatMap((part) => {
        const separator = part.indexOf(":");
        if (separator <= 0) return [];
        const range = part.slice(0, separator).split("-");
        const start = Number(range[0]);
        const end = Number(range[1] ?? range[0]);
        const reading = part.slice(separator + 1);
        if (
            !Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 0 ||
            end < start ||
            end >= characters.length ||
            !reading ||
            !KANJI_PATTERN.test(characters.slice(start, end + 1).join(""))
        ) {
            return [];
        }
        const annotation: FuriganaAnnotation = {
            start: offsets[start],
            end: offsets[end + 1],
            reading,
        };
        return [annotation];
    });
}

function renderOfflineLine(text: string, index: DictionaryIndex): FuriganaRenderData {
    const characters = Array.from(text);
    const maximumSurfaceLength = maximumSurfaceLengths.get(index) ?? characters.length;
    const offsets = [0];
    characters.forEach((character) => offsets.push(offsets[offsets.length - 1] + character.length));
    const annotations: FuriganaAnnotation[] = [];

    let characterIndex = 0;
    while (characterIndex < characters.length) {
        let bestEntry: DictionaryEntry | null = null;
        let bestEnd = characterIndex + 1;

        const maximumEnd = Math.min(characters.length, characterIndex + maximumSurfaceLength);
        for (let end = maximumEnd; end > characterIndex; end -= 1) {
            const surface = characters.slice(characterIndex, end).join("");
            const entry = selectBestEntry(index.get(surface));
            if (!entry) continue;
            bestEntry = entry;
            bestEnd = end;
            break;
        }

        if (!bestEntry) {
            characterIndex += 1;
            continue;
        }

        bestEntry.annotations.forEach((annotation) => {
            annotations.push({
                start: offsets[characterIndex] + annotation.start,
                end: offsets[characterIndex] + annotation.end,
                reading: annotation.reading,
            });
        });
        characterIndex = bestEnd;
    }

    return { text, annotations };
}

function selectBestEntry(entries?: DictionaryEntry[]) {
    if (!entries?.length) return null;
    return entries.reduce((best, entry) =>
        annotationCoverage(entry.annotations) > annotationCoverage(best.annotations) ? entry : best,
    );
}

function annotationCoverage(annotations: FuriganaAnnotation[]) {
    return annotations.reduce(
        (coverage, annotation) => coverage + annotation.end - annotation.start,
        0,
    );
}

async function loadDictionaryIndex(): Promise<DictionaryIndex | null> {
    if (dictionaryIndex) return dictionaryIndex;
    if (!dictionaryLoad) {
        dictionaryLoad = readDictionaryRecord()
            .then((record) => {
                dictionaryIndex = record ? parseOfflineFuriganaDictionary(record.text) : null;
                dictionaryDownloadedAt = record?.downloadedAt ?? null;
                return dictionaryIndex;
            })
            .catch(() => null)
            .finally(() => {
                dictionaryLoad = null;
            });
    }
    return dictionaryLoad;
}

async function readDictionaryRecord(): Promise<DictionaryRecord | null> {
    try {
        const database = await openDatabase();
        return await new Promise<DictionaryRecord | null>((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, "readonly");
            const request = transaction.objectStore(STORE_NAME).get(PACKAGE_KEY);
            request.onsuccess = () => {
                const value = request.result as DictionaryRecord | undefined;
                resolve(
                    value?.key === PACKAGE_KEY && typeof value.text === "string" ? value : null,
                );
            };
            request.onerror = () => {
                reject(request.error ?? new Error("Dictionary read failed"));
            };
            transaction.oncomplete = () => database.close();
            transaction.onerror = () => {
                database.close();
                reject(transaction.error ?? new Error("Dictionary read failed"));
            };
            transaction.onabort = () => {
                database.close();
                reject(transaction.error ?? new Error("Dictionary read aborted"));
            };
        });
    } catch {
        return null;
    }
}

async function writeDictionaryRecord(record: DictionaryRecord) {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put(record);
        transaction.oncomplete = () => {
            database.close();
            resolve();
        };
        transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error("Dictionary write failed"));
        };
        transaction.onabort = () => {
            database.close();
            reject(transaction.error ?? new Error("Dictionary write aborted"));
        };
    });
}

function openDatabase(): Promise<IDBDatabase> {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
        return Promise.reject(new Error("IndexedDB is unavailable"));
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (database: IDBDatabase | null, error?: unknown) => {
            if (settled) {
                database?.close();
                return;
            }
            settled = true;
            window.clearTimeout(timeout);
            if (database) resolve(database);
            else reject(error ?? new Error("Dictionary database failed"));
        };
        const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
            }
        };
        const timeout = window.setTimeout(
            () => finish(null, new Error("Dictionary database open timed out")),
            5000,
        );
        request.onsuccess = () => finish(request.result);
        request.onerror = () => finish(null, request.error);
        request.onblocked = () => {
            // Let the timeout handle a connection that is blocked by an old tab.
        };
    });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(
            () => reject(new Error("dictionary download timed out")),
            timeoutMs,
        );
        promise.then(
            (value) => {
                clearTimeout(timeoutId);
                resolve(value);
            },
            (error) => {
                clearTimeout(timeoutId);
                reject(error);
            },
        );
    });
}
