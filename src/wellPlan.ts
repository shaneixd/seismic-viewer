/**
 * Well Plan — 3D Trajectory Viewer
 * Interactive 3D visualization of planned well trajectories using Three.js.
 * Supports multiple wellbores (parent + sidetrack laterals).
 */

import './wellPlan.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';

// ── Types ──────────────────────────────────────────────────────

interface TurnPoint {
    sectionType: string;
    md: number;        // measured depth (ft)
    inc: number;       // inclination (°)
    azi: number;       // azimuth (°)
    tvd: number;       // true vertical depth (ft)
    northing: number;  // northing (ft)
    easting: number;   // easting (ft)
    dls: number;       // dogleg severity (°/100ft)
    tFace: number;     // toolface (°)
    build: number;     // build rate (°/100ft)
    turn: number;      // turn rate (°/100ft)
    target: string;    // target name
}

interface SurveyStation {
    md: number;
    inc: number;
    azi: number;
    tvd: number;
    northing: number;
    easting: number;
    sectionType: string;
    target: string;
}

interface WellboreDef {
    name: string;
    turnPoints: TurnPoint[];
    colorParam: string;
    visibilityParam: string;
}

// ── Trajectory Data ────────────────────────────────────────────

const SURFACE_NORTHING = 12146030.14;
const SURFACE_EASTING = 2564557.08;

// Lateral 1 — kicks off south-west, turns due west
const LATERAL1_TURN_POINTS: TurnPoint[] = [
    { sectionType: 'Tie Line', md: 0.0, inc: 0.00, azi: 0.00, tvd: 0.0, northing: SURFACE_NORTHING, easting: SURFACE_EASTING, dls: 0.00, tFace: 0.00, build: 0.00, turn: 0.00, target: '' },
    { sectionType: 'Straight MD', md: 2000.0, inc: 0.00, azi: 0.00, tvd: 2000.0, northing: SURFACE_NORTHING, easting: SURFACE_EASTING, dls: 0.00, tFace: 0.00, build: 0.00, turn: 0.00, target: '' },
    { sectionType: 'OPT AL DLS', md: 2885.2, inc: 50.54, azi: 215.50, tvd: 2774.8, northing: 12145732.38, easting: 2564344.85, dls: 5.71, tFace: 215.50, build: 5.71, turn: 0.00, target: '' },
    { sectionType: 'Hold', md: 3050.6, inc: 50.54, azi: 215.50, tvd: 2879.8, northing: 12145628.47, easting: 2564270.52, dls: 0.00, tFace: 0.00, build: 0.00, turn: 0.00, target: '' },
    { sectionType: 'Build + Turn', md: 3315.5, inc: 78.51, azi: 270.00, tvd: 5000.0, northing: 12145538.01, easting: 2564064.95, dls: 20.86, tFace: 75.39, build: 10.56, turn: 20.57, target: 'LP1' },
    { sectionType: 'Lateral', md: 13359.0, inc: 78.51, azi: 270.00, tvd: 5000.0, northing: 12145537.99, easting: 2554222.58, dls: 0.00, tFace: 0.00, build: 0.00, turn: 0.00, target: 'BHL' },
];

// Lateral 1B — Reduced DLS variant, slightly rotated lateral (~4° north of Lat 1)
// Earlier KOP (1500 ft), max DLS ~12°/100ft, gentler build with intermediate hold
// Shares LP1 area then diverges ~200m north at BHL
const LATERAL1B_TURN_POINTS: TurnPoint[] = [
    { sectionType: 'Tie Line',     md: 0.0,     inc: 0.00,  azi: 0.00,   tvd: 0.0,    northing: SURFACE_NORTHING, easting: SURFACE_EASTING, dls: 0.00,  tFace: 0.00,   build: 0.00,  turn: 0.00,  target: '' },
    { sectionType: 'Straight MD',  md: 1500.0,  inc: 0.00,  azi: 0.00,   tvd: 1500.0, northing: SURFACE_NORTHING, easting: SURFACE_EASTING, dls: 0.00,  tFace: 0.00,   build: 0.00,  turn: 0.00,  target: '' },
    { sectionType: 'Build 1',      md: 2500.0,  inc: 40.00, azi: 215.50, tvd: 2350.0, northing: 12145810.00, easting: 2564400.00, dls: 4.00,  tFace: 215.50, build: 4.00,  turn: 0.00,  target: '' },
    { sectionType: 'Hold 1',       md: 2900.0,  inc: 40.00, azi: 215.50, tvd: 2656.4, northing: 12145620.00, easting: 2564252.00, dls: 0.00,  tFace: 0.00,   build: 0.00,  turn: 0.00,  target: '' },
    { sectionType: 'Build + Turn', md: 3600.0,  inc: 78.51, azi: 271.50, tvd: 5000.0, northing: 12145538.01, easting: 2564064.95, dls: 11.80, tFace: 72.00,  build: 5.50,  turn: 10.44, target: 'LP1' },
    { sectionType: 'Lateral',      md: 13359.0, inc: 78.51, azi: 271.50, tvd: 5000.0, northing: 12145788.00, easting: 2554497.00, dls: 0.00,  tFace: 0.00,   build: 0.00,  turn: 0.00,  target: 'BHL' },
];

// Lateral 2 (Sidetrack) — branches from KOP at 2000 ft, builds S (~40° from Lat 1)
// Does NOT include the shared vertical section — only the deviated portion
const LATERAL2_TURN_POINTS: TurnPoint[] = [
    { sectionType: 'KOP Junction', md: 2000.0, inc: 0.00, azi: 175.00, tvd: 2000.0, northing: SURFACE_NORTHING, easting: SURFACE_EASTING, dls: 0.00, tFace: 0.00, build: 0.00, turn: 0.00, target: '' },
    { sectionType: 'OPT AL DLS', md: 3050.0, inc: 55.00, azi: 175.00, tvd: 2826.0, northing: 12145602.00, easting: 2564594.00, dls: 5.24, tFace: 175.00, build: 5.24, turn: 0.00, target: '' },
    { sectionType: 'Hold', md: 3350.0, inc: 55.00, azi: 175.00, tvd: 2998.0, northing: 12145357.00, easting: 2564615.00, dls: 0.00, tFace: 0.00, build: 0.00, turn: 0.00, target: '' },
    { sectionType: 'Build + Turn', md: 3650.0, inc: 82.00, azi: 230.00, tvd: 3105.0, northing: 12145139.00, easting: 2564512.00, dls: 18.50, tFace: 68.00, build: 9.00, turn: 18.33, target: 'LP2' },
    { sectionType: 'Lateral', md: 10650.0, inc: 82.00, azi: 230.00, tvd: 4080.0, northing: 12140685.00, easting: 2559202.00, dls: 0.00, tFace: 0.00, build: 0.00, turn: 0.00, target: 'BHL2' },
];

const WELLBORES: WellboreDef[] = [
    { name: 'Lateral 1',  turnPoints: LATERAL1_TURN_POINTS,  colorParam: 'trajectoryColor',   visibilityParam: 'showLateral1' },
    { name: 'Lateral 1B', turnPoints: LATERAL1B_TURN_POINTS, colorParam: 'lateral1BColor',    visibilityParam: 'showLateral1B' },
    { name: 'Lateral 2',  turnPoints: LATERAL2_TURN_POINTS,  colorParam: 'sidetrackColor',    visibilityParam: 'showLateral2' },
];

// ── Target Definitions ─────────────────────────────────────────
// Targets are geological target zones represented as semi-transparent orbs.

interface TargetDef {
    name: string;
    wellbore: string;      // which wellbore this target belongs to
    tpIndex: number;       // index into that wellbore's turn points
}

const TARGETS: TargetDef[] = [
    { name: 'LP1',  wellbore: 'Lateral 1',  tpIndex: 4.5 }, // Midway along the lateral on Lat 1
    { name: 'BHL',  wellbore: 'Lateral 1',  tpIndex: 5 },   // TD on Lat 1
    { name: 'LP2',  wellbore: 'Lateral 2',  tpIndex: 4 },   // TD on Lat 2
];

// ── Casing Shoe Definitions ────────────────────────────────────

interface CasingShoeDef {
    label: string;       // casing / hole size label
    topMD: number;       // top of casing string (ft MD)
    shoeMD: number;      // shoe depth (ft MD)
    wellbore: string;    // which wellbore this shoe belongs to
}

const CASING_SHOES: CasingShoeDef[] = [
    // Lateral 1 (parent well) — each starts where the previous shoe ends
    { label: '17 1/2"', topMD: 0,    shoeMD: 2000,  wellbore: 'Lateral 1' },
    { label: '12 1/4"', topMD: 2000, shoeMD: 2900,  wellbore: 'Lateral 1' },
    { label: '8 1/2"',  topMD: 2900, shoeMD: 13359, wellbore: 'Lateral 1' },
    // Lateral 1B (reduced DLS variant)
    { label: '17 1/2"', topMD: 0,    shoeMD: 1500,  wellbore: 'Lateral 1B' },
    { label: '12 1/4"', topMD: 1500, shoeMD: 2500,  wellbore: 'Lateral 1B' },
    { label: '8 1/2"',  topMD: 2500, shoeMD: 13359, wellbore: 'Lateral 1B' },
    // Lateral 2 (sidetrack — only strings below KOP)
    { label: '9 5/8"',  topMD: 2000, shoeMD: 3350,  wellbore: 'Lateral 2' },
    { label: '7"',      topMD: 3350, shoeMD: 10650, wellbore: 'Lateral 2' },
];

// ── Minimum Curvature Interpolation ────────────────────────────

const DEG = Math.PI / 180;

function minimumCurvature(turnPoints: TurnPoint[], stationsPerSegment: number): SurveyStation[] {
    const stations: SurveyStation[] = [];

    stations.push({
        md: turnPoints[0].md,
        inc: turnPoints[0].inc,
        azi: turnPoints[0].azi,
        tvd: turnPoints[0].tvd,
        northing: turnPoints[0].northing,
        easting: turnPoints[0].easting,
        sectionType: turnPoints[0].sectionType,
        target: turnPoints[0].target,
    });

    for (let i = 0; i < turnPoints.length - 1; i++) {
        const p1 = turnPoints[i];
        const p2 = turnPoints[i + 1];
        const nSteps = Math.max(2, stationsPerSegment);

        for (let j = 1; j <= nSteps; j++) {
            const frac = j / nSteps;
            const md = p1.md + (p2.md - p1.md) * frac;
            const inc = p1.inc + (p2.inc - p1.inc) * frac;
            const azi = lerpAngle(p1.azi, p2.azi, frac);

            const prev = stations[stations.length - 1];
            const deltaMD = md - prev.md;

            const i1 = prev.inc * DEG;
            const a1 = prev.azi * DEG;
            const i2 = inc * DEG;
            const a2 = azi * DEG;

            const cosDL = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
            const dl = Math.acos(Math.min(1, Math.max(-1, cosDL)));
            const rf = dl < 1e-7 ? 1.0 : (2 / dl) * Math.tan(dl / 2);

            const dN = (deltaMD / 2) * (Math.sin(i1) * Math.cos(a1) + Math.sin(i2) * Math.cos(a2)) * rf;
            const dE = (deltaMD / 2) * (Math.sin(i1) * Math.sin(a1) + Math.sin(i2) * Math.sin(a2)) * rf;
            const dTVD = (deltaMD / 2) * (Math.cos(i1) + Math.cos(i2)) * rf;

            const isLast = j === nSteps;
            stations.push({
                md,
                inc,
                azi,
                tvd: prev.tvd + dTVD,
                northing: prev.northing + dN,
                easting: prev.easting + dE,
                sectionType: isLast ? p2.sectionType : p1.sectionType,
                target: isLast ? p2.target : '',
            });
        }
    }

    return stations;
}

function lerpAngle(a1: number, a2: number, t: number): number {
    let diff = a2 - a1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    let result = a1 + diff * t;
    if (result < 0) result += 360;
    if (result >= 360) result -= 360;
    return result;
}

/**
 * Find the interpolated world position and tangent direction at a given MD
 * along an already-computed station array.
 */
function positionAtMD(
    stations: SurveyStation[],
    targetMD: number,
): { position: THREE.Vector3; tangent: THREE.Vector3 } | null {
    if (stations.length < 2) return null;
    if (targetMD <= stations[0].md) {
        const p = toWorld(stations[0].northing, stations[0].easting, stations[0].tvd);
        const p1 = toWorld(stations[1].northing, stations[1].easting, stations[1].tvd);
        return { position: p, tangent: p1.clone().sub(p).normalize() };
    }
    if (targetMD >= stations[stations.length - 1].md) {
        const last = stations[stations.length - 1];
        const prev = stations[stations.length - 2];
        const p = toWorld(last.northing, last.easting, last.tvd);
        const pp = toWorld(prev.northing, prev.easting, prev.tvd);
        return { position: p, tangent: p.clone().sub(pp).normalize() };
    }
    for (let i = 0; i < stations.length - 1; i++) {
        if (stations[i].md <= targetMD && stations[i + 1].md >= targetMD) {
            const frac = (targetMD - stations[i].md) / (stations[i + 1].md - stations[i].md);
            const pA = toWorld(stations[i].northing, stations[i].easting, stations[i].tvd);
            const pB = toWorld(stations[i + 1].northing, stations[i + 1].easting, stations[i + 1].tvd);
            const position = pA.clone().lerp(pB, frac);
            const tangent = pB.clone().sub(pA).normalize();
            return { position, tangent };
        }
    }
    return null;
}

// ── Coordinate Conversion ──────────────────────────────────────

const WORLD_SCALE = 1 / 1000; // 1 scene unit = 1000 ft

function toWorld(northing: number, easting: number, tvd: number): THREE.Vector3 {
    return new THREE.Vector3(
        (easting - SURFACE_EASTING) * WORLD_SCALE,
        -tvd * WORLD_SCALE,
        (northing - SURFACE_NORTHING) * WORLD_SCALE,
    );
}

// ── Three.js Scene Setup ───────────────────────────────────────

const canvas = document.getElementById('well-canvas') as HTMLCanvasElement;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d1c1f);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(6, 2, 6);
camera.lookAt(0, -2, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 2.2;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 0.5;
controls.maxDistance = 50;
controls.target.set(0, -2, 0);

// ── Lighting ───────────────────────────────────────────────────

const ambientLight = new THREE.AmbientLight(0x334455, 1.8);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
dirLight.position.set(3, 5, 2);
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0x222244, 0x112211, 0.4);
scene.add(hemiLight);

const pointLight = new THREE.PointLight(0x6688aa, 0.5, 20);
pointLight.position.set(-3, -3, -3);
scene.add(pointLight);

// ── Grid ───────────────────────────────────────────────────────

let gridHelper = new THREE.GridHelper(20, 40, new THREE.Color('#2a3955'), new THREE.Color('#2a3955').multiplyScalar(0.6));
gridHelper.position.y = 0.02;
scene.add(gridHelper);

const surfaceGeo = new THREE.PlaneGeometry(30, 30);
surfaceGeo.rotateX(-Math.PI / 2);
const surfaceMat = new THREE.MeshPhongMaterial({
    color: 0x0a1628,
    transparent: true,
    opacity: 0.35,
    shininess: 100,
    side: THREE.DoubleSide,
    depthWrite: false,
});
const surfacePlane = new THREE.Mesh(surfaceGeo, surfaceMat);
surfacePlane.position.y = 0.01;
surfacePlane.visible = false;
scene.add(surfacePlane);

// ── Build Trajectories ─────────────────────────────────────────

const trajectoryGroup = new THREE.Group();
scene.add(trajectoryGroup);

const INTERPOLATION_STEPS = 20;

// Pre-compute stations for all wellbores
const wellboreStations: Map<string, SurveyStation[]> = new Map();
for (const wb of WELLBORES) {
    wellboreStations.set(wb.name, minimumCurvature(wb.turnPoints, INTERPOLATION_STEPS));
}

function buildTrajectory3D(): void {
    // Clear existing
    while (trajectoryGroup.children.length > 0) {
        const child = trajectoryGroup.children[0];
        trajectoryGroup.remove(child);
        if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material instanceof THREE.Material) child.material.dispose();
        }
        if (child instanceof THREE.Sprite) {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
        }
    }

    for (const wb of WELLBORES) {
        // Check visibility
        const visKey = wb.visibilityParam;
        if (!(params as any)[visKey]) continue;

        const stations = wellboreStations.get(wb.name)!;
        if (stations.length < 2) continue;

        const baseColor = new THREE.Color((params as any)[wb.colorParam]);

        // ── Tube segments per turn-point-delimited section ──
        for (let tpIdx = 0; tpIdx < wb.turnPoints.length - 1; tpIdx++) {
            const startStation = tpIdx * INTERPOLATION_STEPS;
            const endStation = Math.min((tpIdx + 1) * INTERPOLATION_STEPS, stations.length - 1);

            const segPoints: THREE.Vector3[] = [];
            for (let i = startStation; i <= endStation; i++) {
                const s = stations[i];
                segPoints.push(toWorld(s.northing, s.easting, s.tvd));
            }
            if (segPoints.length < 2) continue;

            const curve = new THREE.CatmullRomCurve3(segPoints, false, 'catmullrom', 0.5);
            const numSegs = Math.max(segPoints.length * 3, 16);
            const tubeGeo = new THREE.TubeGeometry(curve, numSegs, params.tubeRadius, 8, false);

            const tubeMat = new THREE.MeshPhongMaterial({
                color: baseColor,
                emissive: baseColor.clone().multiplyScalar(0.15),
                shininess: 60,
            });

            const sectionType = wb.turnPoints[tpIdx + 1].sectionType;
            const mdStart = wb.turnPoints[tpIdx].md;
            const mdEnd = wb.turnPoints[tpIdx + 1].md;
            const tube = new THREE.Mesh(tubeGeo, tubeMat);
            tube.name = `section-${wb.name}-${sectionType}`;
            tube.userData = { sectionType, tpIdx, wellbore: wb.name, colorParam: wb.colorParam, mdStart, mdEnd };
            trajectoryGroup.add(tube);
        }

        // ── Wellhead sphere (for wellbores originating at surface) ──
        const startsAtSurface = stations[0].northing === SURFACE_NORTHING && stations[0].easting === SURFACE_EASTING && stations[0].tvd === 0;
        if (startsAtSurface) {
            const headPos = toWorld(stations[0].northing, stations[0].easting, stations[0].tvd);
            const headGeo = new THREE.SphereGeometry(params.markerSize, 16, 16);
            const headMat = new THREE.MeshPhongMaterial({
                color: baseColor,
                emissive: baseColor.clone().multiplyScalar(0.3),
            });
            const head = new THREE.Mesh(headGeo, headMat);
            head.position.copy(headPos);
            head.userData = { wellbore: wb.name, colorParam: wb.colorParam };
            trajectoryGroup.add(head);

            createLabel('SHL', headPos.clone().add(new THREE.Vector3(0.06, 0.06, 0)), (params as any)[wb.colorParam]);
        }

        // ── TD sphere ──
        const tdStation = stations[stations.length - 1];
        const tdPos = toWorld(tdStation.northing, tdStation.easting, tdStation.tvd);
        const tdGeo = new THREE.SphereGeometry(params.markerSize * 0.8, 12, 12);
        const tdMat = new THREE.MeshPhongMaterial({
            color: baseColor,
            emissive: baseColor.clone().multiplyScalar(0.2),
        });
        const td = new THREE.Mesh(tdGeo, tdMat);
        td.position.copy(tdPos);
        td.userData = { wellbore: wb.name, colorParam: wb.colorParam };
        trajectoryGroup.add(td);

        // ── Marker mode: Turn Points or Casing Shoes ──
        const labelOffset = params.tubeRadius * 3 + 0.04;

        if (params.markerMode === 'turnPoints') {
            // ── Turn point markers & labels ──
            for (let tpIdx = 0; tpIdx < wb.turnPoints.length; tpIdx++) {
                const tp = wb.turnPoints[tpIdx];
                const stationIdx = Math.min(tpIdx * INTERPOLATION_STEPS, stations.length - 1);
                const s = stations[stationIdx];
                const pos = toWorld(s.northing, s.easting, s.tvd);

                // Sphere marker
                const markerGeo = new THREE.SphereGeometry(params.markerSize, 12, 12);
                const markerMat = new THREE.MeshPhongMaterial({
                    color: baseColor,
                    emissive: baseColor.clone().multiplyScalar(0.2),
                });
                const marker = new THREE.Mesh(markerGeo, markerMat);
                marker.position.copy(pos);
                marker.name = `turnpoint-${wb.name}-${tp.sectionType}`;
                marker.userData = { sectionType: tp.sectionType, tpIdx, wellbore: wb.name, colorParam: wb.colorParam };
                trajectoryGroup.add(marker);

                // Label
                const label = tp.target || tp.sectionType;
                const nextIdx = Math.min(stationIdx + 1, stations.length - 1);
                const prevIdx = Math.max(stationIdx - 1, 0);
                const nextPos = toWorld(stations[nextIdx].northing, stations[nextIdx].easting, stations[nextIdx].tvd);
                const prevPos = toWorld(stations[prevIdx].northing, stations[prevIdx].easting, stations[prevIdx].tvd);
                const tangent = nextPos.clone().sub(prevPos).normalize();
                const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
                const offsetVec = perp.multiplyScalar(labelOffset).add(new THREE.Vector3(0, 0.03, 0));
                createLabel(label, pos.clone().add(offsetVec), (params as any)[wb.colorParam]);
            }
        } else {
            // ── Casing shoe cones ──
            const shoesForWb = CASING_SHOES.filter(cs => cs.wellbore === wb.name);
            const coneColor = baseColor.clone();

            for (const shoe of shoesForWb) {
                const result = positionAtMD(stations, shoe.shoeMD);
                if (!result) continue;

                const { position, tangent } = result;
                const coneRadius = params.casingConeSize;
                const coneHeight = coneRadius * 1.6;

                const coneGeo = new THREE.ConeGeometry(coneRadius, coneHeight, 16);
                const coneMat = new THREE.MeshPhongMaterial({
                    color: coneColor,
                    emissive: coneColor.clone().multiplyScalar(0.15),
                    shininess: 80,
                });
                const cone = new THREE.Mesh(coneGeo, coneMat);
                cone.position.copy(position);

                // Orient cone so its tip points downhole (along tangent)
                const up = new THREE.Vector3(0, 1, 0);
                const quat = new THREE.Quaternion().setFromUnitVectors(up, tangent.clone().negate());
                cone.setRotationFromQuaternion(quat);

                cone.name = `casing-shoe-${wb.name}-${shoe.label}`;
                cone.userData = { sectionType: shoe.label, wellbore: wb.name, colorParam: wb.colorParam, mdStart: shoe.topMD, mdEnd: shoe.shoeMD };
                trajectoryGroup.add(cone);

                // Label with casing size + MD
                const labelText = `${shoe.label} @ ${shoe.shoeMD.toLocaleString()} ft`;
                const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
                const offsetVec = perp.multiplyScalar(coneRadius + labelOffset).add(new THREE.Vector3(0, 0.03, 0));
                createLabel(labelText, position.clone().add(offsetVec), (params as any)[wb.colorParam]);
            }
        }
    }

    // ── KOP dashed line (shared) ──
    const lat1Stations = wellboreStations.get('Lateral 1')!;
    const kopIdx = Math.min(1 * INTERPOLATION_STEPS, lat1Stations.length - 1);
    const kopS = lat1Stations[kopIdx];
    const kopPos = toWorld(kopS.northing, kopS.easting, kopS.tvd);
    const kopLineMat = new THREE.LineDashedMaterial({
        color: new THREE.Color(params.highlightColor),
        dashSize: 0.05,
        gapSize: 0.03,
        transparent: true,
        opacity: 0.4,
    });
    const kopLineGeo = new THREE.BufferGeometry().setFromPoints([
        kopPos.clone().add(new THREE.Vector3(-0.3, 0, -0.3)),
        kopPos.clone().add(new THREE.Vector3(0.3, 0, 0.3)),
    ]);
    const kopLine = new THREE.Line(kopLineGeo, kopLineMat);
    kopLine.computeLineDistances();
    trajectoryGroup.add(kopLine);

    // ── Vertical reference line ──
    const vertLineMat = new THREE.LineDashedMaterial({
        color: new THREE.Color(params.trajectoryColor),
        dashSize: 0.05,
        gapSize: 0.05,
        transparent: true,
        opacity: 0.15,
    });
    const maxTVD = Math.max(
        LATERAL1_TURN_POINTS[LATERAL1_TURN_POINTS.length - 1].tvd,
        LATERAL2_TURN_POINTS[LATERAL2_TURN_POINTS.length - 1].tvd,
    );
    const surfPoint = toWorld(SURFACE_NORTHING, SURFACE_EASTING, 0);
    const depthPoint = toWorld(SURFACE_NORTHING, SURFACE_EASTING, maxTVD);
    const vertLineGeo = new THREE.BufferGeometry().setFromPoints([surfPoint, depthPoint]);
    const vertLine = new THREE.Line(vertLineGeo, vertLineMat);
    vertLine.computeLineDistances();
    trajectoryGroup.add(vertLine);

    // ── Target Orbs ──
    if (params.showTargets) {
        const tColor = new THREE.Color(params.targetColor);
        for (const tgt of TARGETS) {
            const wb = WELLBORES.find(w => w.name === tgt.wellbore);
            if (!wb) continue;
            const visKey = wb.visibilityParam;
            // Targets on Lateral 1 are also visible when Lateral 1B is shown (shared geological targets)
            const isVisible = (params as any)[visKey]
                || (wb.name === 'Lateral 1' && (params as any).showLateral1B);
            if (!isVisible) continue;

            const stns = wellboreStations.get(wb.name)!;
            const stationIdx = Math.min(Math.round(tgt.tpIndex * INTERPOLATION_STEPS), stns.length - 1);
            const s = stns[stationIdx];
            const pos = toWorld(s.northing, s.easting, s.tvd);

            const orbGeo = new THREE.SphereGeometry(params.targetSize, 32, 32);
            const orbMat = new THREE.MeshPhongMaterial({
                color: tColor,
                emissive: tColor.clone().multiplyScalar(0.15),
                transparent: true,
                opacity: params.targetOpacity,
                depthWrite: false,
                side: THREE.DoubleSide,
                shininess: 80,
            });
            const orb = new THREE.Mesh(orbGeo, orbMat);
            orb.position.copy(pos);
            orb.name = `target-${tgt.name}`;
            trajectoryGroup.add(orb);
        }
    }
}

// ── Section / Wellbore Highlighting ────────────────────────────

let highlightedKey: string | null = null;
type HighlightMode = 'section' | 'wellbore' | 'casingString';

/** Highlight extra data for casing-string MD-range highlighting */
let highlightMDRange: { topMD: number; shoeMD: number } | null = null;

function highlightWellbore(wellbore: string | null, sectionType: string | null = null, mode: HighlightMode = 'section'): void {
    const key = wellbore ? (mode === 'wellbore' ? `wb:${wellbore}` : `${wellbore}:${sectionType}`) : null;
    if (highlightedKey === key) return;
    highlightedKey = key;

    const highlightColor = new THREE.Color(params.highlightColor);

    trajectoryGroup.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        if (!obj.userData.colorParam) return;

        const mat = obj.material as THREE.MeshPhongMaterial;
        if (!mat.isMeshPhongMaterial) return;

        const baseColor = new THREE.Color((params as any)[obj.userData.colorParam]);
        const isCone = obj.name.startsWith('casing-shoe-');
        const isTargetOrb = obj.name.startsWith('target-');

        if (key === null) {
            // No highlight — everything back to base
            mat.color.copy(baseColor);
            mat.emissive.copy(baseColor.clone().multiplyScalar(0.15));
            mat.opacity = isTargetOrb ? params.targetOpacity : 1;
            mat.transparent = isTargetOrb;
        } else if (mode === 'wellbore') {
            // Whole-wellbore highlight mode (3D hover)
            if (obj.userData.wellbore === wellbore) {
                mat.color.copy(highlightColor);
                mat.emissive.copy(highlightColor.clone().multiplyScalar(0.3));
                mat.opacity = isTargetOrb ? params.targetOpacity : 1;
                mat.transparent = isTargetOrb;
            } else {
                // Dim the other wellbore
                mat.color.copy(baseColor.clone().multiplyScalar(0.3));
                mat.emissive.set(0, 0, 0);
                mat.opacity = isTargetOrb ? params.targetOpacity * 0.3 : 0.35;
                mat.transparent = true;
            }
        } else if (mode === 'casingString' && highlightMDRange) {
            // Casing string highlight — match by MD range overlap
            const objMdStart = obj.userData.mdStart as number | undefined;
            const objMdEnd = obj.userData.mdEnd as number | undefined;
            const overlaps = obj.userData.wellbore === wellbore
                && objMdStart !== undefined && objMdEnd !== undefined
                && objMdEnd > highlightMDRange.topMD && objMdStart < highlightMDRange.shoeMD;

            if (overlaps) {
                mat.color.copy(highlightColor);
                mat.emissive.copy(highlightColor.clone().multiplyScalar(0.3));
                mat.opacity = 1;
                mat.transparent = false;
            } else {
                // Keep normal appearance for non-highlighted sections
                mat.color.copy(baseColor);
                mat.emissive.copy(baseColor.clone().multiplyScalar(0.15));
                mat.opacity = isTargetOrb ? params.targetOpacity : 1;
                mat.transparent = isTargetOrb;
            }
        } else {
            // Per-section highlight mode (table hover)
            if (obj.userData.wellbore === wellbore && obj.userData.sectionType === sectionType) {
                mat.color.copy(highlightColor);
                mat.emissive.copy(highlightColor.clone().multiplyScalar(0.3));
                mat.opacity = isTargetOrb ? params.targetOpacity : 1;
            } else {
                mat.color.copy(baseColor);
                mat.emissive.copy(baseColor.clone().multiplyScalar(0.15));
                mat.opacity = isTargetOrb ? params.targetOpacity : 1;
                mat.transparent = isTargetOrb;
            }
        }
    });
}

// ── 3D Hover Raycasting ────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hovered3DWellbore: string | null = null;

canvas.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(trajectoryGroup.children, false);

    let hitWellbore: string | null = null;
    for (const hit of intersects) {
        if (hit.object.userData.wellbore && hit.object.userData.sectionType) {
            hitWellbore = hit.object.userData.wellbore;
            break;
        }
    }

    if (hitWellbore !== hovered3DWellbore) {
        hovered3DWellbore = hitWellbore;
        canvas.style.cursor = hitWellbore ? 'pointer' : '';
        highlightWellbore(hitWellbore, null, 'wellbore');
    }
});

// ── Text Sprite Helper ─────────────────────────────────────────

function createLabel(text: string, position: THREE.Vector3, color: string, scale: number = 0.5): void {
    const labelCanvas = document.createElement('canvas');
    const ctx = labelCanvas.getContext('2d')!;
    const fontSize = 48;
    const font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;

    const padding = 16;
    labelCanvas.width = textWidth + padding * 2;
    labelCanvas.height = fontSize + padding * 2;

    ctx.fillStyle = 'rgba(6, 6, 18, 0.7)';
    ctx.roundRect(0, 0, labelCanvas.width, labelCanvas.height, 8);
    ctx.fill();

    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, labelCanvas.width / 2, labelCanvas.height / 2);

    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        sizeAttenuation: true,
    });

    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.copy(position);
    sprite.visible = params.showLabels;

    const aspect = labelCanvas.width / labelCanvas.height;
    sprite.scale.set(scale * aspect * 0.15, scale * 0.15, 1);
    trajectoryGroup.add(sprite);
}

// ── Data Table with Hover ──────────────────────────────────────

function buildTurnPointTable(container: HTMLElement): void {
    const columns = [
        'Section Type', 'MD (ft)', 'INC (°)', 'AZI (°)', 'TVD (ft)',
        'Northing (ft)', 'Easting (ft)', 'DLS (°/100ft)',
        'Build (°/100ft)', 'Turn (°/100ft)', 'Target',
    ];

    let html = '';

    for (const wb of WELLBORES) {
        html += `<h3 class="table-wellbore-title">${wb.name}</h3>`;
        html += '<table class="trajectory-table"><thead><tr>';
        for (const col of columns) {
            html += `<th>${col}</th>`;
        }
        html += '</tr></thead><tbody>';

        for (let i = 0; i < wb.turnPoints.length; i++) {
            const tp = wb.turnPoints[i];
            html += `<tr data-wellbore="${wb.name}" data-section="${tp.sectionType}" data-tp-idx="${i}">`;
            html += `<td>${tp.sectionType}</td>`;
            html += `<td>${tp.md.toFixed(1)}</td>`;
            html += `<td>${tp.inc.toFixed(2)}</td>`;
            html += `<td>${tp.azi.toFixed(2)}</td>`;
            html += `<td>${tp.tvd.toFixed(1)}</td>`;
            html += `<td>${tp.northing.toFixed(2)}</td>`;
            html += `<td>${tp.easting.toFixed(2)}</td>`;
            html += `<td>${tp.dls.toFixed(2)}</td>`;
            html += `<td>${tp.build.toFixed(2)}</td>`;
            html += `<td>${tp.turn.toFixed(2)}</td>`;

            if (tp.target) {
                const cls = tp.target.startsWith('BHL') ? 'target-badge bhl' : 'target-badge';
                html += `<td><span class="${cls}">${tp.target}</span></td>`;
            } else {
                html += `<td></td>`;
            }

            html += '</tr>';
        }

        html += '</tbody></table>';
    }

    container.innerHTML = html;

    // Add hover handlers to table rows
    const rows = container.querySelectorAll('tr[data-section]');
    rows.forEach((row) => {
        const el = row as HTMLElement;
        const wellboreName = el.dataset.wellbore!;
        const sectionType = el.dataset.section!;

        el.addEventListener('mouseenter', () => {
            highlightWellbore(wellboreName, sectionType, 'section');
            el.classList.add('highlighted');
        });

        el.addEventListener('mouseleave', () => {
            highlightWellbore(null);
            el.classList.remove('highlighted');
        });
    });
}

function buildCasingTable(container: HTMLElement): void {
    const columns = ['Casing String', 'Top MD (ft)', 'Shoe MD (ft)', 'Length (ft)'];

    // Group shoes by wellbore
    const grouped = new Map<string, CasingShoeDef[]>();
    for (const wb of WELLBORES) {
        grouped.set(wb.name, CASING_SHOES.filter(cs => cs.wellbore === wb.name));
    }

    let html = '';

    for (const [wbName, shoes] of grouped) {
        if (shoes.length === 0) continue;
        html += `<h3 class="table-wellbore-title">${wbName} — Casing Program</h3>`;
        html += '<table class="trajectory-table"><thead><tr>';
        for (const col of columns) {
            html += `<th>${col}</th>`;
        }
        html += '</tr></thead><tbody>';

        for (const shoe of shoes) {
            const length = shoe.shoeMD - shoe.topMD;
            html += `<tr data-wellbore="${wbName}" data-casing="${shoe.label}" data-top-md="${shoe.topMD}" data-shoe-md="${shoe.shoeMD}">`;
            html += `<td><span class="casing-badge">${shoe.label}</span></td>`;
            html += `<td>${shoe.topMD.toLocaleString()}</td>`;
            html += `<td>${shoe.shoeMD.toLocaleString()}</td>`;
            html += `<td>${length.toLocaleString()}</td>`;
            html += '</tr>';
        }

        html += '</tbody></table>';
    }

    container.innerHTML = html;

    // Add hover handlers for casing rows
    const rows = container.querySelectorAll('tr[data-casing]');
    rows.forEach((row) => {
        const el = row as HTMLElement;
        const wellboreName = el.dataset.wellbore!;
        const casingLabel = el.dataset.casing!;
        const topMD = parseFloat(el.dataset.topMd!);
        const shoeMD = parseFloat(el.dataset.shoeMd!);

        el.addEventListener('mouseenter', () => {
            highlightMDRange = { topMD, shoeMD };
            highlightWellbore(wellboreName, casingLabel, 'casingString');
            el.classList.add('highlighted');
        });

        el.addEventListener('mouseleave', () => {
            highlightMDRange = null;
            highlightWellbore(null);
            el.classList.remove('highlighted');
        });
    });
}

function rebuildTable(): void {
    const tablePanel = document.getElementById('table-panel')!;
    if (params.markerMode === 'casingShoes') {
        buildCasingTable(tablePanel);
    } else {
        buildTurnPointTable(tablePanel);
    }
    resizeRenderer();
}

// ── lil-gui Controls ───────────────────────────────────────────

const PARAMS_STORAGE_KEY = 'wellplan-params';

const defaultParams = {
    showGrid: true,
    showLabels: false,
    showSurface: false,
    showLateral1: true,
    showLateral1B: false,
    showLateral2: true,
    backgroundColor: '#1d1c1f',
    gridColor: '#2a3955',
    tubeRadius: 0.024,
    markerSize: 0.035,
    markerMode: 'turnPoints' as 'turnPoints' | 'casingShoes',
    casingConeSize: 0.06,
    casingConeColor: '#44c8e8',
    trajectoryColor: '#7495d8',
    lateral1BColor: '#a8d874',
    sidetrackColor: '#d87474',
    highlightColor: '#fffb9e',
    showTargets: true,
    targetColor: '#3ad994',
    targetSize: 0.15,
    targetOpacity: 0.25,
};

// Load saved params, merge with defaults so new keys get default values
function loadParams(): typeof defaultParams {
    try {
        const saved = JSON.parse(localStorage.getItem(PARAMS_STORAGE_KEY) || '{}');
        return { ...defaultParams, ...saved };
    } catch { return { ...defaultParams }; }
}

function persistParams(): void {
    localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
}

const params = loadParams();

const gui = new GUI({ title: 'Well Plan Viewer', width: 260 });

// Auto-persist on any control change
gui.onChange(() => persistParams());

// Dataset dropdown — allows navigation to other views
const datasetOptions: Record<string, string> = {
    'Well Plan': 'wellplan',
    'F3 Netherlands': 'f3',
    'Parihaka (NZ)': 'parihaka',
    'Well Field (Volve)': 'wellfield',
};
gui.add({ dataset: 'wellplan' }, 'dataset', datasetOptions).name('Dataset').onChange((value: string) => {
    if (value === 'wellfield') {
        window.location.href = '/wells.html';
    } else if (value !== 'wellplan') {
        window.location.href = `/?dataset=${value}`;
    }
});

const displayFolder = gui.addFolder('Display');
displayFolder.add(params, 'showGrid').name('Grid').onChange((v: boolean) => {
    gridHelper.visible = v;
});
displayFolder.addColor(params, 'gridColor').name('Grid Color').onChange((v: string) => {
    scene.remove(gridHelper);
    gridHelper.geometry.dispose();
    (Array.isArray(gridHelper.material)
        ? gridHelper.material
        : [gridHelper.material]
    ).forEach(m => m.dispose());
    gridHelper = new THREE.GridHelper(20, 40, new THREE.Color(v), new THREE.Color(v).multiplyScalar(0.6));
    gridHelper.position.y = 0.02;
    scene.add(gridHelper);
});
displayFolder.add(params, 'showSurface').name('Surface Plane').onChange((v: boolean) => {
    surfacePlane.visible = v;
});
displayFolder.add(params, 'showLabels').name('Labels').onChange((v: boolean) => {
    trajectoryGroup.traverse((obj) => {
        if (obj instanceof THREE.Sprite) obj.visible = v;
    });
});
displayFolder.addColor(params, 'backgroundColor').name('Background').onChange((v: string) => {
    scene.background = new THREE.Color(v);
});

const trajFolder = gui.addFolder('Trajectory');
trajFolder.add(params, 'showLateral1').name('Lateral 1').onChange(() => buildTrajectory3D());
trajFolder.addColor(params, 'trajectoryColor').name('Lat 1 Color').onChange(() => buildTrajectory3D());
trajFolder.add(params, 'showLateral1B').name('Lateral 1B (Low DLS)').onChange(() => buildTrajectory3D());
trajFolder.addColor(params, 'lateral1BColor').name('Lat 1B Color').onChange(() => buildTrajectory3D());
trajFolder.add(params, 'showLateral2').name('Lateral 2').onChange(() => buildTrajectory3D());
trajFolder.addColor(params, 'sidetrackColor').name('Lat 2 Color').onChange(() => buildTrajectory3D());
trajFolder.addColor(params, 'highlightColor').name('Highlight');
trajFolder.add(params, 'tubeRadius', 0.004, 0.04, 0.002).name('Tube Radius').onChange(() => buildTrajectory3D());
trajFolder.add(params, 'markerMode', ['turnPoints', 'casingShoes']).name('Marker Mode').onChange(() => { buildTrajectory3D(); rebuildTable(); });
trajFolder.add(params, 'markerSize', 0.005, 0.06, 0.005).name('Marker Size').onChange(() => buildTrajectory3D());
trajFolder.add(params, 'casingConeSize', 0.02, 0.2, 0.005).name('Cone Size').onChange(() => buildTrajectory3D());
// casingConeColor removed — cones now use the wellbore color

const targetFolder = gui.addFolder('Targets');
targetFolder.add(params, 'showTargets').name('Show Targets').onChange(() => buildTrajectory3D());
targetFolder.addColor(params, 'targetColor').name('Color').onChange(() => buildTrajectory3D());
targetFolder.add(params, 'targetSize', 0.05, 0.5, 0.01).name('Size').onChange(() => buildTrajectory3D());
targetFolder.add(params, 'targetOpacity', 0.05, 0.8, 0.05).name('Opacity').onChange(() => buildTrajectory3D());

const viewFolder = gui.addFolder('View');
viewFolder.add({
    resetView: () => {
        animateCamera(
            new THREE.Vector3(0, -2.5, 0),
            new THREE.Vector3(6, 2, 6),
        );
    }
}, 'resetView').name('Reset View');
viewFolder.add({
    topDown: () => {
        animateCamera(
            new THREE.Vector3(-4, -2.5, 0),
            new THREE.Vector3(-4, 12, 0),
        );
    }
}, 'topDown').name('Top Down');
viewFolder.add({
    sideView: () => {
        animateCamera(
            new THREE.Vector3(-4, -2.5, 0),
            new THREE.Vector3(-4, -2.5, 14),
        );
    }
}, 'sideView').name('Side View');
const STORAGE_KEY = 'wellplan-saved-cameras';

interface SavedCamera {
    id: number;
    name: string;
    camPos: { x: number; y: number; z: number };
    targetPos: { x: number; y: number; z: number };
}

function loadSavedCameras(): SavedCamera[] {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch { return []; }
}

function persistCameras(cameras: SavedCamera[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cameras));
}

function addCameraRow(saved: SavedCamera): void {
    const camPos = new THREE.Vector3(saved.camPos.x, saved.camPos.y, saved.camPos.z);
    const targetPos = new THREE.Vector3(saved.targetPos.x, saved.targetPos.y, saved.targetPos.z);
    const ctrl = viewFolder.add({ go: () => animateCamera(targetPos, camPos) }, 'go').name(saved.name);

    const widget = ctrl.$widget as HTMLElement;
    if (widget) {
        widget.style.display = 'flex';
        widget.style.gap = '4px';
        const goBtn = widget.querySelector('button');
        if (goBtn) goBtn.style.flex = '1';

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '✕';
        deleteBtn.style.cssText = `
            flex: 0 0 28px; height: 100%;
            background: rgba(255,80,80,0.15); border: 1px solid rgba(255,80,80,0.3);
            color: #ff6b6b; border-radius: 3px; cursor: pointer;
            font-size: 11px; display: flex; align-items: center; justify-content: center;
            padding: 0;
        `;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            ctrl.destroy();
            const cameras = loadSavedCameras().filter(c => c.id !== saved.id);
            persistCameras(cameras);
        });
        widget.appendChild(deleteBtn);
    }
}

// Restore saved cameras from localStorage
let savedCameraCount = 0;
const existingCameras = loadSavedCameras();
for (const cam of existingCameras) {
    addCameraRow(cam);
    if (cam.id >= savedCameraCount) savedCameraCount = cam.id;
}

viewFolder.add({
    saveCamera: () => {
        savedCameraCount++;
        const saved: SavedCamera = {
            id: savedCameraCount,
            name: `Camera ${savedCameraCount}`,
            camPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            targetPos: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
        };
        const cameras = loadSavedCameras();
        cameras.push(saved);
        persistCameras(cameras);
        addCameraRow(saved);
    }
}, 'saveCamera').name('Save Camera');

// Well Summary
const infoFolder = gui.addFolder('Well Summary');
infoFolder.close();

for (const wb of WELLBORES) {
    const tp = wb.turnPoints;
    const totalMD = tp[tp.length - 1].md;
    const finalTVD = tp[tp.length - 1].tvd;
    const dN = tp[tp.length - 1].northing - SURFACE_NORTHING;
    const dE = tp[tp.length - 1].easting - SURFACE_EASTING;
    const totalDisp = Math.sqrt(dN * dN + dE * dE);
    const maxDLS = Math.max(...tp.map(t => t.dls));

    const summaryData: Record<string, string> = {
        [`${wb.name} TD MD`]: `${totalMD.toFixed(0)} ft`,
        [`${wb.name} TD TVD`]: `${finalTVD.toFixed(0)} ft`,
        [`${wb.name} Disp.`]: `${totalDisp.toFixed(0)} ft`,
        [`${wb.name} Max DLS`]: `${maxDLS.toFixed(2)} °/100ft`,
    };

    for (const [key, val] of Object.entries(summaryData)) {
        const ctrl = infoFolder.add({ v: val }, 'v').name(key).disable();
        ctrl.$widget.style.cssText = 'font-size: 11px; min-width: 0;';
    }
}

// ── Camera Animation ───────────────────────────────────────────

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
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

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

// ── Window Resize ──────────────────────────────────────────────

function resizeRenderer(): void {
    const tableH = document.getElementById('table-panel')!.getBoundingClientRect().height;
    const w = window.innerWidth;
    const h = window.innerHeight - tableH;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

window.addEventListener('resize', resizeRenderer);

// ── Animation Loop ─────────────────────────────────────────────

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// ── Initialize ─────────────────────────────────────────────────

function init(): void {
    const tablePanel = document.getElementById('table-panel')!;
    rebuildTable();

    // Apply restored params to scene objects
    scene.background = new THREE.Color(params.backgroundColor);
    gridHelper.visible = params.showGrid;
    if (params.gridColor !== '#2a3955') {
        scene.remove(gridHelper);
        gridHelper.geometry.dispose();
        (Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material]).forEach(m => m.dispose());
        gridHelper = new THREE.GridHelper(20, 40, new THREE.Color(params.gridColor), new THREE.Color(params.gridColor).multiplyScalar(0.6));
        gridHelper.position.y = 0.02;
        gridHelper.visible = params.showGrid;
        scene.add(gridHelper);
    }
    surfacePlane.visible = params.showSurface;

    resizeRenderer();
    buildTrajectory3D();

    // Frame both trajectories
    const allPoints: THREE.Vector3[] = [];
    for (const wb of WELLBORES) {
        const stations = wellboreStations.get(wb.name)!;
        for (const s of stations) {
            allPoints.push(toWorld(s.northing, s.easting, s.tvd));
        }
    }
    const box = new THREE.Box3().setFromPoints(allPoints);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    controls.target.copy(center);
    camera.position.set(
        center.x + maxDim * 0.8,
        center.y + maxDim * 0.5,
        center.z + maxDim * 0.8,
    );
    camera.lookAt(center);

    document.getElementById('loading-overlay')!.classList.add('hidden');
}

requestAnimationFrame(() => {
    requestAnimationFrame(init);
});

animate();
