import CFM from "../../../utils/config";
import translations from "../../../resources/strings";
import ICONS from "../../../constants";
import { DOM } from "../../elements";
import { QueueAdapter, QueueEntry } from "../../../services/queue-adapter";
import "./styles.scss";

type ArtworkOrigin = { uri: string; src: string; rect: DOMRect };

/** The queue is a wall of upcoming artwork; the playing artwork lives on the left. */
export class Queue {
    private static container: HTMLElement | null = null;
    private static revision = "";
    private static refreshTimers: ReturnType<typeof setTimeout>[] = [];
    private static updateTimer: ReturnType<typeof setTimeout> | null = null;
    private static selectionTimer: ReturnType<typeof setTimeout> | null = null;
    private static selection = 0;
    private static selected: ArtworkOrigin | null = null;
    private static incoming: ArtworkOrigin | null = null;
    private static flight: HTMLElement | null = null;
    private static animation: Animation | null = null;
    private static oldArtwork: HTMLElement | null = null;

    private static get strings() {
        return (translations[CFM.getGlobal("locale") as string] || translations["en-US"]).queue;
    }

    static attach(container: HTMLElement) {
        this.teardown();
        this.container = container;
        container.setAttribute("role", "region");
        container.setAttribute("aria-label", "Queue");
        this.update(true);
        this.refreshTimers = [250, 900].map((delay) => setTimeout(() => this.update(), delay));
    }

    static teardown() {
        this.selection++;
        this.refreshTimers.forEach(clearTimeout);
        this.refreshTimers = [];
        if (this.updateTimer) clearTimeout(this.updateTimer);
        if (this.selectionTimer) clearTimeout(this.selectionTimer);
        this.updateTimer = null;
        this.selectionTimer = null;
        this.selected = null;
        this.incoming = null;
        this.cancelFlight();
        this.container?.replaceChildren();
        this.container = null;
        this.revision = "";
    }

    // Arrow binding is intentional: Spotify invokes this as an event callback.
    static scheduleUpdate = () => {
        if (!Queue.container || Queue.updateTimer) return;
        Queue.updateTimer = setTimeout(() => {
            Queue.updateTimer = null;
            Queue.update();
        }, 0);
    };

    static update(force = false) {
        const container = this.container;
        if (!container) return;
        try {
            const snapshot = QueueAdapter.read();
            const entries = [...snapshot.next, ...snapshot.later].filter(
                (entry) => !entry.isCurrent,
            );
            const revision = JSON.stringify(
                entries.map((entry) => [
                    entry.uid,
                    entry.uri,
                    entry.title,
                    entry.artists,
                    entry.imageUrl,
                ]),
            );
            if (!force && revision === this.revision) return;
            this.revision = revision;
            const oldScroll =
                container.querySelector<HTMLElement>(".queue-gallery")?.scrollTop || 0;
            const activeUid = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
                ".queue-tile",
            )?.dataset.uid;
            const heading = document.createElement("h2");
            heading.textContent = "Queue";
            heading.className = "queue-heading";
            const gallery = document.createElement("div");
            gallery.className = "queue-gallery";
            for (const entry of entries) gallery.append(this.createTile(entry));
            if (!entries.length) {
                const empty = document.createElement("p");
                empty.className = "queue-empty";
                empty.textContent = this.strings.empty;
                gallery.append(empty);
            }
            container.replaceChildren(heading, gallery);
            gallery.scrollTop = oldScroll;
            if (activeUid) {
                const replacement = Array.from(
                    gallery.querySelectorAll<HTMLElement>(".queue-tile"),
                ).find((tile) => tile.dataset.uid === activeUid);
                (replacement || container).focus({ preventScroll: true });
            }
        } catch (error) {
            console.warn("[Fullscape] Unable to read queue", error);
            if (!container.children.length) {
                const heading = document.createElement("h2");
                heading.className = "queue-heading";
                heading.textContent = "Queue";
                const message = document.createElement("p");
                message.className = "queue-empty";
                message.textContent = this.strings.actionUnavailable;
                container.replaceChildren(heading, message);
            }
        }
    }

    private static createTile(entry: QueueEntry) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "queue-tile";
        tile.dataset.uid = entry.uid;
        tile.dataset.uri = entry.uri;
        const artist = entry.artists.join(" · ") || this.strings.unknown;
        tile.setAttribute("aria-label", `${this.strings.playNow}: ${entry.title} — ${artist}`);
        tile.title = `${entry.title} — ${artist}`;
        const image = document.createElement("img");
        image.className = "queue-artwork";
        image.alt = "";
        image.loading = "lazy";
        image.draggable = false;
        image.src = entry.imageUrl || ICONS.OFFLINE_SVG;
        image.onerror = () => {
            image.onerror = null;
            image.src = ICONS.OFFLINE_SVG;
        };
        const title = document.createElement("span");
        title.className = "queue-track-title";
        title.textContent = entry.title;
        const subtitle = document.createElement("span");
        subtitle.className = "queue-track-artist";
        subtitle.textContent = artist;
        tile.append(image, title, subtitle);
        tile.onclick = () => void this.select(entry, image, tile);
        return tile;
    }

    private static async select(
        entry: QueueEntry,
        image: HTMLImageElement,
        tile: HTMLButtonElement,
    ) {
        const request = ++this.selection;
        if (this.selectionTimer) clearTimeout(this.selectionTimer);
        this.selected = {
            uri: entry.uri,
            src: image.currentSrc || image.src,
            rect: image.getBoundingClientRect(),
        };
        this.container
            ?.querySelectorAll(".is-selected")
            .forEach((node) => node.classList.remove("is-selected"));
        tile.classList.add("is-selected");
        tile.setAttribute("aria-busy", "true");
        // Animate only after Spotify confirms the new track and its artwork loads.
        const result = await QueueAdapter.play(entry);
        if (request !== this.selection) return;
        tile.removeAttribute("aria-busy");
        if (!result.ok) {
            this.selected = null;
            tile.classList.remove("is-selected");
            Spicetify.showNotification(this.strings.actionUnavailable, true, 4500);
            return;
        }
        this.selectionTimer = setTimeout(() => {
            if (request !== this.selection) return;
            this.selected = null;
            tile.classList.remove("is-selected");
        }, 8000);
    }

    /** Capture geometry before queue_update removes the newly playing tile. */
    static captureIncoming() {
        this.cancelFlight();
        this.incoming = null;
        if (!DOM.container.classList.contains("side-view-queue")) return;
        const uri = Spicetify.Player.data?.item?.uri;
        if (!uri) return;
        if (this.selected?.uri === uri) this.incoming = this.selected;
        else {
            const tile = Array.from(
                this.container?.querySelectorAll<HTMLElement>(".queue-tile") || [],
            ).find((node) => node.dataset.uri === uri);
            const image = tile?.querySelector<HTMLImageElement>("img");
            if (image) {
                const rect = image.getBoundingClientRect();
                const gallery = this.container?.getBoundingClientRect();
                if (gallery && rect.top >= gallery.top && rect.bottom <= gallery.bottom) {
                    this.incoming = { uri, src: image.currentSrc || image.src, rect };
                }
            }
        }
        this.selected = null;
        if (this.incoming && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            const rect = DOM.cover.getBoundingClientRect();
            const old = document.createElement("div");
            old.className = "queue-artwork-flight";
            old.setAttribute("aria-hidden", "true");
            Object.assign(old.style, {
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                backgroundImage: getComputedStyle(DOM.cover).backgroundImage,
                backgroundSize: "cover",
                borderRadius: "6px",
            });
            DOM.container.append(old);
            this.oldArtwork = old;
        }
    }

    static cancelHandoff() {
        this.incoming = null;
        this.cancelFlight();
    }

    /** Called from master's image onload, after Cover has applied the new aspect ratio. */
    static async landIncoming() {
        const incoming = this.incoming;
        // Master's paused artwork grows back on play. Land at its settled bounds.
        const layoutAnimations = DOM.cover.parentElement?.parentElement?.getAnimations() || [];
        if (incoming && layoutAnimations.length) {
            await Promise.allSettled(layoutAnimations.map((animation) => animation.finished));
            if (this.incoming !== incoming) return;
        }
        this.incoming = null;
        if (
            !incoming ||
            incoming.uri !== Spicetify.Player.data?.item?.uri ||
            !DOM.container.isConnected ||
            !DOM.container.classList.contains("side-view-queue") ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
            this.cancelFlight();
            return;
        }
        const target = DOM.cover.getBoundingClientRect();
        if (!target.width || !incoming.rect.width) {
            this.cancelFlight();
            return;
        }
        const flight = document.createElement("img");
        flight.src = incoming.src;
        flight.alt = "";
        flight.className = "queue-artwork-flight";
        flight.setAttribute("aria-hidden", "true");
        Object.assign(flight.style, {
            left: `${incoming.rect.left}px`,
            top: `${incoming.rect.top}px`,
            width: `${incoming.rect.width}px`,
            height: `${incoming.rect.height}px`,
        });
        DOM.container.append(flight);
        this.flight = flight;
        DOM.cover.classList.add("queue-artwork-landing");
        this.oldArtwork?.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 450,
            fill: "forwards",
        });
        const animation = flight.animate(
            [
                { transform: "translate3d(0,0,0) scale(1)", borderRadius: "8px" },
                {
                    transform: `translate3d(${target.left - incoming.rect.left}px,${target.top - incoming.rect.top}px,0) scale(${target.width / incoming.rect.width},${target.height / incoming.rect.height})`,
                    borderRadius: "6px",
                },
            ],
            { duration: 680, easing: "cubic-bezier(.22,.75,.18,1)", fill: "forwards" },
        );
        this.animation = animation;
        void animation.finished
            .then(async () => {
                if (this.flight !== flight) return;
                DOM.cover.classList.remove("queue-artwork-landing");
                await flight.animate([{ opacity: 1 }, { opacity: 0 }], {
                    duration: 140,
                    fill: "forwards",
                }).finished;
                if (this.flight === flight) this.cancelFlight();
            })
            .catch(() => {
                /* A new track or closing FullScape cancels the handoff. */
            });
    }

    private static cancelFlight() {
        this.animation?.cancel();
        this.animation = null;
        this.flight?.remove();
        this.flight = null;
        this.oldArtwork?.remove();
        this.oldArtwork = null;
        DOM.cover?.classList.remove("queue-artwork-landing");
    }
}
