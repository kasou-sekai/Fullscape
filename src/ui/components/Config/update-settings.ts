import translations from "../../../resources/strings";
import {
    CURRENT_VERSION,
    ReleaseUpdater,
    type ReleaseInfo,
    type UpdateCheckResult,
} from "../../../services/release-updater";
import CFM from "../../../utils/config";
import { createToggleControl } from "../../../utils/setting";

let updatePromptRetryTimer: number | null = null;

function showReloadFallback(LOCALE: string) {
    const strings = translations[LOCALE].settings.updates;
    const content = document.createElement("div");
    content.id = "fullscape-update-fallback";
    content.classList.add("update-dialog", "update-dialog-fallback");

    const icon = document.createElement("div");
    icon.classList.add("update-dialog-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 6.75 9.5 12 5 17.25M11.5 17.25H19" />
        </svg>`;

    const description = document.createElement("p");
    description.classList.add("update-dialog-description");
    description.textContent = strings.reloadFallbackDescription;
    const command = document.createElement("div");
    command.classList.add("update-command");
    command.innerHTML = `<span aria-hidden="true">$</span><code>spicetify apply</code>`;
    content.append(icon, description, command);

    Spicetify.PopupModal.display({
        title: strings.reloadFallbackTitle,
        content,
    });
}

type UpdateStrings = (typeof translations)[string]["settings"]["updates"];

function createVersionFlow(targetVersion: string, targetLabel: string, strings: UpdateStrings) {
    const flow = document.createElement("div");
    flow.classList.add("update-version-flow");
    flow.innerHTML = `
        <div class="update-version-stop">
            <span>${strings.currentVersion}</span>
            <strong>v${CURRENT_VERSION}</strong>
        </div>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        <div class="update-version-stop update-version-stop-target">
            <span>${targetLabel}</span>
            <strong>v${targetVersion}</strong>
        </div>`;
    return flow;
}

function bindReleaseSwitch(
    release: ReleaseInfo,
    locale: string,
    confirm: HTMLButtonElement,
    cancel: HTMLButtonElement,
    label: string,
) {
    const strings = translations[locale].settings.updates;
    confirm.textContent = label;
    confirm.onclick = async () => {
        confirm.disabled = cancel.disabled = true;
        confirm.textContent = strings.cachingVersion;
        let error: string;
        if (!(await ReleaseUpdater.cacheRelease(release))) {
            error = strings.cacheFailed.replace("{version}", release.version);
        } else if (!ReleaseUpdater.switchToRelease(release, () => showReloadFallback(locale))) {
            error = strings.storageFailed;
        } else {
            Spicetify.PopupModal.hide();
            return;
        }
        confirm.disabled = cancel.disabled = false;
        confirm.textContent = label;
        Spicetify.showNotification(error, true, 8000);
    };
}

function showVersionConfirmation(target: ReleaseInfo | "bundled", LOCALE: string) {
    const strings = translations[LOCALE].settings.updates;
    const content = document.createElement("div");
    content.id = "fullscape-version-confirmation";
    content.classList.add("update-dialog", "update-dialog-confirmation");

    const targetVersion =
        target === "bundled" ? ReleaseUpdater.getBundledVersion() : target.version;
    const icon = document.createElement("div");
    icon.classList.add("update-dialog-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M20 7v5h-5M4 17v-5h5" />
            <path d="M6.1 8.2A7 7 0 0 1 18.7 10M17.9 15.8A7 7 0 0 1 5.3 14" />
        </svg>`;

    const description = document.createElement("p");
    description.classList.add("update-dialog-description");
    description.textContent =
        target === "bundled"
            ? strings.confirmBundledDescription.replace(
                  "{version}",
                  ReleaseUpdater.getBundledVersion(),
              )
            : strings.confirmVersionDescription
                  .replace("{current}", CURRENT_VERSION)
                  .replace("{version}", target.version);

    const versionFlow = createVersionFlow(
        targetVersion,
        target === "bundled" ? strings.bundledVersion : strings.cardTitle,
        strings,
    );

    const actions = document.createElement("div");
    actions.classList.add("setting-button-row", "update-dialog-actions");
    const cancel = document.createElement("button");
    cancel.classList.add("main-buttons-button", "main-button-secondary");
    cancel.textContent = strings.cancel;
    cancel.onclick = () => Spicetify.PopupModal.hide();
    const confirm = document.createElement("button");
    confirm.classList.add("main-buttons-button", "main-button-primary");
    if (target === "bundled") {
        confirm.textContent = strings.confirmSwitch;
        confirm.onclick = () => {
            if (!ReleaseUpdater.switchToBundledVersion(() => showReloadFallback(LOCALE))) {
                Spicetify.showNotification(strings.storageFailed, true, 8000);
                return;
            }
            Spicetify.PopupModal.hide();
        };
    } else {
        bindReleaseSwitch(target, LOCALE, confirm, cancel, strings.confirmSwitch);
    }
    actions.append(cancel, confirm);
    content.append(icon, versionFlow, description, actions);

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

function createUpdateCard(LOCALE: string, refreshVersionList?: () => Promise<void> | void) {
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
            <div class="update-version-explanation"></div>
        </div>`;

    const title = card.querySelector<HTMLElement>(".setting-title");
    const version = card.querySelector<HTMLElement>(".update-version");
    const status = card.querySelector<HTMLElement>(".update-status");
    const explanation = card.querySelector<HTMLElement>(".update-version-explanation");
    const releaseLink = card.querySelector<HTMLAnchorElement>(".update-release-link");
    const button = card.querySelector<HTMLButtonElement>(".update-button");
    if (!title || !version || !status || !explanation || !releaseLink || !button) return card;

    title.textContent = strings.cardTitle;
    const bundledVersion = ReleaseUpdater.getBundledVersion();
    version.textContent = `${strings.currentVersion}: v${CURRENT_VERSION} · ${strings.bundledVersion}: v${bundledVersion}`;
    const appendExplanation = (label: string, description: string) => {
        const line = document.createElement("div");
        const heading = document.createElement("strong");
        heading.textContent = label;
        line.append(heading, document.createTextNode(` — ${description}`));
        explanation.append(line);
    };
    appendExplanation(strings.currentVersion, strings.runningVersionDescription);
    appendExplanation(strings.bundledVersion, strings.bundledVersionDescription);
    appendExplanation(strings.releaseCache, strings.releaseCacheDescription);
    releaseLink.textContent = strings.releasePage;
    releaseLink.hidden = true;

    const renderResult = (result: UpdateCheckResult) => {
        button.disabled = false;
        button.classList.remove("main-button-primary");
        button.classList.add("main-button-secondary");
        releaseLink.hidden = true;
        releaseLink.removeAttribute("href");
        const withCacheWarning = (message: string) =>
            result.status !== "error" && result.stale
                ? `${message} ${strings.cachedResultWarning}: ${result.message ?? strings.checkFailed}`
                : message;

        if (result.status === "available") {
            status.textContent = withCacheWarning(
                strings.available.replace("{version}", result.release.version),
            );
            button.textContent = strings.reviewUpdate;
            button.classList.remove("main-button-secondary");
            button.classList.add("main-button-primary");
            button.onclick = () => showVersionConfirmation(result.release, LOCALE);
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

        status.textContent = withCacheWarning(strings.upToDate);
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
        const result = await ReleaseUpdater.check(force);
        if (force) await refreshVersionList?.();
        renderResult(result);
    };

    void check();
    return card;
}

function createVersionSelector(LOCALE: string) {
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
    const confirmSelection = () => {
        if (select.value === "bundled") {
            showVersionConfirmation("bundled", LOCALE);
            return;
        }
        const release = releases.find((candidate) => candidate.tag === select.value);
        if (release) showVersionConfirmation(release, LOCALE);
    };

    button.onclick = confirmSelection;

    const load = async (force = false) => {
        select.disabled = true;
        button.disabled = true;
        status.textContent = strings.loadingVersions;
        try {
            releases = await ReleaseUpdater.listStableReleases(force);
            const runningTag = `v${CURRENT_VERSION}`;
            if (!force && !releases.some((release) => release.tag === runningTag)) {
                releases = await ReleaseUpdater.listStableReleases(true);
            }
            select.replaceChildren();
            const bundled = document.createElement("option");
            bundled.value = "bundled";
            bundled.textContent = strings.bundledVersionOption.replace(
                "{version}",
                ReleaseUpdater.getBundledVersion(),
            );
            select.append(bundled);
            const selectedRelease = ReleaseUpdater.getSelectedRelease();
            if (
                selectedRelease &&
                !releases.some((release) => release.tag === selectedRelease.tag)
            ) {
                const running = document.createElement("option");
                running.value = selectedRelease.tag;
                running.textContent = strings.runningVersionOption.replace(
                    "{version}",
                    selectedRelease.version,
                );
                select.append(running);
            }
            releases.forEach((release) => {
                const option = document.createElement("option");
                option.value = release.tag;
                option.textContent = `v${release.version}`;
                select.append(option);
            });
            const selected = ReleaseUpdater.getSelectedRelease()?.tag ?? "bundled";
            select.value = Array.from(select.options).some((option) => option.value === selected)
                ? selected
                : "bundled";
            select.disabled = false;
            const listWarning = ReleaseUpdater.getReleaseListWarning();
            status.textContent = listWarning
                ? `${strings.versionListReady} ${strings.cachedResultWarning}: ${listWarning}`
                : strings.versionListReady;
            button.textContent = strings.useSelectedVersion;
            button.onclick = confirmSelection;
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

export function createUpdateSettings(LOCALE: string, saveAutoCheck: (enabled: boolean) => void) {
    const strings = translations[LOCALE].settings.updates;
    const stack = document.createElement("div");
    stack.classList.add("update-settings-stack");
    const { card: versionSelector, load } = createVersionSelector(LOCALE);
    const autoCheck = CFM.getGlobal("autoUpdateCheck") as boolean;
    versionSelector.hidden = autoCheck;
    const updateCard = createUpdateCard(LOCALE, async () => {
        if (!versionSelector.hidden) await load(true);
    });

    const toggle = createToggleControl(
        strings.autoCheck,
        "autoUpdateCheck",
        autoCheck,
        (enabled) => {
            saveAutoCheck(enabled);
            versionSelector.hidden = enabled;
            if (enabled) {
                ReleaseUpdater.resetPromptedVersion();
            } else {
                void load();
            }
        },
        strings.autoCheckDescription,
    );
    stack.append(toggle, updateCard, versionSelector);
    if (!autoCheck) void load();
    return stack;
}

export async function promptForUpdate(LOCALE: string) {
    if (!CFM.getGlobal("autoUpdateCheck")) return;
    const result = await ReleaseUpdater.check();
    if (result.status !== "available" || !ReleaseUpdater.shouldPromptFor(result.release)) {
        return;
    }
    if (document.querySelector("body > generic-modal")) {
        if (updatePromptRetryTimer === null) {
            updatePromptRetryTimer = window.setTimeout(() => {
                updatePromptRetryTimer = null;
                void promptForUpdate(LOCALE);
            }, 30000);
        }
        return;
    }

    const strings = translations[LOCALE].settings.updates;
    const content = document.createElement("div");
    content.id = "fullscape-update-prompt";
    content.classList.add("update-dialog", "update-dialog-available");

    const icon = document.createElement("div");
    icon.classList.add("update-dialog-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />
        </svg>`;
    const description = document.createElement("p");
    description.classList.add("update-dialog-description");
    description.textContent = strings.promptDescription
        .replace("{current}", CURRENT_VERSION)
        .replace("{version}", result.release.version);

    const versionFlow = createVersionFlow(result.release.version, strings.cardTitle, strings);

    const actions = document.createElement("div");
    actions.classList.add("setting-button-row", "update-dialog-actions");
    const releaseNotes = document.createElement("a");
    releaseNotes.classList.add("update-dialog-link");
    releaseNotes.href = result.release.pageUrl;
    releaseNotes.target = "_blank";
    releaseNotes.rel = "noreferrer";
    releaseNotes.textContent = strings.releasePage;
    const later = document.createElement("button");
    later.classList.add("main-buttons-button", "main-button-secondary");
    later.textContent = strings.later;
    later.onclick = () => Spicetify.PopupModal.hide();
    const update = document.createElement("button");
    update.classList.add("main-buttons-button", "main-button-primary");
    bindReleaseSwitch(result.release, LOCALE, update, later, strings.confirmUpdate);
    actions.append(releaseNotes, later, update);
    content.append(icon, versionFlow, description, actions);

    Spicetify.PopupModal.display({
        title: strings.promptTitle,
        content,
    });
    ReleaseUpdater.markPrompted(result.release);
}
