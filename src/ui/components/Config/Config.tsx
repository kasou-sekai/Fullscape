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
import WebAPI from "../../../services/web-api";
import {
    CURRENT_VERSION,
    ReleaseInfo,
    ReleaseUpdater,
    UpdateCheckResult,
} from "../../../services/release-updater";

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
        const rgb = Utils.hexToRgb(hexColor)?.split(",").map(Number);
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

    private static showReloadFallback(LOCALE: string) {
        const strings = translations[LOCALE].settings.updates;
        const content = document.createElement("div");
        content.id = "full-screen-update-fallback";
        content.classList.add("update-fallback");

        const description = document.createElement("p");
        description.textContent = strings.reloadFallbackDescription;
        const command = document.createElement("code");
        command.textContent = "spicetify apply";
        content.append(description, command);

        Spicetify.PopupModal.display({
            title: strings.reloadFallbackTitle,
            content,
        });
    }

    private static showVersionConfirmation(target: ReleaseInfo | "bundled", LOCALE: string) {
        const strings = translations[LOCALE].settings.updates;
        const content = document.createElement("div");
        content.id = "full-screen-version-confirmation";
        content.classList.add("update-prompt");

        const description = document.createElement("p");
        description.textContent =
            target === "bundled"
                ? strings.confirmBundledDescription.replace(
                      "{version}",
                      ReleaseUpdater.getBundledVersion(),
                  )
                : strings.confirmVersionDescription
                      .replace("{current}", CURRENT_VERSION)
                      .replace("{version}", target.version);

        const actions = document.createElement("div");
        actions.classList.add("setting-button-row");
        const cancel = document.createElement("button");
        cancel.classList.add("main-buttons-button", "main-button-secondary");
        cancel.textContent = strings.cancel;
        cancel.onclick = () => Spicetify.PopupModal.hide();
        const confirm = document.createElement("button");
        confirm.classList.add("main-buttons-button", "main-button-primary");
        confirm.textContent = strings.confirmSwitch;
        confirm.onclick = () => {
            Spicetify.PopupModal.hide();
            if (target === "bundled") {
                ReleaseUpdater.switchToBundledVersion(() => this.showReloadFallback(LOCALE));
            } else {
                ReleaseUpdater.switchToRelease(target, () => this.showReloadFallback(LOCALE));
            }
        };
        actions.append(cancel, confirm);
        content.append(description, actions);

        // PopupModal reuses one custom element. Replacing its contents during the
        // selector button's click makes the old overlay treat that same click as
        // an outside click and immediately close the new confirmation. Let the
        // current event finish before replacing the settings modal.
        window.setTimeout(() => {
            Spicetify.PopupModal.display({
                title:
                    target === "bundled"
                        ? strings.confirmBundledTitle
                        : strings.confirmVersionTitle.replace("{version}", target.version),
                content,
            });
        }, 0);
    }

    private static createUpdateCard(LOCALE: string) {
        const strings = translations[LOCALE].settings.updates;
        const card = document.createElement("div");
        card.classList.add("setting-card", "update-card");
        card.innerHTML = `
            <div class="setting-container">
                <div class="setting-item">
                    <div>
                        <div class="setting-title"></div>
                        <div class="update-version"></div>
                    </div>
                    <div class="setting-action update-actions">
                        <a class="update-release-link" target="_blank" rel="noreferrer"></a>
                        <button class="main-buttons-button main-button-secondary update-button"></button>
                    </div>
                </div>
                <div class="setting-description update-status"></div>
            </div>`;

        const title = card.querySelector<HTMLElement>(".setting-title");
        const version = card.querySelector<HTMLElement>(".update-version");
        const status = card.querySelector<HTMLElement>(".update-status");
        const releaseLink = card.querySelector<HTMLAnchorElement>(".update-release-link");
        const button = card.querySelector<HTMLButtonElement>(".update-button");
        if (!title || !version || !status || !releaseLink || !button) return card;

        title.textContent = strings.cardTitle;
        const bundledVersion = ReleaseUpdater.getBundledVersion();
        version.textContent = `${strings.currentVersion}: v${CURRENT_VERSION}`;
        if (bundledVersion !== CURRENT_VERSION) {
            version.textContent += ` · ${strings.bundledVersion}: v${bundledVersion}`;
        }
        releaseLink.textContent = strings.releasePage;
        releaseLink.hidden = true;

        const renderResult = (result: UpdateCheckResult) => {
            button.disabled = false;
            button.classList.remove("main-button-primary");
            button.classList.add("main-button-secondary");
            releaseLink.hidden = true;
            releaseLink.removeAttribute("href");

            if (result.status === "available") {
                status.textContent = strings.available.replace("{version}", result.release.version);
                button.textContent = strings.reviewUpdate;
                button.classList.remove("main-button-secondary");
                button.classList.add("main-button-primary");
                button.onclick = () => this.showVersionConfirmation(result.release, LOCALE);
                releaseLink.href = result.release.pageUrl;
                releaseLink.hidden = false;
                return;
            }

            if (result.status === "error") {
                status.textContent = `${strings.checkFailed}: ${result.message}`;
                button.textContent = strings.retry;
                button.onclick = () => void check(true);
                return;
            }

            status.textContent = strings.upToDate;
            button.textContent = strings.checkNow;
            button.onclick = () => void check(true);
            if (result.release) {
                releaseLink.href = result.release.pageUrl;
                releaseLink.hidden = false;
            }
        };

        const check = async (force = false) => {
            button.disabled = true;
            button.textContent = strings.checking;
            status.textContent = strings.checkingDescription;
            renderResult(await ReleaseUpdater.check(force));
        };

        void check();
        return card;
    }

    private static createVersionSelector(LOCALE: string) {
        const strings = translations[LOCALE].settings.updates;
        const card = document.createElement("div");
        card.classList.add("setting-card", "update-version-selector");
        card.innerHTML = `
            <div class="setting-container">
                <div class="setting-item">
                    <div>
                        <div class="setting-title"></div>
                        <div class="setting-description version-selector-description"></div>
                    </div>
                    <div class="setting-action update-version-actions">
                        <select class="update-version-select"></select>
                        <button class="main-buttons-button main-button-primary update-version-button"></button>
                    </div>
                </div>
                <div class="setting-description update-version-status"></div>
            </div>`;

        const title = card.querySelector<HTMLElement>(".setting-title");
        const description = card.querySelector<HTMLElement>(".version-selector-description");
        const select = card.querySelector<HTMLSelectElement>(".update-version-select");
        const button = card.querySelector<HTMLButtonElement>(".update-version-button");
        const status = card.querySelector<HTMLElement>(".update-version-status");
        if (!title || !description || !select || !button || !status) {
            return { card, load: async () => undefined };
        }

        title.textContent = strings.versionSelectorTitle;
        description.textContent = strings.versionSelectorDescription;
        button.textContent = strings.useSelectedVersion;
        let releases: ReleaseInfo[] = [];

        const syncButton = () => {
            const active = ReleaseUpdater.getSelectedRelease()?.tag ?? "bundled";
            button.disabled = select.disabled || select.value === active;
        };

        select.onchange = syncButton;
        button.onclick = () => {
            if (select.value === "bundled") {
                this.showVersionConfirmation("bundled", LOCALE);
                return;
            }
            const release = releases.find((candidate) => candidate.tag === select.value);
            if (release) this.showVersionConfirmation(release, LOCALE);
        };

        const load = async (force = false) => {
            select.disabled = true;
            button.disabled = true;
            status.textContent = strings.loadingVersions;
            try {
                releases = await ReleaseUpdater.listStableReleases(force);
                select.replaceChildren();
                const bundled = document.createElement("option");
                bundled.value = "bundled";
                bundled.textContent = strings.bundledVersionOption.replace(
                    "{version}",
                    ReleaseUpdater.getBundledVersion(),
                );
                select.append(bundled);
                releases.forEach((release) => {
                    const option = document.createElement("option");
                    option.value = release.tag;
                    option.textContent = `v${release.version}`;
                    select.append(option);
                });
                const selected = ReleaseUpdater.getSelectedRelease()?.tag ?? "bundled";
                select.value = Array.from(select.options).some(
                    (option) => option.value === selected,
                )
                    ? selected
                    : "bundled";
                select.disabled = false;
                status.textContent = strings.versionListReady;
                button.textContent = strings.useSelectedVersion;
                button.onclick = () => {
                    if (select.value === "bundled") {
                        this.showVersionConfirmation("bundled", LOCALE);
                        return;
                    }
                    const release = releases.find((candidate) => candidate.tag === select.value);
                    if (release) this.showVersionConfirmation(release, LOCALE);
                };
                syncButton();
            } catch (error) {
                status.textContent = `${strings.versionListFailed}: ${
                    error instanceof Error ? error.message : String(error)
                }`;
                button.disabled = false;
                button.textContent = strings.retry;
                button.onclick = () => void load(true);
            }
        };

        return { card, load };
    }

    private static createUpdateSettings(LOCALE: string) {
        const strings = translations[LOCALE].settings.updates;
        const stack = document.createElement("div");
        stack.classList.add("update-settings-stack");
        const { card: versionSelector, load } = this.createVersionSelector(LOCALE);
        const autoCheck = CFM.getGlobal("autoUpdateCheck") as boolean;
        versionSelector.hidden = autoCheck;

        const toggle = this.createToggle(
            strings.autoCheck,
            "autoUpdateCheck",
            (enabled) => {
                this.saveGlobalOption("autoUpdateCheck", enabled);
                versionSelector.hidden = enabled;
                if (enabled) {
                    ReleaseUpdater.resetPromptedVersion();
                } else {
                    void load();
                }
            },
            strings.autoCheckDescription,
        );
        stack.append(toggle, this.createUpdateCard(LOCALE), versionSelector);
        if (!autoCheck) void load();
        return stack;
    }

    static async promptForUpdate(LOCALE: string) {
        if (!CFM.getGlobal("autoUpdateCheck")) return;
        const result = await ReleaseUpdater.check();
        if (result.status !== "available" || !ReleaseUpdater.shouldPromptFor(result.release)) {
            return;
        }
        if (document.querySelector("body > generic-modal")) return;
        ReleaseUpdater.markPrompted(result.release);

        const strings = translations[LOCALE].settings.updates;
        const content = document.createElement("div");
        content.id = "full-screen-update-prompt";
        content.classList.add("update-prompt");
        const description = document.createElement("p");
        description.textContent = strings.promptDescription
            .replace("{current}", CURRENT_VERSION)
            .replace("{version}", result.release.version);

        const actions = document.createElement("div");
        actions.classList.add("setting-button-row");
        const later = document.createElement("button");
        later.classList.add("main-buttons-button", "main-button-secondary");
        later.textContent = strings.later;
        later.onclick = () => Spicetify.PopupModal.hide();
        const update = document.createElement("button");
        update.classList.add("main-buttons-button", "main-button-primary");
        update.textContent = strings.confirmUpdate;
        update.onclick = () => {
            Spicetify.PopupModal.hide();
            ReleaseUpdater.switchToRelease(result.release, () => this.showReloadFallback(LOCALE));
        };
        actions.append(later, update);
        content.append(description, actions);

        Spicetify.PopupModal.display({
            title: strings.promptTitle,
            content,
        });
    }

    static openConfig(evt: Event | null = null): void {
        evt?.preventDefault();
        const configuredLocale = CFM.getGlobal("locale") as Config["locale"];
        const LOCALE = configuredLocale in translations ? configuredLocale : DEFAULTS.locale;
        if (LOCALE !== configuredLocale) CFM.setGlobal("locale", LOCALE);
        const strings = translations[LOCALE].settings;
        const layout = strings.layout;
        this.configContainer = document.createElement("div");
        this.configContainer.id = "full-screen-config-container";
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
                            Utils.getAvailableLanguages(translations),
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
                            strings.fsHideOriginal,
                            "fsHideOriginal",
                            (value) => {
                                this.saveGlobalOption("fsHideOriginal", value);
                                location.reload();
                            },
                            strings.fsHideOriginalDescription,
                        ),
                        this.createToggle(
                            strings.verticalMonitorSupport,
                            "verticalMonitorSupport",
                            (value: boolean) => this.saveOption("verticalMonitorSupport", value),
                            strings.verticalMonitorSupportDescription,
                        ),
                    ),
                    this.createSettingsGroup(
                        layout.groups.troubleshooting.title,
                        layout.groups.troubleshooting.description,
                        this.createToggle(
                            strings.debugMode.setting,
                            "debugMode",
                            (value) => {
                                const section =
                                    this.configContainer.querySelector<HTMLElement>(
                                        ".fsd-debug-settings",
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
                        layout.groups.controls.title,
                        layout.groups.controls.description,
                        this.createOptions(
                            strings.progressBar,
                            {
                                never: strings.contextDisplay.never,
                                mousemove: strings.contextDisplay.mouse,
                                always: strings.contextDisplay.always,
                            },
                            CFM.get("progressBarDisplay") as Settings["progressBarDisplay"],
                            "progressBarDisplay",
                            (value: string) => {
                                CFM.set(
                                    "progressBarDisplay",
                                    value as Settings["progressBarDisplay"],
                                );
                                if (value !== "never") {
                                    ReactDOM.render(
                                        <SeekableProgressBar state={value} />,
                                        DOM.container.querySelector("#fsd-progress-parent"),
                                    );
                                } else {
                                    const root =
                                        DOM.container.querySelector("#fsd-progress-parent");
                                    if (root) ReactDOM.unmountComponentAtNode(root);
                                }
                            },
                            layout.descriptions.progressBar,
                        ),
                        this.createOptions(
                            strings.playerControls,
                            {
                                never: strings.contextDisplay.never,
                                mousemove: strings.contextDisplay.mouse,
                                always: strings.contextDisplay.always,
                            },
                            CFM.get("playerControls") as Settings["playerControls"],
                            "playerControls",
                            (value: string) => this.saveOption("playerControls", value),
                            layout.descriptions.playerControls,
                        ),
                    ),
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
                            Number(CFM.get("lyricsSize") || DEFAULTS.def.lyricsSize),
                            1,
                            12,
                            99,
                            (value: number) =>
                                this.saveOption(
                                    "lyricsSize",
                                    value as unknown as Settings["lyricsSize"],
                                ),
                            strings.lyricsSize.description,
                        ),
                        this.createToggle(
                            strings.autoHideLyrics,
                            "autoHideLyrics",
                            undefined,
                            layout.descriptions.autoHideLyrics,
                        ),
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
                    this.createDebugSettings(LOCALE),
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
                            (state) => {
                                CFM.set("animationSpeed", Number(state) / 100);
                                modifyRotationSpeed(Number(state) / 100);
                            },
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
                            5,
                            (state) => {
                                CFM.set("backAnimationTime", Number(state));
                                DOM.container.style.setProperty("--fs-transition", `${state}s`);
                            },
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
                id: "appearance",
                title: layout.sections.appearance.title,
                section: this.createSettingsSection(
                    layout.sections.appearance.title,
                    layout.sections.appearance.description,
                    this.createSettingsGroup(
                        layout.groups.playbackTheme.title,
                        layout.groups.playbackTheme.description,
                        this.createToggle(
                            strings.themedButtons,
                            "themedButtons",
                            undefined,
                            layout.descriptions.themedButtons,
                        ),
                        this.createToggle(
                            strings.themedIcons,
                            "themedIcons",
                            undefined,
                            layout.descriptions.themedIcons,
                        ),
                        this.createOptions(
                            strings.invertColors.setting,
                            {
                                never: strings.invertColors.never,
                                always: strings.invertColors.always,
                                auto: strings.invertColors.auto,
                            },
                            CFM.get("invertColors") as Settings["invertColors"],
                            "invertColors",
                            (value: string) => this.saveOption("invertColors", value),
                            layout.descriptions.invertColors,
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
                        this.createUpdateSettings(LOCALE),
                    ),
                ),
            },
        ];
        this.configContainer.append(
            this.createSettingsShell(sections),
            this.getSettingsFooter(LOCALE),
        );
        Spicetify.PopupModal.display({
            title: strings.fullscreenConfig,
            content: this.configContainer,
        });
        window.requestAnimationFrame(() => void this.applyAlbumAccent());
    }
}
