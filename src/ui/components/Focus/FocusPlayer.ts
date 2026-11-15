import "./focus-player.scss";

export type FocusPlayerState = {
    trackKey: string;
    coverUrl: string;
    title: string;
    artist: string;
    paused: boolean;
    progress: number;
    duration: number;
    format: "vinyl" | "cd";
};

type SpinMode = "playing" | "coasting" | "stopped";

const SPIN_PERIOD: Record<FocusPlayerState["format"], number> = {
    vinyl: 1800,
    cd: 440,
};
const COAST_TIME: Record<FocusPlayerState["format"], number> = {
    vinyl: 1500,
    cd: 1050,
};
const TRACK_CHANGE_MS = 430;

/** A purely visual record/CD player for the focus screen. */
export class FocusPlayer {
    private readonly mount: HTMLElement;
    private readonly player: HTMLDivElement;
    private readonly vinylArtwork: HTMLImageElement;
    private readonly cdArtwork: HTMLImageElement;
    private readonly mediaQuery: MediaQueryList | null;
    private readonly onMotionPreferenceChange: (event: MediaQueryListEvent) => void;
    private state: FocusPlayerState | null = null;
    private pendingState: FocusPlayerState | null = null;
    private changeTimer: ReturnType<typeof setTimeout> | null = null;
    private frame: number | null = null;
    private lastFrameTime = 0;
    private angle = 0;
    private spinMode: SpinMode = "stopped";
    private coastElapsed = 0;
    private coastDuration = 0;
    private coastStartSpeed = 0;
    private motionReduced: boolean;
    private destroyed = false;

    constructor(root: HTMLElement) {
        this.mount = root;
        this.player = document.createElement("div");
        this.player.className = "focus-player";
        this.player.setAttribute("role", "img");
        this.player.setAttribute("aria-label", "Record player");

        const scene = document.createElement("div");
        scene.className = "focus-player-scene";
        scene.setAttribute("aria-hidden", "true");

        const turntable = document.createElement("div");
        turntable.className = "focus-vinyl-deck";
        turntable.innerHTML = `
            <div class="focus-vinyl-platter">
                <div class="focus-vinyl-record">
                    <div class="focus-vinyl-disc">
                        <div class="focus-vinyl-label">
                            <img class="focus-vinyl-artwork" alt="" draggable="false">
                            <span class="focus-disc-spindle"></span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="focus-tonearm">
                <span class="focus-tonearm-pivot"></span>
            </div>
            <div class="focus-deck-highlight"></div>
        `;
        const vinylArtwork = turntable.querySelector<HTMLImageElement>(".focus-vinyl-artwork");
        if (!vinylArtwork) throw new Error("Focus player vinyl artwork element is missing");
        this.vinylArtwork = vinylArtwork;

        const cdPlayer = document.createElement("div");
        cdPlayer.className = "focus-cd-player";
        cdPlayer.innerHTML = `
            <div class="focus-cd-case">
                <div class="focus-cd-tray">
                    <div class="focus-cd-disc">
                        <div class="focus-cd-label">
                            <img class="focus-cd-artwork" alt="" draggable="false">
                            <span class="focus-disc-spindle"></span>
                        </div>
                    </div>
                </div>
                <div class="focus-cd-case-reflection"></div>
            </div>
        `;
        const cdArtwork = cdPlayer.querySelector<HTMLImageElement>(".focus-cd-artwork");
        if (!cdArtwork) throw new Error("Focus player CD artwork element is missing");
        this.cdArtwork = cdArtwork;

        scene.append(turntable, cdPlayer);
        this.player.append(scene);
        this.mount.replaceChildren(this.player);

        this.mediaQuery =
            typeof window.matchMedia === "function"
                ? window.matchMedia("(prefers-reduced-motion: reduce)")
                : null;
        this.motionReduced = this.mediaQuery?.matches ?? false;
        this.onMotionPreferenceChange = (event) => {
            this.motionReduced = event.matches;
            if (this.motionReduced) {
                this.spinMode = "stopped";
                this.stopFrame();
                this.paintAngle();
            } else if (this.state && !this.state.paused) {
                this.spinMode = "playing";
                this.startFrame();
            }
        };
        this.mediaQuery?.addEventListener?.("change", this.onMotionPreferenceChange);
    }

    update(state: FocusPlayerState) {
        if (this.destroyed) return;
        const next = this.normalizeState(state);

        if (this.changeTimer !== null) {
            this.pendingState = next;
            return;
        }

        if (this.state && next.trackKey !== this.state.trackKey) {
            this.ejectForTrackChange(next);
            return;
        }

        const previous = this.state;
        this.state = next;
        this.applyState(next, previous);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.changeTimer !== null) clearTimeout(this.changeTimer);
        this.changeTimer = null;
        this.pendingState = null;
        this.stopFrame();
        this.mediaQuery?.removeEventListener?.("change", this.onMotionPreferenceChange);
        this.mount.replaceChildren();
    }

    private normalizeState(state: FocusPlayerState): FocusPlayerState {
        return {
            ...state,
            title: state.title.trim(),
            artist: state.artist.trim(),
            coverUrl: state.coverUrl.trim(),
            progress: Number.isFinite(state.progress) ? Math.max(0, state.progress) : 0,
            duration: Number.isFinite(state.duration) ? Math.max(0, state.duration) : 0,
            format: state.format === "cd" ? "cd" : "vinyl",
            paused: Boolean(state.paused),
        };
    }

    private applyState(next: FocusPlayerState, previous: FocusPlayerState | null) {
        this.player.dataset.format = next.format;
        this.player.classList.toggle("is-paused", next.paused);
        this.player.classList.toggle("is-playing", !next.paused);
        this.player.setAttribute("aria-label", this.accessibleLabel(next));
        this.updateArtwork(this.vinylArtwork, next.coverUrl);
        this.updateArtwork(this.cdArtwork, next.coverUrl);
        this.updateNeedle(next);

        if (this.motionReduced || next.paused) {
            if (previous && !previous.paused && this.spinMode === "playing") {
                this.startCoasting(previous.format);
            } else if (!previous || next.paused) {
                if (this.spinMode === "playing")
                    this.startCoasting(previous?.format || next.format);
                else if (!previous) this.spinMode = "stopped";
            }
        } else {
            this.spinMode = "playing";
            this.startFrame();
        }
        this.paintAngle();
    }

    private ejectForTrackChange(next: FocusPlayerState) {
        if (!this.state) return;
        this.pendingState = next;
        this.player.classList.add("is-ejecting");
        if (!this.motionReduced && this.spinMode === "playing") {
            this.startCoasting(this.state.format);
        }

        this.changeTimer = setTimeout(() => {
            this.changeTimer = null;
            const inserted = this.pendingState || next;
            this.pendingState = null;
            this.state = inserted;
            this.angle = 0;
            this.player.classList.remove("is-ejecting");
            this.player.dataset.format = inserted.format;
            this.updateArtwork(this.vinylArtwork, inserted.coverUrl);
            this.updateArtwork(this.cdArtwork, inserted.coverUrl);
            this.updateNeedle(inserted);
            this.player.classList.toggle("is-paused", inserted.paused);
            this.player.classList.toggle("is-playing", !inserted.paused);
            this.player.setAttribute("aria-label", this.accessibleLabel(inserted));
            this.player.classList.add("is-loading");
            this.spinMode = !this.motionReduced && !inserted.paused ? "playing" : "stopped";
            this.paintAngle();
            if (this.spinMode === "playing") this.startFrame();
            requestAnimationFrame(() => {
                if (!this.destroyed) this.player.classList.remove("is-loading");
            });
        }, TRACK_CHANGE_MS);
    }

    private updateArtwork(image: HTMLImageElement, source: string) {
        if (!source) {
            image.removeAttribute("src");
            return;
        }
        if (image.getAttribute("src") !== source) image.src = source;
    }

    private accessibleLabel(state: FocusPlayerState) {
        const track = state.title ? `“${state.title}”` : "Untitled track";
        const artist = state.artist ? ` by ${state.artist}` : "";
        const medium = state.format === "vinyl" ? "Vinyl record" : "Compact disc";
        return `${medium} player, ${track}${artist}, ${state.paused ? "paused" : "playing"}`;
    }

    private updateNeedle(state: FocusPlayerState) {
        const progress = state.duration > 0 ? Math.min(1, state.progress / state.duration) : 0;
        // The arm travels from the outer groove toward the label as the track advances.
        this.player.style.setProperty("--focus-needle-angle", `${-56 + progress * 30}deg`);
    }

    private startCoasting(format: FocusPlayerState["format"]) {
        if (this.motionReduced || this.spinMode !== "playing") {
            this.spinMode = "stopped";
            this.stopFrame();
            return;
        }
        this.coastElapsed = 0;
        this.coastDuration = COAST_TIME[format];
        this.coastStartSpeed = 360 / SPIN_PERIOD[format];
        this.spinMode = "coasting";
        this.startFrame();
    }

    private startFrame() {
        if (this.motionReduced || this.spinMode === "stopped" || this.frame !== null) return;
        this.lastFrameTime = 0;
        this.frame = requestAnimationFrame(this.onFrame);
    }

    private stopFrame() {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        this.lastFrameTime = 0;
    }

    private onFrame = (time: number) => {
        this.frame = null;
        if (this.destroyed || this.motionReduced || this.spinMode === "stopped") return;
        const delta = this.lastFrameTime ? Math.min(48, time - this.lastFrameTime) : 0;
        this.lastFrameTime = time;

        if (this.spinMode === "playing") {
            const format = this.state?.format || "vinyl";
            this.angle += (360 / SPIN_PERIOD[format]) * delta;
        } else {
            this.coastElapsed = Math.min(this.coastDuration, this.coastElapsed + delta);
            const velocity = this.coastStartSpeed * (1 - this.coastElapsed / this.coastDuration);
            this.angle += velocity * delta;
            if (this.coastElapsed >= this.coastDuration) {
                this.spinMode = "stopped";
            }
        }

        this.paintAngle();
        if (this.spinMode !== "stopped") this.frame = requestAnimationFrame(this.onFrame);
    };

    private paintAngle() {
        const angle = `${this.angle % 360}deg`;
        this.player.style.setProperty("--focus-spin-angle", angle);
    }
}
