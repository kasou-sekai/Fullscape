import { Config, Settings } from "../types/fullscape";
import { DEFAULTS } from "../constants";

let CONFIG: Config | null = null;
const STORAGE_KEY = "fullscape:config";

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
        const parsed: unknown = JSON.parse(storedConfig ?? "{}");
        const config = mergeKnownValues(parsed, defaultConfig);
        if (config.autoLaunch !== "never" && config.autoLaunch !== "default") {
            config.autoLaunch = "default";
        }
        if (config.def.displayTheme !== "focus") config.def.displayTheme = "default";
        if (config.def.focusFormat !== "cd") config.def.focusFormat = "vinyl";
        saveConfig(config);
        return config;
    } catch {
        const config = cloneDefaults();
        saveConfig(config);
        return config;
    }
}

function saveConfig(config: Config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function currentConfig() {
    return (CONFIG ??= getConfig(DEFAULTS));
}

function saveChange(config: Config, key: string, value: unknown) {
    saveConfig(config);
    document.dispatchEvent(new CustomEvent(key, { detail: value }));
}

const ConfigManager = {
    get<K extends keyof Settings>(key: K): Settings[K] {
        return currentConfig().def[key];
    },
    set<K extends keyof Settings>(key: K, value: Settings[K]) {
        const config = currentConfig();
        config.def[key] = value;
        saveChange(config, key, value);
    },
    getGlobal<K extends keyof Config>(key: K): Config[K] {
        return currentConfig()[key];
    },
    setGlobal<K extends keyof Config>(key: K, value: Config[K]) {
        const config = currentConfig();
        config[key] = value;
        saveChange(config, key, value);
    },
    resetSettings<K extends keyof Settings>(key: K | null = null, isGlobal = false) {
        const config = currentConfig();
        if (isGlobal) {
            CONFIG = cloneDefaults();
            saveConfig(CONFIG);
        } else {
            if (key === null) {
                config.def = mergeKnownValues(undefined, DEFAULTS.def);
            } else {
                config.def[key] = mergeKnownValues(undefined, DEFAULTS.def[key]);
            }
            saveConfig(config);
        }
    },
};

export default ConfigManager;
