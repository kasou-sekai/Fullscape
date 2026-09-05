import CFM from "../../../utils/config";
import translations from "../../../resources/strings";
import ICONS from "../../../constants";
import { QueueAdapter, QueueEntry, QueueSnapshot } from "../../../services/queue-adapter";
import { Config } from "../../../types/fullscape";

import "./styles.scss";

type QueueStrings = {
    title: string;
    lyrics: string;
    current: string;
    upNext: string;
    later: string;
    empty: string;
    clear: string;
    clearConfirm: string;
    playNow: string;
    moveNext: string;
    remove: string;
    openTrack: string;
    openArtist: string;
    openAlbum: string;
    playing: string;
    paused: string;
    manual: string;
    context: string;
    recommendation: string;
    unknown: string;
    reorderUnavailable: string;
    actionUnavailable: string;
};

type QueueOptions = {
    onClose: () => void;
    onNavigate: (uri: string) => void;
};

const getStrings = (): QueueStrings => {
    const locale = CFM.getGlobal("locale") as Config["locale"];
    return translations[locale].queue as QueueStrings;
};

const text = (value: string) => {
    const node = document.createElement("span");
    node.textContent = value;
    return node;
};

const getArtistText = (entry: QueueEntry, strings: QueueStrings) =>
    entry.artists.length ? entry.artists.join(", ") : strings.unknown;

const formatDuration = (durationMs: number) => {
    if (!durationMs) return "—";
    const seconds = Math.max(0, Math.round(durationMs / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export class Queue {
    private static container: HTMLElement | null = null;
    private static options: QueueOptions | null = null;
    private static lastRevision = "";
    private static updateTimer: ReturnType<typeof setTimeout> | null = null;
    private static refreshTimers: ReturnType<typeof setTimeout>[] = [];
    private static dragUid: string | null = null;

    static attach(container: HTMLElement, options: QueueOptions) {
        this.teardown();
        this.container = container;
        this.options = options;
        this.container.tabIndex = -1;
        this.container.setAttribute("role", "region");
        this.container.setAttribute("aria-label", getStrings().title);
        this.update(true);
        // Spotify can populate its internal queue just after the FullScape view mounts.
        // Re-read after layout and after the player has had a chance to publish it.
        this.refreshTimers = [250, 900].map((delay) =>
            setTimeout(() => {
                if (this.container === container) this.update(true);
            }, delay),
        );
    }

    static teardown() {
        if (this.updateTimer) clearTimeout(this.updateTimer);
        this.updateTimer = null;
        this.refreshTimers.forEach((timer) => clearTimeout(timer));
        this.refreshTimers = [];
        this.dragUid = null;
        this.lastRevision = "";
        this.options = null;
        this.container?.replaceChildren();
        this.container = null;
    }

    static scheduleUpdate() {
        if (!this.container || this.updateTimer) return;
        this.updateTimer = setTimeout(() => {
            this.updateTimer = null;
            this.update();
        }, 0);
    }

    static update(force = false) {
        if (!this.container || !this.options) return;
        let snapshot: QueueSnapshot;
        try {
            snapshot = QueueAdapter.read();
        } catch (error) {
            console.warn("[Fullscape] Unable to read Spotify queue.", error);
            snapshot = { revision: `unavailable:${Date.now()}`, current: null, next: [], later: [] };
        }
        const revision = `${snapshot.revision}:${snapshot.current?.uid ?? ""}:${snapshot.current?.uri ?? ""}`;
        if (!force && revision === this.lastRevision) return;
        this.lastRevision = revision;
        try {
            this.render(snapshot);
        } catch (error) {
            console.warn("[Fullscape] Unable to render queue.", error);
            this.renderUnavailable();
        }
    }

    static focus() {
        if (!this.container) return;
        this.container.focus({ preventScroll: true });
    }

    private static render(snapshot: QueueSnapshot) {
        const container = this.container;
        const options = this.options;
        if (!container || !options) return;
        const strings = getStrings();
        const queueEntries = [...snapshot.next, ...snapshot.later];
        const canReorder =
            QueueAdapter.canReorder() && queueEntries.every((entry) => entry.hasSpotifyUid);
        container.replaceChildren();

        const shell = document.createElement("div");
        shell.className = "queue-shell";

        const header = document.createElement("header");
        header.className = "queue-header";
        const heading = document.createElement("div");
        heading.className = "queue-heading";
        const eyebrow = document.createElement("span");
        eyebrow.className = "queue-eyebrow";
        eyebrow.textContent = strings.title.toUpperCase();
        const title = document.createElement("h2");
        title.textContent = strings.title;
        heading.append(eyebrow, title);

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "queue-icon-button";
        closeButton.innerHTML = ICONS.APPLE_MUSIC_LYRICS;
        closeButton.setAttribute("aria-label", strings.lyrics);
        closeButton.title = strings.lyrics;
        closeButton.onclick = options.onClose;
        header.append(heading, closeButton);
        shell.append(header);

        const scroll = document.createElement("div");
        scroll.className = "queue-scroll";
        if (snapshot.current) {
            const currentSection = this.createSection(
                strings.current,
                [snapshot.current],
                strings,
                options,
                true,
                0,
                canReorder,
            );
            scroll.append(currentSection);
        }
        scroll.append(
            this.createSection(
                strings.upNext,
                snapshot.next,
                strings,
                options,
                false,
                0,
                canReorder,
            ),
            this.createSection(
                strings.later,
                snapshot.later,
                strings,
                options,
                false,
                snapshot.next.length,
                canReorder,
            ),
        );
        shell.append(scroll);

        const footer = document.createElement("footer");
        footer.className = "queue-footer";
        if (!canReorder && (snapshot.next.length || snapshot.later.length)) {
            footer.append(text(strings.reorderUnavailable));
        }
        const clearButton = document.createElement("button");
        clearButton.type = "button";
        clearButton.className = "queue-clear-button";
        clearButton.textContent = strings.clear;
        clearButton.disabled = !snapshot.next.length && !snapshot.later.length;
        clearButton.onclick = () => void this.clearQueue(strings);
        footer.append(clearButton);
        shell.append(footer);
        container.append(shell);
    }

    private static createSection(
        label: string,
        entries: QueueEntry[],
        strings: QueueStrings,
        options: QueueOptions,
        current: boolean,
        offset: number,
        canReorder: boolean,
    ) {
        const section = document.createElement("section");
        section.className = `queue-section${current ? " queue-section-current" : ""}`;
        const heading = document.createElement("h3");
        heading.textContent = label;
        section.append(heading);
        const list = document.createElement("div");
        list.className = "queue-list";
        list.setAttribute("role", "list");
        if (!entries.length) {
            const empty = document.createElement("p");
            empty.className = "queue-empty";
            empty.textContent = strings.empty;
            list.append(empty);
        } else {
            entries.forEach((entry, index) =>
                list.append(
                    this.createEntry(
                        entry,
                        strings,
                        options,
                        current,
                        offset + index,
                        canReorder,
                    ),
                ),
            );
        }
        section.append(list);
        return section;
    }

    private static renderUnavailable() {
        const container = this.container;
        const options = this.options;
        if (!container || !options) return;
        const strings = getStrings();
        container.replaceChildren();
        const shell = document.createElement("div");
        shell.className = "queue-shell";
        const header = document.createElement("header");
        header.className = "queue-header";
        const title = document.createElement("h2");
        title.className = "queue-heading";
        title.textContent = strings.title;
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "queue-icon-button";
        closeButton.innerHTML = ICONS.APPLE_MUSIC_LYRICS;
        closeButton.setAttribute("aria-label", strings.lyrics);
        closeButton.title = strings.lyrics;
        closeButton.onclick = options.onClose;
        header.append(title, closeButton);
        const message = document.createElement("p");
        message.className = "queue-empty queue-error";
        message.textContent = strings.empty;
        shell.append(header, message);
        container.append(shell);
    }

    private static createEntry(
        entry: QueueEntry,
        strings: QueueStrings,
        options: QueueOptions,
        current: boolean,
        index: number,
        canReorder: boolean,
    ) {
        const row = document.createElement("article");
        row.className = `queue-entry${current ? " queue-entry-current" : ""}`;
        row.dataset.uid = entry.uid;
        row.dataset.index = String(index);
        row.setAttribute("role", "listitem");
        if (current) row.setAttribute("aria-current", "true");
        if (canReorder && !current) {
            row.draggable = true;
            row.addEventListener("dragstart", (event) => {
                this.dragUid = entry.uid;
                row.classList.add("queue-entry-dragging");
                event.dataTransfer?.setData("text/plain", entry.uid);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            });
            row.addEventListener("dragend", () => {
                this.dragUid = null;
                row.classList.remove("queue-entry-dragging");
            });
            row.addEventListener("dragover", (event) => {
                event.preventDefault();
                row.classList.add("queue-entry-drag-target");
            });
            row.addEventListener("dragleave", () => row.classList.remove("queue-entry-drag-target"));
            row.addEventListener("drop", (event) => {
                event.preventDefault();
                row.classList.remove("queue-entry-drag-target");
                const uid = event.dataTransfer?.getData("text/plain") || this.dragUid;
                if (!uid || uid === entry.uid) return;
                const targetIndex = Number(row.dataset.index);
                const snapshot = QueueAdapter.read();
                const dragged = [...snapshot.next, ...snapshot.later].find(
                    (candidate) => candidate.uid === uid,
                );
                if (dragged && Number.isInteger(targetIndex)) {
                    void QueueAdapter.reorder(dragged, targetIndex).then((result) => {
                        if (!result.ok) this.showActionUnavailable(strings);
                        else this.scheduleUpdate();
                    });
                }
            });
        }

        const cover = document.createElement("img");
        cover.className = "queue-entry-cover";
        cover.alt = "";
        cover.src = entry.imageUrl || ICONS.OFFLINE_SVG;
        cover.onerror = () => {
            cover.onerror = null;
            cover.src = ICONS.OFFLINE_SVG;
        };

        const main = document.createElement("button");
        main.type = "button";
        main.className = "queue-entry-main";
        main.setAttribute(
            "aria-label",
            `${entry.title} — ${getArtistText(entry, strings)}${current ? `, ${this.sourceLabel(entry, strings)}` : ""}`,
        );
        main.title = entry.title;
        main.onclick = () => {
            if (current) return;
            main.focus();
        };
        main.ondblclick = () => void this.playEntry(entry, strings);
        main.onkeydown = (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void this.playEntry(entry, strings);
            }
        };

        const details = document.createElement("span");
        details.className = "queue-entry-details";
        const title = document.createElement("strong");
        title.className = "queue-entry-title";
        title.textContent = entry.title;
        const artist = document.createElement("span");
        artist.className = "queue-entry-artist";
        artist.textContent = getArtistText(entry, strings);
        const source = document.createElement("span");
        source.className = "queue-entry-source";
        if (current) {
            const state = document.createElement("span");
            state.className = "queue-entry-state";
            state.textContent = Spicetify.Player.isPlaying() ? "▶" : "Ⅱ";
            state.setAttribute("aria-hidden", "true");
            source.append(state, document.createTextNode(` ${this.sourceLabel(entry, strings)}`));
        } else {
            source.textContent = this.sourceLabel(entry, strings);
        }
        details.append(title, artist, source);
        main.append(details);

        const duration = document.createElement("time");
        duration.className = "queue-entry-duration";
        duration.textContent = formatDuration(entry.durationMs);
        duration.dateTime = String(Math.round(entry.durationMs / 1000));

        const actions = this.createActions(entry, strings, options);
        if (canReorder && !current) {
            const handle = document.createElement("span");
            handle.className = "queue-drag-handle";
            handle.textContent = "⋮⋮";
            handle.setAttribute("aria-hidden", "true");
            row.append(handle);
        }
        row.append(cover, main, duration, actions);
        return row;
    }

    private static createActions(entry: QueueEntry, strings: QueueStrings, options: QueueOptions) {
        const wrapper = document.createElement("div");
        wrapper.className = "queue-entry-actions";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "queue-more-button";
        button.textContent = "•••";
        button.setAttribute("aria-label", strings.title);
        button.title = strings.title;
        const menu = document.createElement("div");
        menu.className = "queue-entry-menu";
        menu.hidden = true;
        menu.setAttribute("role", "menu");

        const addAction = (label: string, action: () => void, disabled = false) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "queue-menu-item";
            item.textContent = label;
            item.disabled = disabled;
            if (disabled) item.title = strings.reorderUnavailable;
            item.setAttribute("role", "menuitem");
            item.onclick = () => {
                menu.hidden = true;
                action();
            };
            menu.append(item);
        };
        addAction(strings.playNow, () => void this.playEntry(entry, strings), entry.isCurrent);
        addAction(
            strings.moveNext,
            () => void this.moveNext(entry, strings),
            !QueueAdapter.canReorder() || !entry.hasSpotifyUid,
        );
        addAction(
            strings.remove,
            () => void this.removeEntry(entry, strings),
            entry.isCurrent || !QueueAdapter.canRemove(entry),
        );
        addAction(strings.openTrack, () => options.onNavigate(entry.uri));
        if (entry.artistUris[0]) addAction(strings.openArtist, () => options.onNavigate(entry.artistUris[0]));
        if (entry.albumUri) addAction(strings.openAlbum, () => options.onNavigate(entry.albumUri));

        button.onclick = (event) => {
            event.stopPropagation();
            const wasHidden = menu.hidden;
            document.querySelectorAll<HTMLElement>(".queue-entry-menu").forEach((item) => {
                item.hidden = true;
            });
            menu.hidden = !wasHidden;
        };
        wrapper.append(button, menu);
        return wrapper;
    }

    private static sourceLabel(entry: QueueEntry, strings: QueueStrings) {
        if (entry.isCurrent) return Spicetify.Player.isPlaying() ? strings.playing : strings.paused;
        switch (entry.source) {
            case "manual":
                return strings.manual;
            case "recommendation":
                return strings.recommendation;
            case "context":
                return strings.context;
            default:
                return strings.unknown;
        }
    }

    private static async playEntry(entry: QueueEntry, strings: QueueStrings) {
        const result = await QueueAdapter.play(entry);
        if (!result.ok) this.showActionUnavailable(strings);
    }

    private static async removeEntry(entry: QueueEntry, strings: QueueStrings) {
        const result = await QueueAdapter.remove(entry);
        if (!result.ok) this.showActionUnavailable(strings);
        else this.scheduleUpdate();
    }

    private static async moveNext(entry: QueueEntry, strings: QueueStrings) {
        const result = await QueueAdapter.reorder(entry, 0);
        if (!result.ok) this.showActionUnavailable(strings);
        else this.scheduleUpdate();
    }

    private static async clearQueue(strings: QueueStrings) {
        if (!window.confirm(strings.clearConfirm)) return;
        const result = await QueueAdapter.clear();
        if (!result.ok) this.showActionUnavailable(strings);
        else this.scheduleUpdate();
    }

    private static showActionUnavailable(strings: QueueStrings) {
        Spicetify.showNotification(strings.actionUnavailable, true, 4500);
    }
}
