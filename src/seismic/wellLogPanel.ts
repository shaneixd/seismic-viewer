/**
 * Well Log Overlay Panel — Multi-well side-by-side display
 * 
 * Displays well log curves (GR, DT, RHOB) in a slide-out panel alongside the
 * 3D seismic view. Multiple wells can be shown side by side for correlation.
 * Each well column has its own dismiss button, plus a "Close All" in the header.
 * 
 * Uses HTML5 Canvas for rendering log curves (industry-standard approach).
 */

import type { WellLogData, WellLogCurve, WellFormation } from './wellData';

/** Callback types for cross-highlighting between panel and 3D view */
export interface WellLogPanelCallbacks {
    onFormationHover?: (wellName: string, formationCode: string | null) => void;
    onClose?: () => void;
}

/** Track rendering config */
interface TrackConfig {
    curveName: string;
    color: string;
    fillColor: string;
    fillDirection: 'left' | 'right' | 'none';
    scaleMin: number;
    scaleMax: number;
    label: string;
    unit: string;
}

/** Internal state for one displayed well */
interface WellColumn {
    wellName: string;
    wellColor: string;
    logData: WellLogData;
    formations: WellFormation[];
}

const TRACK_CONFIGS: Record<string, TrackConfig> = {
    GR: {
        curveName: 'GR',
        color: '#4ade80',
        fillColor: 'rgba(74, 222, 128, 0.15)',
        fillDirection: 'right',
        scaleMin: 0,
        scaleMax: 150,
        label: 'GR',
        unit: 'gAPI',
    },
    DT: {
        curveName: 'DT',
        color: '#60a5fa',
        fillColor: 'rgba(96, 165, 250, 0.10)',
        fillDirection: 'none',
        scaleMin: 30,
        scaleMax: 140,
        label: 'DT',
        unit: 'μs/ft',
    },
    RHOB: {
        curveName: 'RHOB',
        color: '#f87171',
        fillColor: 'rgba(248, 113, 113, 0.10)',
        fillDirection: 'none',
        scaleMin: 1.8,
        scaleMax: 2.9,
        label: 'RHOB',
        unit: 'g/cc',
    },
};

// Layout constants
const HEADER_HEIGHT = 40;
const WELL_HEADER_HEIGHT = 32;
const SCALE_HEADER_HEIGHT = 36;
const DEPTH_TRACK_WIDTH = 52;
const LOG_TRACK_WIDTH = 80;
const TRACK_GAP = 1;
const WELL_SEPARATOR = 2;
const FORMATION_LABEL_WIDTH = 8;
const SINGLE_WELL_WIDTH = DEPTH_TRACK_WIDTH + (LOG_TRACK_WIDTH + TRACK_GAP) * 3;
const PANEL_PADDING = 4;

export class WellLogPanel {
    private container: HTMLElement;
    private headerEl: HTMLElement;
    private titleEl: HTMLElement;
    private closeAllBtn: HTMLElement;
    private wellColumnsEl: HTMLElement;

    private wells: WellColumn[] = [];
    private wellCanvases: Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; headerEl: HTMLElement }> = new Map();
    private callbacks: WellLogPanelCallbacks;

    private hoveredFormationCode: string | null = null;
    private highlightedFormationCode: string | null = null;

    // Shared scroll/zoom state (in TVDSS meters) — all wells share depth range
    private viewTop = 0;
    private viewBottom = 3000;
    private isDragging = false;
    private dragStartY = 0;
    private dragStartTop = 0;

    private isVisible = false;
    private dpr = 1;

    constructor(parentEl: HTMLElement, callbacks: WellLogPanelCallbacks = {}) {
        this.callbacks = callbacks;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);

        // Build DOM
        this.container = document.createElement('div');
        this.container.className = 'well-log-panel';

        // Header bar
        this.headerEl = document.createElement('div');
        this.headerEl.className = 'well-log-header';

        this.titleEl = document.createElement('span');
        this.titleEl.className = 'well-log-title';
        this.titleEl.textContent = 'Well Logs';

        this.closeAllBtn = document.createElement('button');
        this.closeAllBtn.className = 'well-log-close';
        this.closeAllBtn.innerHTML = '✕ Close All';
        this.closeAllBtn.addEventListener('click', () => this.hideAll());

        this.headerEl.appendChild(this.titleEl);
        this.headerEl.appendChild(this.closeAllBtn);
        this.container.appendChild(this.headerEl);

        // Scrollable columns container
        this.wellColumnsEl = document.createElement('div');
        this.wellColumnsEl.className = 'well-log-columns';
        this.container.appendChild(this.wellColumnsEl);

        parentEl.appendChild(this.container);

        window.addEventListener('resize', () => {
            if (this.isVisible) this.renderAll();
        });
    }

    /** Add or bring-to-front a well. If already shown, does nothing. */
    show(wellName: string, logData: WellLogData, formations: WellFormation[], wellColor: string): void {
        // If already displayed, don't duplicate
        if (this.wells.find(w => w.wellName === wellName)) return;

        const column: WellColumn = { wellName, wellColor, logData, formations };
        this.wells.push(column);

        // Create DOM for this well column
        this.createWellColumnDOM(column);

        // Fit depth range to encompass all wells
        this.fitDepthRange();

        // Update panel width and show
        this.updatePanelWidth();
        this.container.classList.add('visible');
        this.isVisible = true;
        this.updateTitle();

        requestAnimationFrame(() => this.renderAll());
    }

    /** Remove a single well from the panel */
    removeWell(wellName: string): void {
        const idx = this.wells.findIndex(w => w.wellName === wellName);
        if (idx === -1) return;

        this.wells.splice(idx, 1);

        // Remove DOM
        const entry = this.wellCanvases.get(wellName);
        if (entry) {
            entry.headerEl.parentElement?.remove();
            this.wellCanvases.delete(wellName);
        }

        if (this.wells.length === 0) {
            this.hideAll();
        } else {
            this.fitDepthRange();
            this.updatePanelWidth();
            this.updateTitle();
            this.renderAll();
        }
    }

    /** Hide and clear everything */
    hideAll(): void {
        this.wells = [];
        this.wellCanvases.clear();
        this.wellColumnsEl.innerHTML = '';
        this.container.classList.remove('visible');
        this.isVisible = false;
        this.callbacks.onClose?.();
    }

    /** Highlight a formation band across all columns (called from 3D hover) */
    highlightFormation(code: string | null): void {
        if (this.highlightedFormationCode !== code) {
            this.highlightedFormationCode = code;
            if (this.isVisible) this.renderAll();
        }
    }

    get visible(): boolean {
        return this.isVisible;
    }

    get activeWells(): string[] {
        return this.wells.map(w => w.wellName);
    }

    hasWell(wellName: string): boolean {
        return this.wells.some(w => w.wellName === wellName);
    }

    dispose(): void {
        this.container.remove();
    }

    // ─── DOM creation ───────────────────────────────────────

    private createWellColumnDOM(column: WellColumn): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'well-log-col';

        // Per-well header with name + dismiss button
        const header = document.createElement('div');
        header.className = 'well-log-col-header';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'well-log-col-name';
        nameSpan.textContent = column.wellName;
        nameSpan.style.color = column.wellColor;

        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'well-log-col-dismiss';
        dismissBtn.innerHTML = '✕';
        dismissBtn.title = `Remove ${column.wellName}`;
        dismissBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeWell(column.wellName);
        });

        header.appendChild(nameSpan);
        header.appendChild(dismissBtn);
        wrapper.appendChild(header);

        // Canvas for this well
        const canvas = document.createElement('canvas');
        canvas.className = 'well-log-canvas';
        wrapper.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D context');

        // Mouse events on this canvas
        canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e, column));
        canvas.addEventListener('mouseup', () => this.onMouseUp());
        canvas.addEventListener('mouseleave', () => this.onMouseLeave());

        this.wellColumnsEl.appendChild(wrapper);
        this.wellCanvases.set(column.wellName, { canvas, ctx, headerEl: header });
    }

    private updatePanelWidth(): void {
        const totalWidth = this.wells.length * (SINGLE_WELL_WIDTH + WELL_SEPARATOR) + PANEL_PADDING * 2;
        this.container.style.width = `${Math.max(totalWidth, 120)}px`;
    }

    private updateTitle(): void {
        this.titleEl.textContent = this.wells.length === 1
            ? 'Well Log'
            : `Well Logs (${this.wells.length})`;
    }

    private fitDepthRange(): void {
        if (this.wells.length === 0) return;

        let minDepth = Infinity;
        let maxDepth = -Infinity;
        for (const w of this.wells) {
            if (w.logData.tvdss.length > 0) {
                minDepth = Math.min(minDepth, w.logData.tvdss[0]);
                maxDepth = Math.max(maxDepth, w.logData.tvdss[w.logData.tvdss.length - 1]);
            }
        }
        if (isFinite(minDepth) && isFinite(maxDepth)) {
            this.viewTop = minDepth;
            this.viewBottom = maxDepth;
        }
    }

    // ─── Rendering ──────────────────────────────────────────

    private renderAll(): void {
        for (const column of this.wells) {
            const entry = this.wellCanvases.get(column.wellName);
            if (entry) this.renderColumn(column, entry.canvas, entry.ctx);
        }
    }

    private renderColumn(column: WellColumn, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
        // Size canvas to fit its container
        const wrapper = canvas.parentElement!;
        const rect = wrapper.getBoundingClientRect();
        const canvasHeight = rect.height - WELL_HEADER_HEIGHT;
        const canvasWidth = SINGLE_WELL_WIDTH;

        canvas.style.width = `${canvasWidth}px`;
        canvas.style.height = `${Math.max(canvasHeight, 100)}px`;
        canvas.width = canvasWidth * this.dpr;
        canvas.height = Math.max(canvasHeight, 100) * this.dpr;

        const dpr = this.dpr;
        ctx.save();
        ctx.scale(dpr, dpr);

        const w = canvasWidth;
        const h = Math.max(canvasHeight, 100);

        // Clear
        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(0, 0, w, h);

        const drawAreaTop = SCALE_HEADER_HEIGHT;
        const drawAreaHeight = h - drawAreaTop;

        // Draw scale headers
        this.drawScaleHeaders(ctx, w);

        // Draw formation bands
        this.drawFormationBands(ctx, column.formations, drawAreaTop, drawAreaHeight);

        // Draw depth track
        this.drawDepthTrack(ctx, drawAreaTop, drawAreaHeight);

        // Draw log tracks
        const trackNames = ['GR', 'DT', 'RHOB'];
        for (let i = 0; i < trackNames.length; i++) {
            const cfg = TRACK_CONFIGS[trackNames[i]];
            if (!cfg) continue;
            const curve = column.logData.curves.find(c => c.name === cfg.curveName);
            if (!curve) continue;

            const trackX = DEPTH_TRACK_WIDTH + i * (LOG_TRACK_WIDTH + TRACK_GAP);
            this.drawLogTrack(ctx, column.logData, curve, cfg, trackX, drawAreaTop, LOG_TRACK_WIDTH, drawAreaHeight);
        }

        // Draw track borders
        this.drawTrackBorders(ctx, drawAreaTop, drawAreaHeight, trackNames.length);

        ctx.restore();
    }

    private drawScaleHeaders(ctx: CanvasRenderingContext2D, w: number): void {
        ctx.fillStyle = 'rgba(15, 15, 30, 0.95)';
        ctx.fillRect(0, 0, w, SCALE_HEADER_HEIGHT);

        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, SCALE_HEADER_HEIGHT);
        ctx.lineTo(w, SCALE_HEADER_HEIGHT);
        ctx.stroke();

        // Depth header
        ctx.fillStyle = '#888';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TVDSS', DEPTH_TRACK_WIDTH / 2, 13);
        ctx.fillStyle = '#666';
        ctx.font = '8px Inter, sans-serif';
        ctx.fillText('(m)', DEPTH_TRACK_WIDTH / 2, 26);

        // Track headers
        const trackNames = ['GR', 'DT', 'RHOB'];
        for (let i = 0; i < trackNames.length; i++) {
            const cfg = TRACK_CONFIGS[trackNames[i]];
            if (!cfg) continue;
            const trackX = DEPTH_TRACK_WIDTH + i * (LOG_TRACK_WIDTH + TRACK_GAP);
            const cx = trackX + LOG_TRACK_WIDTH / 2;

            ctx.fillStyle = cfg.color;
            ctx.font = 'bold 9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(cfg.label, cx, 13);

            ctx.fillStyle = '#666';
            ctx.font = '8px Inter, sans-serif';
            ctx.fillText(`${cfg.scaleMin}–${cfg.scaleMax}`, cx, 26);
        }
    }

    private drawDepthTrack(ctx: CanvasRenderingContext2D, top: number, height: number): void {
        ctx.fillStyle = 'rgba(20, 20, 35, 0.5)';
        ctx.fillRect(0, top, DEPTH_TRACK_WIDTH, height);

        const range = this.viewBottom - this.viewTop;
        let tickInterval = 100;
        if (range > 2000) tickInterval = 500;
        else if (range > 1000) tickInterval = 200;
        else if (range < 300) tickInterval = 50;

        const firstTick = Math.ceil(this.viewTop / tickInterval) * tickInterval;

        ctx.font = '8px Inter, sans-serif';
        ctx.textAlign = 'right';

        for (let depth = firstTick; depth <= this.viewBottom; depth += tickInterval) {
            const y = top + ((depth - this.viewTop) / range) * height;
            if (y < top || y > top + height) continue;

            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(DEPTH_TRACK_WIDTH, y);
            ctx.lineTo(SINGLE_WELL_WIDTH, y);
            ctx.stroke();

            ctx.fillStyle = '#888';
            ctx.fillText(`${depth.toFixed(0)}`, DEPTH_TRACK_WIDTH - 4, y + 3);
        }
    }

    private drawFormationBands(ctx: CanvasRenderingContext2D, formations: WellFormation[], top: number, height: number): void {
        const range = this.viewBottom - this.viewTop;
        if (range <= 0) return;

        for (const fm of formations) {
            const y1 = top + ((fm.top_tvdss - this.viewTop) / range) * height;
            const y2 = top + ((fm.bottom_tvdss - this.viewTop) / range) * height;

            if (y2 < top || y1 > top + height) continue;

            const clampY1 = Math.max(y1, top);
            const clampY2 = Math.min(y2, top + height);
            const bandHeight = clampY2 - clampY1;
            if (bandHeight < 1) continue;

            const isHighlighted = fm.code === this.highlightedFormationCode ||
                fm.code === this.hoveredFormationCode;

            const alpha = isHighlighted ? 0.20 : 0.06;
            ctx.fillStyle = this.hexToRgba(fm.color, alpha);
            ctx.fillRect(0, clampY1, SINGLE_WELL_WIDTH, bandHeight);

            // Color strip on left edge
            ctx.fillStyle = this.hexToRgba(fm.color, isHighlighted ? 0.9 : 0.5);
            ctx.fillRect(0, clampY1, FORMATION_LABEL_WIDTH, bandHeight);

            // Top line
            if (y1 >= top && y1 <= top + height) {
                ctx.strokeStyle = this.hexToRgba(fm.color, isHighlighted ? 0.6 : 0.25);
                ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
                ctx.setLineDash(isHighlighted ? [] : [4, 4]);
                ctx.beginPath();
                ctx.moveTo(FORMATION_LABEL_WIDTH, y1);
                ctx.lineTo(SINGLE_WELL_WIDTH, y1);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Formation label
            if (bandHeight > 12) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, clampY1, DEPTH_TRACK_WIDTH, bandHeight);
                ctx.clip();
                ctx.fillStyle = isHighlighted ? fm.color : this.hexToRgba(fm.color, 0.7);
                ctx.font = `${isHighlighted ? 'bold ' : ''}7px Inter, sans-serif`;
                ctx.textAlign = 'left';
                ctx.fillText(fm.code.slice(0, 5), FORMATION_LABEL_WIDTH + 2, clampY1 + 9);
                ctx.restore();
            }
        }
    }

    private drawLogTrack(
        ctx: CanvasRenderingContext2D,
        logData: WellLogData,
        curve: WellLogCurve,
        cfg: TrackConfig,
        x: number, top: number, width: number, height: number
    ): void {
        const depths = logData.tvdss;
        const values = curve.data;
        const range = this.viewBottom - this.viewTop;
        if (range <= 0) return;

        const scaleRange = cfg.scaleMax - cfg.scaleMin;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, top, width, height);
        ctx.clip();

        // Build path
        ctx.beginPath();
        let started = false;

        for (let i = 0; i < depths.length; i++) {
            const d = depths[i];
            if (d < this.viewTop || d > this.viewBottom) continue;

            const y = top + ((d - this.viewTop) / range) * height;
            const v = values[i];
            if (isNaN(v) || v === -999.25) continue;

            const normalized = (v - cfg.scaleMin) / scaleRange;
            const px = x + Math.max(0, Math.min(1, normalized)) * width;

            if (!started) {
                ctx.moveTo(px, y);
                started = true;
            } else {
                ctx.lineTo(px, y);
            }
        }

        // Fill if configured
        if (cfg.fillDirection !== 'none' && started) {
            const fillPath = new Path2D();
            let fillStarted = false;
            let lastY = top;

            for (let i = 0; i < depths.length; i++) {
                const d = depths[i];
                if (d < this.viewTop || d > this.viewBottom) continue;

                const y = top + ((d - this.viewTop) / range) * height;
                const v = values[i];
                if (isNaN(v) || v === -999.25) continue;

                const normalized = (v - cfg.scaleMin) / scaleRange;
                const px = x + Math.max(0, Math.min(1, normalized)) * width;

                if (!fillStarted) {
                    fillPath.moveTo(x, y);
                    fillPath.lineTo(px, y);
                    fillStarted = true;
                } else {
                    fillPath.lineTo(px, y);
                }
                lastY = y;
            }

            if (fillStarted) {
                fillPath.lineTo(x, lastY);
                fillPath.closePath();
                ctx.fillStyle = cfg.fillColor;
                ctx.fill(fillPath);
            }
        }

        ctx.strokeStyle = cfg.color;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.restore();
    }

    private drawTrackBorders(ctx: CanvasRenderingContext2D, top: number, height: number, numTracks: number): void {
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(DEPTH_TRACK_WIDTH, 0);
        ctx.lineTo(DEPTH_TRACK_WIDTH, top + height);
        ctx.stroke();

        for (let i = 1; i < numTracks; i++) {
            const bx = DEPTH_TRACK_WIDTH + i * (LOG_TRACK_WIDTH + TRACK_GAP);
            ctx.beginPath();
            ctx.moveTo(bx, 0);
            ctx.lineTo(bx, top + height);
            ctx.stroke();
        }
    }

    // ─── Mouse interaction (shared across all canvases) ─────

    private onWheel(e: WheelEvent): void {
        e.preventDefault();
        const range = this.viewBottom - this.viewTop;
        const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;

        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const mouseY = e.clientY - rect.top - SCALE_HEADER_HEIGHT;
        const drawH = rect.height - SCALE_HEADER_HEIGHT;
        const fraction = Math.max(0, Math.min(1, mouseY / drawH));

        const centerDepth = this.viewTop + fraction * range;
        const newRange = Math.max(50, Math.min(5000, range * zoomFactor));

        this.viewTop = centerDepth - fraction * newRange;
        this.viewBottom = centerDepth + (1 - fraction) * newRange;

        this.renderAll();
    }

    private onMouseDown(e: MouseEvent): void {
        this.isDragging = true;
        this.dragStartY = e.clientY;
        this.dragStartTop = this.viewTop;
        (e.target as HTMLCanvasElement).style.cursor = 'grabbing';
    }

    private onMouseMove(e: MouseEvent, column: WellColumn): void {
        if (this.isDragging) {
            const dy = e.clientY - this.dragStartY;
            const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const drawH = rect.height - SCALE_HEADER_HEIGHT;
            const range = this.viewBottom - this.viewTop;
            const depthDelta = -(dy / drawH) * range;

            this.viewTop = this.dragStartTop + depthDelta;
            this.viewBottom = this.viewTop + range;
            this.renderAll();
            return;
        }

        // Formation hover
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const mouseY = e.clientY - rect.top - SCALE_HEADER_HEIGHT;
        const drawH = rect.height - SCALE_HEADER_HEIGHT;
        const range = this.viewBottom - this.viewTop;
        const depth = this.viewTop + (mouseY / drawH) * range;

        let hoveredCode: string | null = null;
        for (const fm of column.formations) {
            if (depth >= fm.top_tvdss && depth < fm.bottom_tvdss) {
                hoveredCode = fm.code;
                break;
            }
        }

        if (hoveredCode !== this.hoveredFormationCode) {
            this.hoveredFormationCode = hoveredCode;
            this.renderAll();
            this.callbacks.onFormationHover?.(column.wellName, hoveredCode);
        }
    }

    private onMouseUp(): void {
        this.isDragging = false;
        // Reset cursor on all canvases
        for (const [, entry] of this.wellCanvases) {
            entry.canvas.style.cursor = '';
        }
    }

    private onMouseLeave(): void {
        this.isDragging = false;
        if (this.hoveredFormationCode) {
            this.hoveredFormationCode = null;
            this.renderAll();
            this.callbacks.onFormationHover?.('', null);
        }
    }

    // ─── Utility ────────────────────────────────────────────

    private hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
}
