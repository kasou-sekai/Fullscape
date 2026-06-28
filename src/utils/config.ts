import { Config, Settings } from "../types/fullscreen";
import { DEFAULTS } from "../constants";

let CONFIG: Config | null = null;
let ACTIVE: "tv" | "def" | null = null;

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
        const parsed: unknown = JSON.parse(localStorage.getItem("full-screen-config") ?? "{}");
        const config = mergeKnownValues(parsed, defaultConfig);
        saveConfig(config);
        return config;
    } catch {
        const config = cloneDefaults();
        saveConfig(config);
        return config;
    }
}

function saveConfig(CONFIG: Config) {
    localStorage.setItem("full-screen-config", JSON.stringify(CONFIG));
}

function resetModeSetting<K extends keyof Settings>(config: Config, mode: "tv" | "def", key: K) {
    config[mode][key] = DEFAULTS[mode][key];
}

const ConfigManager = {
    get(key: keyof Settings) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        if (ACTIVE === null) {
            ACTIVE = CONFIG.tvMode ? "tv" : "def";
        }
        return CONFIG[ACTIVE][key];
    },
    set<K extends keyof Settings>(key: K, value: Settings[K]) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        if (ACTIVE === null) {
            ACTIVE = CONFIG.tvMode ? "tv" : "def";
        }
        CONFIG[ACTIVE][key] = value;
        saveConfig(CONFIG);
        document.dispatchEvent(new CustomEvent(key, { detail: value }));
    },
    getGlobal(key: keyof Config) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        if (ACTIVE === null) {
            ACTIVE = CONFIG.tvMode ? "tv" : "def";
        }
        return CONFIG[key];
    },
    setGlobal<K extends keyof Config>(key: K, value: Config[K]) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        if (ACTIVE === null) {
            ACTIVE = CONFIG.tvMode ? "tv" : "def";
        }
        CONFIG[key] = value;
        saveConfig(CONFIG);
        document.dispatchEvent(new CustomEvent(key, { detail: value }));
    },
    getMode() {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        if (ACTIVE === null) {
            ACTIVE = CONFIG.tvMode ? "tv" : "def";
        }
        return ACTIVE;
    },
    setMode(modeValue: "tv" | "def") {
        ACTIVE = modeValue;
    },
    resetSettings(key: keyof Settings | null = null, isGlobal = false) {
        if (CONFIG === null) {
            CONFIG = getConfig(DEFAULTS);
        }
        if (isGlobal) {
            CONFIG = cloneDefaults();
        } else {
            if (ACTIVE === null) {
                ACTIVE = CONFIG.tvMode ? "tv" : "def";
            }
            if (key === null) {
                CONFIG[ACTIVE] = mergeKnownValues(undefined, DEFAULTS[ACTIVE]);
            } else {
                resetModeSetting(CONFIG, ACTIVE, key);
            }
        }
        saveConfig(CONFIG);
    },
};

export default ConfigManager;
