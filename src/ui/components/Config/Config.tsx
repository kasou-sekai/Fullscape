import { hexToRgb } from "../../../utils/color-values";
import CFM from "../../../utils/config";
import translations, { languageNames } from "../../../resources/strings";
import { DEFAULTS } from "../../../constants";
import { Config, Settings } from "../../../types/fullscape";
import Utils from "../../../utils/utils";
import { DOM } from "../../elements";
import { headerText, getSettingCard, createAdjust, createToggleControl } from "../../../utils/setting";
import { getTypography, typographyWeights } from "../../../utils/typography";
import {
    getLyricFontSize,
    MAX_LYRIC_FONT_SIZE,
    MIN_LYRIC_FONT_SIZE,
} from "../../../utils/lyric-font-size";
import { MAX_BACKGROUND_TRANSITION_SECONDS } from "../../../utils/motion";
import WebAPI from "../../../services/web-api";
import { createUpdateSettings, promptForUpdate } from "./update-settings";
import { createLyricsDebugSettings, createOfflineFuriganaDictionaryCard } from "./lyrics-settings";

export class ConfigManager {
    static configContainer: HTMLDivElement;
    static overlayTimout: ReturnType<typeof setTimeout>;
    static render: () => void;
    static activate: () => Promise<void>;
    static deactivate: () => Promise<void>;
    static updateBackground: (
        meta?: Partial<Record<string, unknown>>,
        fromResize?: boolean,
    ) => Promise<void>;
    static updateUpNextShow: () => void;

    static init(
        render: () => void,
        activate: () => Promise<void>,
        deactivate: () => Promise<void>,
        updateBackground: (
            meta?: Partial<Record<string, unknown>>,
            fromResize?: boolean,
        ) => Promise<void>,
        updateUpNextShow: () => void,
    ) {
        this.render = render;
        this.activate = activate;
        this.deactivate = deactivate;
        this.updateBackground = updateBackground;
        this.updateUpNextShow = updateUpNextShow;
    }

    static saveOption(key: keyof Settings, value: unknown) {
        CFM.set(key, value as never);
        this.render();
        if (Utils.isModeActivated()) this.activate();
    }

    static saveGlobalOption(key: keyof Config, value: Config[keyof Config]) {
        CFM.setGlobal(key, value);
        this.render();
        if (Utils.isModeActivated()) this.activate();
    }

    static getSettingsFooter(LOCALE: string) {
        const container = document.createElement("div");
        container.innerHTML = `
        <div class="setting-button-row settings-footer">
          <button class="main-buttons-button main-button-secondary" id="reset-switch">${translations[LOCALE].settings.configReset}</button>
        </div>`;
        const resetButton = container.querySelector<HTMLElement>("#reset-switch");
        if (resetButton)
            resetButton.onclick = () => {
                if (Utils.isModeActivated()) {
                    CFM.resetSettings();
                    this.render();
                    this.activate();
                    this.configContainer = document.createElement("div");
                    setTimeout(() => this.openConfig(), 5);
                } else {
                    CFM.resetSettings(null, true);
                    location.reload();
                }
            };
        return container;
    }

    private static createSettingsSection(
        title: string,
        description = "",
        ...items: Array<Node | string>
    ) {
        const section = document.createElement("section");
        section.classList.add("settings-section");
        section.append(headerText(title, description));

        const grid = document.createElement("div");
        grid.classList.add("settings-section-grid");
        items.forEach((item) => {
            if (item !== "") grid.append(item);
        });
        section.append(grid);
        return section;
    }

    private static createSettingsGroup(
        title: string,
        description = "",
        ...items: Array<Node | string>
    ) {
        const group = document.createElement("section");
        group.classList.add("settings-group");
        group.append(headerText(title, description));

        const grid = document.createElement("div");
        grid.classList.add("settings-group-grid");
        items.forEach((item) => {
            if (item !== "") grid.append(item);
        });
        group.append(grid);
        return group;
    }

    private static getAccentContrast(hexColor: string) {
        const rgb = hexToRgb(hexColor)?.split(",").map(Number);
        if (!rgb || rgb.length !== 3) return "#ffffff";
        const [red, green, blue] = rgb.map((channel) => {
            const value = channel / 255;
            return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        return luminance > 0.42 ? "#101318" : "#ffffff";
    }

    private static async applyAlbumAccent() {
        const imageUrl = Spicetify.Player.data.item?.metadata?.image_xlarge_url;
        if (!imageUrl) return;
        const colors = await WebAPI.colorExtractor(imageUrl).catch((error) => {
            console.warn("Unable to match settings buttons to the album artwork:", error);
            return undefined;
        });
        if (!colors || !this.configContainer.isConnected) return;
        const accent = colors.VIBRANT ?? colors.DARK_VIBRANT;
        if (!accent) return;
        this.configContainer.style.setProperty("--theme-color", accent);
        this.configContainer.style.setProperty(
            "--theme-contrast-color",
            this.getAccentContrast(accent),
        );
    }

    private static createSettingsShell(
        sections: Array<{ id: string; title: string; section: HTMLElement }>,
    ) {
        const shell = document.createElement("div");
        shell.classList.add("settings-shell");

        const navigation = document.createElement("nav");
        navigation.classList.add("settings-nav");
        navigation.setAttribute("aria-label", "Settings sections");

        const content = document.createElement("div");
        content.classList.add("settings-content");

        const activateSection = (id: string) => {
            navigation
                .querySelectorAll<HTMLButtonElement>(".settings-nav-button")
                .forEach((tab) => {
                    const active = tab.dataset.sectionId === id;
                    tab.classList.toggle("active", active);
                    tab.setAttribute("aria-selected", String(active));
                });
            content.querySelectorAll<HTMLElement>(".settings-panel").forEach((panel) => {
                panel.hidden = panel.dataset.sectionId !== id;
            });
        };

        sections.forEach(({ id, title, section }, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.classList.add("settings-nav-button");
            button.classList.toggle("active", index === 0);
            button.dataset.sectionId = id;
            button.textContent = title;
            button.setAttribute("aria-selected", String(index === 0));
            button.onclick = () => activateSection(id);
            navigation.append(button);

            section.classList.add("settings-panel");
            section.dataset.sectionId = id;
            section.hidden = index !== 0;
            content.append(section);
        });

        shell.append(navigation, content);
        return shell;
    }

    static createOptions(
        title: string,
        options: Record<string, string>,
        configValue: string | number,
        key: keyof Settings | keyof Config,
        callback: (val: string) => void,
        description = "",
    ) {
        const settingCard = getSettingCard(
            `<select>
                ${Object.keys(options)
                    .map((item) => `<option value="${item}" dir="auto">${options[item]}</option>`)
                    .join("\n")}
            </select>`,
            title,
            key,
            description,
        );

        const select = settingCard.querySelector<HTMLSelectElement>("select");
        if (!select) return settingCard;
        if (!(configValue in options)) {
            if (key in DEFAULTS.def) {
                configValue = DEFAULTS.def[key as keyof Settings] as string;
                this.saveOption(key as keyof Settings, configValue);
            } else if (key in DEFAULTS) {
                configValue = DEFAULTS[key as keyof Config] as string | number;
                this.saveGlobalOption(key as keyof Config, configValue as Config[keyof Config]);
            }
        }
        select.value = configValue.toString();
        select.onchange = (e) => {
            callback((e?.target as HTMLInputElement).value);
        };
        return settingCard;
    }

    static createToggle(
        title: string,
        key: keyof Settings | keyof Config,
        callback = (value: boolean) => this.saveOption(key as keyof Settings, value),
        description = "",
    ) {
        const checked = key in DEFAULTS
            ? Boolean(CFM.getGlobal(key as keyof Config))
            : Boolean(CFM.get(key as keyof Settings));
        return createToggleControl(title, key, checked, callback, description);
    }

    private static createTypographySetting(locale: string) {
        const strings = translations[locale].settings.typography;
        const settings = getTypography(CFM.get("typography"));
        const card = getSettingCard(
            `<div class="typography-controls">
                <select class="typography-preset"></select>
                <div class="gen-input typography-family" hidden>
                    <input type="text" maxlength="120" placeholder="Georgia" spellcheck="false">
                </div>
                <select class="typography-weight"></select>
            </div>`,
            strings.setting,
            "typography",
            strings.description,
        );
        const preset = card.querySelector<HTMLSelectElement>(".typography-preset");
        const familyField = card.querySelector<HTMLElement>(".typography-family");
        const family = familyField?.querySelector<HTMLInputElement>("input");
        const weight = card.querySelector<HTMLSelectElement>(".typography-weight");
        if (!preset || !familyField || !family || !weight) return card;
        preset.setAttribute("aria-label", strings.preset);
        family.setAttribute("aria-label", strings.family);
        weight.setAttribute("aria-label", strings.weight);
        preset.add(new Option(strings.default, "default"));
        preset.add(new Option(strings.serif, "serif"));
        preset.add(new Option(strings.custom, "custom"));
        typographyWeights.forEach((value) => {
            weight.add(
                new Option(
                    value ? `${strings.weight} ${value}` : strings.defaultWeight,
                    String(value),
                ),
            );
        });
        preset.value = settings.preset;
        family.value = settings.family;
        weight.value = String(settings.weight);
        familyField.hidden = settings.preset !== "custom";

        const save = () => {
            familyField.hidden = preset.value !== "custom";
            const next = getTypography({
                preset: preset.value as Settings["typography"]["preset"],
                family: family.value,
                weight: Number(weight.value),
            });
            family.value = next.family;
            CFM.set("typography", next);
        };
        preset.onchange = family.onchange = weight.onchange = save;
        family.onkeydown = (event) => {
            if (event.key === "Enter") family.blur();
        };
        return card;
    }

    private static createBeatSettings(LOCALE: string) {
        const strings = translations[LOCALE].settings.beatControls;
        const section = document.createElement("section");
        section.classList.add("fullscape-beat-settings", "settings-nested-section");
        section.hidden = CFM.get("beatResponsePreset") !== "custom";
        section.append(
            headerText(strings.header, strings.description),
            createAdjust(
                strings.scale.setting,
                "beatScaleAmount",
                "%",
                Number(CFM.get("beatScaleAmount")) * 100,
                1,
                0,
                40,
                (value) => CFM.set("beatScaleAmount", Number(value) / 100),
                strings.scale.description,
            ),
            createAdjust(
                strings.warp.setting,
                "beatWarpAmount",
                "%",
                Number(CFM.get("beatWarpAmount")) * 100,
                1,
                0,
                18,
                (value) => CFM.set("beatWarpAmount", Number(value) / 100),
                strings.warp.description,
            ),
            createAdjust(
                strings.saturation.setting,
                "beatSaturationAmount",
                "%",
                Number(CFM.get("beatSaturationAmount")) * 100,
                1,
                0,
                60,
                (value) => CFM.set("beatSaturationAmount", Number(value) / 100),
                strings.saturation.description,
            ),
            createAdjust(
                strings.speed.setting,
                "beatSpeedAmount",
                "%",
                Number(CFM.get("beatSpeedAmount")) * 100,
                1,
                0,
                60,
                (value) => CFM.set("beatSpeedAmount", Number(value) / 100),
                strings.speed.description,
            ),
            createAdjust(
                strings.attack.setting,
                "beatAttack",
                "%",
                Number(CFM.get("beatAttack")) * 100,
                5,
                5,
                100,
                (value) => CFM.set("beatAttack", Number(value) / 100),
                strings.attack.description,
            ),
            createAdjust(
                strings.release.setting,
                "beatRelease",
                "%",
                Number(CFM.get("beatRelease")) * 100,
                1,
                1,
                50,
                (value) => CFM.set("beatRelease", Number(value) / 100),
                strings.release.description,
            ),
        );
        return section;
    }

    private static createBeatResponsePresetSetting(LOCALE: string) {
        const strings = translations[LOCALE].settings.beatResponsePreset;
        return this.createOptions(
            strings.setting,
            {
                off: strings.off,
                low: strings.low,
                medium: strings.medium,
                high: strings.high,
                custom: strings.custom,
            },
            CFM.get("beatResponsePreset") as Settings["beatResponsePreset"],
            "beatResponsePreset",
            (value) => {
                const section = this.configContainer.querySelector<HTMLElement>(
                    ".fullscape-beat-settings",
                );
                if (section) section.hidden = value !== "custom";
                CFM.set("beatResponsePreset", value as Settings["beatResponsePreset"]);
            },
            strings.description,
        );
    }

    static promptForUpdate = promptForUpdate;

    static openConfig(evt: Event | null = null): void {
        evt?.preventDefault();
        const configuredLocale = CFM.getGlobal("locale") as Config["locale"];
        const LOCALE = configuredLocale in translations ? configuredLocale : DEFAULTS.locale;
        if (LOCALE !== configuredLocale) CFM.setGlobal("locale", LOCALE);
        const strings = translations[LOCALE].settings;
        const layout = strings.layout;
        this.configContainer = document.createElement("div");
        this.configContainer.id = "fullscape-config-container";
        this.configContainer.dataset.locale = LOCALE;
        const sections = [
            {
                id: "general",
                title: layout.sections.general.title,
                section: this.createSettingsSection(
                    layout.sections.general.title,
                    layout.sections.general.description,
                    this.createSettingsGroup(
                        layout.groups.languageAndLaunch.title,
                        layout.groups.languageAndLaunch.description,
                        this.createOptions(
                            strings.language,
                            languageNames,
                            CFM.getGlobal("locale") as Config["locale"],
                            "locale",
                            (value: string) => {
                                this.saveGlobalOption("locale", value);
                                document.querySelector("body > generic-modal")?.remove();
                                this.openConfig();
                            },
                            layout.descriptions.language,
                        ),
                        this.createOptions(
                            strings.autoLaunch.setting,
                            {
                                never: strings.autoLaunch.never,
                                default: strings.autoLaunch.default,
                            },
                            CFM.getGlobal("autoLaunch") as Config["autoLaunch"],
                            "autoLaunch",
                            (value: string) => this.saveGlobalOption("autoLaunch", value),
                            strings.autoLaunch.description,
                        ),
                    ),
                    this.createSettingsGroup(
                        layout.groups.activation.title,
                        layout.groups.activation.description,
                        this.createOptions(
                            strings.activationTypes.setting,
                            {
                                both: strings.activationTypes.both,
                                btns: strings.activationTypes.btns,
                                keys: strings.activationTypes.keys,
                            },
                            CFM.getGlobal("activationTypes") as Config["activationTypes"],
                            "activationTypes",
                            (value: string) => {
                                this.saveGlobalOption("activationTypes", value);
                                location.reload();
                            },
                            strings.activationTypes.description,
                        ),
                        document.fullscreenEnabled
                            ? this.createToggle(
                                  strings.fullscreen,
                                  "enableFullscreen",
                                  undefined,
                                  layout.descriptions.fullscreen,
                              )
                            : "",
                        this.createToggle(
                            strings.hideSpotifyFullscreenButton,
                            "hideSpotifyFullscreenButton",
                            (value) => {
                                this.saveGlobalOption("hideSpotifyFullscreenButton", value);
                                location.reload();
                            },
                            strings.hideSpotifyFullscreenButtonDescription,
                        ),
                    ),
                    this.createSettingsGroup(
                        layout.groups.troubleshooting.title,
                        layout.groups.troubleshooting.description,
                        this.createToggle(
                            strings.debugMode.setting,
                            "debugMode",
                            (value) => {
                                const section = this.configContainer.querySelector<HTMLElement>(
                                    ".fullscape-debug-settings",
                                );
                                if (section) section.hidden = !value;
                                this.saveOption("debugMode", value);
                            },
                            strings.debugMode.description,
                        ),
                    ),
                ),
            },
            {
                id: "playback",
                title: layout.sections.playback.title,
                section: this.createSettingsSection(
                    layout.sections.playback.title,
                    layout.sections.playback.description,
                    this.createSettingsGroup(
                        layout.groups.trackInfo.title,
                        layout.groups.trackInfo.description,
                        this.createOptions(
                            strings.showAlbum.setting,
                            {
                                never: strings.showAlbum.never,
                                always: strings.showAlbum.always,
                                date: strings.showAlbum.date,
                            },
                            CFM.get("showAlbum") as Settings["showAlbum"],
                            "showAlbum",
                            (value: string) => this.saveOption("showAlbum", value),
                            layout.descriptions.showAlbum,
                        ),
                        this.createToggle(
                            strings.icons,
                            "icons",
                            undefined,
                            layout.descriptions.icons,
                        ),
                        this.createToggle(
                            strings.trimTitle,
                            "trimTitle",
                            undefined,
                            layout.descriptions.trimTitle,
                        ),
                        this.createToggle(
                            strings.trimAlbum,
                            "trimAlbum",
                            undefined,
                            layout.descriptions.trimAlbum,
                        ),
                    ),
                    this.createSettingsGroup(
                        layout.groups.upNext.title,
                        layout.groups.upNext.description,
                        this.createOptions(
                            strings.upnextDisplay,
                            {
                                always: strings.volumeDisplay.always,
                                never: strings.volumeDisplay.never,
                                smart: strings.volumeDisplay.smart,
                            },
                            CFM.get("upnextDisplay") as Settings["upnextDisplay"],
                            "upnextDisplay",
                            (value: string) => this.saveOption("upnextDisplay", value),
                            layout.descriptions.upNextDisplay,
                        ),
                        this.createToggle(
                            strings.trimTitleUpNext,
                            "trimTitleUpNext",
                            undefined,
                            layout.descriptions.trimTitleUpNext,
                        ),
                        createAdjust(
                            strings.upnextTime,
                            "upnextTimeToShow",
                            "s",
                            CFM.get("upnextTimeToShow") as Settings["upnextTimeToShow"],
                            1,
                            5,
                            60,
                            (state) => {
                                CFM.set("upnextTimeToShow", Number(state));
                                this.updateUpNextShow();
                            },
                            layout.descriptions.upNextTime,
                        ),
                    ),
                ),
            },
            {
                id: "lyrics",
                title: layout.sections.lyrics.title,
                section: this.createSettingsSection(
                    layout.sections.lyrics.title,
                    layout.sections.lyrics.description,
                    this.createSettingsGroup(
                        layout.groups.lyricsDisplay.title,
                        layout.groups.lyricsDisplay.description,
                        this.createToggle(
                            strings.lyrics,
                            "lyricsDisplay",
                            (value) => {
                                this.saveOption("lyricsDisplay", value);
                                DOM.container.classList.remove("lyrics-unavailable");
                            },
                            strings.lyricsDescription.join("<br>"),
                        ),
                        createAdjust(
                            strings.lyricsSize.setting,
                            "lyricsSize",
                            "px",
                            getLyricFontSize(CFM.get("lyricsSize")),
                            1,
                            MIN_LYRIC_FONT_SIZE,
                            MAX_LYRIC_FONT_SIZE,
                            (value) => this.saveOption("lyricsSize", Number(value)),
                            strings.lyricsSize.description,
                        ),
                        this.createTypographySetting(LOCALE),
                    ),
                    this.createSettingsGroup(
                        layout.groups.lyricSources.title,
                        layout.groups.lyricSources.description,
                        this.createToggle(
                            strings.thirdPartyLyrics,
                            "thirdPartyLyrics",
                            undefined,
                            layout.descriptions.thirdPartyLyrics,
                        ),
                        this.createToggle(
                            strings.sharedLyricsBridge.setting,
                            "sharedLyricsBridge",
                            undefined,
                            strings.sharedLyricsBridge.description,
                        ),
                        this.createOptions(
                            strings.lyricsSource.setting,
                            {
                                auto: strings.lyricsSource.auto,
                                "apple-music": "Apple Music (Shiori)",
                                standard: strings.lyricsSource.standard,
                            },
                            CFM.get("lyricsSource") as Settings["lyricsSource"],
                            "lyricsSource",
                            (value) => this.saveOption("lyricsSource", value),
                        ),
                        this.createToggle(
                            strings.relaxedLyricsMatching.setting,
                            "relaxedLyricsMatching",
                            undefined,
                            strings.relaxedLyricsMatching.description,
                        ),
                    ),
                    this.createSettingsGroup(
                        layout.groups.lyricContent.title,
                        layout.groups.lyricContent.description,
                        this.createToggle(strings.showLyricsTranslation, "showLyricsTranslation"),
                        this.createToggle(strings.showLyricsRomanization, "showLyricsRomanization"),
                        this.createToggle(strings.showLyricsFurigana, "showLyricsFurigana"),
                        createOfflineFuriganaDictionaryCard(LOCALE),
                        this.createOptions(
                            strings.lyricsChineseConversion.setting,
                            {
                                original: strings.lyricsChineseConversion.original,
                                simplified: strings.lyricsChineseConversion.simplified,
                                traditional: strings.lyricsChineseConversion.traditional,
                            },
                            CFM.get(
                                "lyricsChineseConversion",
                            ) as Settings["lyricsChineseConversion"],
                            "lyricsChineseConversion",
                            (value) =>
                                this.saveOption(
                                    "lyricsChineseConversion",
                                    value as Settings["lyricsChineseConversion"],
                                ),
                            strings.lyricsChineseConversion.description,
                        ),
                        this.createToggle(strings.karaokeLyrics, "karaokeLyrics"),
                    ),
                    createLyricsDebugSettings(LOCALE),
                ),
            },
            {
                id: "background",
                title: layout.sections.background.title,
                section: this.createSettingsSection(
                    layout.sections.background.title,
                    layout.sections.background.description,
                    this.createSettingsGroup(
                        layout.groups.motion.title,
                        layout.groups.motion.description,
                        this.createBeatResponsePresetSetting(LOCALE),
                        this.createToggle(
                            strings.bpmDrivenMotion,
                            "bpmDrivenMotion",
                            (value) => CFM.set("bpmDrivenMotion", value),
                            strings.bpmDrivenMotionDescription,
                        ),
                        this.createBeatSettings(LOCALE),
                        createAdjust(
                            strings.animationSpeed,
                            "animationSpeed",
                            "",
                            (CFM.get("animationSpeed") as Settings["animationSpeed"]) * 100,
                            2,
                            2,
                            40,
                            (state) => CFM.set("animationSpeed", Number(state) / 100),
                            layout.descriptions.animationSpeed,
                        ),
                    ),
                    this.createSettingsGroup(
                        layout.groups.backgroundRendering.title,
                        layout.groups.backgroundRendering.description,
                        createAdjust(
                            strings.backAnimationTime,
                            "backAnimationTime",
                            "s",
                            CFM.get("backAnimationTime") as Settings["backAnimationTime"],
                            0.1,
                            0,
                            MAX_BACKGROUND_TRANSITION_SECONDS,
                            (state) => CFM.set("backAnimationTime", Number(state)),
                            layout.descriptions.transitionTime,
                        ),
                        createAdjust(
                            strings.backgroundBlur,
                            "blurSize",
                            "",
                            CFM.get("blurSize") as Settings["blurSize"],
                            4,
                            0,
                            100,
                            (state) => {
                                CFM.set("blurSize", Number(state));
                                if (Utils.isModeActivated()) {
                                    Utils.overlayBack();
                                    this.updateBackground(
                                        Spicetify.Player.data.item?.metadata,
                                        true,
                                    );
                                    if (this.overlayTimout) clearTimeout(this.overlayTimout);
                                    this.overlayTimout = setTimeout(() => {
                                        Utils.overlayBack(false);
                                    }, 2000);
                                }
                            },
                            layout.descriptions.backgroundBlur,
                        ),
                        this.createOptions(
                            strings.backgroundBrightness,
                            {
                                0: "0%",
                                0.1: "10%",
                                0.2: "20%",
                                0.3: "30%",
                                0.4: "40%",
                                0.5: "50%",
                                0.6: "60%",
                                0.7: "70%",
                                0.8: "80%",
                                0.9: "90%",
                                1: "100%",
                            },
                            CFM.get("backgroundBrightness") as Settings["backgroundBrightness"],
                            "backgroundBrightness",
                            (value: string) => {
                                CFM.set("backgroundBrightness", Number(value));
                                if (Utils.isModeActivated()) {
                                    this.updateBackground(
                                        Spicetify.Player.data.item?.metadata,
                                        true,
                                    );
                                }
                            },
                            layout.descriptions.backgroundBrightness,
                        ),
                    ),
                ),
            },
            {
                id: "updates",
                title: layout.sections.updates.title,
                section: this.createSettingsSection(
                    layout.sections.updates.title,
                    layout.sections.updates.description,
                    this.createSettingsGroup(
                        layout.groups.releaseUpdates.title,
                        layout.groups.releaseUpdates.description,
                        createUpdateSettings(LOCALE, (enabled) =>
                            this.saveGlobalOption("autoUpdateCheck", enabled),
                        ),
                    ),
                ),
            },
        ];
        this.configContainer.append(
            this.createSettingsShell(sections),
            this.getSettingsFooter(LOCALE),
        );
        Spicetify.PopupModal.display({
            title: strings.fullscapeConfig,
            content: this.configContainer,
        });
        window.requestAnimationFrame(() => void this.applyAlbumAccent());
    }
}
