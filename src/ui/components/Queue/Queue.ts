import CFM from "../../../utils/config";
import translations from "../../../resources/strings";
import ICONS from "../../../constants";
import { DOM } from "../../elements";
import { QueueAdapter, QueueEntry } from "../../../services/queue-adapter";
import {
    createOverflowScrollAnimation,
    getOverflowScrollTiming,
} from "../../../utils/overflow-scroll";
import "./styles.scss";
import { layoutQueue } from "./layout";
import { getQueueTileMotion } from "./motion";

type ArtworkOrigin = { uri: string; src: string; rect: DOMRect };

/** The queue is a wall of upcoming artwork; the playing artwork lives on the left. */
export class Queue {
    private static container: HTMLElement | null = null;
    private static revision = "";
    private static layoutObserver: ResizeObserver | null = null;
    private static deferredUpdate = false;
    private static tileOverflowAnimations = new WeakMap<HTMLElement, Animation[]>();
    private static scrollGallery: HTMLElement | null = null;
    private static scrollFrame: number | null = null;
    private static scrollListener: (() => void) | null = null;

    private static layoutGallery() {
        const gallery = this.container?.querySelector<HTMLElement>(".queue-gallery");
        const wall = gallery?.querySelector<HTMLElement>(".queue-wall");
        if (!gallery || !wall) return;
        const tiles = Array.from(wall.querySelectorAll<HTMLElement>(".queue-tile"));
        const width = gallery.clientWidth - 16;
        if (!Number.isFinite(width) || width <= 0) return;
        const layout = layoutQueue(width, tiles.length);
        const labels = [
            [".queue-up-next-label", layout.labels.upNext],
            [".queue-heading", layout.labels.queue],
        ] as const;
        labels.forEach(([selector, position]) => {
            const label = wall.querySelector<HTMLElement>(selector);
            if (!label) return;
            Object.assign(label.style, {
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: "width" in position && position.width ? `${position.width}px` : "",
            });
        });
        tiles.forEach((tile, index) => {
            const position = layout.tiles[index];
            Object.assign(tile.style, {
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${position.width}px`,
            });
        });
        wall.style.height = `${layout.height}px`;
    }

    private static teardownScrollAnimations() {
        if (this.scrollGallery && this.scrollListener) {
            this.scrollGallery.removeEventListener("scroll", this.scrollListener);
        }
        if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
        this.scrollGallery = null;
        this.scrollFrame = null;
        this.scrollListener = null;
    }

    /** Map the visible part of each tile directly to its edge materialization. */
    private static setupScrollAnimations(gallery: HTMLElement) {
        this.teardownScrollAnimations();
        this.scrollGallery = gallery;
        if (
            typeof requestAnimationFrame !== "function" ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
            return;
        const update = () => {
            this.scrollFrame = null;
            if (this.scrollGallery !== gallery) return;
            this.updateScrollProgress(gallery);
        };
        this.scrollListener = () => {
            if (this.scrollFrame === null) this.scrollFrame = requestAnimationFrame(update);
        };
        gallery.addEventListener("scroll", this.scrollListener, { passive: true });
        this.scrollFrame = requestAnimationFrame(update);
    }

    private static updateScrollProgress(gallery: HTMLElement) {
        const galleryBounds = gallery.getBoundingClientRect();
        if (!galleryBounds.height) return;
        const measurements = Array.from(
            gallery.querySelectorAll<HTMLElement>(".queue-tile"),
        ).map((tile) => ({ tile, bounds: tile.getBoundingClientRect() }));
        measurements.forEach(({ tile, bounds }) => {
            const state = getQueueTileMotion(bounds, galleryBounds, gallery.scrollTop);
            if (!state) return;
            const motion = tile.querySelector<HTMLElement>(".queue-motion-layer");
            if (!motion) return;
            motion.style.transformOrigin = state.origin;
            motion.style.transform = `translate3d(0, ${state.translateY}px, 0) scale3d(${state.scaleX}, ${state.scaleY}, 1)`;
            motion.style.opacity = String(state.progress);
            motion.style.filter = `blur(${state.blur}px)`;
        });
    }
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
        if (typeof ResizeObserver !== "undefined") {
            this.layoutObserver = new ResizeObserver(() => this.layoutGallery());
            this.layoutObserver.observe(container);
        }
        this.refreshTimers = [250, 900].map((delay) => setTimeout(() => this.update(), delay));
    }

    static teardown() {
        this.layoutObserver?.disconnect();
        this.layoutObserver = null;
        this.deferredUpdate = false;
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
        this.tileOverflowAnimations = new WeakMap();
        this.teardownScrollAnimations();
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
        if (this.incoming || this.flight) {
            this.deferredUpdate = true;
            return;
        }
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
            const previous = new Map(
                Array.from(container.querySelectorAll<HTMLElement>(".queue-tile")).map((tile) => [
                    tile.dataset.uid,
                    tile.getBoundingClientRect(),
                ]),
            );
            const gallery = document.createElement("div");
            gallery.className = "queue-gallery";
            const wall = document.createElement("div");
            wall.className = "queue-wall";
            const upNextLabel = document.createElement("h2");
            upNextLabel.className = "queue-wall-label queue-up-next-label";
            upNextLabel.textContent = "Up Next";
            const heading = document.createElement("h2");
            heading.className = "queue-wall-label queue-heading";
            heading.textContent = "Queue";
            wall.append(upNextLabel, heading);
            for (const [index, entry] of entries.entries()) {
                wall.append(this.createTile(entry, index, index === 0));
            }
            gallery.append(wall);
            if (!entries.length) {
                const empty = document.createElement("p");
                empty.className = "queue-empty";
                empty.textContent = this.strings.empty;
                gallery.append(empty);
            }
            container.replaceChildren(gallery);
            this.layoutGallery();
            gallery.scrollTop = oldScroll;
            this.setupScrollAnimations(gallery);
            if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                const bounds = container.getBoundingClientRect();
                wall.querySelectorAll<HTMLElement>(".queue-tile").forEach((tile) => {
                    const before = previous.get(tile.dataset.uid);
                    const after = tile.getBoundingClientRect();
                    if (
                        !before?.width ||
                        !after.width ||
                        after.top > bounds.bottom ||
                        after.bottom < bounds.top
                    )
                        return;
                    tile.animate(
                        [
                            {
                                transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width})`,
                                transformOrigin: "top left",
                            },
                            { transform: "none", transformOrigin: "top left" },
                        ],
                        { duration: 320, easing: "cubic-bezier(.2,.75,.2,1)" },
                    );
                });
            }
            if (activeUid) {
                const replacement = Array.from(
                    gallery.querySelectorAll<HTMLElement>(".queue-tile"),
                ).find((tile) => tile.dataset.uid === activeUid);
                (replacement || container).focus({ preventScroll: true });
            }
        } catch (error) {
            console.warn("[Fullscape] Unable to read queue", error);
            if (!container.children.length) {
                const message = document.createElement("p");
                message.className = "queue-empty";
                message.textContent = this.strings.actionUnavailable;
                container.replaceChildren(message);
            }
        }
    }

    private static createTile(entry: QueueEntry, queueIndex: number, isUpNext: boolean) {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = `queue-tile${isUpNext ? " queue-tile-lead" : ""}`;
        tile.dataset.uid = entry.uid;
        tile.dataset.uri = entry.uri;
        tile.dataset.queueIndex = String(queueIndex);
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
        const artwork = document.createElement("span");
        artwork.className = "queue-artwork-frame";
        artwork.append(image);
        const title = document.createElement("span");
        title.className = "queue-track-title";
        title.textContent = entry.title;
        const subtitle = document.createElement("span");
        subtitle.className = "queue-track-artist";
        subtitle.textContent = artist;
        const titleViewport = document.createElement("span");
        titleViewport.className = "queue-track-title-viewport";
        titleViewport.append(title);
        const artistViewport = document.createElement("span");
        artistViewport.className = "queue-track-artist-viewport";
        artistViewport.append(subtitle);
        const copy = document.createElement("span");
        copy.className = isUpNext ? "queue-lead-copy" : "queue-artwork-copy";
        copy.append(titleViewport, artistViewport);
        const motion = document.createElement("span");
        motion.className = "queue-motion-layer";
        if (isUpNext) motion.append(artwork, copy);
        else {
            artwork.append(copy);
            motion.append(artwork);
        }
        tile.append(motion);
        tile.onpointerenter = () => this.startTileOverflow(tile);
        tile.onpointerleave = () => this.cancelTileOverflow(tile);
        tile.onfocus = () => this.startTileOverflow(tile);
        tile.onblur = () => this.cancelTileOverflow(tile);
        tile.onclick = () => void this.select(entry, image, tile);
        return tile;
    }

    private static startTileOverflow(tile: HTMLElement) {
        this.cancelTileOverflow(tile);
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        requestAnimationFrame(() => {
            if (!tile.matches(":hover, :focus-visible")) return;
            const measurements = Array.from(
                tile.querySelectorAll<HTMLElement>(
                    ".queue-track-title-viewport, .queue-track-artist-viewport",
                ),
            )
                .map((viewport) => {
                    const track = viewport.firstElementChild as HTMLElement | null;
                    return track
                        ? { track, overflow: Math.ceil(track.scrollWidth - viewport.clientWidth) }
                        : null;
                })
                .filter(
                    (value): value is { track: HTMLElement; overflow: number } => Boolean(value),
                );
            const maxOverflow = Math.max(0, ...measurements.map(({ overflow }) => overflow));
            if (maxOverflow <= 1) return;
            const timing = getOverflowScrollTiming(maxOverflow);
            const animations = measurements
                .filter(({ overflow }) => overflow > 1)
                .map(({ track, overflow }) =>
                    createOverflowScrollAnimation(track, overflow, timing),
                );
            this.tileOverflowAnimations.set(tile, animations);
        });
    }

    private static cancelTileOverflow(tile: HTMLElement) {
        this.tileOverflowAnimations.get(tile)?.forEach((animation) => animation.cancel());
        this.tileOverflowAnimations.delete(tile);
        tile.querySelectorAll<HTMLElement>(".queue-track-title, .queue-track-artist").forEach(
            (track) => track.style.removeProperty("transform"),
        );
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
        let target = DOM.cover.getBoundingClientRect();
        // Resolve the destination of master's pause/play scale without waiting for it.
        const artwork = DOM.cover.parentElement?.parentElement;
        if (artwork?.offsetWidth) {
            const bounds = artwork.getBoundingClientRect();
            const currentScale = bounds.width / artwork.offsetWidth;
            const finalScale = DOM.container.classList.contains("playback-paused") ? 0.86 : 1;
            const ratio = currentScale > 0 ? finalScale / currentScale : 1;
            const centerX = bounds.left + bounds.width / 2;
            const centerY = bounds.top + bounds.height / 2;
            target = {
                ...target,
                left: centerX + (target.left - centerX) * ratio,
                top: centerY + (target.top - centerY) * ratio,
                width: target.width * ratio,
                height: target.height * ratio,
            };
        }
        if (!target.width || !incoming.rect.width) {
            this.cancelFlight();
            return;
        }
        const flight = document.createElement("img");
        // The tile artwork has already decoded, so it gives the handoff a stable
        // first frame while the main cover swaps to Spotify's full-size source.
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
        if (typeof requestAnimationFrame === "function") {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (this.flight !== flight) return;
        }
        this.oldArtwork?.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: 380,
            fill: "forwards",
        });
        const animation = flight.animate(
            [
                { transform: "translate3d(0,0,0) scale(1)" },
                {
                    transform: `translate3d(${target.left - incoming.rect.left}px,${target.top - incoming.rect.top}px,0) scale(${target.width / incoming.rect.width},${target.height / incoming.rect.height})`,
                },
            ],
            { duration: 520, easing: "cubic-bezier(.22,.75,.18,1)", fill: "forwards" },
        );
        this.animation = animation;
        void animation.finished
            .then(async () => {
                if (this.flight !== flight) return;
                DOM.cover.classList.remove("queue-artwork-landing");
                await flight.animate([{ opacity: 1 }, { opacity: 0 }], {
                    duration: 90,
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
        if (this.deferredUpdate) {
            this.deferredUpdate = false;
            this.scheduleUpdate();
        }
    }
}
