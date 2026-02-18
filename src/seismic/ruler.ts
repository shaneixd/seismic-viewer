/**
 * Reusable ruler component for seismic interpretation views.
 *
 * Draws tick marks and labels along edges of a canvas or as DOM overlays.
 * Used by HorizonInterpPanel, TabBar, and Faux2D views.
 */

export interface RulerConfig {
    /** Axis label, e.g. "Time (ms)" or "Inline" */
    label: string;
    /** Data-space range: [min, max] */
    range: [number, number];
    /** Desired number of major ticks (auto-calculated from range if omitted) */
    majorTicks?: number;
    /** Number of minor ticks between each major tick */
    minorTicks?: number;
}

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

/**
 * Draw a vertical ruler on the left edge of a canvas (time axis).
 */
export function drawVerticalRuler(
    ctx: CanvasRenderingContext2D,
    x: number,
    top: number,
    height: number,
    config: RulerConfig,
    opts: { bgColor?: string; textColor?: string; lineColor?: string; fontSize?: number } = {}
): void {
    const {
        bgColor = 'rgba(10, 10, 20, 0.85)',
        textColor = '#8888a0',
        lineColor = 'rgba(255,255,255,0.15)',
        fontSize = 10,
    } = opts;

    const rulerWidth = 52;
    const [min, max] = config.range;
    const range = max - min;
    const targetTicks = config.majorTicks ?? Math.max(4, Math.floor(height / 60));
    const interval = niceInterval(range, targetTicks);
    const minorSubs = config.minorTicks ?? 4;

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, top, rulerWidth, height);

    // Right border
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + rulerWidth, top);
    ctx.lineTo(x + rulerWidth, top + height);
    ctx.stroke();

    ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Major ticks
    const firstTick = Math.ceil(min / interval) * interval;
    for (let v = firstTick; v <= max; v += interval) {
        const t = (v - min) / range;
        const y = top + t * height;

        // Major tick line
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + rulerWidth - 8, y);
        ctx.lineTo(x + rulerWidth, y);
        ctx.stroke();

        // Label
        ctx.fillStyle = textColor;
        ctx.fillText(Math.round(v).toString(), x + rulerWidth - 10, y);

        // Minor ticks
        if (minorSubs > 0) {
            const minorInterval = interval / (minorSubs + 1);
            for (let m = 1; m <= minorSubs; m++) {
                const mv = v + m * minorInterval;
                if (mv > max) break;
                const mt = (mv - min) / range;
                const my = top + mt * height;
                ctx.strokeStyle = 'rgba(255,255,255,0.06)';
                ctx.beginPath();
                ctx.moveTo(x + rulerWidth - 4, my);
                ctx.lineTo(x + rulerWidth, my);
                ctx.stroke();
            }
        }
    }

    // Axis label (rotated)
    ctx.save();
    ctx.translate(x + 12, top + height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(136, 136, 160, 0.6)';
    ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.fillText(config.label, 0, 0);
    ctx.restore();
}

/**
 * Draw a horizontal ruler on the bottom edge of a canvas (IL/XL axis).
 */
export function drawHorizontalRuler(
    ctx: CanvasRenderingContext2D,
    left: number,
    y: number,
    width: number,
    config: RulerConfig,
    opts: { bgColor?: string; textColor?: string; lineColor?: string; fontSize?: number } = {}
): void {
    const {
        bgColor = 'rgba(10, 10, 20, 0.85)',
        textColor = '#8888a0',
        lineColor = 'rgba(255,255,255,0.15)',
        fontSize = 10,
    } = opts;

    const rulerHeight = 28;
    const [min, max] = config.range;
    const range = max - min;
    const targetTicks = config.majorTicks ?? Math.max(4, Math.floor(width / 80));
    const interval = niceInterval(range, targetTicks);
    const minorSubs = config.minorTicks ?? 4;

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(left, y, width, rulerHeight);

    // Top border
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();

    ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Major ticks
    const firstTick = Math.ceil(min / interval) * interval;
    for (let v = firstTick; v <= max; v += interval) {
        const t = (v - min) / range;
        const x = left + t * width;

        // Major tick line
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 8);
        ctx.stroke();

        // Label
        ctx.fillStyle = textColor;
        ctx.fillText(Math.round(v).toString(), x, y + 10);

        // Minor ticks
        if (minorSubs > 0) {
            const minorInterval = interval / (minorSubs + 1);
            for (let m = 1; m <= minorSubs; m++) {
                const mv = v + m * minorInterval;
                if (mv > max) break;
                const mt = (mv - min) / range;
                const mx = left + mt * width;
                ctx.strokeStyle = 'rgba(255,255,255,0.06)';
                ctx.beginPath();
                ctx.moveTo(mx, y);
                ctx.lineTo(mx, y + 4);
                ctx.stroke();
            }
        }
    }

    // Axis label
    ctx.fillStyle = 'rgba(136, 136, 160, 0.6)';
    ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(config.label, left + width / 2, y + rulerHeight - fontSize - 2);
}

/**
 * Create DOM-based ruler overlays for faux-2D mode.
 * Returns a container element with tick marks positioned along the edge.
 */
export function createDOMRuler(
    orientation: 'vertical' | 'horizontal',
    config: RulerConfig
): HTMLElement {
    const container = document.createElement('div');
    container.className = `dom-ruler dom-ruler-${orientation}`;

    const [min, max] = config.range;
    const range = max - min;
    const targetTicks = config.majorTicks ?? (orientation === 'vertical' ? 8 : 10);
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

    return container;
}
