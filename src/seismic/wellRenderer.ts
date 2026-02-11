/**
 * 3D Well Renderer for the seismic volume viewer.
 * Renders well sticks, labels, and formation markers using Three.js.
 */

import * as THREE from 'three';
import type { WellData, WellDataset } from './wellData';
import type { SeismicDimensions } from './volume';

export interface WellRenderOptions {
    /** Scale vector from SeismicVolume (maps volume indices to world coords) */
    scale: THREE.Vector3;
    /** Volume dimensions (nx, ny, nz) */
    dimensions: SeismicDimensions;
    /** Inline range of the loaded volume [start, end] */
    volumeIlRange: [number, number];
    /** Crossline range of the loaded volume [start, end] */
    volumeXlRange: [number, number];
    /** Time/depth range of the loaded volume in ms [start, end] */
    volumeTimeRange: [number, number];
}

/**
 * Manages 3D rendering of wells within the seismic volume.
 */
export class WellRenderer {
    private scene: THREE.Scene;
    private options: WellRenderOptions;
    private wells: WellData[] = [];

    // Three.js objects per well
    private wellGroups: Map<string, THREE.Group> = new Map();
    private wellSticks: Map<string, THREE.Mesh> = new Map();
    private wellLabels: Map<string, THREE.Sprite> = new Map();
    private formationMarkers: Map<string, THREE.Group> = new Map();

    // Master group for all wells
    private masterGroup: THREE.Group;

    // Visibility state
    private showFormations: boolean = true;

    constructor(scene: THREE.Scene, options: WellRenderOptions) {
        this.scene = scene;
        this.options = options;
        this.masterGroup = new THREE.Group();
        this.masterGroup.name = 'wells';
        this.scene.add(this.masterGroup);
    }

    /**
     * Convert inline/crossline/time position to world (Three.js) coordinates.
     * Matches the coordinate system used by SeismicVolume.
     */
    private surveyToWorld(il: number, xl: number, tvdss: number): THREE.Vector3 {
        const { nx: _nx, ny: _ny, nz: _nz } = this.options.dimensions;
        const [ilStart, ilEnd] = this.options.volumeIlRange;
        const [xlStart, xlEnd] = this.options.volumeXlRange;
        const [timeStart, timeEnd] = this.options.volumeTimeRange;

        // Map IL/XL to 0-1 range within the loaded volume
        const ilFrac = (il - ilStart) / (ilEnd - ilStart);
        const xlFrac = (xl - xlStart) / (xlEnd - xlStart);

        // Convert TVDSS (meters) to approximate TWT (ms) using a rough velocity
        // For the North Sea shallow section, ~2000 m/s average velocity is reasonable
        // TWT = 2 * depth / velocity * 1000 (convert to ms)
        const avgVelocity = 2000; // m/s  
        const twtMs = (2 * tvdss / avgVelocity) * 1000;
        const timeFrac = (twtMs - timeStart) / (timeEnd - timeStart);

        // Map to world coords matching SeismicVolume's coordinate system:
        // X axis = inline direction
        // Y axis = vertical (time/depth), positive up
        // Z axis = crossline direction
        const worldX = (ilFrac - 0.5) * this.options.scale.x;
        const worldY = (0.5 - timeFrac) * this.options.scale.y; // Inverted: top=+Y
        const worldZ = (xlFrac - 0.5) * this.options.scale.z;

        return new THREE.Vector3(worldX, worldY, worldZ);
    }

    /**
     * Load and render wells from a WellDataset.
     */
    public loadWells(dataset: WellDataset): void {
        // Clear existing wells
        this.dispose();
        this.masterGroup = new THREE.Group();
        this.masterGroup.name = 'wells';
        this.scene.add(this.masterGroup);

        this.wells = dataset.wells;

        for (const well of this.wells) {
            this.createWellVisuals(well);
        }
    }

    /**
     * Create all 3D visuals for a single well.
     */
    private createWellVisuals(well: WellData): void {
        const group = new THREE.Group();
        group.name = `well-${well.name}`;

        // Check if well is within volume bounds
        const [ilStart, ilEnd] = this.options.volumeIlRange;
        const [xlStart, xlEnd] = this.options.volumeXlRange;
        const inBounds = (
            well.surface_il >= ilStart && well.surface_il <= ilEnd &&
            well.surface_xl >= xlStart && well.surface_xl <= xlEnd
        );

        if (!inBounds) {
            console.log(`Well ${well.name} is outside volume bounds (IL=${well.surface_il}, XL=${well.surface_xl})`);
            // Still render it but make it semi-transparent
        }

        // Create well stick (vertical tube)
        this.createWellStick(well, group, inBounds);

        // Create well label
        this.createWellLabel(well, group);

        // Create formation markers
        if (this.showFormations) {
            this.createFormationMarkers(well, group);
        }

        this.masterGroup.add(group);
        this.wellGroups.set(well.name, group);
    }

    /**
     * Create the well stick geometry (a thin cylinder from surface to TD).
     */
    private createWellStick(well: WellData, group: THREE.Group, inBounds: boolean): void {
        const color = new THREE.Color(well.color);

        // If the well has trajectory points, build a path
        if (well.trajectory.length >= 2) {
            // Build a path from trajectory points
            const points: THREE.Vector3[] = [];

            // Add surface point (at top of volume)
            const surfacePoint = this.surveyToWorld(well.surface_il, well.surface_xl, 0);
            points.push(surfacePoint);

            // Add trajectory points (only those within the time range)
            for (const pt of well.trajectory) {
                const worldPos = this.surveyToWorld(pt.il, pt.xl, pt.tvdss);

                // Clamp to volume bounds vertically
                const minY = -0.5 * this.options.scale.y;
                if (worldPos.y < minY) {
                    // Interpolate to volume bottom
                    if (points.length > 0) {
                        const lastPt = points[points.length - 1];
                        const t = (minY - lastPt.y) / (worldPos.y - lastPt.y);
                        const clampedPt = new THREE.Vector3().lerpVectors(lastPt, worldPos, t);
                        clampedPt.y = minY;
                        points.push(clampedPt);
                    }
                    break;
                }

                points.push(worldPos);
            }

            if (points.length >= 2) {
                // Create tube geometry along the path
                const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.1);
                const tubeRadius = 0.003; // Thin tube
                const tubeGeom = new THREE.TubeGeometry(curve, Math.max(points.length * 2, 8), tubeRadius, 6, false);

                const tubeMat = new THREE.MeshPhongMaterial({
                    color: color,
                    emissive: color.clone().multiplyScalar(0.3),
                    shininess: 30,
                    transparent: !inBounds,
                    opacity: inBounds ? 1.0 : 0.4,
                });

                const tubeMesh = new THREE.Mesh(tubeGeom, tubeMat);
                tubeMesh.name = `stick-${well.name}`;
                tubeMesh.userData.wellName = well.name;
                group.add(tubeMesh);
                this.wellSticks.set(well.name, tubeMesh);

                // Add a small sphere at the surface location
                const sphereGeom = new THREE.SphereGeometry(0.008, 8, 8);
                const sphereMat = new THREE.MeshPhongMaterial({
                    color: color,
                    emissive: color.clone().multiplyScalar(0.5),
                    transparent: !inBounds,
                    opacity: inBounds ? 1.0 : 0.4,
                });
                const sphere = new THREE.Mesh(sphereGeom, sphereMat);
                sphere.position.copy(surfacePoint);
                sphere.userData.wellName = well.name;
                group.add(sphere);
            }
        }
    }

    /**
     * Create a text label sprite for the well.
     */
    private createWellLabel(well: WellData, group: THREE.Group): void {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;

        canvas.width = 256;
        canvas.height = 64;

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 8);
        ctx.fill();

        // Border in well color
        ctx.strokeStyle = well.color;
        ctx.lineWidth = 2;
        ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 8);
        ctx.stroke();

        // Well dot
        ctx.fillStyle = well.color;
        ctx.beginPath();
        ctx.arc(24, canvas.height / 2, 8, 0, Math.PI * 2);
        ctx.fill();

        // Text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(well.name, 42, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        const spriteMat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            sizeAttenuation: true,
        });

        const sprite = new THREE.Sprite(spriteMat);

        // Position above the well
        const surfacePos = this.surveyToWorld(well.surface_il, well.surface_xl, 0);
        sprite.position.set(surfacePos.x, surfacePos.y + 0.05, surfacePos.z);
        sprite.scale.set(0.15, 0.0375, 1);

        group.add(sprite);
        this.wellLabels.set(well.name, sprite);
    }

    /**
     * Create formation (well tops) markers along the wellbore.
     */
    private createFormationMarkers(well: WellData, group: THREE.Group): void {
        const markersGroup = new THREE.Group();
        markersGroup.name = `formations-${well.name}`;

        for (const fm of well.formations) {
            // Create a small ring/disc at the formation top depth
            const worldPos = this.surveyToWorld(well.surface_il, well.surface_xl, fm.top_tvdss);

            // Skip if below volume
            if (worldPos.y < -0.5 * this.options.scale.y) continue;
            // Skip if above volume
            if (worldPos.y > 0.5 * this.options.scale.y) continue;

            // Formation disc with slight extrusion
            const ringGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.001, 24);
            const ringMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(fm.color),
                transparent: true,
                opacity: 0.8,
            });

            const ring = new THREE.Mesh(ringGeom, ringMat);
            ring.position.copy(worldPos);

            // Store formation info for hover tooltips
            ring.userData = {
                isFormationMarker: true,
                wellName: well.name,
                wellColor: well.color,
                formationName: fm.name,
                formationCode: fm.code,
                formationColor: fm.color,
                topTvdss: fm.top_tvdss,
                topMd: fm.top_md,
            };

            markersGroup.add(ring);
        }

        group.add(markersGroup);
        this.formationMarkers.set(well.name, markersGroup);
    }

    /**
     * Set visibility for a specific well.
     */
    public setWellVisible(name: string, visible: boolean): void {
        const group = this.wellGroups.get(name);
        if (group) {
            group.visible = visible;
        }
    }

    /**
     * Set visibility for all wells.
     */
    public setAllVisible(visible: boolean): void {
        this.masterGroup.visible = visible;
    }

    /**
     * Toggle formation markers visibility.
     */
    public setFormationsVisible(visible: boolean): void {
        this.showFormations = visible;
        for (const [, markersGroup] of this.formationMarkers) {
            markersGroup.visible = visible;
        }
    }

    /**
     * Get all well names.
     */
    public getWellNames(): string[] {
        return this.wells.map(w => w.name);
    }

    /**
     * Get the world-space bounds of a well for camera framing.
     * Returns center point, top/bottom positions, and vertical extent.
     */
    public getWellBounds(name: string): { center: THREE.Vector3; top: THREE.Vector3; bottom: THREE.Vector3; extent: number } | null {
        const well = this.wells.find(w => w.name === name);
        if (!well) return null;

        const surfacePos = this.surveyToWorld(well.surface_il, well.surface_xl, 0);

        if (well.trajectory.length >= 2) {
            // Compute actual bounds from visible trajectory points
            let minY = surfacePos.y;
            let maxY = surfacePos.y;
            const bottomLimit = -0.5 * this.options.scale.y;

            for (const pt of well.trajectory) {
                const worldPos = this.surveyToWorld(pt.il, pt.xl, pt.tvdss);
                if (worldPos.y < bottomLimit) break;
                minY = Math.min(minY, worldPos.y);
                maxY = Math.max(maxY, worldPos.y);
            }

            const center = new THREE.Vector3(
                surfacePos.x,
                (maxY + minY) / 2,
                surfacePos.z
            );

            return {
                center,
                top: new THREE.Vector3(surfacePos.x, maxY, surfacePos.z),
                bottom: new THREE.Vector3(surfacePos.x, minY, surfacePos.z),
                extent: maxY - minY,
            };
        }

        // Fallback for wells without trajectory
        return {
            center: surfacePos.clone(),
            top: surfacePos.clone(),
            bottom: surfacePos.clone(),
            extent: 0.2,
        };
    }

    /**
     * Get the world-space center position of a well (midway down its trajectory).
     * Convenience wrapper around getWellBounds.
     */
    public getWellWorldPosition(name: string): THREE.Vector3 | null {
        const bounds = this.getWellBounds(name);
        return bounds ? bounds.center : null;
    }

    /**
     * Get well data by name.
     */
    public getWellByName(name: string): WellData | undefined {
        return this.wells.find(w => w.name === name);
    }

    /**
     * Check if any wells are loaded.
     */
    public hasWells(): boolean {
        return this.wells.length > 0;
    }

    /**
     * Get all formation marker meshes for raycasting.
     */
    public getFormationMeshes(): THREE.Mesh[] {
        const meshes: THREE.Mesh[] = [];
        for (const [, markersGroup] of this.formationMarkers) {
            markersGroup.traverse((obj) => {
                if (obj instanceof THREE.Mesh && obj.userData.isFormationMarker) {
                    meshes.push(obj);
                }
            });
        }
        return meshes;
    }

    /**
     * Get all well stick and sphere meshes for raycasting (click-to-center).
     */
    public getWellStickMeshes(): THREE.Mesh[] {
        const meshes: THREE.Mesh[] = [];
        for (const [, group] of this.wellGroups) {
            group.traverse((obj) => {
                if (obj instanceof THREE.Mesh && obj.userData.wellName && !obj.userData.isFormationMarker) {
                    meshes.push(obj);
                }
            });
        }
        return meshes;
    }

    /**
     * Update well colors (e.g. when colormap changes and we need to pick
     * colors that contrast with the new colormap).
     * @param colors Array of hex color strings, one per well in order.
     */
    public updateWellColors(colors: string[]): void {
        for (let i = 0; i < this.wells.length && i < colors.length; i++) {
            const well = this.wells[i];
            const newColor = colors[i];
            well.color = newColor;
            const threeColor = new THREE.Color(newColor);

            const group = this.wellGroups.get(well.name);
            if (!group) continue;

            // Recolor stick and sphere meshes
            group.traverse((obj) => {
                if (obj instanceof THREE.Mesh) {
                    const mat = obj.material as THREE.MeshPhongMaterial;
                    // Only recolor well sticks/spheres, not formation markers
                    if (!obj.userData.isFormationMarker && mat.isMeshPhongMaterial) {
                        mat.color.copy(threeColor);
                        mat.emissive.copy(threeColor).multiplyScalar(0.3);
                    }
                }
            });

            // Recolor label sprite
            const label = this.wellLabels.get(well.name);
            if (label) {
                this.updateLabelSprite(label, well.name, newColor);
            }

            // Update formation marker userData to reflect new well color
            const markers = this.formationMarkers.get(well.name);
            if (markers) {
                markers.traverse((obj) => {
                    if (obj instanceof THREE.Mesh && obj.userData.isFormationMarker) {
                        obj.userData.wellColor = newColor;
                    }
                });
            }
        }
    }

    /**
     * Update formation marker colors based on a code-to-color map.
     */
    public updateFormationColors(colorMap: Map<string, string>): void {
        for (const [, markersGroup] of this.formationMarkers) {
            markersGroup.traverse((obj) => {
                if (obj instanceof THREE.Mesh && obj.userData.isFormationMarker) {
                    const code = obj.userData.formationCode as string;
                    const newColor = colorMap.get(code);
                    if (newColor) {
                        (obj.material as THREE.MeshBasicMaterial).color.set(newColor);
                        obj.userData.formationColor = newColor;
                        // Also update the well's formation data
                    }
                }
            });
        }

        // Update the source formation data too
        for (const well of this.wells) {
            for (const fm of well.formations) {
                const newColor = colorMap.get(fm.code);
                if (newColor) {
                    fm.color = newColor;
                }
            }
        }
    }

    /**
     * Get all unique formation codes across all wells for color generation.
     */
    public getUniqueFormationCodes(): string[] {
        const codes = new Set<string>();
        for (const well of this.wells) {
            for (const fm of well.formations) {
                codes.add(fm.code);
            }
        }
        return Array.from(codes);
    }

    /**
     * Redraw a label sprite with a new color.
     */
    private updateLabelSprite(sprite: THREE.Sprite, name: string, color: string): void {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        canvas.width = 256;
        canvas.height = 64;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 8);
        ctx.fill();

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 8);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(24, canvas.height / 2, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 42, canvas.height / 2);

        // Dispose old texture
        sprite.material.map?.dispose();

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        sprite.material.map = texture;
        sprite.material.needsUpdate = true;
    }

    /**
     * Clean up all Three.js resources.
     */
    public dispose(): void {
        // Recursively dispose all geometries and materials in the master group
        this.masterGroup.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
                obj.geometry.dispose();
                if (obj.material instanceof THREE.Material) {
                    obj.material.dispose();
                }
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => m.dispose());
                }
            }
            if (obj instanceof THREE.Sprite) {
                obj.material.map?.dispose();
                obj.material.dispose();
            }
        });

        this.scene.remove(this.masterGroup);
        this.wellGroups.clear();
        this.wellSticks.clear();
        this.wellLabels.clear();
        this.formationMarkers.clear();
    }
}
