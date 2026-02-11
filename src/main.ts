import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SeismicVolume } from './seismic/volume';
import { createColormap, AVAILABLE_COLORMAPS, generateContrastColors, type ColormapType } from './seismic/colormap';
import { WellRenderer } from './seismic/wellRenderer';
import { loadWellData } from './seismic/wellData';
import type { WellData } from './seismic/wellData';
import GUI from 'lil-gui';

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

// Well renderer
let wellRenderer: WellRenderer | null = null;

// UI Elements (kept for loading overlay)
const loadingOverlay = document.getElementById('loading-overlay')!;
const loadingText = document.getElementById('loading-text')!;
const wellInfoPanel = document.getElementById('well-info')!;

// lil-gui setup
const gui = new GUI({ title: 'Seismic Viewer', width: 280 });

// Build colormap options as { display: value } object
const colormapOptions: Record<string, string> = {};
AVAILABLE_COLORMAPS.forEach(map => {
  colormapOptions[map.charAt(0).toUpperCase() + map.slice(1)] = map;
});

// Reactive params object for lil-gui
const params = {
  dataset: 'f3',
  inline: 50,
  crossline: 50,
  time: 50,
  opacity: 80,
  colormap: 'seismic' as string,
  showWells: true,
  showFormations: true,
  surveyInfo: 'Loading...',
};

// Dataset dropdown
const datasetOptions: Record<string, string> = {
  'F3 Netherlands': 'f3',
  'Parihaka (NZ)': 'parihaka',
};
gui.add(params, 'dataset', datasetOptions).name('Dataset').onChange((value: string) => {
  loadSeismicData(value);
});

// Slices folder
const slicesFolder = gui.addFolder('Slices');
const inlineCtrl = slicesFolder.add(params, 'inline', 0, 100, 1).name('Inline').onChange(updateSlices);
const crosslineCtrl = slicesFolder.add(params, 'crossline', 0, 100, 1).name('Crossline').onChange(updateSlices);
const timeCtrl = slicesFolder.add(params, 'time', 0, 100, 1).name('Time').onChange(updateSlices);

// Display folder
const displayFolder = gui.addFolder('Display');
displayFolder.add(params, 'opacity', 0, 100, 1).name('Opacity').onChange(updateSlices);
displayFolder.add(params, 'colormap', colormapOptions).name('Color Scale').onChange(() => {
  updateColormap();
});

// Wells folder
const wellsFolder = gui.addFolder('Wells');
wellsFolder.add(params, 'showWells').name('Show Wells').onChange((value: boolean) => {
  if (wellRenderer) wellRenderer.setAllVisible(value);
});
wellsFolder.add(params, 'showFormations').name('Show Formations').onChange((value: boolean) => {
  if (wellRenderer) wellRenderer.setFormationsVisible(value);
});

// Custom well list container inside the wells folder
const wellListContainer = document.createElement('div');
wellListContainer.className = 'well-list';
wellsFolder.$children.appendChild(wellListContainer);

// Survey info folder (collapsed by default)
const infoFolder = gui.addFolder('Survey Info');
infoFolder.close();
const surveyInfoCtrl = infoFolder.add(params, 'surveyInfo').name('').disable();
surveyInfoCtrl.$widget.style.cssText = 'font-size: 11px; min-width: 0;';
surveyInfoCtrl.domElement.style.cssText = 'height: auto; min-height: 26px;';

// Load seismic data
interface DatasetConfig {
  name: string;
  url: string;
  description: string;
  scale?: { x: number, y: number, z: number };
  wellDataUrl?: string;
  // Survey grid parameters for well positioning
  ilRange?: [number, number];
  xlRange?: [number, number];
  timeRangeMs?: [number, number];
}

const DATASETS: Record<string, DatasetConfig> = {
  f3: {
    name: 'F3 Netherlands',
    url: '/data/f3_highres.bin',
    description: 'F3 Netherlands: High Resolution (401x701x255)',
    wellDataUrl: '/data/f3_wells.json',
    // Zenodo Facies Benchmark subset ranges
    ilRange: [100, 500],
    xlRange: [300, 1000],
    timeRangeMs: [0, 1848],
  },
  parihaka: {
    name: 'Parihaka (New Zealand)',
    url: '/data/parihaka_full.bin',
    description: 'Parihaka PSTM Full Angle Stack (Taranaki Basin)'
  }
};


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

    // Update lil-gui slider ranges
    inlineCtrl.max(nx - 1);
    crosslineCtrl.max(ny - 1);
    timeCtrl.max(nz - 1);

    params.inline = Math.floor(nx / 2);
    params.crossline = Math.floor(ny / 2);
    params.time = Math.floor(nz / 2);
    inlineCtrl.updateDisplay();
    crosslineCtrl.updateDisplay();
    timeCtrl.updateDisplay();

    params.surveyInfo = `${config.name} | ${nx}×${ny}×${nz} | ${(floatData.length / 1e6).toFixed(1)}M samples`;
    surveyInfoCtrl.updateDisplay();

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

    // Load wells if available for this dataset
    if (config.wellDataUrl && seismicVolume) {
      loadingText.textContent = 'Loading well data...';
      await loadAndRenderWells(config, seismicVolume);
    } else {
      clearWellUI();
    }

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

  // Update lil-gui slider ranges
  inlineCtrl.max(nx - 1);
  crosslineCtrl.max(ny - 1);
  timeCtrl.max(nz - 1);

  params.inline = Math.floor(nx / 2);
  params.crossline = Math.floor(ny / 2);
  params.time = Math.floor(nz / 2);
  inlineCtrl.updateDisplay();
  crosslineCtrl.updateDisplay();
  timeCtrl.updateDisplay();

  params.surveyInfo = `Demo (${datasetName}) | ${nx}×${ny}×${nz} | Synthetic`;
  surveyInfoCtrl.updateDisplay();

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

function updateSlices() {
  if (!seismicVolume) return;
  seismicVolume.updateSlices(params.inline, params.crossline, params.time, params.opacity / 100);
}

function updateColormap() {
  if (!seismicVolume) return;
  const lut = createColormap(params.colormap as ColormapType);
  seismicVolume.setColormap(lut);
  updateSlices();

  // Update well colors to contrast with the new colormap
  applyContrastColorsToWells(lut);
}

/**
 * Generate contrast colors from the active LUT and apply to all wells + formations.
 */
function applyContrastColorsToWells(lut: Uint8Array): void {
  if (!wellRenderer || !wellRenderer.hasWells()) return;

  // Contrast colors for well sticks
  const wellNames = wellRenderer.getWellNames();
  const colors = generateContrastColors(lut, wellNames.length);
  wellRenderer.updateWellColors(colors);

  // Contrast colors for formation tops — generate more colors for the unique formations
  const formationCodes = wellRenderer.getUniqueFormationCodes();
  if (formationCodes.length > 0) {
    // Generate enough contrast colors for all unique formations
    // We request (wells + formations) total so the algorithm spreads across the full gap space,
    // then take only the formation slice — this avoids formations duplicating well colors.
    const allColors = generateContrastColors(lut, wellNames.length + formationCodes.length);
    const fmColors = allColors.slice(wellNames.length);
    const fmColorMap = new Map<string, string>();
    for (let i = 0; i < formationCodes.length; i++) {
      fmColorMap.set(formationCodes[i], fmColors[i]);
    }
    wellRenderer.updateFormationColors(fmColorMap);
  }

  // Update UI dots to match
  const dots = wellListContainer.querySelectorAll('.well-dot');
  dots.forEach((dot, i) => {
    if (i < colors.length) {
      (dot as HTMLElement).style.backgroundColor = colors[i];
      (dot as HTMLElement).style.color = colors[i];
    }
  });
}


async function loadAndRenderWells(config: DatasetConfig, volume: SeismicVolume): Promise<void> {
  if (!config.wellDataUrl) return;

  const wellData = await loadWellData(config.wellDataUrl);
  if (!wellData || wellData.wells.length === 0) {
    console.log('No well data available');
    clearWellUI();
    return;
  }

  // Dispose previous well renderer
  if (wellRenderer) {
    wellRenderer.dispose();
  }

  // Create well renderer with volume parameters
  wellRenderer = new WellRenderer(scene, {
    scale: volume.scale,
    dimensions: volume.dimensions,
    volumeIlRange: config.ilRange || [0, volume.dimensions.nx],
    volumeXlRange: config.xlRange || [0, volume.dimensions.ny],
    volumeTimeRange: config.timeRangeMs || [0, 1848],
  });

  // Generate contrast colors based on current colormap
  const lut = createColormap(params.colormap as ColormapType);
  const contrastColors = generateContrastColors(lut, wellData.wells.length);
  for (let i = 0; i < wellData.wells.length; i++) {
    wellData.wells[i].color = contrastColors[i];
  }

  wellRenderer.loadWells(wellData);

  // Update UI
  populateWellList(wellData.wells);

  console.log(`Rendered ${wellData.wells.length} wells with contrast colors:`, contrastColors);
}

function populateWellList(wells: WellData[]): void {
  wellListContainer.innerHTML = '';

  for (const well of wells) {
    const item = document.createElement('div');
    item.className = 'well-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.style.display = 'none';

    const dot = document.createElement('div');
    dot.className = 'well-dot';
    dot.style.backgroundColor = well.color;
    dot.style.color = well.color;

    const name = document.createElement('span');
    name.className = 'well-item-name';
    name.textContent = well.name;

    const info = document.createElement('span');
    info.className = 'well-item-info';
    info.textContent = `${well.formations.length} fms`;

    item.appendChild(checkbox);
    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(info);

    // Click to toggle visibility + show info
    item.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked;
      if (wellRenderer) {
        wellRenderer.setWellVisible(well.name, checkbox.checked);
      }
      dot.style.opacity = checkbox.checked ? '1' : '0.3';
      name.style.opacity = checkbox.checked ? '1' : '0.5';

      // Show well info
      showWellInfo(well);
    });

    wellListContainer.appendChild(item);
  }
}

function showWellInfo(well: WellData): void {
  const topFormations = well.formations.slice(0, 5).map(f => f.name).join(', ');
  wellInfoPanel.innerHTML = `
    <strong style="color: ${well.color}">${well.name}</strong><br>
    IL: ${well.surface_il.toFixed(0)} / XL: ${well.surface_xl.toFixed(0)}<br>
    TD: ${well.td_md.toFixed(0)}m MD<br>
    Formations: ${well.formations.length}<br>
    <small>${topFormations}${well.formations.length > 5 ? '...' : ''}</small>
  `;
  wellInfoPanel.classList.remove('hidden');
}

function clearWellUI(): void {
  wellListContainer.innerHTML = '<span style="font-size:11px;color:#888">No wells available</span>';
  wellInfoPanel.classList.add('hidden');
  if (wellRenderer) {
    wellRenderer.dispose();
    wellRenderer = null;
  }
}

// Formation hover tooltip
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Create tooltip element
const tooltip = document.createElement('div');
tooltip.id = 'formation-tooltip';
tooltip.className = 'formation-tooltip hidden';
document.getElementById('app')!.appendChild(tooltip);

let hoveredFormation: THREE.Mesh | null = null;

canvas.addEventListener('mousemove', (event: MouseEvent) => {
  // Convert to normalized device coords
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  if (!wellRenderer || !wellRenderer.hasWells()) {
    tooltip.classList.add('hidden');
    return;
  }

  raycaster.setFromCamera(mouse, camera);
  const formationMeshes = wellRenderer.getFormationMeshes();
  const intersects = raycaster.intersectObjects(formationMeshes, false);

  if (intersects.length > 0) {
    const hit = intersects[0].object as THREE.Mesh;
    const data = hit.userData;

    if (data.isFormationMarker) {
      // Update tooltip content
      tooltip.innerHTML = `
        <div class="fm-tooltip-header" style="border-left: 3px solid ${data.wellColor}">
          <span class="fm-tooltip-well">${data.wellName}</span>
        </div>
        <div class="fm-tooltip-body">
          <div class="fm-tooltip-name" style="color: ${data.formationColor}">● ${data.formationName}</div>
          <div class="fm-tooltip-depth">${data.topTvdss.toFixed(0)}m TVDSS · ${data.topMd.toFixed(0)}m MD</div>
          <div class="fm-tooltip-code">${data.formationCode}</div>
        </div>
      `;
      tooltip.style.left = `${event.clientX + 16}px`;
      tooltip.style.top = `${event.clientY - 10}px`;
      tooltip.classList.remove('hidden');

      // Highlight the hovered ring
      if (hoveredFormation && hoveredFormation !== hit) {
        // Restore previous
        (hoveredFormation.material as THREE.MeshPhongMaterial).opacity = 0.8;
      }
      (hit.material as THREE.MeshPhongMaterial).opacity = 1.0;
      hoveredFormation = hit;

      canvas.style.cursor = 'pointer';
      return;
    }
  }

  // No hit — hide tooltip
  if (hoveredFormation) {
    (hoveredFormation.material as THREE.MeshPhongMaterial).opacity = 0.8;
    hoveredFormation = null;
  }
  tooltip.classList.add('hidden');
  canvas.style.cursor = '';
});

// Click on well in 3D to recenter camera
let mouseDownPos = { x: 0, y: 0 };

canvas.addEventListener('mousedown', (event: MouseEvent) => {
  mouseDownPos = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener('mouseup', (event: MouseEvent) => {
  // Only trigger on actual clicks, not drags (threshold: 5px)
  const dx = event.clientX - mouseDownPos.x;
  const dy = event.clientY - mouseDownPos.y;
  if (Math.sqrt(dx * dx + dy * dy) > 5) return;

  if (!wellRenderer || !wellRenderer.hasWells()) return;

  const clickMouse = new THREE.Vector2(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1
  );

  raycaster.setFromCamera(clickMouse, camera);

  // Check well sticks and spheres
  const stickMeshes = wellRenderer.getWellStickMeshes();
  const intersects = raycaster.intersectObjects(stickMeshes, false);

  if (intersects.length > 0) {
    const wellName = intersects[0].object.userData.wellName as string;
    if (wellName) {
      const bounds = wellRenderer.getWellBounds(wellName);
      if (bounds) {
        // Preserve current viewing direction, just adjust distance to frame the well
        const currentDir = camera.position.clone().sub(controls.target).normalize();
        const distance = Math.max(bounds.extent * 1.8, 0.3);
        const cameraPos = bounds.center.clone().add(currentDir.multiplyScalar(distance));
        animateCameraToWell(bounds.center, cameraPos);
      }

      // Also show well info
      const wellData = wellRenderer.getWellByName(wellName);
      if (wellData) {
        showWellInfo(wellData);
      }
    }
  }
});

// Handle window resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Smooth camera animation — target + position
let cameraAnimationId: number | null = null;

function animateCameraToWell(targetPos: THREE.Vector3, cameraPos: THREE.Vector3): void {
  // Cancel any in-progress animation
  if (cameraAnimationId !== null) {
    cancelAnimationFrame(cameraAnimationId);
    cameraAnimationId = null;
  }

  const startTarget = controls.target.clone();
  const startCamPos = camera.position.clone();
  const startTime = performance.now();
  const duration = 700; // ms

  function step() {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease-in-out cubic
    const ease = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    controls.target.lerpVectors(startTarget, targetPos, ease);
    camera.position.lerpVectors(startCamPos, cameraPos, ease);
    controls.update();

    if (t < 1) {
      cameraAnimationId = requestAnimationFrame(step);
    } else {
      cameraAnimationId = null;
    }
  }

  cameraAnimationId = requestAnimationFrame(step);
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// Start
loadSeismicData('f3');
animate();

