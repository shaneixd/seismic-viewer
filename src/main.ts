import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SeismicVolume } from './seismic/volume';
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

// Seismic volume
let seismicVolume: SeismicVolume | null = null;

// UI Elements
const loadingOverlay = document.getElementById('loading-overlay')!;
const loadingText = document.getElementById('loading-text')!;
const surveyInfo = document.getElementById('survey-info')!;

const inlineSlider = document.getElementById('inline-slider') as HTMLInputElement;
const crosslineSlider = document.getElementById('crossline-slider') as HTMLInputElement;
const timeSlider = document.getElementById('time-slider') as HTMLInputElement;
const opacitySlider = document.getElementById('opacity-slider') as HTMLInputElement;
const colormapSelect = document.getElementById('colormap') as HTMLSelectElement;

const inlineValue = document.getElementById('inline-value')!;
const crosslineValue = document.getElementById('crossline-value')!;
const timeValue = document.getElementById('time-value')!;

// Load seismic data
interface DatasetConfig {
  name: string;
  url: string;
  description: string;
  scale?: { x: number, y: number, z: number };
}

const DATASETS: Record<string, DatasetConfig> = {
  f3: {
    name: 'F3 Netherlands',
    url: '/data/f3_highres.bin',
    description: 'F3 Netherlands: High Resolution (401x701x255)'
    // Auto-scale is fine for F3, or we can enforce it
  },
  parihaka: {
    name: 'Parihaka (New Zealand)',
    url: '/data/parihaka_full.bin',
    description: 'Parihaka PSTM Full Angle Stack (Taranaki Basin)'
  }
};

const datasetSelector = document.getElementById('dataset-selector') as HTMLSelectElement;

async function loadSeismicData(datasetKey: string = 'f3') {
  const config = DATASETS[datasetKey];
  if (!config) return;

  try {
    loadingOverlay.classList.remove('hidden');
    loadingText.textContent = `Loading ${config.name}...`;

    // Clear previous volume
    if (seismicVolume) {
      seismicVolume.dispose();
    }

    // Try to load the binary seismic data
    const response = await fetch(config.url);

    // Check content type - Vite returns HTML for missing files
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(`Data file not found at ${config.url}`);
    }

    if (!response.ok) {
      throw new Error(`Failed to load seismic data: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    // Validate minimum file size (header is 12 bytes)
    if (arrayBuffer.byteLength < 100) {
      throw new Error(`Data file too small: ${arrayBuffer.byteLength} bytes`);
    }

    loadingText.textContent = 'Processing data...';

    // Parse header (first 12 bytes: nx, ny, nz as int32)
    const headerView = new DataView(arrayBuffer);
    const nx = headerView.getInt32(0, true); // inline
    const ny = headerView.getInt32(4, true); // crossline
    const nz = headerView.getInt32(8, true); // time samples

    // Validate dimensions are reasonable
    if (nx <= 0 || ny <= 0 || nz <= 0 || nx > 10000 || ny > 10000 || nz > 10000) {
      throw new Error(`Invalid dimensions: ${nx} x ${ny} x ${nz}`);
    }

    // Extract float32 data
    const dataOffset = 12;
    const expectedSize = nx * ny * nz * 4 + dataOffset;
    if (arrayBuffer.byteLength < expectedSize) {
      throw new Error(`Data file incomplete: expected ${expectedSize} bytes, got ${arrayBuffer.byteLength}`);
    }

    const floatData = new Float32Array(arrayBuffer, dataOffset);

    console.log(`Loaded seismic volume: ${nx} x ${ny} x ${nz} = ${floatData.length} samples`);

    // Update UI
    inlineSlider.max = String(nx - 1);
    crosslineSlider.max = String(ny - 1);
    timeSlider.max = String(nz - 1);

    inlineSlider.value = String(Math.floor(nx / 2));
    crosslineSlider.value = String(Math.floor(ny / 2));
    timeSlider.value = String(Math.floor(nz / 2));

    updateSliderDisplays();

    surveyInfo.innerHTML = `
      <strong>${config.name}</strong><br>
      Inlines: ${nx}<br>
      Crosslines: ${ny}<br>
      Time samples: ${nz}<br>
      Total: ${(floatData.length / 1000000).toFixed(1)}M samples<br>
      <small>${config.description}</small>
    `;

    // Create seismic volume visualization
    // We recreate the scene object for the new data
    // Ideally SeismicVolume should be updated, but for now we create new
    // We need to remove the old mesh from scene if it exists.
    // Assuming SeismicVolume adds itself to scene. 
    // We might need to refactor SeismicVolume to allow disposal or update.
    // For this prototype, let's assume SeismicVolume cleans up or we can find it in the scene.

    // Quick hack: Remove old volume mesh if we can access it, or just clear scene "seismic" objects
    // Since we don't have direct access to the mesh in the class without checking, 
    // let's rely on garbage collection if we drop the reference, 
    // BUT we must remove it from the scene graph.
    // Let's modify SeismicVolume later or just clear the scene partially.
    // For now, let's just clear ALL children that are not lights/helpers?
    // Or better: pass the old instance and let it clean up?

    // Actually, looking at SeismicVolume usage, it takes 'scene' in constructor.
    // We should probably add a dispose method to SeismicVolume.
    // Since I can't edit SeismicVolume right now easily without context, 
    // I'll make sure to implement a simple cleanup if I can find the object.

    // Check if we have an old volume
    if (seismicVolume) {
      // We need to implement a dispose/remove method or manually remove its mesh
      // This is a known technical debt item.
      // For now, I will reload the page if switching datasets? No, that's bad UX.
      // I will assume SeismicVolume needs a destroy method.
      // I will just add logic to remove objects with specific names if I named them.
    }

    seismicVolume = new SeismicVolume(scene, {
      data: floatData,
      dimensions: { nx, ny, nz },
      colormap: createColormap('seismic')
    });

    // Initial slice positions
    updateSlices();

    // Hide loading overlay
    loadingOverlay.classList.add('hidden');

  } catch (error) {
    console.error('Error loading seismic data:', error);
    loadingText.textContent = 'Demo mode: showing synthetic data';

    // Create demo data if real data not available
    await createDemoData(config.name);
  }
}

// Create synthetic demo data for testing
async function createDemoData(datasetName: string) {
  const nx = 100;
  const ny = 100;
  const nz = 100;

  const data = new Float32Array(nx * ny * nz);

  // Generate synthetic seismic-like data with horizons
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        const idx = i * ny * nz + j * nz + k;

        // Create layered reflections with some structure
        const depth = k / nz;
        const offset = Math.sin(i * 0.1) * 5 + Math.cos(j * 0.08) * 3;

        // Multiple reflection events
        let value = 0;
        value += Math.sin((k + offset) * 0.3) * Math.exp(-depth * 0.5);
        value += Math.sin((k + offset) * 0.15) * 0.5 * Math.exp(-depth * 0.3);
        value += Math.sin((k + offset) * 0.6) * 0.3 * Math.exp(-depth * 0.7);

        // Add some noise
        value += (Math.random() - 0.5) * 0.1;

        // Simulate a fault
        if (i > nx * 0.6 && j > ny * 0.4 && j < ny * 0.7) {
          value = data[Math.max(0, (i - 1)) * ny * nz + j * nz + Math.min(nz - 1, k + 5)] || value;
        }

        data[idx] = value;
      }
    }
  }

  // Normalize
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    min = Math.min(min, data[i]);
    max = Math.max(max, data[i]);
  }
  for (let i = 0; i < data.length; i++) {
    data[i] = (data[i] - min) / (max - min) * 2 - 1;
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
    <strong>Demo Data (${datasetName})</strong><br>
    Inlines: ${nx}<br>
    Crosslines: ${ny}<br>
    Time samples: ${nz}<br>
    <em>Synthetic data - file not found</em>
  `;

  // Clean up old volume if exists (naive approach)
  // note: strictly speaking we should remove old meshes from scene.

  seismicVolume = new SeismicVolume(scene, {
    data,
    dimensions: { nx, ny, nz },
    colormap: createColormap('seismic')
  });

  updateSlices();
  loadingOverlay.classList.add('hidden');
}

function updateSliderDisplays() {
  inlineValue.textContent = inlineSlider.value;
  crosslineValue.textContent = crosslineSlider.value;
  timeValue.textContent = timeSlider.value;
}

function updateSlices() {
  if (!seismicVolume) return;

  const inlinePos = parseInt(inlineSlider.value);
  const crosslinePos = parseInt(crosslineSlider.value);
  const timePos = parseInt(timeSlider.value);
  const opacity = parseInt(opacitySlider.value) / 100;

  seismicVolume.updateSlices(inlinePos, crosslinePos, timePos, opacity);
  updateSliderDisplays();
}

function updateColormap() {
  if (!seismicVolume) return;
  seismicVolume.setColormap(createColormap(colormapSelect.value as ColormapType));
  updateSlices();
}

// Event listeners
inlineSlider.addEventListener('input', updateSlices);
crosslineSlider.addEventListener('input', updateSlices);
timeSlider.addEventListener('input', updateSlices);
opacitySlider.addEventListener('input', updateSlices);
colormapSelect.addEventListener('change', updateColormap);

datasetSelector.addEventListener('change', (e) => {
  const target = e.target as HTMLSelectElement;
  loadSeismicData(target.value);
});

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
loadSeismicData('f3');
animate();

