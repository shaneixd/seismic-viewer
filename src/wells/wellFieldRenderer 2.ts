/**
 * 3D Well Field Renderer
 * Renders a field of wells with trajectories, casing shoes, and drilling event markers.
 */

import * as THREE from 'three';
import type {
    WellFieldDataset,
    WellFieldWell,
    WellFieldTrajectoryPoint,
    PlatformInfo,
} from './wellFieldData';

/** Scale factor to convert real-world meters to scene units */
const WORLD_SCALE = 1 / 1000; // 1 scene unit = 1000 meters

export class WellFieldRenderer {
    private scene: THREE.Scene;
    private wells: WellFieldWell[] = [];
    private wellGroups: Map<string, THREE.Group> = new Map();
    private platformGroup: THREE.Group;
    private seabedMesh: THREE.Mesh | null = null;
    private formationPlanes: THREE.Mesh[] = [];
    private highlightedWell: string | null = null;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.platformGroup = new THREE.Group();
        this.platformGroup.name = 'platforms';
        scene.add(this.platformGroup);
    }

    // ── Coordinate conversion ──
    // Convert (northing, easting, tvd) to Three.js world coords.
    // Three.js: X = easting, Y = -tvd (up), Z = northing
    private toWorld(northing: number, easting: number, tvd: number): THREE.Vector3 {
        return new THREE.Vector3(
            easting * WORLD_SCALE,
            -tvd * WORLD_SCALE,
            northing * WORLD_SCALE
        );
    }

    // ── Load & Build ──
    loadWells(dataset: WellFieldDataset): void {
        this.dispose();
        this.wells = dataset.wells;

        // Build seabed plane
        this.createSeabed(dataset);

        // Build formation horizon planes
        this.createFormationPlanes(dataset);

        // Build platform markers
        for (const platform of dataset.platforms) {
            this.createPlatformMarker(platform);
        }

        // Build each well
        for (const well of dataset.wells) {
            const group = new THREE.Group();
            group.name = `well-${well.name}`;
            this.scene.add(group);
            this.wellGroups.set(well.name, group);

            this.createWellTrajectory(well, group);
            this.createCasingShoes(well, group);
            this.createEventMarkers(well, group);
            this.createWellLabel(well, group);
        }
    }

    // ── Seabed ──
    private createSeabed(dataset: WellFieldDataset): void {
        if (dataset.wells.length === 0) return;

        const waterDepth = dataset.wells[0].water_depth;
        const size = 12; // scene units — large enough to cover the field

        const geo = new THREE.PlaneGeometry(size, size);
        geo.rotateX(-Math.PI / 2);

        const mat = new THREE.MeshPhongMaterial({
            color: 0x1a3a2a,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        this.seabedMesh = new THREE.Mesh(geo, mat);
        this.seabedMesh.position.y = -waterDepth * WORLD_SCALE;
        this.seabedMesh.name = 'seabed';
        this.scene.add(this.seabedMesh);
    }

    // ── Formation horizons ──
    private createFormationPlanes(_dataset: WellFieldDataset): void {
        // Add a few transparent depth planes for geological context
        const depths = [1500, 2500, 3500]; // TVD in meters
        const colors = [0x2d5a3d, 0x3d4a6d, 0x6d3d4a];

        for (let i = 0; i < depths.length; i++) {
            const geo = new THREE.PlaneGeometry(10, 10);
            geo.rotateX(-Math.PI / 2);

            const mat = new THREE.MeshPhongMaterial({
                color: colors[i],
                transparent: true,
                opacity: 0.12,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.visible = false; // Off by default
            mesh.position.y = -depths[i] * WORLD_SCALE;
            mesh.name = `formation-${depths[i]}`;
            this.scene.add(mesh);
            this.formationPlanes.push(mesh);
        }
    }

    // ── Platform Markers ──
    private createPlatformMarker(platform: PlatformInfo): void {
        const pos = this.toWorld(platform.northing, platform.easting, -25); // Above sea level

        // Platform base — flat cylinder
        const baseGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.01, 16);
        const baseMat = new THREE.MeshPhongMaterial({
            color: 0xcccccc,
            emissive: 0x333333,
        });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.copy(pos);
        this.platformGroup.add(base);

        // Derrick structure — cone
        const derrickGeo = new THREE.ConeGeometry(0.02, 0.08, 4);
        const derrickMat = new THREE.MeshPhongMaterial({
            color: 0xaaaaaa,
            emissive: 0x222222,
        });
        const derrick = new THREE.Mesh(derrickGeo, derrickMat);
        derrick.position.copy(pos);
        derrick.position.y += 0.05;
        this.platformGroup.add(derrick);

        // Platform label
        this.createTextSprite(platform.name, pos.clone().add(new THREE.Vector3(0, 0.12, 0)),
            '#ffffff', 0.12, this.platformGroup);
    }

    // ── Well Trajectory ──
    private createWellTrajectory(well: WellFieldWell, group: THREE.Group): void {
        const points = this.trajectoryToPoints(well.trajectory);
        if (points.length < 2) return;

        // Create smooth curve from trajectory points
        const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);

        // Tube geometry for the well path
        const segments = Math.max(points.length * 3, 64);
        const tubeGeo = new THREE.TubeGeometry(curve, segments, 0.004, 8, false);

        const tubeMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(well.color),
            emissive: new THREE.Color(well.color).multiplyScalar(0.15),
            shininess: 60,
        });

        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        tube.name = 'trajectory';
        tube.userData = { wellName: well.name, isTrajectory: true };
        group.add(tube);

        // Hit area — thicker invisible tube for raycasting
        const hitGeo = new THREE.TubeGeometry(curve, segments, 0.015, 8, false);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.userData = { wellName: well.name, isHitArea: true };
        group.add(hitMesh);

        // Wellhead sphere at surface
        const headGeo = new THREE.SphereGeometry(0.008, 12, 12);
        const headMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(well.color),
            emissive: new THREE.Color(well.color).multiplyScalar(0.3),
        });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.copy(points[0]);
        head.userData = { wellName: well.name };
        group.add(head);

        // TD marker — small sphere at bottom
        const tdGeo = new THREE.SphereGeometry(0.006, 8, 8);
        const tdMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(well.color).multiplyScalar(0.6),
        });
        const td = new THREE.Mesh(tdGeo, tdMat);
        td.position.copy(points[points.length - 1]);
        group.add(td);
    }

    // ── Casing Shoes ──
    private createCasingShoes(well: WellFieldWell, group: THREE.Group): void {
        const casingsGroup = new THREE.Group();
        casingsGroup.name = 'casings';

        for (const casing of well.casings) {
            const pos = this.interpolatePosition(well.trajectory, casing.shoe_md);
            if (!pos) continue;

            // Direction at shoe depth for ring orientation
            const dir = this.interpolateDirection(well.trajectory, casing.shoe_md);

            // Ring size based on casing OD
            const ringRadius = (casing.od_inches / 30) * 0.02; // Scaled
            const tubeRadius = 0.002;

            const torusGeo = new THREE.TorusGeometry(ringRadius, tubeRadius, 8, 24);
            const torusMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(casing.color),
                emissive: new THREE.Color(casing.color).multiplyScalar(0.2),
                shininess: 80,
            });

            const torus = new THREE.Mesh(torusGeo, torusMat);
            torus.position.copy(pos);

            // Orient ring perpendicular to well path
            if (dir) {
                const up = new THREE.Vector3(0, 1, 0);
                const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
                torus.quaternion.copy(quat);
            }

            torus.userData = {
                wellName: well.name,
                isCasingShoe: true,
                casingName: casing.name,
                casingOD: casing.od_inches,
                shoeMD: casing.shoe_md,
                shoeTVD: casing.shoe_tvd,
            };

            casingsGroup.add(torus);

            // Small label near casing shoe
            const labelPos = pos.clone().add(new THREE.Vector3(0.015, 0, 0));
            this.createTextSprite(
                `${casing.od_inches}"`,
                labelPos, casing.color, 0.04, casingsGroup
            );
        }

        group.add(casingsGroup);
    }

    // ── Event/Warning Markers ──
    private createEventMarkers(well: WellFieldWell, group: THREE.Group): void {
        const eventsGroup = new THREE.Group();
        eventsGroup.name = 'events';

        for (const event of well.events) {
            const pos = this.interpolatePosition(well.trajectory, event.md);
            if (!pos) continue;

            // Triangle marker
            const color = event.severity === 'critical' ? 0xff3333 : 0xff9933;
            // Severity-based styling
            const size = event.severity === 'critical' ? 0.015 : 0.012;

            // Create triangle shape
            const shape = new THREE.Shape();
            const h = size;
            const w = h * 0.866; // equilateral
            shape.moveTo(0, h);
            shape.lineTo(-w / 2, 0);
            shape.lineTo(w / 2, 0);
            shape.lineTo(0, h);

            const shapeGeo = new THREE.ShapeGeometry(shape);
            const shapeMat = new THREE.MeshBasicMaterial({
                color,
                side: THREE.DoubleSide,
            });

            const marker = new THREE.Mesh(shapeGeo, shapeMat);
            marker.position.copy(pos);

            // Offset slightly from well path so it's visible
            marker.position.x += 0.02;
            marker.position.y += size / 2;

            marker.userData = {
                wellName: well.name,
                isEvent: true,
                eventType: event.type,
                eventSeverity: event.severity,
                eventDescription: event.description,
                eventMD: event.md,
                eventTVD: event.tvd,
            };

            eventsGroup.add(marker);

            // Exclamation mark inside triangle
            const bangPos = pos.clone();
            bangPos.x += 0.02;
            bangPos.y += size * 0.8;
            this.createTextSprite('!', bangPos, event.severity === 'critical' ? '#ffffff' : '#000000',
                0.03, eventsGroup, true);
        }

        group.add(eventsGroup);
    }

    // ── Well Label ──
    private createWellLabel(well: WellFieldWell, group: THREE.Group): void {
        const first = well.trajectory[0];
        const pos = this.toWorld(first.northing, first.easting, first.tvd);
        pos.y += 0.06; // Above wellhead

        const labelGroup = new THREE.Group();
        labelGroup.name = 'label';

        this.createTextSprite(well.name, pos, well.color, 0.06, labelGroup);
        group.add(labelGroup);
    }

    // ── Text Sprite Helper ──
    private createTextSprite(
        text: string,
        position: THREE.Vector3,
        color: string,
        scale: number,
        parent: THREE.Object3D,
        bold?: boolean
    ): THREE.Sprite {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = 256;
        canvas.height = 64;

        const fontSize = bold ? 40 : 28;
        ctx.font = `${bold ? 'bold ' : ''}${fontSize}px "Inter", "SF Pro", system-ui, sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 32);

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;

        const mat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: true,
            depthWrite: false,
        });

        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(position);
        sprite.scale.set(scale * 4, scale, 1);
        sprite.userData = { isLabel: true };
        parent.add(sprite);

        return sprite;
    }

    // ── Trajectory Helpers ──
    private trajectoryToPoints(trajectory: WellFieldTrajectoryPoint[]): THREE.Vector3[] {
        return trajectory.map(p => this.toWorld(p.northing, p.easting, p.tvd));
    }

    /** Interpolate 3D position at a given MD along the trajectory. */
    private interpolatePosition(trajectory: WellFieldTrajectoryPoint[], md: number): THREE.Vector3 | null {
        if (trajectory.length < 2) return null;
        if (md <= trajectory[0].md) return this.toWorld(trajectory[0].northing, trajectory[0].easting, trajectory[0].tvd);
        if (md >= trajectory[trajectory.length - 1].md) {
            const last = trajectory[trajectory.length - 1];
            return this.toWorld(last.northing, last.easting, last.tvd);
        }

        for (let i = 1; i < trajectory.length; i++) {
            if (trajectory[i].md >= md) {
                const prev = trajectory[i - 1];
                const curr = trajectory[i];
                const t = (md - prev.md) / (curr.md - prev.md);

                const n = prev.northing + t * (curr.northing - prev.northing);
                const e = prev.easting + t * (curr.easting - prev.easting);
                const tvd = prev.tvd + t * (curr.tvd - prev.tvd);

                return this.toWorld(n, e, tvd);
            }
        }
        return null;
    }

    /** Interpolate direction vector at a given MD (tangent to trajectory). */
    private interpolateDirection(trajectory: WellFieldTrajectoryPoint[], md: number): THREE.Vector3 | null {
        if (trajectory.length < 2) return null;

        let idx = 0;
        for (let i = 1; i < trajectory.length; i++) {
            if (trajectory[i].md >= md) { idx = i; break; }
        }

        const prev = trajectory[Math.max(0, idx - 1)];
        const curr = trajectory[Math.min(trajectory.length - 1, idx)];

        const p1 = this.toWorld(prev.northing, prev.easting, prev.tvd);
        const p2 = this.toWorld(curr.northing, curr.easting, curr.tvd);

        return p2.sub(p1).normalize();
    }

    // ── Visibility Controls ──
    setGeologicalLayersVisible(visible: boolean): void {
        for (const plane of this.formationPlanes) {
            plane.visible = visible;
        }
    }

    setCasingShoesVisible(visible: boolean): void {
        this.wellGroups.forEach(group => {
            const casings = group.getObjectByName('casings');
            if (casings) casings.visible = visible;
        });
    }

    setWarningsVisible(visible: boolean): void {
        this.wellGroups.forEach(group => {
            const events = group.getObjectByName('events');
            if (events) events.visible = visible;
        });
    }

    setLabelsVisible(visible: boolean): void {
        this.wellGroups.forEach(group => {
            const label = group.getObjectByName('label');
            if (label) label.visible = visible;
        });
    }

    setWellVisible(name: string, visible: boolean): void {
        const group = this.wellGroups.get(name);
        if (group) group.visible = visible;
    }

    setAllVisible(visible: boolean): void {
        this.wellGroups.forEach(g => { g.visible = visible; });
    }

    // ── Highlighting ──
    private dimOpacity: number = 0.15;
    highlightWell(name: string | null): void {
        if (this.highlightedWell === name) return;
        this.highlightedWell = name;

        this.wellGroups.forEach((group, wellName) => {
            const trajectory = group.getObjectByName('trajectory') as THREE.Mesh | undefined;
            if (!trajectory) return;

            const mat = trajectory.material as THREE.MeshPhongMaterial;

            if (name === null) {
                // Reset all
                mat.opacity = 1;
                mat.transparent = false;
                mat.emissive.set(new THREE.Color(this.getWellColor(wellName)).multiplyScalar(0.15));
            } else if (wellName === name) {
                // Highlight selected
                mat.opacity = 1;
                mat.transparent = false;
                mat.emissive.set(new THREE.Color(this.getWellColor(wellName)).multiplyScalar(0.5));
            } else {
                // Dim others
                mat.opacity = this.dimOpacity;
                mat.transparent = true;
                mat.emissive.setScalar(0);
            }
        });
    }

    setDimOpacity(opacity: number): void {
        this.dimOpacity = opacity;
        // Re-apply if currently highlighting
        if (this.highlightedWell !== null) {
            this.wellGroups.forEach((group, wellName) => {
                if (wellName === this.highlightedWell) return;
                const trajectory = group.getObjectByName('trajectory') as THREE.Mesh | undefined;
                if (!trajectory) return;
                const mat = trajectory.material as THREE.MeshPhongMaterial;
                mat.opacity = opacity;
            });
        }
    }

    private getWellColor(name: string): string {
        const well = this.wells.find(w => w.name === name);
        return well?.color || '#888888';
    }

    // ── Query Methods ──
    getWellNames(): string[] {
        return this.wells.map(w => w.name);
    }

    getWellByName(name: string): WellFieldWell | undefined {
        return this.wells.find(w => w.name === name);
    }

    hasWells(): boolean {
        return this.wells.length > 0;
    }

    /** Get world-space bounding info for a well (for camera framing). */
    getWellBounds(name: string): { center: THREE.Vector3; top: THREE.Vector3; bottom: THREE.Vector3; extent: number } | null {
        const well = this.wells.find(w => w.name === name);
        if (!well || well.trajectory.length < 2) return null;

        const first = well.trajectory[0];
        const last = well.trajectory[well.trajectory.length - 1];

        const top = this.toWorld(first.northing, first.easting, first.tvd);
        const bottom = this.toWorld(last.northing, last.easting, last.tvd);
        const center = top.clone().add(bottom).multiplyScalar(0.5);
        const extent = top.distanceTo(bottom);

        return { center, top, bottom, extent };
    }

    /** Get all trajectory + hit area meshes for raycasting. */
    getHitMeshes(): THREE.Mesh[] {
        const meshes: THREE.Mesh[] = [];
        this.wellGroups.forEach(group => {
            group.traverse(child => {
                if (child instanceof THREE.Mesh && (child.userData.isHitArea || child.userData.isTrajectory)) {
                    meshes.push(child);
                }
            });
        });
        return meshes;
    }

    /** Get all event marker meshes for raycasting. */
    getEventMeshes(): THREE.Mesh[] {
        const meshes: THREE.Mesh[] = [];
        this.wellGroups.forEach(group => {
            group.traverse(child => {
                if (child instanceof THREE.Mesh && child.userData.isEvent) {
                    meshes.push(child);
                }
            });
        });
        return meshes;
    }

    /** Get all casing shoe meshes for raycasting. */
    getCasingMeshes(): THREE.Mesh[] {
        const meshes: THREE.Mesh[] = [];
        this.wellGroups.forEach(group => {
            group.traverse(child => {
                if (child instanceof THREE.Mesh && child.userData.isCasingShoe) {
                    meshes.push(child);
                }
            });
        });
        return meshes;
    }

    // ── Cleanup ──
    dispose(): void {
        // Remove well groups
        this.wellGroups.forEach(group => {
            group.traverse(child => {
                if (child instanceof THREE.Mesh) {
                    child.geometry.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
                if (child instanceof THREE.Sprite) {
                    child.material.map?.dispose();
                    child.material.dispose();
                }
            });
            this.scene.remove(group);
        });
        this.wellGroups.clear();
        this.wells = [];

        // Remove platform group children
        this.platformGroup.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
            if (child instanceof THREE.Sprite) {
                child.material.map?.dispose();
                child.material.dispose();
            }
        });
        this.platformGroup.clear();

        // Remove seabed
        if (this.seabedMesh) {
            this.seabedMesh.geometry.dispose();
            (this.seabedMesh.material as THREE.Material).dispose();
            this.scene.remove(this.seabedMesh);
            this.seabedMesh = null;
        }

        // Remove formation planes
        for (const plane of this.formationPlanes) {
            plane.geometry.dispose();
            (plane.material as THREE.Material).dispose();
            this.scene.remove(plane);
        }
        this.formationPlanes = [];

        this.highlightedWell = null;
    }
}
