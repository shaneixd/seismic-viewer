/**
 * Right-click context menu for seismic slice interpretation.
 * 
 * Appears when right-clicking on an inline or crossline slice in the 3D view.
 * Offers three interpretation view options: Panel, Tab, and Faux-2D mode.
 */

export interface SliceInfo {
    sliceType: 'inline' | 'crossline';
    sliceIndex: number;
    /** Survey-space label (e.g. IL 250) */
    label: string;
}

export type InterpViewMode = 'panel' | 'tab' | 'faux2d';

export interface ContextMenuCallbacks {
    onSelect: (mode: InterpViewMode, slice: SliceInfo) => void;
}

export class ContextMenu {
    private el: HTMLElement;
    private callbacks: ContextMenuCallbacks;
    private currentSlice: SliceInfo | null = null;
    private dismissHandler: (e: MouseEvent) => void;
    private keyHandler: (e: KeyboardEvent) => void;

    constructor(parentEl: HTMLElement, callbacks: ContextMenuCallbacks) {
        this.callbacks = callbacks;

        this.el = document.createElement('div');
        this.el.className = 'ctx-menu hidden';
        this.el.innerHTML = `
            <div class="ctx-menu-header">
                <span class="ctx-menu-title"></span>
            </div>
            <div class="ctx-menu-items">
                <button class="ctx-menu-item" data-mode="panel">
                    <span class="ctx-menu-icon">◫</span>
                    <span class="ctx-menu-label">Open in Panel</span>
                    <span class="ctx-menu-hint">Side panel view</span>
                </button>
                <button class="ctx-menu-item" data-mode="tab">
                    <span class="ctx-menu-icon">▭</span>
                    <span class="ctx-menu-label">Open in Tab</span>
                    <span class="ctx-menu-hint">Full-width tab view</span>
                </button>
                <button class="ctx-menu-item" data-mode="faux2d">
                    <span class="ctx-menu-icon">⊡</span>
                    <span class="ctx-menu-label">Enter 2D Mode</span>
                    <span class="ctx-menu-hint">Orthographic slice view</span>
                </button>
            </div>
        `;
        parentEl.appendChild(this.el);

        // Wire up item clicks
        this.el.querySelectorAll('.ctx-menu-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = (btn as HTMLElement).dataset.mode as InterpViewMode;
                if (this.currentSlice) {
                    this.callbacks.onSelect(mode, this.currentSlice);
                }
                this.hide();
            });
        });

        // Auto-dismiss on click outside
        this.dismissHandler = (e: MouseEvent) => {
            if (!this.el.contains(e.target as Node)) {
                this.hide();
            }
        };

        // Dismiss on Escape
        this.keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.hide();
        };
    }

    show(x: number, y: number, slice: SliceInfo): void {
        this.currentSlice = slice;

        // Update header
        const title = this.el.querySelector('.ctx-menu-title')!;
        title.textContent = `${slice.label} — Interpret`;

        // Position (keep within viewport)
        const menuW = 220;
        const menuH = 180;
        const px = Math.min(x, window.innerWidth - menuW - 8);
        const py = Math.min(y, window.innerHeight - menuH - 8);
        this.el.style.left = `${px}px`;
        this.el.style.top = `${py}px`;

        this.el.classList.remove('hidden');

        // Bind dismiss listeners (on next tick to avoid immediate dismiss)
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', this.dismissHandler);
            document.addEventListener('keydown', this.keyHandler);
        });
    }

    hide(): void {
        this.el.classList.add('hidden');
        this.currentSlice = null;
        document.removeEventListener('mousedown', this.dismissHandler);
        document.removeEventListener('keydown', this.keyHandler);
    }

    get visible(): boolean {
        return !this.el.classList.contains('hidden');
    }

    dispose(): void {
        this.hide();
        this.el.remove();
    }
}
