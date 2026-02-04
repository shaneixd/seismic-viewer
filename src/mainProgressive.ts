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

        // Start progressive refinement to full resolution
        await progressiveVolume.refineToLevel(0);

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
    }, 50); // 50ms debounce for smooth slider interaction
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
        // Progressive refinement - already done during initialization
        return;
    }

    const level = parseInt(value);
    await progressiveVolume.refineToLevel(level);
    await updateSlices();
}

// Event listeners
inlineSlider.addEventListener('input', debouncedUpdateSlices);
crosslineSlider.addEventListener('input', debouncedUpdateSlices);
timeSlider.addEventListener('input', debouncedUpdateSlices);
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
    renderer.render(scene, camera);
}

// Start
loadProgressiveData();
animate();
