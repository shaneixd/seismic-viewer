/**
 * Faux-2D Mode — Reorients the 3D camera perpendicular to a slice for
 * orthographic-like interpretation.
 *
 * - Animates camera to face the slice head-on
 * - Constrains OrbitControls (no rotation, pan + zoom only)
 * - Overlays DOM-based rulers on viewport edges that update with pan/zoom
 * - Provides an "Exit 2D" button to return to 3D
 */

import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { type RulerConfig } from './ruler';

/** Nice tick interval for a given range and target count. */
function niceInterval(range: number, targetTicks: number): number {
    const rough = range / targetTicks;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const frac = rough / pow;
    let nice: number;
    if (frac <= 1.5) nice = 1;
    else if (frac <= 3) nice = 2;
    else if (frac <= 7) nice = 5;
    else nice = 10;
    return nice * pow;
}

export interface Faux2DSliceInfo {
    sliceType: 'inline' | 'crossline';
    sliceIndex: number;
    label: string;
    /** The 3D position of the slice plane center (in scene coords) */
    slicePosition: THREE.Vector3;
    /** Normal of the slice plane (pointing towards the camera) */
    sliceNormal: THREE.Vector3;
    /** Scale of the volume */
    volumeScale: THREE.Vector3;
    /** Survey ranges */
    timeRangeMs?: [number, number];
    ilRange?: [number, number];
    xlRange?: [number, number];
}

export interface Faux2DCallbacks {
    onEnter?: (info: Faux2DSliceInfo) => void;
    onExit?: () => void;
}

export class Faux2DMode {
    private parentEl: HTMLElement;
    private camera: THREE.PerspectiveCamera;
    private controls: OrbitControls;
    private callbacks: Faux2DCallbacks;

    private _active = false;
    private savedCameraPos = new THREE.Vector3();
    private savedTarget = new THREE.Vector3();
    private savedEnableRotate = true;
    private savedMinDistance = 0.5;
    private savedMaxDistance = 10;

    private overlayEl: HTMLElement | null = null;
    private exitBtn: HTMLElement | null = null;
    private animId: number | null = null;

    // For dynamic ruler updates
    private currentInfo: Faux2DSliceInfo | null = null;
    private leftRulerEl: HTMLElement | null = null;
    private bottomRulerEl: HTMLElement | null = null;
    private controlsChangeHandler: (() => void) | null = null;

    constructor(
        parentEl: HTMLElement,
        camera: THREE.PerspectiveCamera,
        controls: OrbitControls,
        callbacks: Faux2DCallbacks = {}
    ) {
        this.parentEl = parentEl;
        this.camera = camera;
        this.controls = controls;
        this.callbacks = callbacks;
    }

    enter(info: Faux2DSliceInfo): void {
        if (this._active) this.exit();

        this._active = true;
        this.currentInfo = info;

        // Save camera state
        this.savedCameraPos.copy(this.camera.position);
        this.savedTarget.copy(this.controls.target);
        this.savedEnableRotate = this.controls.enableRotate;
        this.savedMinDistance = this.controls.minDistance;
        this.savedMaxDistance = this.controls.maxDistance;

        // Compute target camera position
        const center = info.slicePosition.clone();
        const normal = info.sliceNormal.clone().normalize();
        // Distance to fit the slice in view
        const vFov = THREE.MathUtils.degToRad(this.camera.fov);
        const aspect = this.camera.aspect;
        const sliceHeight = info.volumeScale.y; // time axis
        const sliceWidth = info.sliceType === 'inline' ? info.volumeScale.z : info.volumeScale.x;
        const distV = (sliceHeight / 2) / Math.tan(vFov / 2);
        const distH = (sliceWidth / 2) / (aspect * Math.tan(vFov / 2));
        const dist = Math.max(distV, distH) * 0.88; // zoom in past edges

        const targetCamPos = center.clone().add(normal.multiplyScalar(dist));

        // Animate to position
        this.animateCamera(targetCamPos, center, () => {
            // Lock controls
            this.controls.enableRotate = false;
            this.controls.minDistance = dist * 0.3;
            this.controls.maxDistance = dist * 3;
            this.controls.target.copy(center);
            this.controls.update();

            // Initial ruler update after animation
            this.updateRulers();
        });

        // Create overlay with rulers and exit button
        this.createOverlay(info);

        // Listen for controls changes to update rulers live
        this.controlsChangeHandler = () => this.updateRulers();
        this.controls.addEventListener('change', this.controlsChangeHandler);

        this.callbacks.onEnter?.(info);
    }

    exit(): void {
        if (!this._active) return;
        this._active = false;
        this.currentInfo = null;

        // Remove controls listener
        if (this.controlsChangeHandler) {
            this.controls.removeEventListener('change', this.controlsChangeHandler);
            this.controlsChangeHandler = null;
        }

        // Restore controls
        this.controls.enableRotate = this.savedEnableRotate;
        this.controls.minDistance = this.savedMinDistance;
        this.controls.maxDistance = this.savedMaxDistance;

        // Animate camera back
        this.animateCamera(this.savedCameraPos, this.savedTarget, () => {
            this.controls.update();
        });

        // Remove overlay
        this.removeOverlay();
        this.callbacks.onExit?.();
    }

    get active(): boolean {
        return this._active;
    }

    // ── Compute visible data ranges from camera frustum ──────────

    private getVisibleRanges(): { timeRange: [number, number]; horizRange: [number, number] } | null {
        const info = this.currentInfo;
        if (!info) return null;

        // Camera frustum half-extents at the target distance
        const dist = this.camera.position.distanceTo(this.controls.target);
        const vFov = THREE.MathUtils.degToRad(this.camera.fov);
        const halfH = Math.tan(vFov / 2) * dist;   // world-space half-height
        const halfW = halfH * this.camera.aspect;   // world-space half-width

        // Camera target offset from slice center
        const center = info.slicePosition;
        const target = this.controls.target;

        // Map to data axes
        const fullTimeRange: [number, number] = info.timeRangeMs || [0, 1000];
        const sliceHeight = info.volumeScale.y;
        const timePerUnit = (fullTimeRange[1] - fullTimeRange[0]) / sliceHeight;

        // Y offset (time axis is inverted: top of scene = min time)
        const yOffset = target.y - center.y;
        const visCenterTime = fullTimeRange[0] + (fullTimeRange[1] - fullTimeRange[0]) / 2 - yOffset * timePerUnit;
        const visHalfTime = halfH * timePerUnit;

        // Horizontal axis
        let fullHorizRange: [number, number];
        let sliceWidth: number;
        let hOffset: number;

        if (info.sliceType === 'inline') {
            fullHorizRange = info.xlRange || [0, 100];
            sliceWidth = info.volumeScale.z;
            hOffset = target.z - center.z;
        } else {
            fullHorizRange = info.ilRange || [0, 100];
            sliceWidth = info.volumeScale.x;
            hOffset = target.x - center.x;
        }

        const horizPerUnit = (fullHorizRange[1] - fullHorizRange[0]) / sliceWidth;
        const visCenterHoriz = fullHorizRange[0] + (fullHorizRange[1] - fullHorizRange[0]) / 2 + hOffset * horizPerUnit;
        const visHalfHoriz = halfW * horizPerUnit;

        return {
            timeRange: [visCenterTime - visHalfTime, visCenterTime + visHalfTime],
            horizRange: [visCenterHoriz - visHalfHoriz, visCenterHoriz + visHalfHoriz],
        };
    }

    // ── Update DOM rulers with current visible ranges ────────────

    private updateRulers(): void {
        const ranges = this.getVisibleRanges();
        if (!ranges) return;

        if (this.leftRulerEl) {
            this.rebuildDOMRuler(this.leftRulerEl, 'vertical', {
                label: 'Time (ms)',
                range: ranges.timeRange,
            });
        }

        if (this.bottomRulerEl) {
            const info = this.currentInfo!;
            const horizontalLabel = info.sliceType === 'inline' ? 'Crossline' : 'Inline';
            this.rebuildDOMRuler(this.bottomRulerEl, 'horizontal', {
                label: horizontalLabel,
                range: ranges.horizRange,
            });
        }
    }

    private rebuildDOMRuler(container: HTMLElement, orientation: 'vertical' | 'horizontal', config: RulerConfig): void {
        // Clear existing ticks (keep the container itself)
        container.innerHTML = '';

        const [min, max] = config.range;
        const range = max - min;
        if (range <= 0) return;

        const targetTicks = orientation === 'vertical' ? 8 : 10;
        const interval = niceInterval(range, targetTicks);

        // Axis label
        const labelEl = document.createElement('div');
        labelEl.className = 'dom-ruler-label';
        labelEl.textContent = config.label;
        container.appendChild(labelEl);

        // Ticks
        const firstTick = Math.ceil(min / interval) * interval;
        for (let v = firstTick; v <= max; v += interval) {
            const t = (v - min) / range;
            if (t < 0 || t > 1) continue;
            const tick = document.createElement('div');
            tick.className = 'dom-ruler-tick';
            if (orientation === 'vertical') {
                tick.style.top = `${t * 100}%`;
            } else {
                tick.style.left = `${t * 100}%`;
            }
            tick.textContent = Math.round(v).toString();
            container.appendChild(tick);
        }
    }

    // ── Overlay creation ─────────────────────────────────────────

    private createOverlay(info: Faux2DSliceInfo): void {
        this.overlayEl = document.createElement('div');
        this.overlayEl.className = 'faux2d-overlay';

        // Left ruler (time) — will be populated by updateRulers()
        this.leftRulerEl = document.createElement('div');
        this.leftRulerEl.className = 'dom-ruler dom-ruler-vertical';
        this.overlayEl.appendChild(this.leftRulerEl);

        // Bottom ruler (IL or XL) — will be populated by updateRulers()
        this.bottomRulerEl = document.createElement('div');
        this.bottomRulerEl.className = 'dom-ruler dom-ruler-horizontal';
        this.overlayEl.appendChild(this.bottomRulerEl);

        // Slice label
        const labelEl = document.createElement('div');
        labelEl.className = 'faux2d-label';
        labelEl.textContent = info.label;
        this.overlayEl.appendChild(labelEl);

        // Exit button
        this.exitBtn = document.createElement('button');
        this.exitBtn.className = 'faux2d-exit';
        this.exitBtn.textContent = '✕ Exit 2D';
        this.exitBtn.addEventListener('click', () => this.exit());
        this.overlayEl.appendChild(this.exitBtn);

        this.parentEl.appendChild(this.overlayEl);

        // Initial ruler population
        this.updateRulers();
    }

    private removeOverlay(): void {
        if (this.overlayEl) {
            this.overlayEl.remove();
            this.overlayEl = null;
            this.exitBtn = null;
            this.leftRulerEl = null;
            this.bottomRulerEl = null;
        }
    }

    private animateCamera(
        targetPos: THREE.Vector3,
        targetLookAt: THREE.Vector3,
        onComplete: () => void
    ): void {
        if (this.animId !== null) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }

        const startPos = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        const startTime = performance.now();
        const duration = 700;

        const step = () => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);
            const ease = t < 0.5
                ? 4 * t * t * t
                : 1 - Math.pow(-2 * t + 2, 3) / 2;

            this.camera.position.lerpVectors(startPos, targetPos, ease);
            this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
            this.controls.update();

            if (t < 1) {
                this.animId = requestAnimationFrame(step);
            } else {
                this.animId = null;
                onComplete();
            }
        };

        this.animId = requestAnimationFrame(step);
    }

    dispose(): void {
        this.exit();
    }
}
