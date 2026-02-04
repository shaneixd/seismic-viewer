/**
 * Progressive loading main entry point for seismic viewer.
 * 
 * Uses bricked multi-resolution data for instant startup with progressive refinement.
 */

import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ProgressiveSeismicVolume } from './seismic/progressiveVolume';
import { createColormap } from './seismic/colormap';
import type { ColormapType } from './seismic/colormap';

// Scene setup
const canvas = document.getElementById('seismic-canvas') as HTMLCanvasElement;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a12);

// Camera
const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(2, 1.5, 2);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 0.5;
controls.maxDistance = 10;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

// Add coordinate axes helper
const axesHelper = new THREE.AxesHelper(1.2);
scene.add(axesHelper);

// Grid helper
const gridHelper = new THREE.GridHelper(2, 20, 0x333355, 0x222244);
gridHelper.position.y = -0.5;
scene.add(gridHelper);

// Progressive volume
let progressiveVolume: ProgressiveSeismicVolume | null = null;

// UI Elements
const loadingOverlay = document.getElementById('loading-overlay')!;
const loadingText = document.getElementById('loading-text')!;
const surveyInfo = document.getElementById('survey-info')!;

const inlineSlider = document.getElementById('inline-slider') as HTMLInputElement;
const crosslineSlider = document.getElementById('crossline-slider') as HTMLInputElement;
const timeSlider = document.getElementById('time-slider') as HTMLInputElement;
const opacitySlider = document.getElementById('opacity-slider') as HTMLInputElement;
const colormapSelect = document.getElementById('colormap') as HTMLSelectElement;
const resolutionSelect = document.getElementById('resolution-level') as HTMLSelectElement;
const resolutionStatus = document.getElementById('resolution-status')!;

const inlineValue = document.getElementById('inline-value')!;
const crosslineValue = document.getElementById('crossline-value')!;
const timeValue = document.getElementById('time-value')!;

// Debounce timer for slider updates
let updateTimer: number | null = null;

// Auto mode state
let isAutoMode = true;
let lastAutoLevel = -1;
let autoUpdatePending = false;

// Interactive update state
let interactionLevel = 2; // Use 1/4x resolution during slider interaction
let savedLevel = 0;       // Level to restore after interaction
let isInteracting = false;
let interactionTimer: number | null = null;

/**
 * Calculate the appropriate resolution level based on camera distance
 * Closer = finer resolution (level 0), farther = coarser (higher levels)
 */
function calculateLevelFromZoom(): number {
    if (!progressiveVolume) return 0;

    const numLevels = progressiveVolume.getNumLevels();
    const distance = camera.position.length();

    // Distance thresholds for each level
    // At close range (< 1), use full resolution
    // At far range (> 4), use coarsest
    const minDist = 0.8;
    const maxDist = 4.0;

    // Normalize distance to 0-1 range
    const t = Math.max(0, Math.min(1, (distance - minDist) / (maxDist - minDist)));

    // Map to level (0 = finest, numLevels-1 = coarsest)
    const level = Math.floor(t * numLevels);
    return Math.min(level, numLevels - 1);
}

/**
 * Update the auto mode dropdown text to show current level
 */
function updateAutoModeText(level: number): void {
    const autoOption = resolutionSelect.options[0];
    if (autoOption && autoOption.value === 'auto') {
        const scale = Math.pow(2, level);
        const levelText = level === 0 ? 'Full' : `1/${scale}x`;
        autoOption.textContent = `Auto (${levelText})`;
    }
}

/**
 * Handle zoom changes in auto mode
 */
async function handleZoomChange(): Promise<void> {
    if (!isAutoMode || !progressiveVolume || autoUpdatePending) return;

    const newLevel = calculateLevelFromZoom();

    if (newLevel !== lastAutoLevel) {
        autoUpdatePending = true;
        lastAutoLevel = newLevel;

        console.log(`[Auto] Zoom level changed, switching to level ${newLevel}`);
        updateAutoModeText(newLevel);

        await progressiveVolume.setLevel(newLevel);
        autoUpdatePending = false;
    }
}

// Load progressive seismic data
async function loadProgressiveData() {
    try {
        loadingText.textContent = 'Loading seismic bricks...';

        progressiveVolume = new ProgressiveSeismicVolume(scene, {
            colormap: createColormap('seismic'),
            basePath: '/data/bricks'
        });

        // Set loading state callback
        progressiveVolume.setLoadingStateCallback((state, detail) => {
            if (state === 'loading') {
                resolutionStatus.textContent = detail || 'Loading...';
                resolutionStatus.classList.add('loading');
            } else if (state === 'refining') {
                resolutionStatus.textContent = detail || 'Refining...';
                resolutionStatus.classList.add('loading');
            } else {
                resolutionStatus.textContent = `Level ${progressiveVolume?.getCurrentLevel() ?? 0} loaded`;
                resolutionStatus.classList.remove('loading');
            }
        });

        // Initialize and load coarsest level
        const dims = await progressiveVolume.initialize();
        const { nx, ny, nz } = dims;

        console.log(`Loaded progressive volume: ${nx} x ${ny} x ${nz}`);

        // Populate resolution level selector
        const numLevels = progressiveVolume.getNumLevels();
        resolutionSelect.innerHTML = '<option value="auto">Auto (Progressive)</option>';
        for (let i = numLevels - 1; i >= 0; i--) {
            const scale = Math.pow(2, i);
            const label = i === 0 ? 'Full Resolution' : `1/${scale}x`;
            resolutionSelect.innerHTML += `<option value="${i}">${label}</option>`;
        }

        // Update UI
        inlineSlider.max = String(nx - 1);
        crosslineSlider.max = String(ny - 1);
        timeSlider.max = String(nz - 1);

        inlineSlider.value = String(Math.floor(nx / 2));
        crosslineSlider.value = String(Math.floor(ny / 2));
        timeSlider.value = String(Math.floor(nz / 2));

        updateSliderDisplays();

        surveyInfo.innerHTML = `
      <strong>F3 Netherlands</strong><br>
      Inlines: ${nx}<br>
      Crosslines: ${ny}<br>
      Time samples: ${nz}<br>
      <em>Progressive loading enabled</em>
    `;

        // Initial slice update
        await updateSlices();

        // Hide loading overlay
        loadingOverlay.classList.add('hidden');

        // Start in auto mode - set initial level based on current zoom
        lastAutoLevel = calculateLevelFromZoom();
        updateAutoModeText(lastAutoLevel);
        await progressiveVolume.setLevel(lastAutoLevel);

    } catch (error) {
        console.error('Error loading progressive data:', error);
        loadingText.textContent = 'Failed to load bricked data. Falling back to single file...';

        // Could fall back to original loading method here
        setTimeout(() => {
            loadingText.textContent = 'No bricked data found. Run convert_to_bricks.py first.';
        }, 2000);
    }
}

function updateSliderDisplays() {
    inlineValue.textContent = inlineSlider.value;
    crosslineValue.textContent = crosslineSlider.value;
    timeValue.textContent = timeSlider.value;
}

async function updateSlices() {
    if (!progressiveVolume) return;

    const inlinePos = parseInt(inlineSlider.value);
    const crosslinePos = parseInt(crosslineSlider.value);
    const timePos = parseInt(timeSlider.value);
    const opacity = parseInt(opacitySlider.value) / 100;

    await progressiveVolume.updateSlices(inlinePos, crosslinePos, timePos, opacity);
    updateSliderDisplays();
}

function debouncedUpdateSlices() {
    updateSliderDisplays();

    if (updateTimer !== null) {
        clearTimeout(updateTimer);
    }

    updateTimer = window.setTimeout(async () => {
        await updateSlices();
        updateTimer = null;
    }, 100); // 100ms debounce for smooth slider interaction
}

/**
 * Fast update during slider drag - uses coarser resolution
 */
async function interactiveSliderUpdate() {
    updateSliderDisplays();

    if (!progressiveVolume) return;

    // Switch to interaction level on first drag
    if (!isInteracting && !isAutoMode) {
        isInteracting = true;
        savedLevel = progressiveVolume.getCurrentLevel();

        // Only switch to coarse if we're at a finer level
        if (savedLevel < interactionLevel) {
            console.log(`[Perf] Switching to interaction level ${interactionLevel}`);
            await progressiveVolume.setLevel(interactionLevel);
        }
    }

    // Clear any pending full-resolution update
    if (interactionTimer !== null) {
        clearTimeout(interactionTimer);
    }

    // Throttled coarse update
    if (updateTimer !== null) {
        clearTimeout(updateTimer);
    }

    updateTimer = window.setTimeout(async () => {
        if (!progressiveVolume) return;

        const inlinePos = parseInt(inlineSlider.value);
        const crosslinePos = parseInt(crosslineSlider.value);
        const timePos = parseInt(timeSlider.value);
        const opacity = parseInt(opacitySlider.value) / 100;

        await progressiveVolume.updateSlices(inlinePos, crosslinePos, timePos, opacity);
        updateTimer = null;
    }, 30); // Fast updates during interaction
}

/**
 * Final update when slider is released - restores full resolution
 */
async function finalSliderUpdate() {
    // Schedule return to full resolution after interaction ends
    if (interactionTimer !== null) {
        clearTimeout(interactionTimer);
    }

    interactionTimer = window.setTimeout(async () => {
        if (!progressiveVolume || !isInteracting) return;

        console.log(`[Perf] Restoring level ${savedLevel}`);
        isInteracting = false;

        // Restore previous level
        await progressiveVolume.setLevel(savedLevel);
        await updateSlices();

        interactionTimer = null;
    }, 150); // Small delay to catch rapid slider adjustments
}

async function updateColormap() {
    if (!progressiveVolume) return;
    progressiveVolume.setColormap(createColormap(colormapSelect.value as ColormapType));
    await updateSlices();
}

async function handleResolutionChange() {
    if (!progressiveVolume) return;

    const value = resolutionSelect.value;

    if (value === 'auto') {
        // Enable auto mode based on zoom
        isAutoMode = true;
        console.log('[UI] Auto mode enabled');

        // Immediately apply zoom-based level
        const newLevel = calculateLevelFromZoom();
        lastAutoLevel = newLevel;
        updateAutoModeText(newLevel);
        await progressiveVolume.setLevel(newLevel);
        return;
    }

    // Manual mode
    isAutoMode = false;
    const level = parseInt(value);
    console.log(`[UI] Manual level selected: ${level}`);
    await progressiveVolume.setLevel(level);
}

// Event listeners - use coarse updates during drag, full resolution on release
inlineSlider.addEventListener('input', interactiveSliderUpdate);
crosslineSlider.addEventListener('input', interactiveSliderUpdate);
timeSlider.addEventListener('input', interactiveSliderUpdate);
inlineSlider.addEventListener('change', finalSliderUpdate);
crosslineSlider.addEventListener('change', finalSliderUpdate);
timeSlider.addEventListener('change', finalSliderUpdate);
opacitySlider.addEventListener('input', debouncedUpdateSlices);
colormapSelect.addEventListener('change', updateColormap);
resolutionSelect.addEventListener('change', handleResolutionChange);

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Check for zoom changes in auto mode
    if (isAutoMode && progressiveVolume) {
        handleZoomChange();
    }

    renderer.render(scene, camera);
}

// Start
loadProgressiveData();
animate();
