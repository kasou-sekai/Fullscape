import { Config, Settings } from "../types/fullscreen";
import { DEFAULTS } from "../constants";

let CONFIG: Config | null = null;
const STORAGE_KEY = "full-screen-playing:config";
const LEGACY_STORAGE_KEY = "full-screen-config";

function cloneDefaults(): Config {
    return JSON.parse(JSON.stringify(DEFAULTS)) as Config;
}

function mergeKnownValues<T>(stored: unknown, defaults: T): T {
    if (typeof defaults === "number") {
        return (typeof stored === "number" && Number.isFinite(stored) ? stored : defaults) as T;
    }
    if (typeof defaults !== "object" || defaults === null) {
        return (typeof stored === typeof defaults ? stored : defaults) as T;
    }

    const source =
        stored && typeof stored === "object" && !Array.isArray(stored)
            ? (stored as Record<string, unknown>)
            : {};
    const result: Record<string, unknown> = {};
    Object.entries(defaults as Record<string, unknown>).forEach(([key, defaultValue]) => {
        result[key] = mergeKnownValues(source[key], defaultValue);
    });
    return result as T;
}

function getConfig(defaultConfig: Config): Config {
    try {
        const storedConfig = localStorage.getItem(STORAGE_KEY);
        const legacyConfig = localStorage.getItem(LEGACY_STORAGE_KEY);
        const parsed: unknown = JSON.parse(storedConfig ?? legacyConfig ?? "{}");
        const config = mergeKnownValues(parsed, defaultConfig);
        if (config.autoLaunch !== "never" && config.autoLaunch !== "default") {
            config.autoLaunch = "default";
        }
        saveConfig(config);
        if (legacyConfig !== null) localStorage.removeItem(LEGACY_STORAGE_KEY);
        return config;
    } catch {
        const config = cloneDefaults();
        saveConfig(config);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        return config;
    }
}

function saveConfig(CONFIG: Config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(CONFIG));
}

function resetSetting<K extends keyof Settings>(config: Config, key: K) {
    config.def[key] = DEFAULTS.def[key];
}

const ConfigManager = {
    get(key: keyof Settings) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        return CONFIG.def[key];
    },
    set<K extends keyof Settings>(key: K, value: Settings[K]) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        CONFIG.def[key] = value;
        saveConfig(CONFIG);
        document.dispatchEvent(new CustomEvent(key, { detail: value }));
    },
    getGlobal(key: keyof Config) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        return CONFIG[key];
    },
    setGlobal<K extends keyof Config>(key: K, value: Config[K]) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        CONFIG[key] = value;
        saveConfig(CONFIG);
        document.dispatchEvent(new CustomEvent(key, { detail: value }));
    },
    resetSettings(key: keyof Settings | null = null, isGlobal = false) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        if (isGlobal) {
            CONFIG = cloneDefaults();
        } else {
            if (key === null) {
                CONFIG.def = mergeKnownValues(undefined, DEFAULTS.def);
            } else {
                resetSetting(CONFIG, key);
            }
        }
        saveConfig(CONFIG);
    },
};

export default ConfigManager;
