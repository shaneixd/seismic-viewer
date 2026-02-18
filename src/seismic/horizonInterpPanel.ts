/**
 * Horizon Interpretation Panel — Slide-out side panel for 2D slice viewing.
 *
 * Follows the same UX pattern as WellLogPanel: slides in from the right,
 * renders the slice on an HTML5 Canvas with rulers on the left (time) and
 * bottom (IL/XL).
 */

import { applyColormap } from './colormap';
import { drawVerticalRuler, drawHorizontalRuler, type RulerConfig } from './ruler';

export interface InterpSliceInfo {
    sliceType: 'inline' | 'crossline';
    sliceIndex: number;
    label: string;
    /** Raw float data, row-major, already flipped for display */
    data: Float32Array;
    width: number;
    height: number;
    /** Current colormap LUT (256 × 4 RGBA) */
    colormap: Uint8Array;
    /** Survey ranges for ruler labels */
    timeRangeMs?: [number, number];
    ilRange?: [number, number];
    xlRange?: [number, number];
}

export interface HorizonInterpPanelCallbacks {
    onClose?: () => void;
    onShow?: () => void;
    onMoveToTab?: (slice: InterpSliceInfo) => void;
}

const RULER_LEFT_W = 52;
const RULER_BOTTOM_H = 28;

export class HorizonInterpPanel {
    private container: HTMLElement;
    private headerEl: HTMLElement;
    private titleEl: HTMLElement;
    private closeBtn: HTMLElement;
    private canvasEl: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private callbacks: HorizonInterpPanelCallbacks;

    private currentSlice: InterpSliceInfo | null = null;

    // Pan / zoom state
    private viewOffsetX = 0;
    private viewOffsetY = 0;
    private viewScale = 1;
    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragStartOffX = 0;
    private dragStartOffY = 0;

    constructor(parentEl: HTMLElement, callbacks: HorizonInterpPanelCallbacks = {}) {
        this.callbacks = callbacks;

        this.container = document.createElement('div');
        this.container.className = 'interp-panel';

        // Header
        this.headerEl = document.createElement('div');
        this.headerEl.className = 'interp-panel-header';

        this.titleEl = document.createElement('span');
        this.titleEl.className = 'interp-panel-title';
        this.titleEl.textContent = 'Interpretation';

        this.closeBtn = document.createElement('button');
        this.closeBtn.className = 'interp-panel-close';
        this.closeBtn.textContent = '✕ Close';
        this.closeBtn.addEventListener('click', () => this.hide());

        // "Pop out to tab" button
        const tabBtn = document.createElement('button');
        tabBtn.className = 'interp-panel-to-tab';
        tabBtn.textContent = '⤢ Expand';
        tabBtn.title = 'Expand to full-width tab view';
        tabBtn.addEventListener('click', () => {
            if (this.currentSlice) {
                this.callbacks.onMoveToTab?.(this.currentSlice);
                this.hide();
            }
        });

        this.headerEl.appendChild(this.titleEl);
        this.headerEl.appendChild(tabBtn);
        this.headerEl.appendChild(this.closeBtn);
        this.container.appendChild(this.headerEl);

        // Canvas
        this.canvasEl = document.createElement('canvas');
        this.canvasEl.className = 'interp-panel-canvas';
        this.container.appendChild(this.canvasEl);
        this.ctx = this.canvasEl.getContext('2d')!;

        parentEl.appendChild(this.container);

        // Interaction handlers
        this.canvasEl.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.canvasEl.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvasEl.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvasEl.addEventListener('mouseup', () => this.onMouseUp());
        this.canvasEl.addEventListener('mouseleave', () => this.onMouseUp());
    }

    show(slice: InterpSliceInfo): void {
        this.currentSlice = slice;
        this.titleEl.textContent = slice.label;

        // Reset view
        this.viewOffsetX = 0;
        this.viewOffsetY = 0;
        this.viewScale = 1;

        this.container.classList.add('visible');
        this.callbacks.onShow?.();
        // Render on next frame so layout has settled
        requestAnimationFrame(() => this.render());
    }

    hide(): void {
        this.container.classList.remove('visible');
        this.currentSlice = null;
        this.callbacks.onClose?.();
    }

    get visible(): boolean {
        return this.container.classList.contains('visible');
    }

    dispose(): void {
        this.hide();
        this.container.remove();
    }

    private render(): void {
        if (!this.currentSlice) return;

        const slice = this.currentSlice;
        const dpr = window.devicePixelRatio || 1;

        // Size canvas to container
        const rect = this.canvasEl.getBoundingClientRect();
        this.canvasEl.width = rect.width * dpr;
        this.canvasEl.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;

        // Clear
        this.ctx.fillStyle = 'rgba(10, 10, 20, 1)';
        this.ctx.fillRect(0, 0, w, h);

        // Image area (inside rulers)
        const imgX = RULER_LEFT_W;
        const imgY = 0;
        const imgW = w - RULER_LEFT_W;
        const imgH = h - RULER_BOTTOM_H;

        // Render the colormapped slice into an ImageData
        const imgData = this.ctx.createImageData(slice.width, slice.height);
        for (let i = 0; i < slice.data.length; i++) {
            const rgb = applyColormap(slice.data[i], slice.colormap);
            imgData.data[i * 4] = rgb[0];
            imgData.data[i * 4 + 1] = rgb[1];
            imgData.data[i * 4 + 2] = rgb[2];
            imgData.data[i * 4 + 3] = 255;
        }

        // Create offscreen canvas for the image
        const offscreen = new OffscreenCanvas(slice.width, slice.height);
        const offCtx = offscreen.getContext('2d')!;
        offCtx.putImageData(imgData, 0, 0);

        // Draw scaled image with pan/zoom — preserving original aspect ratio.
        // Fit-to-width: the horizontal axis fills the panel; the vertical size
        // is derived from the data's native aspect ratio. If the image is taller
        // than the visible area the user can pan to see clipped portions.
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(imgX, imgY, imgW, imgH);
        this.ctx.clip();

        const dataAspect = slice.height / slice.width; // e.g. 255/701 or 255/401
        const baseW = imgW;                            // fit to available width
        const baseH = baseW * dataAspect;              // derive height from data

        const drawW = baseW * this.viewScale;
        const drawH = baseH * this.viewScale;
        const drawX = imgX + this.viewOffsetX + (imgW - drawW) / 2;
        const drawY = imgY + this.viewOffsetY + (imgH - drawH) / 2;

        this.ctx.imageSmoothingEnabled = this.viewScale < 3;
        this.ctx.drawImage(offscreen, drawX, drawY, drawW, drawH);
        this.ctx.restore();

        // Rulers — compute visible data ranges from the draw transform
        const fullTimeRange: [number, number] = slice.timeRangeMs || [0, slice.height];
        const fullHorizRange: [number, number] = slice.sliceType === 'inline'
            ? (slice.xlRange || [0, slice.width])
            : (slice.ilRange || [0, slice.width]);
        const horizontalLabel = slice.sliceType === 'inline' ? 'Crossline' : 'Inline';

        // Map viewport edges → data space
        // Horizontal: left of image area (imgX) → right of image area (imgX + imgW)
        const fullHorizSpan = fullHorizRange[1] - fullHorizRange[0];
        const visHorizMin = fullHorizRange[0] + ((imgX - drawX) / drawW) * fullHorizSpan;
        const visHorizMax = fullHorizRange[0] + ((imgX + imgW - drawX) / drawW) * fullHorizSpan;

        // Vertical: top of image area (0) → bottom of image area (imgH)
        const fullTimeSpan = fullTimeRange[1] - fullTimeRange[0];
        const visTimeMin = fullTimeRange[0] + ((imgY - drawY) / drawH) * fullTimeSpan;
        const visTimeMax = fullTimeRange[0] + ((imgY + imgH - drawY) / drawH) * fullTimeSpan;

        const vertRuler: RulerConfig = { label: 'Time (ms)', range: [visTimeMin, visTimeMax] };
        const horzRuler: RulerConfig = { label: horizontalLabel, range: [visHorizMin, visHorizMax] };

        drawVerticalRuler(this.ctx, 0, 0, imgH, vertRuler);
        drawHorizontalRuler(this.ctx, RULER_LEFT_W, imgH, imgW, horzRuler);

        // Corner box (ruler intersection)
        this.ctx.fillStyle = 'rgba(10, 10, 20, 0.85)';
        this.ctx.fillRect(0, imgH, RULER_LEFT_W, RULER_BOTTOM_H);
    }

    // --- Interaction ---

    private onWheel(e: WheelEvent): void {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        this.viewScale = Math.max(0.2, Math.min(20, this.viewScale * factor));
        this.render();
    }

    private onMouseDown(e: MouseEvent): void {
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartOffX = this.viewOffsetX;
        this.dragStartOffY = this.viewOffsetY;
        this.canvasEl.style.cursor = 'grabbing';
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.isDragging) return;
        this.viewOffsetX = this.dragStartOffX + (e.clientX - this.dragStartX);
        this.viewOffsetY = this.dragStartOffY + (e.clientY - this.dragStartY);
        this.render();
    }

    private onMouseUp(): void {
        this.isDragging = false;
        this.canvasEl.style.cursor = 'grab';
    }
}
