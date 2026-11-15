import {
    deleteOfflineFuriganaDictionary,
    downloadOfflineFuriganaDictionary,
    getOfflineFuriganaDictionaryStatus,
    OFFLINE_FURIGANA_DICTIONARY_SIZE,
} from "../../../services/offline-furigana-dictionary";
import translations from "../../../resources/strings";
import CFM from "../../../utils/config";
import { getSettingCard, headerText } from "../../../utils/setting";
import { Lyrics } from "../Lyrics/Lyrics";

function formatLyricTime(time: number | null) {
    if (time === null || !Number.isFinite(time)) return "--:--";
    const totalSeconds = Math.max(0, Math.floor(time / 1000));
    const minutes = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
}

function createLyricsDiagnosticsCard(LOCALE: string) {
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

    const providerEnabled =
        Boolean(CFM.get("thirdPartyLyrics")) || diagnostics.sourceFamily === "apple-music";
    const providerStatus = providerEnabled
        ? (strings.providerStatuses[diagnostics.thirdParty.status] ?? diagnostics.thirdParty.status)
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
            ? `[${formatLyricTime(diagnostics.thirdParty.spotifyFirst.time)}] ${diagnostics.thirdParty.spotifyFirst.text}`
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
            .map((line) => `[${formatLyricTime(line.time)}] ${line.text}`)
            .join("\n"),
    );
    if (diagnostics.thirdParty.matchedFirst) {
        appendRow(
            provider,
            strings.matchedFirst,
            `[${formatLyricTime(diagnostics.thirdParty.matchedFirst.time)}] ${diagnostics.thirdParty.matchedFirst.text}`,
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
                `[${formatLyricTime(candidate.first.time)}] ${candidate.first.text}`,
            );
        }
        appendBlock(
            candidateElement,
            strings.preview,
            (candidate.preview ?? [])
                .map((line) => `[${formatLyricTime(line.time)}] ${line.text}`)
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
                return `[${formatLyricTime(line.time)}] (${index + 1}) ${line.text}${flags ? ` <${flags}>` : ""}`;
            })
            .join("\n"),
    );
    return card;
}

function createLyricsRefreshCard(LOCALE: string) {
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
        const diagnosticsCard = card
            .closest(".fullscape-debug-settings")
            ?.querySelector(".lyrics-diagnostics-card");
        diagnosticsCard?.replaceWith(createLyricsDiagnosticsCard(LOCALE));
        window.setTimeout(() => {
            if (!button.isConnected) return;
            button.disabled = false;
            button.textContent = strings.button;
        }, 1500);
    };
    return card;
}

export function createOfflineFuriganaDictionaryCard(LOCALE: string) {
    const strings = translations[LOCALE].settings.offlineFuriganaDictionary;
    const card = getSettingCard(
        `<div class="offline-furigana-actions">
            <span class="offline-furigana-status">${strings.notDownloaded}</span>
            <button type="button" class="main-buttons-button main-button-secondary offline-furigana-download">${strings.download}</button>
            <button type="button" class="main-buttons-button main-button-secondary offline-furigana-delete">${strings.delete}</button>
        </div>`,
        strings.setting,
        "showLyricsFurigana",
        strings.description,
    );
    const status = card.querySelector<HTMLElement>(".offline-furigana-status");
    const download = card.querySelector<HTMLButtonElement>(".offline-furigana-download");
    const deleteButton = card.querySelector<HTMLButtonElement>(".offline-furigana-delete");
    if (!status || !download || !deleteButton) return card;

    const setBusy = (busy: boolean) => {
        download.disabled = busy;
        deleteButton.disabled = busy;
    };
    const refreshStatus = async () => {
        const dictionary = await getOfflineFuriganaDictionaryStatus();
        status.textContent = dictionary.available
            ? strings.ready.replace("{size}", OFFLINE_FURIGANA_DICTIONARY_SIZE)
            : strings.notDownloaded;
        download.hidden = dictionary.available;
        deleteButton.hidden = !dictionary.available;
    };

    download.onclick = async () => {
        setBusy(true);
        status.textContent = strings.downloading;
        let completed = false;
        try {
            await downloadOfflineFuriganaDictionary();
            completed = true;
            status.textContent = strings.downloaded;
            Lyrics.refreshRenderedFurigana();
        } catch {
            status.textContent = strings.error;
        } finally {
            setBusy(false);
            if (completed) await refreshStatus();
        }
    };
    deleteButton.onclick = async () => {
        setBusy(true);
        status.textContent = strings.deleting;
        let completed = false;
        try {
            await deleteOfflineFuriganaDictionary();
            completed = true;
            status.textContent = strings.deleted;
            Lyrics.refreshRenderedFurigana();
        } catch {
            status.textContent = strings.error;
        } finally {
            setBusy(false);
            if (completed) await refreshStatus();
        }
    };
    void refreshStatus();
    return card;
}

export function createLyricsDebugSettings(LOCALE: string) {
    const section = document.createElement("section");
    section.classList.add("fullscape-debug-settings", "settings-nested-section");
    section.hidden = !CFM.get("debugMode");
    section.append(
        headerText(translations[LOCALE].settings.lyricsDebugHeader),
        createLyricsRefreshCard(LOCALE),
        createLyricsDiagnosticsCard(LOCALE),
    );
    return section;
}
