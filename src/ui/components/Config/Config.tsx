import React from "react";
import ReactDOM from "react-dom";
import CFM from "../../../utils/config";
import translations from "../../../resources/strings";
import { DEFAULTS } from "../../../constants";
import { Config, Settings } from "../../../types/fullscreen";
import Utils from "../../../utils/utils";
import { DOM } from "../../elements";
import { headerText, getSettingCard, createAdjust } from "../../../utils/setting";
import SeekableProgressBar from "../ProgressBar/ProgressBar";
import { modifyRotationSpeed } from "../../../utils/animation";
import { Lyrics } from "../Lyrics/Lyrics";

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

    static getSettingTopHeader(LOCALE: string) {
        const container = document.createElement("div");
        container.innerHTML = `
        <div class="setting-button-row">
          <button class="main-buttons-button main-button-primary" id="mode-exit">
            ${translations[LOCALE].settings.exit}
          </button>
        </div>`;
        const exitButton = container.querySelector<HTMLElement>("#mode-exit");
        if (exitButton) exitButton.onclick = this.deactivate;
        return container;
    }

    static getSettingsFooter(LOCALE: string) {
        const container = document.createElement("div");
        container.innerHTML = `
        <div class="setting-button-row">
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
        const settingCard = getSettingCard(
            `<label class="switch">
                <input type="checkbox">
                <span class="slider"></span>
            </label>`,
            title,
            key,
            description,
        );
        const toggle = settingCard.querySelector<HTMLInputElement>("input");
        if (toggle) {
            if (key in DEFAULTS) toggle.checked = CFM.getGlobal(key as keyof Config) as boolean;
            else toggle.checked = CFM.get(key as keyof Settings) as boolean;

            toggle.onchange = (evt) => callback((evt?.target as HTMLInputElement)?.checked);
        }
        return settingCard;
    }

    static createInputElement(
        title: string,
        key: keyof Settings | keyof Config,
        type: string,
        callback = (value: string) => this.saveOption(key as keyof Settings, value),
        description = "",
    ): HTMLDivElement {
        const settingCard = getSettingCard(
            `<label class="gen-input">
                <input type="${type}">
            </label>`,
            title,
            key,
            description,
        );
        const inputElement = settingCard.querySelector<HTMLInputElement>("input");
        if (inputElement) {
            if (key in DEFAULTS) inputElement.value = CFM.getGlobal(key as keyof Config) as string;
            else inputElement.value = CFM.get(key as keyof Settings) as string;

            inputElement.oninput = (evt) => callback((evt?.target as HTMLInputElement)?.value);
        }
        return settingCard;
    }

    private static formatLyricTime(time: number | null) {
        if (time === null || !Number.isFinite(time)) return "--:--";
        const totalSeconds = Math.max(0, Math.floor(time / 1000));
        const minutes = Math.floor(totalSeconds / 60)
            .toString()
            .padStart(2, "0");
        const seconds = (totalSeconds % 60).toString().padStart(2, "0");
        return `${minutes}:${seconds}`;
    }

    private static createLyricsDiagnosticsCard(LOCALE: string) {
        const diagnostics = Lyrics.getDiagnostics();
        const strings = translations[LOCALE].settings.lyricsDiagnostics;
        const card = document.createElement("div");
        card.classList.add("setting-card", "lyrics-diagnostics-card");
        card.innerHTML = `
            <div class="setting-container">
                <div class="setting-item">
                    <label class="setting-title"></label>
                </div>
                <div class="setting-description"></div>
                <div class="lyrics-diagnostics-output"></div>
            </div>`;
        const title = card.querySelector<HTMLElement>(".setting-title");
        const description = card.querySelector<HTMLElement>(".setting-description");
        if (title) title.textContent = strings.setting;
        if (description) description.textContent = strings.description;

        const output = card.querySelector<HTMLElement>(".lyrics-diagnostics-output");
        if (!output) return card;

        const appendHeading = (container: HTMLElement, text: string) => {
            const heading = document.createElement("strong");
            heading.classList.add("lyrics-diagnostics-heading");
            heading.textContent = text;
            container.append(heading);
        };
        const appendRow = (container: HTMLElement, label: string, value: string | number) => {
            const row = document.createElement("div");
            row.classList.add("lyrics-diagnostics-row");
            const labelElement = document.createElement("strong");
            labelElement.textContent = `${label}: `;
            row.append(labelElement, document.createTextNode(String(value)));
            container.append(row);
        };
        const appendBlock = (container: HTMLElement, label: string, value: string) => {
            const wrapper = document.createElement("div");
            wrapper.classList.add("lyrics-diagnostics-block");
            const labelElement = document.createElement("strong");
            labelElement.textContent = label;
            const pre = document.createElement("pre");
            pre.textContent = value || strings.noData;
            wrapper.append(labelElement, pre);
            container.append(wrapper);
        };
        const createDetails = (label: string, count: number) => {
            const details = document.createElement("details");
            details.classList.add("lyrics-diagnostics-details");
            const summary = document.createElement("summary");
            const summaryLabel = document.createElement("strong");
            summaryLabel.textContent = `${label} (${count})`;
            summary.append(summaryLabel);
            const content = document.createElement("div");
            content.classList.add("lyrics-diagnostics-details-content");
            details.append(summary, content);
            output.append(details);
            return content;
        };

        const providerEnabled = Boolean(CFM.get("thirdPartyLyrics"));
        const providerStatus = providerEnabled
            ? (strings.providerStatuses[diagnostics.thirdParty.status] ??
              diagnostics.thirdParty.status)
            : strings.disabled;
        const status = strings.statuses[diagnostics.status] ?? diagnostics.status;

        const overview = document.createElement("section");
        overview.classList.add("lyrics-diagnostics-section");
        appendHeading(overview, strings.overview);
        appendRow(overview, strings.status, status);
        appendRow(
            overview,
            strings.lines,
            `${diagnostics.lines.total} (${strings.timed}: ${diagnostics.lines.timed})`,
        );
        appendRow(
            overview,
            strings.features,
            `${strings.translation} ${diagnostics.lines.translations} / ${strings.romanization} ${diagnostics.lines.romanizations} / ${strings.karaoke} ${diagnostics.lines.karaoke}`,
        );
        output.append(overview);

        const provider = document.createElement("section");
        provider.classList.add("lyrics-diagnostics-section");
        appendHeading(provider, strings.providerDetails);
        appendRow(provider, strings.status, providerStatus);
        const track = diagnostics.thirdParty.track;
        appendRow(
            provider,
            strings.track,
            track
                ? `${track.title} - ${track.artists || strings.none} / ${track.album || strings.none} (${Math.round(track.duration / 1000)}s)`
                : strings.none,
        );
        appendRow(provider, strings.matched, diagnostics.thirdParty.matchedSong ?? strings.none);
        appendRow(
            provider,
            strings.spotifyFirst,
            diagnostics.thirdParty.spotifyFirst
                ? `[${this.formatLyricTime(diagnostics.thirdParty.spotifyFirst.time)}] ${diagnostics.thirdParty.spotifyFirst.text}`
                : strings.none,
        );
        appendRow(
            provider,
            strings.merged,
            `${strings.translation} ${diagnostics.thirdParty.merged.translation} / ${strings.romanization} ${diagnostics.thirdParty.merged.romanization} / ${strings.furiganaData} ${diagnostics.thirdParty.merged.furigana} / ${strings.karaoke} ${diagnostics.thirdParty.merged.karaoke}`,
        );
        appendRow(provider, strings.reason, diagnostics.thirdParty.reason || strings.none);
        appendBlock(
            provider,
            strings.spotifyPreview,
            diagnostics.thirdParty.spotifyPreview
                .map((line) => `[${this.formatLyricTime(line.time)}] ${line.text}`)
                .join("\n"),
        );
        if (diagnostics.thirdParty.matchedFirst) {
            appendRow(
                provider,
                strings.matchedFirst,
                `[${this.formatLyricTime(diagnostics.thirdParty.matchedFirst.time)}] ${diagnostics.thirdParty.matchedFirst.text}`,
            );
        }
        output.append(provider);

        const candidateContent = createDetails(
            strings.candidateDetails,
            diagnostics.thirdParty.candidates.length,
        );
        diagnostics.thirdParty.candidates.forEach((candidate, index) => {
            const candidateElement = document.createElement("article");
            candidateElement.classList.add("lyrics-diagnostics-candidate");
            appendHeading(
                candidateElement,
                `${index + 1}. [${candidate.provider === "netease" ? "NetEase" : "QQ Music"}] ${candidate.name} - ${candidate.artists || strings.none}`,
            );
            appendRow(candidateElement, strings.album, candidate.album || strings.none);
            appendRow(candidateElement, strings.id, candidate.id);
            appendRow(
                candidateElement,
                strings.match,
                `${candidate.match ? strings.yes : strings.no} (${strings.plausible}: ${candidate.plausible ? strings.yes : strings.no})`,
            );
            if (candidate.counts) {
                appendRow(
                    candidateElement,
                    strings.counts,
                    `LRC ${candidate.counts.lrc} / ${strings.translation} ${candidate.counts.translation} / ${strings.romanization} ${candidate.counts.romanization} / ${strings.furiganaData} ${candidate.counts.furigana} / ${strings.dynamic} ${candidate.counts.dynamic}`,
                );
            }
            appendRow(candidateElement, strings.reason, candidate.reason || strings.none);
            if (candidate.first) {
                appendRow(
                    candidateElement,
                    strings.firstLine,
                    `[${this.formatLyricTime(candidate.first.time)}] ${candidate.first.text}`,
                );
            }
            appendBlock(
                candidateElement,
                strings.preview,
                (candidate.preview ?? [])
                    .map((line) => `[${this.formatLyricTime(line.time)}] ${line.text}`)
                    .join("\n"),
            );
            candidateContent.append(candidateElement);
        });

        const renderedContent = createDetails(strings.renderedLyrics, diagnostics.rendered.length);
        appendBlock(
            renderedContent,
            strings.renderedLyrics,
            diagnostics.rendered
                .map((line, index) => {
                    const flags = [
                        line.translation ? strings.translation : "",
                        line.romanization ? strings.romanization : "",
                        line.words?.length ? `${strings.karaoke}(${line.words.length})` : "",
                    ]
                        .filter(Boolean)
                        .join(", ");
                    return `[${this.formatLyricTime(line.time)}] (${index + 1}) ${line.text}${flags ? ` <${flags}>` : ""}`;
                })
                .join("\n"),
        );
        return card;
    }

    private static createLyricsRefreshCard(LOCALE: string) {
        const strings = translations[LOCALE].settings.refreshLyrics;
        const card = getSettingCard(
            `<button class="main-buttons-button main-button-secondary lyrics-refresh-button">${strings.button}</button>`,
            strings.setting,
            "lyricsDisplay",
            strings.description,
        );
        const button = card.querySelector<HTMLButtonElement>(".lyrics-refresh-button");
        if (!button) return card;
        const blockedReason = Lyrics.getRefreshBlockedReason();
        if (blockedReason === "manual-selection") {
            const description = card.querySelector<HTMLElement>(".setting-description");
            button.disabled = true;
            const message = strings.manualSelectionBlocked ?? strings.description;
            button.title = message;
            if (description) description.textContent = message;
            return card;
        }

        button.onclick = async () => {
            button.disabled = true;
            button.textContent = strings.loading;
            const refreshed = await Lyrics.refreshCurrentLyrics().catch(() => false);
            button.textContent = refreshed ? strings.done : strings.failed;
            const diagnosticsCard = this.configContainer.querySelector(".lyrics-diagnostics-card");
            diagnosticsCard?.replaceWith(this.createLyricsDiagnosticsCard(LOCALE));
            window.setTimeout(() => {
                if (!button.isConnected) return;
                button.disabled = false;
                button.textContent = strings.button;
            }, 1500);
        };
        return card;
    }

    private static createDebugSettings(LOCALE: string) {
        const section = document.createElement("section");
        section.classList.add("fsd-debug-settings", "settings-nested-section");
        section.hidden = !CFM.get("debugMode");
        section.append(
            headerText(translations[LOCALE].settings.lyricsDebugHeader),
            this.createLyricsRefreshCard(LOCALE),
            this.createLyricsDiagnosticsCard(LOCALE),
        );
        return section;
    }

    private static createBeatSettings(LOCALE: string) {
        const strings = translations[LOCALE].settings.beatControls;
        const section = document.createElement("section");
        section.classList.add("fsd-beat-settings", "settings-nested-section");
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
                const section =
                    this.configContainer.querySelector<HTMLElement>(".fsd-beat-settings");
                if (section) section.hidden = value !== "custom";
                CFM.set("beatResponsePreset", value as Settings["beatResponsePreset"]);
                CFM.set("beatBounce", value !== "off");
            },
            strings.description,
        );
    }

    static openConfig(evt: Event | null = null): void {
        evt?.preventDefault();
        const LOCALE = CFM.getGlobal("locale") as Config["locale"];
        this.configContainer = document.createElement("div");
        this.configContainer.id = "full-screen-config-container";
        const sections = [
            {
                id: "plugin",
                title: translations[LOCALE].settings.pluginSettings,
                section: this.createSettingsSection(
                    translations[LOCALE].settings.pluginSettings,
                    "",
                    this.createOptions(
                        translations[LOCALE].settings.language,
                        Utils.getAvailableLanguages(translations),
                        CFM.getGlobal("locale") as Config["locale"],
                        "locale",
                        (value: string) => {
                            this.saveGlobalOption("locale", value);
                            document.querySelector("body > generic-modal")?.remove();
                            this.openConfig();
                        },
                    ),
                    this.createOptions(
                        translations[LOCALE].settings.activationTypes.setting,
                        {
                            both: translations[LOCALE].settings.activationTypes.both,
                            btns: translations[LOCALE].settings.activationTypes.btns,
                            keys: translations[LOCALE].settings.activationTypes.keys,
                        },
                        CFM.getGlobal("activationTypes") as Config["activationTypes"],
                        "activationTypes",
                        (value: string) => {
                            this.saveGlobalOption("activationTypes", value);
                            location.reload();
                        },
                        translations[LOCALE].settings.activationTypes.description,
                    ),
                    this.createOptions(
                        translations[LOCALE].settings.autoLaunch.setting,
                        {
                            never: translations[LOCALE].settings.autoLaunch.never,
                            default: translations[LOCALE].settings.autoLaunch.default,
                        },
                        CFM.getGlobal("autoLaunch") as Config["autoLaunch"],
                        "autoLaunch",
                        (value: string) => {
                            this.saveGlobalOption("autoLaunch", value);
                        },
                        translations[LOCALE].settings.autoLaunch.description,
                    ),
                    this.createToggle(
                        translations[LOCALE].settings.fsHideOriginal,
                        "fsHideOriginal",
                        (value) => {
                            this.saveGlobalOption("fsHideOriginal", value);
                            location.reload();
                        },
                        translations[LOCALE].settings.fsHideOriginalDescription,
                    ),
                    document.fullscreenEnabled
                        ? this.createToggle(
                              translations[LOCALE].settings.fullscreen,
                              "enableFullscreen",
                          )
                        : "",
                    this.createToggle(
                        translations[LOCALE].settings.debugMode.setting,
                        "debugMode",
                        (value) => {
                            const section =
                                this.configContainer.querySelector<HTMLElement>(
                                    ".fsd-debug-settings",
                                );
                            if (section) section.hidden = !value;
                            this.saveOption("debugMode", value);
                        },
                        translations[LOCALE].settings.debugMode.description,
                    ),
                ),
            },
            {
                id: "lyrics",
                title: translations[LOCALE].settings.lyricsHeader,
                section: this.createSettingsSection(
                    translations[LOCALE].settings.lyricsHeader,
                    "",
                    this.createToggle(
                        translations[LOCALE].settings.lyrics,
                        "lyricsDisplay",
                        (value) => {
                            this.saveOption("lyricsDisplay", value);
                            DOM.container.classList.remove("lyrics-unavailable");
                        },
                        translations[LOCALE].settings.lyricsDescription.join("<br>"),
                    ),
                    this.createToggle(
                        translations[LOCALE].settings.thirdPartyLyrics,
                        "thirdPartyLyrics",
                    ),
                    this.createToggle(
                        translations[LOCALE].settings.sharedLyricsBridge.setting,
                        "sharedLyricsBridge",
                        undefined,
                        translations[LOCALE].settings.sharedLyricsBridge.description,
                    ),
                    this.createToggle(
                        translations[LOCALE].settings.relaxedLyricsMatching.setting,
                        "relaxedLyricsMatching",
                        undefined,
                        translations[LOCALE].settings.relaxedLyricsMatching.description,
                    ),
                    this.createToggle(
                        translations[LOCALE].settings.showLyricsTranslation,
                        "showLyricsTranslation",
                    ),
                    this.createToggle(
                        translations[LOCALE].settings.showLyricsRomanization,
                        "showLyricsRomanization",
                    ),
                    this.createToggle(
                        translations[LOCALE].settings.showLyricsFurigana,
                        "showLyricsFurigana",
                    ),
                    this.createOptions(
                        translations[LOCALE].settings.lyricsChineseConversion.setting,
                        {
                            original:
                                translations[LOCALE].settings.lyricsChineseConversion.original,
                            simplified:
                                translations[LOCALE].settings.lyricsChineseConversion.simplified,
                            traditional:
                                translations[LOCALE].settings.lyricsChineseConversion.traditional,
                        },
                        CFM.get("lyricsChineseConversion") as Settings["lyricsChineseConversion"],
                        "lyricsChineseConversion",
                        (value) =>
                            this.saveOption(
                                "lyricsChineseConversion",
                                value as Settings["lyricsChineseConversion"],
                            ),
                        translations[LOCALE].settings.lyricsChineseConversion.description,
                    ),
                    this.createToggle(translations[LOCALE].settings.karaokeLyrics, "karaokeLyrics"),
                    this.createToggle(
                        translations[LOCALE].settings.autoHideLyrics,
                        "autoHideLyrics",
                    ),
                    createAdjust(
                        translations[LOCALE].settings.lyricsSize.setting,
                        "lyricsSize",
                        "px",
                        Number(CFM.get("lyricsSize") || 30),
                        1,
                        12,
                        99,
                        (value: number) =>
                            this.saveOption(
                                "lyricsSize",
                                value as unknown as Settings["lyricsSize"],
                            ),
                        translations[LOCALE].settings.lyricsSize.description,
                    ),
                    this.createDebugSettings(LOCALE),
                ),
            },
            {
                id: "general",
                title: translations[LOCALE].settings.generalHeader,
                section: this.createSettingsSection(
                    translations[LOCALE].settings.generalHeader,
                    "",
                    this.createOptions(
                        translations[LOCALE].settings.progressBar,
                        {
                            never: translations[LOCALE].settings.contextDisplay.never,
                            mousemove: translations[LOCALE].settings.contextDisplay.mouse,
                            always: translations[LOCALE].settings.contextDisplay.always,
                        },
                        CFM.get("progressBarDisplay") as Settings["progressBarDisplay"],
                        "progressBarDisplay",
                        (value: string) => {
                            CFM.set("progressBarDisplay", value as Settings["progressBarDisplay"]);
                            if (value !== "never") {
                                ReactDOM.render(
                                    <SeekableProgressBar state={value} />,
                                    DOM.container.querySelector("#fsd-progress-parent"),
                                );
                            } else {
                                const root = DOM.container.querySelector("#fsd-progress-parent");
                                if (root) ReactDOM.unmountComponentAtNode(root);
                            }
                        },
                    ),
                    this.createOptions(
                        translations[LOCALE].settings.playerControls,
                        {
                            never: translations[LOCALE].settings.contextDisplay.never,
                            mousemove: translations[LOCALE].settings.contextDisplay.mouse,
                            always: translations[LOCALE].settings.contextDisplay.always,
                        },
                        CFM.get("playerControls") as Settings["playerControls"],
                        "playerControls",
                        (value: string) => this.saveOption("playerControls", value),
                    ),
                    this.createOptions(
                        translations[LOCALE].settings.showAlbum.setting,
                        {
                            never: translations[LOCALE].settings.showAlbum.never,
                            always: translations[LOCALE].settings.showAlbum.always,
                            date: translations[LOCALE].settings.showAlbum.date,
                        },
                        CFM.get("showAlbum") as Settings["showAlbum"],
                        "showAlbum",
                        (value: string) => this.saveOption("showAlbum", value),
                    ),
                    this.createToggle(translations[LOCALE].settings.icons, "icons"),
                    this.createToggle(translations[LOCALE].settings.trimTitle, "trimTitle"),
                    this.createToggle(translations[LOCALE].settings.trimAlbum, "trimAlbum"),
                    this.createOptions(
                        translations[LOCALE].settings.upnextDisplay,
                        {
                            always: translations[LOCALE].settings.volumeDisplay.always,
                            never: translations[LOCALE].settings.volumeDisplay.never,
                            smart: translations[LOCALE].settings.volumeDisplay.smart,
                        },
                        CFM.get("upnextDisplay") as Settings["upnextDisplay"],
                        "upnextDisplay",
                        (value: string) => this.saveOption("upnextDisplay", value),
                    ),
                    this.createToggle(
                        translations[LOCALE].settings.trimTitleUpNext,
                        "trimTitleUpNext",
                    ),
                    createAdjust(
                        translations[LOCALE].settings.upnextTime,
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
                    ),
                    this.createToggle(
                        translations[LOCALE].settings.verticalMonitorSupport,
                        "verticalMonitorSupport",
                        (value: boolean) => this.saveOption("verticalMonitorSupport", value),
                        translations[LOCALE].settings.verticalMonitorSupportDescription,
                    ),
                ),
            },
            {
                id: "background",
                title: translations[LOCALE].settings.backgroundHeader,
                section: this.createSettingsSection(
                    translations[LOCALE].settings.backgroundHeader,
                    translations[LOCALE].settings.backgroundSubHeader,
                    this.createBeatResponsePresetSetting(LOCALE),
                    this.createToggle(
                        translations[LOCALE].settings.bpmDrivenMotion,
                        "bpmDrivenMotion",
                        (value) => CFM.set("bpmDrivenMotion", value),
                        translations[LOCALE].settings.bpmDrivenMotionDescription,
                    ),
                    this.createBeatSettings(LOCALE),
                    createAdjust(
                        translations[LOCALE].settings.animationSpeed,
                        "animationSpeed",
                        "",
                        (CFM.get("animationSpeed") as Settings["animationSpeed"]) * 100,
                        2,
                        2,
                        40,
                        (state) => {
                            CFM.set("animationSpeed", Number(state) / 100);
                            modifyRotationSpeed(Number(state) / 100);
                        },
                    ),
                    createAdjust(
                        translations[LOCALE].settings.backAnimationTime,
                        "backAnimationTime",
                        "s",
                        CFM.get("backAnimationTime") as Settings["backAnimationTime"],
                        0.1,
                        0,
                        5,
                        (state) => {
                            CFM.set("backAnimationTime", Number(state));
                            DOM.container.style.setProperty("--fs-transition", `${state}s`);
                        },
                    ),
                    createAdjust(
                        translations[LOCALE].settings.backgroundBlur,
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
                                this.updateBackground(Spicetify.Player.data.item?.metadata, true);
                                if (this.overlayTimout) clearTimeout(this.overlayTimout);
                                this.overlayTimout = setTimeout(() => {
                                    Utils.overlayBack(false);
                                }, 2000);
                            }
                        },
                    ),
                    this.createOptions(
                        translations[LOCALE].settings.backgroundBrightness,
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
                                this.updateBackground(Spicetify.Player.data.item?.metadata, true);
                            }
                        },
                    ),
                ),
            },
            {
                id: "appearance",
                title: translations[LOCALE].settings.appearanceHeader,
                section: this.createSettingsSection(
                    translations[LOCALE].settings.appearanceHeader,
                    translations[LOCALE].settings.appearanceSubHeader,
                    this.createToggle(translations[LOCALE].settings.themedButtons, "themedButtons"),
                    this.createToggle(translations[LOCALE].settings.themedIcons, "themedIcons"),
                    this.createOptions(
                        translations[LOCALE].settings.invertColors.setting,
                        {
                            never: translations[LOCALE].settings.invertColors.never,
                            always: translations[LOCALE].settings.invertColors.always,
                            auto: translations[LOCALE].settings.invertColors.auto,
                        },
                        CFM.get("invertColors") as Settings["invertColors"],
                        "invertColors",
                        (value: string) => this.saveOption("invertColors", value),
                    ),
                ),
            },
        ];
        this.configContainer.append(
            this.createSettingsShell(sections),
            this.getSettingsFooter(LOCALE),
        );
        Spicetify.PopupModal.display({
            title: translations[LOCALE].settings.fullscreenConfig,
            content: this.configContainer,
        });
    }
}
