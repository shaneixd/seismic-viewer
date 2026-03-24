/**
 * Well Field Visualization — Main Entry Point
 * 3D view of a field of wells with trajectories, casing shoes, and drilling events.
 */

import './wellField.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WellFieldRenderer } from './wells/wellFieldRenderer';
import { loadWellFieldData } from './wells/wellFieldData';
import type { WellFieldWell } from './wells/wellFieldData';
import GUI from 'lil-gui';

// ── Scene Setup ──
const canvas = document.getElementById('well-canvas') as HTMLCanvasElement;
const scene = new THREE.Scene();

// Gradient background — dark sky above, deep ocean blue at horizon
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.FogExp2(0x050510, 0.0);

// Camera
const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.01,
    100
);
camera.position.set(3, 1.5, 3);
camera.lookAt(0, -1, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 2.2;

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 0.2;
controls.maxDistance = 20;
controls.target.set(0, -1.5, 0);

// ── Lighting ──
const ambientLight = new THREE.AmbientLight(0x334455, 1.8);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
dirLight.position.set(3, 5, 2);
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0x222244, 0x112211, 0.4);
scene.add(hemiLight);

// Subtle point light for depth cue
const pointLight = new THREE.PointLight(0x6688aa, 0.5, 10);
pointLight.position.set(-2, -2, -2);
scene.add(pointLight);

// ── Grid ──
const gridHelper = new THREE.GridHelper(8, 40, 0x222244, 0x151530);
gridHelper.position.y = 0.025; // At sea level
scene.add(gridHelper);

// Sea surface plane — subtle reflective surface
const seaSurfaceGeo = new THREE.PlaneGeometry(12, 12);
seaSurfaceGeo.rotateX(-Math.PI / 2);
const seaSurfaceMat = new THREE.MeshPhongMaterial({
    color: 0x0a1628,
    transparent: true,
    opacity: 0.4,
    shininess: 100,
    side: THREE.DoubleSide,
    depthWrite: false,
});
const seaSurface = new THREE.Mesh(seaSurfaceGeo, seaSurfaceMat);
seaSurface.position.y = 0.024;
scene.add(seaSurface);

// ── Well Field Renderer ──
let fieldRenderer: WellFieldRenderer | null = null;

// ── UI Elements ──
const loadingOverlay = document.getElementById('loading-overlay')!;
const loadingText = document.getElementById('loading-text')!;
const infoPanel = document.getElementById('well-info-panel')!;
const tooltip = document.getElementById('field-tooltip')!;

// ── lil-gui ──
const gui = new GUI({ title: 'Well Field Viewer', width: 280 });
gui.domElement.style.position = 'fixed';
gui.domElement.style.top = '0';
gui.domElement.style.left = '0';
gui.domElement.style.right = 'auto';

const params = {
    dataset: 'wellfield',
    showCasings: true,
    showWarnings: true,
    showLabels: true,
    showGeologicalLayers: false,
    showAllWells: true,
    fieldInfo: 'Loading...',
    fogDensity: 0.0,
    exposure: 2.2,
    ambientIntensity: 1.8,
    dirLightIntensity: 2.0,
    toneMapping: 'None' as string,
    dimOpacity: 0.15,
};

// Dataset dropdown — allows navigation back to seismic views
const datasetOptions: Record<string, string> = {
    'Well Field (Volve)': 'wellfield',
    'F3 Netherlands': 'f3',
    'Parihaka (NZ)': 'parihaka',
};
gui.add(params, 'dataset', datasetOptions).name('Dataset').onChange((value: string) => {
    if (value !== 'wellfield') {
        window.location.href = `/?dataset=${value}`;
    }
});

// Display folder
const displayFolder = gui.addFolder('Display');
displayFolder.add(params, 'showGeologicalLayers').name('Geological Layers').onChange((v: boolean) => {
    fieldRenderer?.setGeologicalLayersVisible(v);
});
displayFolder.add(params, 'showCasings').name('Casing Shoes').onChange((v: boolean) => {
    fieldRenderer?.setCasingShoesVisible(v);
});
displayFolder.add(params, 'showWarnings').name('Warnings').onChange((v: boolean) => {
    fieldRenderer?.setWarningsVisible(v);
});
displayFolder.add(params, 'showLabels').name('Labels').onChange((v: boolean) => {
    fieldRenderer?.setLabelsVisible(v);
});
displayFolder.add(params, 'showAllWells').name('Show All').onChange((v: boolean) => {
    fieldRenderer?.setAllVisible(v);
    const checkboxes = document.querySelectorAll('.well-visibility-checkbox') as NodeListOf<HTMLInputElement>;
    checkboxes.forEach(cb => {
        cb.checked = v;
        const item = cb.closest('.well-item') as HTMLElement;
        if (item) item.style.opacity = v ? '1' : '0.4';
    });
});
displayFolder.add(params, 'dimOpacity', 0, 1, 0.05).name('Dim Opacity').onChange((v: number) => {
    fieldRenderer?.setDimOpacity(v);
});

// Wells folder
const wellsFolder = gui.addFolder('Wells');
const wellListContainer = document.createElement('div');
wellListContainer.className = 'well-list';
wellsFolder.$children.appendChild(wellListContainer);

// Info folder
const infoFolder = gui.addFolder('Field Info');
infoFolder.close();
const infoCtrl = infoFolder.add(params, 'fieldInfo').name('').disable();
infoCtrl.$widget.style.cssText = 'font-size: 11px; min-width: 0;';
infoCtrl.domElement.style.cssText = 'height: auto; min-height: 26px;';

// Lighting folder
const lightingFolder = gui.addFolder('Lighting');
lightingFolder.close();
lightingFolder.add(params, 'fogDensity', 0, 0.4, 0.01).name('Fog Density').onChange((v: number) => {
    (scene.fog as THREE.FogExp2).density = v;
});
lightingFolder.add(params, 'exposure', 0.5, 3.0, 0.1).name('Exposure').onChange((v: number) => {
    renderer.toneMappingExposure = v;
});
lightingFolder.add(params, 'ambientIntensity', 0, 2.0, 0.1).name('Ambient').onChange((v: number) => {
    ambientLight.intensity = v;
});
lightingFolder.add(params, 'dirLightIntensity', 0, 3.0, 0.1).name('Directional').onChange((v: number) => {
    dirLight.intensity = v;
});
const toneMappingOptions: Record<string, string> = {
    'None': 'None',
    'ACES Filmic': 'ACESFilmic',
    'Reinhard': 'Reinhard',
    'Linear': 'Linear',
};
lightingFolder.add(params, 'toneMapping', toneMappingOptions).name('Tone Map').onChange((v: string) => {
    const map: Record<string, THREE.ToneMapping> = {
        'None': THREE.NoToneMapping,
        'ACESFilmic': THREE.ACESFilmicToneMapping,
        'Reinhard': THREE.ReinhardToneMapping,
        'Linear': THREE.LinearToneMapping,
    };
    renderer.toneMapping = map[v] ?? THREE.NoToneMapping;
});

// ── Load Data ──
async function loadWellField(): Promise<void> {
    try {
        loadingOverlay.classList.remove('hidden');
        loadingText.textContent = 'Loading well field data...';

        const data = await loadWellFieldData('/data/volve_wells.json');
        if (!data) {
            loadingText.textContent = 'Failed to load well field data.';
            return;
        }

        // Only show wells with real WITSML trajectory data
        data.wells = data.wells.filter(w => w.data_source === 'witsml');

        // Create renderer
        fieldRenderer = new WellFieldRenderer(scene);
        fieldRenderer.loadWells(data);

        // Update info
        const totalEvents = data.wells.reduce((sum, w) => sum + w.events.length, 0);
        params.fieldInfo = `${data.field_name} | ${data.wells.length} wells | ${totalEvents} events`;
        infoCtrl.updateDisplay();

        // Populate well list
        populateWellList(data.wells);

        loadingOverlay.classList.add('hidden');
    } catch (error) {
        console.error('Error loading well field:', error);
        loadingText.textContent = 'Error loading well field data';
    }
}

function populateWellList(wells: WellFieldWell[]): void {
    wellListContainer.innerHTML = '';

    for (const well of wells) {
        const item = document.createElement('div');
        item.className = 'well-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.className = 'well-visibility-checkbox';
        checkbox.title = 'Toggle visibility';
        checkbox.addEventListener('click', (e) => e.stopPropagation());
        checkbox.addEventListener('change', (e) => {
            const visible = (e.target as HTMLInputElement).checked;
            if (fieldRenderer) fieldRenderer.setWellVisible(well.name, visible);
            item.style.opacity = visible ? '1' : '0.4';
        });

        const dot = document.createElement('div');
        dot.className = 'well-dot';
        dot.style.backgroundColor = well.color;

        const name = document.createElement('span');
        name.className = 'well-item-name';
        name.textContent = well.name;
        // Add a subtle indicator for real vs synthesized data
        if (well.data_source === 'witsml' || well.data_source === 'mwd_csv' || well.data_source === 'welleng') {
            name.title = well.data_source === 'witsml' ? 'Real WITSML directional survey'
                : well.data_source === 'mwd_csv' ? 'Real MWD realtime trajectory'
                    : 'Computed directional trajectory';
        }

        const info = document.createElement('span');
        info.className = 'well-item-info';
        const purposeShort = well.purpose === 'Production' ? 'Prod' :
            well.purpose === 'Injection' ? 'Inj' :
                well.purpose === 'Observation' ? 'Obs' :
                    well.purpose === 'Appraisal' ? 'App' : well.purpose.slice(0, 4);
        let tag = `${purposeShort}`;
        if (well.data_source !== 'synthesized') tag += ' ✦';
        tag += ` · ${well.casings.length} csgs`;
        const warningCount = well.events.filter(e => e.severity === 'warning').length;
        const criticalCount = well.events.filter(e => e.severity === 'critical').length;
        if (criticalCount > 0) tag += ` · ${criticalCount}🔴`;
        else if (warningCount > 0) tag += ` · ${warningCount}🟡`;
        info.textContent = tag;

        item.appendChild(checkbox);
        item.appendChild(dot);
        item.appendChild(name);
        item.appendChild(info);

        item.addEventListener('click', () => {
            showWellInfo(well);
            if (fieldRenderer) {
                fieldRenderer.highlightWell(well.name);
                const bounds = fieldRenderer.getWellBounds(well.name);
                if (bounds) {
                    const dir = camera.position.clone().sub(controls.target).normalize();
                    const distance = Math.max(bounds.extent * 2.0, 0.5);
                    const cameraPos = bounds.center.clone().add(dir.multiplyScalar(distance));
                    animateCamera(bounds.center, cameraPos);
                }
            }
        });

        item.addEventListener('dblclick', () => {
            // Double-click to reset highlight
            fieldRenderer?.highlightWell(null);
        });

        wellListContainer.appendChild(item);
    }
}

function showWellInfo(well: WellFieldWell): void {
    const casingRows = well.casings.map(c =>
        `<tr>
      <td style="color:${c.color}">●</td>
      <td>${c.name}</td>
      <td>${c.od_inches}"</td>
      <td>${c.shoe_md.toFixed(0)}m</td>
    </tr>`
    ).join('');

    const eventRows = well.events.map(e =>
        `<div class="event-row ${e.severity}">
      <span class="event-icon">${e.severity === 'critical' ? '🔴' : '🟡'}</span>
      <span class="event-text">${e.description}</span>
    </div>`
    ).join('');

    const dataSourceLabel = well.data_source === 'witsml'
        ? '<span style="color:#4fc3f7;font-size:11px">✦ Real WITSML directional survey</span>'
        : well.data_source === 'mwd_csv'
            ? '<span style="color:#81c784;font-size:11px">✦ Real MWD realtime trajectory</span>'
            : well.data_source === 'welleng'
                ? '<span style="color:#ce93d8;font-size:11px">✦ Computed directional trajectory</span>'
                : '<span style="color:#999;font-size:11px">Trajectory derived from survey summary</span>';

    const dateInfo = well.entered_date && well.completed_date
        ? `<div class="info-row"><span>Drilled:</span><span>${well.entered_date} — ${well.completed_date}</span></div>`
        : '';

    infoPanel.innerHTML = `
    <div class="info-header">
      <h3 style="color:${well.color}">${well.name}</h3>
      <button class="info-close" onclick="document.getElementById('well-info-panel').classList.add('hidden')">&times;</button>
    </div>
    <div class="info-body">
      <div class="info-row"><span>Purpose:</span><span>${well.purpose}</span></div>
      <div class="info-row"><span>Platform:</span><span>${well.platform}</span></div>
      <div class="info-row"><span>TD:</span><span>${well.td_md.toFixed(0)}m MD / ${well.td_tvd.toFixed(0)}m TVD</span></div>
      <div class="info-row"><span>Water Depth:</span><span>${well.water_depth.toFixed(0)}m</span></div>
      ${dateInfo}
      <div class="info-row">${dataSourceLabel}</div>

      <h4>Casing Program</h4>
      <table class="casing-table">
        <thead><tr><th></th><th>String</th><th>OD</th><th>Shoe</th></tr></thead>
        <tbody>${casingRows}</tbody>
      </table>

      ${well.events.length > 0 ? `
        <h4>Drilling Events (${well.events.length})</h4>
        <div class="events-list">${eventRows}</div>
      ` : ''}
    </div>
  `;
    infoPanel.classList.remove('hidden');
}

// ── Raycasting ──
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

canvas.addEventListener('mousemove', (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    if (!fieldRenderer || !fieldRenderer.hasWells()) {
        tooltip.classList.add('hidden');
        return;
    }

    raycaster.setFromCamera(mouse, camera);

    // Check event markers
    const eventMeshes = fieldRenderer.getEventMeshes();
    const eventHits = raycaster.intersectObjects(eventMeshes, false);
    if (eventHits.length > 0) {
        const data = eventHits[0].object.userData;
        tooltip.innerHTML = `
      <div class="tooltip-header ${data.eventSeverity}">
        ${data.eventSeverity === 'critical' ? '🔴' : '🟡'} ${data.eventType.replace(/_/g, ' ')}
      </div>
      <div class="tooltip-body">
        <div class="tooltip-well">${data.wellName}</div>
        <div class="tooltip-depth">${data.eventMD.toFixed(0)}m MD / ${data.eventTVD.toFixed(0)}m TVD</div>
        <div class="tooltip-desc">${data.eventDescription}</div>
      </div>
    `;
        tooltip.style.left = `${event.clientX + 16}px`;
        tooltip.style.top = `${event.clientY - 10}px`;
        tooltip.classList.remove('hidden');
        canvas.style.cursor = 'pointer';
        return;
    }

    // Check casing shoes
    const casingMeshes = fieldRenderer.getCasingMeshes();
    const casingHits = raycaster.intersectObjects(casingMeshes, false);
    if (casingHits.length > 0) {
        const data = casingHits[0].object.userData;
        tooltip.innerHTML = `
      <div class="tooltip-header casing">
        Casing Shoe — ${data.casingName}
      </div>
      <div class="tooltip-body">
        <div class="tooltip-well">${data.wellName}</div>
        <div class="tooltip-depth">${data.casingOD}" OD @ ${data.shoeMD.toFixed(0)}m MD</div>
      </div>
    `;
        tooltip.style.left = `${event.clientX + 16}px`;
        tooltip.style.top = `${event.clientY - 10}px`;
        tooltip.classList.remove('hidden');
        canvas.style.cursor = 'pointer';
        return;
    }

    // Check well trajectories
    const hitMeshes = fieldRenderer.getHitMeshes();
    const wellHits = raycaster.intersectObjects(hitMeshes, false);
    if (wellHits.length > 0) {
        const wellName = wellHits[0].object.userData.wellName;
        if (wellName) {
            fieldRenderer.highlightWell(wellName);
            canvas.style.cursor = 'pointer';
            tooltip.classList.add('hidden');
            return;
        }
    }

    // No hit
    tooltip.classList.add('hidden');
    canvas.style.cursor = '';
});

// Click on well
let mouseDownPos = { x: 0, y: 0 };
canvas.addEventListener('mousedown', (event: MouseEvent) => {
    mouseDownPos = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener('mouseup', (event: MouseEvent) => {
    const dx = event.clientX - mouseDownPos.x;
    const dy = event.clientY - mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return;

    if (!fieldRenderer || !fieldRenderer.hasWells()) return;

    const rect = canvas.getBoundingClientRect();
    const clickMouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    raycaster.setFromCamera(clickMouse, camera);
    const hitMeshes = fieldRenderer.getHitMeshes();
    const hits = raycaster.intersectObjects(hitMeshes, false);

    if (hits.length > 0) {
        const wellName = hits[0].object.userData.wellName as string;
        if (wellName) {
            const well = fieldRenderer.getWellByName(wellName);
            if (well) {
                showWellInfo(well);
                fieldRenderer.highlightWell(wellName);
                const bounds = fieldRenderer.getWellBounds(wellName);
                if (bounds) {
                    const dir = camera.position.clone().sub(controls.target).normalize();
                    const distance = Math.max(bounds.extent * 2.0, 0.5);
                    const cameraPos = bounds.center.clone().add(dir.multiplyScalar(distance));
                    animateCamera(bounds.center, cameraPos);
                }
            }
        }
    }
});

// Reset highlight on background click
canvas.addEventListener('dblclick', () => {
    fieldRenderer?.highlightWell(null);
    infoPanel.classList.add('hidden');
});

// ── Camera Animation ──
let cameraAnimId: number | null = null;

function animateCamera(targetPos: THREE.Vector3, cameraPos: THREE.Vector3): void {
    if (cameraAnimId !== null) {
        cancelAnimationFrame(cameraAnimId);
        cameraAnimId = null;
    }

    const startTarget = controls.target.clone();
    const startCamPos = camera.position.clone();
    const startTime = performance.now();
    const duration = 700;

    function step() {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const ease = t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;

        controls.target.lerpVectors(startTarget, targetPos, ease);
        camera.position.lerpVectors(startCamPos, cameraPos, ease);
        controls.update();

        if (t < 1) {
            cameraAnimId = requestAnimationFrame(step);
        } else {
            cameraAnimId = null;
        }
    }

    cameraAnimId = requestAnimationFrame(step);
}

// ── Window Resize ──
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});

// ── Animation Loop ──
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// ── Start ──
loadWellField();
animate();
