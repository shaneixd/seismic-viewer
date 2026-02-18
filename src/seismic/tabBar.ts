/**
 * Tab Bar — Full-width 2D slice view with tab management.
 *
 * Adds a tab bar at the top of the viewport. The first tab is always "3D View".
 * Each opened slice gets its own tab with a close button.
 * Active slice tab hides the 3D canvas and shows a full-viewport 2D slice with rulers.
 */

import { applyColormap } from './colormap';
import { drawVerticalRuler, drawHorizontalRuler } from './ruler';

export interface TabSliceInfo {
    sliceType: 'inline' | 'crossline';
    sliceIndex: number;
    label: string;
    data: Float32Array;
    width: number;
    height: number;
    colormap: Uint8Array;
    timeRangeMs?: [number, number];
    ilRange?: [number, number];
    xlRange?: [number, number];
}

interface TabEntry {
    id: string;
    label: string;
    tabEl: HTMLElement;
    slice: TabSliceInfo | null; // null = 3D view tab
    canvas?: HTMLCanvasElement;
    ctx?: CanvasRenderingContext2D;
    customEl?: HTMLElement;       // arbitrary DOM content (e.g. well logs)
    onDock?: () => void;          // callback when dock button is clicked
    viewScale: number;
    viewOffsetX: number;
    viewOffsetY: number;
}

export interface TabBarCallbacks {
    onActivate3D?: () => void;
    onDeactivate3D?: () => void;
    onMoveToPanel?: (slice: TabSliceInfo) => void;
    onCustomTabDock?: (id: string) => void;
}

const RULER_LEFT_W = 52;
const RULER_BOTTOM_H = 28;

export class TabBar {
    private barEl: HTMLElement;
    private contentEl: HTMLElement;
    private canvasEl: HTMLCanvasElement; // the 3D canvas to show/hide
    private tabs: TabEntry[] = [];
    private activeTabId: string = '3d';
    private callbacks: TabBarCallbacks;

    // Drag state for active tab
    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragStartOffX = 0;
    private dragStartOffY = 0;

    constructor(parentEl: HTMLElement, canvasEl: HTMLCanvasElement, callbacks: TabBarCallbacks = {}) {
        this.canvasEl = canvasEl;
        this.callbacks = callbacks;

        // Tab bar strip
        this.barEl = document.createElement('div');
        this.barEl.className = 'tab-bar';
        this.barEl.style.display = 'none'; // hidden until first slice tab added

        // Content area for 2D views (sits behind the 3D canvas when inactive)
        this.contentEl = document.createElement('div');
        this.contentEl.className = 'tab-content';
        this.contentEl.style.display = 'none';

        parentEl.appendChild(this.barEl);
        parentEl.appendChild(this.contentEl);

        // Create the permanent "3D View" tab
        this.create3DTab();
    }

    private create3DTab(): void {
        const tabEl = document.createElement('div');
        tabEl.className = 'tab-item active';
        tabEl.innerHTML = '<span class="tab-icon">◆</span> 3D View';
        tabEl.addEventListener('click', () => this.activate('3d'));

        this.barEl.appendChild(tabEl);
        this.tabs.push({
            id: '3d',
            label: '3D View',
            tabEl,
            slice: null,
            viewScale: 1,
            viewOffsetX: 0,
            viewOffsetY: 0,
        });
    }

    addSlice(slice: TabSliceInfo): void {
        const id = `${slice.sliceType}-${slice.sliceIndex}`;

        // If already open, just activate it
        const existing = this.tabs.find(t => t.id === id);
        if (existing) {
            this.activate(id);
            return;
        }

        // Show the tab bar if hidden
        this.barEl.style.display = '';

        // Create tab element
        const tabEl = document.createElement('div');
        tabEl.className = 'tab-item';

        const labelSpan = document.createElement('span');
        labelSpan.textContent = slice.label;
        tabEl.appendChild(labelSpan);

        // "Dock to panel" icon
        const dockBtn = document.createElement('span');
        dockBtn.className = 'tab-dock';
        dockBtn.textContent = '⧉';
        dockBtn.title = 'Move to side panel';
        dockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.callbacks.onMoveToPanel?.(slice);
            this.removeTab(id);
        });
        tabEl.appendChild(dockBtn);

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeTab(id);
        });
        tabEl.appendChild(closeBtn);

        tabEl.addEventListener('click', () => this.activate(id));
        this.barEl.appendChild(tabEl);

        // Create canvas for this tab
        const canvas = document.createElement('canvas');
        canvas.className = 'tab-slice-canvas';
        canvas.style.display = 'none';
        this.contentEl.appendChild(canvas);

        const ctx = canvas.getContext('2d')!;

        const entry: TabEntry = {
            id,
            label: slice.label,
            tabEl,
            slice,
            canvas,
            ctx,
            viewScale: 1,
            viewOffsetX: 0,
            viewOffsetY: 0,
        };
        this.tabs.push(entry);

        // Wire interaction
        canvas.addEventListener('wheel', (e) => this.onWheel(e, entry), { passive: false });
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e, entry));
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e, entry));
        canvas.addEventListener('mouseup', () => this.onMouseUp(entry));
        canvas.addEventListener('mouseleave', () => this.onMouseUp(entry));

        this.activate(id);
    }

    private activate(id: string): void {
        this.activeTabId = id;

        // Update tab styles and content visibility
        for (const tab of this.tabs) {
            tab.tabEl.classList.toggle('active', tab.id === id);
            if (tab.canvas) {
                tab.canvas.style.display = tab.id === id ? 'block' : 'none';
            }
            if (tab.customEl) {
                tab.customEl.style.display = tab.id === id ? 'flex' : 'none';
            }
        }

        if (id === '3d') {
            // Show 3D canvas, hide content
            this.canvasEl.style.display = 'block';
            this.contentEl.style.display = 'none';
            this.callbacks.onActivate3D?.();
        } else {
            // Hide 3D canvas, show content
            this.canvasEl.style.display = 'none';
            this.contentEl.style.display = 'block';
            this.callbacks.onDeactivate3D?.();
            // Render the active tab (slice tabs only)
            const tab = this.tabs.find(t => t.id === id)!;
            if (tab.slice) {
                requestAnimationFrame(() => this.renderTab(tab));
            }
            // Custom tabs re-render themselves via resize
            if (tab.customEl) {
                window.dispatchEvent(new Event('resize'));
            }
        }
    }

    removeTab(id: string, docking = false): void {
        const idx = this.tabs.findIndex(t => t.id === id);
        if (idx < 0 || id === '3d') return;

        const tab = this.tabs[idx];
        tab.tabEl.remove();
        tab.canvas?.remove();
        // Custom elements: hide only when closing (✕), not when docking back.
        // When docking, the onDock callback reparents and shows the element.
        if (tab.customEl && !docking) {
            tab.customEl.style.display = 'none';
        }
        this.tabs.splice(idx, 1);

        // If we removed the active tab, switch to 3D
        if (this.activeTabId === id) {
            this.activate('3d');
        }

        // Hide tab bar if only 3D tab remains
        if (this.tabs.length <= 1) {
            this.barEl.style.display = 'none';
        }
    }

    /**
     * Add a tab backed by an arbitrary DOM element (e.g. the well-log panel).
     * The element is reparented into the tab content area.
     */
    addCustomTab(id: string, label: string, contentEl: HTMLElement, onDock?: () => void): void {
        // If already open, just activate
        const existing = this.tabs.find(t => t.id === id);
        if (existing) {
            this.activate(id);
            return;
        }

        // Show the tab bar
        this.barEl.style.display = '';

        // Create tab header element
        const tabEl = document.createElement('div');
        tabEl.className = 'tab-item';

        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        tabEl.appendChild(labelSpan);

        // Dock-to-panel icon
        if (onDock) {
            const dockBtn = document.createElement('span');
            dockBtn.className = 'tab-dock';
            dockBtn.textContent = '\u29C9';
            dockBtn.title = 'Move to side panel';
            dockBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                onDock();
                this.removeTab(id, true);
            });
            tabEl.appendChild(dockBtn);
        }

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '\u2715';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeTab(id);
        });
        tabEl.appendChild(closeBtn);

        tabEl.addEventListener('click', () => this.activate(id));
        this.barEl.appendChild(tabEl);

        // Reparent the content element into the tab content area
        contentEl.style.display = 'none';
        this.contentEl.appendChild(contentEl);

        const entry: TabEntry = {
            id,
            label,
            tabEl,
            slice: null,
            customEl: contentEl,
            onDock,
            viewScale: 1,
            viewOffsetX: 0,
            viewOffsetY: 0,
        };
        this.tabs.push(entry);

        this.activate(id);
    }

    hasTab(id: string): boolean {
        return this.tabs.some(t => t.id === id);
    }

    private renderTab(tab: TabEntry): void {
        if (!tab.slice || !tab.canvas || !tab.ctx) return;

        const slice = tab.slice;
        const ctx = tab.ctx;
        const dpr = window.devicePixelRatio || 1;

        // Size canvas to content area
        const rect = this.contentEl.getBoundingClientRect();
        tab.canvas.width = rect.width * dpr;
        tab.canvas.height = rect.height * dpr;
        tab.canvas.style.width = `${rect.width}px`;
        tab.canvas.style.height = `${rect.height}px`;
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;

        // Clear
        ctx.fillStyle = 'rgba(10, 10, 20, 1)';
        ctx.fillRect(0, 0, w, h);

        // Image area
        const imgX = RULER_LEFT_W;
        const imgY = 0;
        const imgW = w - RULER_LEFT_W;
        const imgH = h - RULER_BOTTOM_H;

        // Colormapped image
        const imgData = ctx.createImageData(slice.width, slice.height);
        for (let i = 0; i < slice.data.length; i++) {
            const rgb = applyColormap(slice.data[i], slice.colormap);
            imgData.data[i * 4] = rgb[0];
            imgData.data[i * 4 + 1] = rgb[1];
            imgData.data[i * 4 + 2] = rgb[2];
            imgData.data[i * 4 + 3] = 255;
        }

        const offscreen = new OffscreenCanvas(slice.width, slice.height);
        const offCtx = offscreen.getContext('2d')!;
        offCtx.putImageData(imgData, 0, 0);

        // Draw with pan/zoom — preserving original aspect ratio (fit-to-width)
        ctx.save();
        ctx.beginPath();
        ctx.rect(imgX, imgY, imgW, imgH);
        ctx.clip();

        const dataAspect = slice.height / slice.width;
        const baseW = imgW;
        const baseH = baseW * dataAspect;

        const drawW = baseW * tab.viewScale;
        const drawH = baseH * tab.viewScale;
        const drawX = imgX + tab.viewOffsetX + (imgW - drawW) / 2;
        const drawY = imgY + tab.viewOffsetY + (imgH - drawH) / 2;

        ctx.imageSmoothingEnabled = tab.viewScale < 3;
        ctx.drawImage(offscreen, drawX, drawY, drawW, drawH);
        ctx.restore();

        // Rulers — compute visible data ranges from the draw transform
        const fullTimeRange: [number, number] = slice.timeRangeMs || [0, slice.height];
        const fullHorizRange: [number, number] = slice.sliceType === 'inline'
            ? (slice.xlRange || [0, slice.width])
            : (slice.ilRange || [0, slice.width]);
        const horizontalLabel = slice.sliceType === 'inline' ? 'Crossline' : 'Inline';

        const fullHorizSpan = fullHorizRange[1] - fullHorizRange[0];
        const visHorizMin = fullHorizRange[0] + ((imgX - drawX) / drawW) * fullHorizSpan;
        const visHorizMax = fullHorizRange[0] + ((imgX + imgW - drawX) / drawW) * fullHorizSpan;

        const fullTimeSpan = fullTimeRange[1] - fullTimeRange[0];
        const visTimeMin = fullTimeRange[0] + ((imgY - drawY) / drawH) * fullTimeSpan;
        const visTimeMax = fullTimeRange[0] + ((imgY + imgH - drawY) / drawH) * fullTimeSpan;

        drawVerticalRuler(ctx, 0, 0, imgH, { label: 'Time (ms)', range: [visTimeMin, visTimeMax] });
        drawHorizontalRuler(ctx, RULER_LEFT_W, imgH, imgW, { label: horizontalLabel, range: [visHorizMin, visHorizMax] });

        // Corner box
        ctx.fillStyle = 'rgba(10, 10, 20, 0.85)';
        ctx.fillRect(0, imgH, RULER_LEFT_W, RULER_BOTTOM_H);
    }

    // --- Interaction ---

    private onWheel(e: WheelEvent, tab: TabEntry): void {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        tab.viewScale = Math.max(0.2, Math.min(20, tab.viewScale * factor));
        this.renderTab(tab);
    }

    private onMouseDown(e: MouseEvent, tab: TabEntry): void {
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartOffX = tab.viewOffsetX;
        this.dragStartOffY = tab.viewOffsetY;
        if (tab.canvas) tab.canvas.style.cursor = 'grabbing';
    }

    private onMouseMove(e: MouseEvent, tab: TabEntry): void {
        if (!this.isDragging) return;
        tab.viewOffsetX = this.dragStartOffX + (e.clientX - this.dragStartX);
        tab.viewOffsetY = this.dragStartOffY + (e.clientY - this.dragStartY);
        this.renderTab(tab);
    }

    private onMouseUp(tab: TabEntry): void {
        this.isDragging = false;
        if (tab.canvas) tab.canvas.style.cursor = 'grab';
    }

    get isSliceActive(): boolean {
        return this.activeTabId !== '3d';
    }

    dispose(): void {
        for (const tab of this.tabs) {
            tab.tabEl.remove();
            tab.canvas?.remove();
        }
        this.tabs = [];
        this.barEl.remove();
        this.contentEl.remove();
    }
}
