import * as THREE from 'three';
import { applyColormap } from './colormap';

export interface SeismicDimensions {
    nx: number;  // Inline count
    ny: number;  // Crossline count
    nz: number;  // Time sample count
}

export interface SeismicVolumeOptions {
    data: Float32Array;
    dimensions: SeismicDimensions;
    colormap: Uint8Array;
    scale?: THREE.Vector3;
}

/**
 * 3D Seismic Volume Visualization using slice planes
 */
export class SeismicVolume {
    private scene: THREE.Scene;
    private data: Float32Array;
    public readonly dimensions: SeismicDimensions;
    private colormap: Uint8Array;

    // Amplitude clipping range (default: full range)
    private clipMin: number = -1;
    private clipMax: number = 1;

    // Slice meshes
    private inlineSlice: THREE.Mesh | null = null;
    private crosslineSlice: THREE.Mesh | null = null;
    private timeSlice: THREE.Mesh | null = null;

    // Bounding box
    private boundingBox: THREE.LineSegments | null = null;

    // Scale factor to normalize to unit cube
    public readonly scale: THREE.Vector3;

    constructor(scene: THREE.Scene, options: SeismicVolumeOptions) {
        this.scene = scene;
        this.data = options.data;
        this.dimensions = options.dimensions;
        this.colormap = options.colormap;

        // Calculate scale to fit in unit cube centered at origin
        // If custom scale provided, use it. Otherwise calculate proportional scale.
        if (options.scale) {
            this.scale = options.scale;
        } else {
            const maxDim = Math.max(options.dimensions.nx, options.dimensions.ny, options.dimensions.nz);
            this.scale = new THREE.Vector3(
                options.dimensions.nx / maxDim,
                options.dimensions.nz / maxDim, // Y is vertical (time/depth)
                options.dimensions.ny / maxDim
            );
        }

        this.createBoundingBox();
    }

    private createBoundingBox(): void {
        const geometry = new THREE.BoxGeometry(
            this.scale.x,
            this.scale.y,
            this.scale.z
        );

        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({
            color: 0x4a9eff,
            opacity: 0.5,
            transparent: true
        });

        this.boundingBox = new THREE.LineSegments(edges, material);
        this.scene.add(this.boundingBox);
    }

    /**
     * Get sample value at (i, j, k) position
     */
    private getSample(i: number, j: number, k: number): number {
        const { nx, ny, nz } = this.dimensions;
        if (i < 0 || i >= nx || j < 0 || j >= ny || k < 0 || k >= nz) {
            return 0;
        }
        return this.data[i * ny * nz + j * nz + k];
    }

    /**
     * Create a texture for an inline slice (constant i)
     */
    private createInlineTexture(inlineIdx: number): THREE.DataTexture {
        const { ny, nz } = this.dimensions;
        const pixels = new Uint8Array(ny * nz * 4);

        for (let j = 0; j < ny; j++) {
            for (let k = 0; k < nz; k++) {
                // Flip Time axis: k=0 (Top) should map to Row nz-1 (Top)
                // Wait. Texture Row 0 is Bottom.
                // We want Time=Max at Bottom (Row 0).
                // We want Time=0 at Top (Row nz-1).
                // So Row r aligns with Time k?
                // Row 0 -> Time Max (nz-1)
                // Row nz-1 -> Time 0

                // Let's iterate k (Time) and map to correct row index.
                const row = nz - 1 - k;

                const value = this.getSample(inlineIdx, j, k);
                const rgb = applyColormap(this.clipValue(value), this.colormap);

                const idx = (row * ny + j) * 4;
                pixels[idx] = rgb[0];
                pixels[idx + 1] = rgb[1];
                pixels[idx + 2] = rgb[2];
                pixels[idx + 3] = 255;
            }
        }

        const texture = new THREE.DataTexture(pixels, ny, nz, THREE.RGBAFormat);
        texture.needsUpdate = true;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    /**
     * Create a texture for a crossline slice (constant j)
     */
    private createCrosslineTexture(crosslineIdx: number): THREE.DataTexture {
        const { nx, nz } = this.dimensions;
        const pixels = new Uint8Array(nx * nz * 4);

        for (let i = 0; i < nx; i++) {
            for (let k = 0; k < nz; k++) {
                // Flip Time axis
                // Row 0 (Bottom) -> Time Max (nz-1)
                // Row nz-1 (Top) -> Time 0
                const row = nz - 1 - k;

                const value = this.getSample(i, crosslineIdx, k);
                const rgb = applyColormap(this.clipValue(value), this.colormap);

                const idx = (row * nx + i) * 4;
                pixels[idx] = rgb[0];
                pixels[idx + 1] = rgb[1];
                pixels[idx + 2] = rgb[2];
                pixels[idx + 3] = 255;
            }
        }

        const texture = new THREE.DataTexture(pixels, nx, nz, THREE.RGBAFormat);
        texture.needsUpdate = true;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    /**
     * Create a texture for a time slice (constant k)
     */
    private createTimeTexture(timeIdx: number): THREE.DataTexture {
        const { nx, ny } = this.dimensions;
        const pixels = new Uint8Array(nx * ny * 4);

        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < ny; j++) {
                // Flip Crossline axis (J) to match Z-axis physics
                // J=0 should be at -Z (Top of texture, Row ny-1, because +Y maps to -Z)
                // J=Max should be at +Z (Bottom of texture, Row 0)
                const row = ny - 1 - j;

                const value = this.getSample(i, j, timeIdx);
                const rgb = applyColormap(this.clipValue(value), this.colormap);

                const idx = (row * nx + i) * 4;
                pixels[idx] = rgb[0];
                pixels[idx + 1] = rgb[1];
                pixels[idx + 2] = rgb[2];
                pixels[idx + 3] = 255;
            }
        }

        const texture = new THREE.DataTexture(pixels, nx, ny, THREE.RGBAFormat);
        texture.needsUpdate = true;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    /**
     * Update all slice positions
     */
    public updateSlices(
        inlinePos: number,
        crosslinePos: number,
        timePos: number,
        opacity: number = 0.8,
        showInline: boolean = true,
        showCrossline: boolean = true,
        showTime: boolean = true
    ): void {
        const { nx, ny, nz } = this.dimensions;

        // --- Inline Slice ---
        if (showInline) {
            // Create if missing
            if (!this.inlineSlice) {
                const inlineGeom = new THREE.PlaneGeometry(this.scale.z, this.scale.y);
                const inlineTex = this.createInlineTexture(inlinePos);
                const inlineMat = new THREE.MeshBasicMaterial({
                    map: inlineTex,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: opacity
                });
                this.inlineSlice = new THREE.Mesh(inlineGeom, inlineMat);
                this.inlineSlice.rotation.y = -Math.PI / 2;
                this.inlineSlice.userData.sliceType = 'inline';
                this.scene.add(this.inlineSlice);
            } else {
                // Update existing
                (this.inlineSlice.material as THREE.MeshBasicMaterial).map?.dispose();
                (this.inlineSlice.material as THREE.MeshBasicMaterial).map = this.createInlineTexture(inlinePos);
                (this.inlineSlice.material as THREE.MeshBasicMaterial).opacity = opacity;
            }
            // Position
            this.inlineSlice.position.x = (inlinePos / nx - 0.5) * this.scale.x;
            this.inlineSlice.userData.sliceIndex = inlinePos;
            this.inlineSlice.visible = true;
        } else {
            // Hide if exists
            if (this.inlineSlice) {
                this.inlineSlice.visible = false;
            }
        }

        // --- Crossline Slice ---
        if (showCrossline) {
            if (!this.crosslineSlice) {
                const crosslineGeom = new THREE.PlaneGeometry(this.scale.x, this.scale.y);
                const crosslineTex = this.createCrosslineTexture(crosslinePos);
                const crosslineMat = new THREE.MeshBasicMaterial({
                    map: crosslineTex,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: opacity
                });
                this.crosslineSlice = new THREE.Mesh(crosslineGeom, crosslineMat);
                this.crosslineSlice.userData.sliceType = 'crossline';
                this.scene.add(this.crosslineSlice);
            } else {
                (this.crosslineSlice.material as THREE.MeshBasicMaterial).map?.dispose();
                (this.crosslineSlice.material as THREE.MeshBasicMaterial).map = this.createCrosslineTexture(crosslinePos);
                (this.crosslineSlice.material as THREE.MeshBasicMaterial).opacity = opacity;
            }
            this.crosslineSlice.position.z = (crosslinePos / ny - 0.5) * this.scale.z;
            this.crosslineSlice.userData.sliceIndex = crosslinePos;
            this.crosslineSlice.visible = true;
        } else {
            if (this.crosslineSlice) {
                this.crosslineSlice.visible = false;
            }
        }

        // --- Time Slice ---
        if (showTime) {
            if (!this.timeSlice) {
                const timeGeom = new THREE.PlaneGeometry(this.scale.x, this.scale.z);
                const timeTex = this.createTimeTexture(timePos);
                const timeMat = new THREE.MeshBasicMaterial({
                    map: timeTex,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: opacity
                });
                this.timeSlice = new THREE.Mesh(timeGeom, timeMat);
                this.timeSlice.rotation.x = -Math.PI / 2;
                this.scene.add(this.timeSlice);
            } else {
                (this.timeSlice.material as THREE.MeshBasicMaterial).map?.dispose();
                (this.timeSlice.material as THREE.MeshBasicMaterial).map = this.createTimeTexture(timePos);
                (this.timeSlice.material as THREE.MeshBasicMaterial).opacity = opacity;
            }
            this.timeSlice.position.y = (0.5 - timePos / nz) * this.scale.y;
            this.timeSlice.visible = true;
        } else {
            if (this.timeSlice) {
                this.timeSlice.visible = false;
            }
        }
    }

    /**
     * Get visible inline/crossline slice meshes for raycasting (e.g. right-click context menu).
     * Each mesh has userData: { sliceType, sliceIndex, dimensions, scale, timeRangeMs }
     */
    public getSliceMeshes(): THREE.Mesh[] {
        const meshes: THREE.Mesh[] = [];
        if (this.inlineSlice && this.inlineSlice.visible) meshes.push(this.inlineSlice);
        if (this.crosslineSlice && this.crosslineSlice.visible) meshes.push(this.crosslineSlice);
        return meshes;
    }

    /**
     * Extract raw Float32Array data for a given slice (for 2D rendering in panels/tabs).
     */
    public getSliceData(sliceType: 'inline' | 'crossline', index: number): { data: Float32Array; width: number; height: number } {
        const { nx, ny, nz } = this.dimensions;
        if (sliceType === 'inline') {
            const data = new Float32Array(ny * nz);
            for (let j = 0; j < ny; j++) {
                for (let k = 0; k < nz; k++) {
                    data[(nz - 1 - k) * ny + j] = this.getSample(index, j, k);
                }
            }
            return { data, width: ny, height: nz };
        } else {
            const data = new Float32Array(nx * nz);
            for (let i = 0; i < nx; i++) {
                for (let k = 0; k < nz; k++) {
                    data[(nz - 1 - k) * nx + i] = this.getSample(i, index, k);
                }
            }
            return { data, width: nx, height: nz };
        }
    }

    /**
     * Update the colormap
     */
    public setColormap(colormap: Uint8Array): void {
        this.colormap = colormap;
    }

    /**
     * Set amplitude clipping range. Values outside [min, max] are clamped,
     * and the sub-range is stretched across the full colormap.
     */
    public setClipRange(min: number, max: number): void {
        this.clipMin = min;
        this.clipMax = max;
    }

    /**
     * Clamp value to clip range and remap to [-1, 1] for colormap lookup.
     */
    private clipValue(value: number): number {
        const clamped = Math.max(this.clipMin, Math.min(this.clipMax, value));
        const range = this.clipMax - this.clipMin;
        return range > 0 ? ((clamped - this.clipMin) / range) * 2 - 1 : 0;
    }

    /**
     * Cleanup resources
     */
    public dispose(): void {
        if (this.boundingBox) {
            this.scene.remove(this.boundingBox);
            this.boundingBox.geometry.dispose();
            (this.boundingBox.material as THREE.Material).dispose();
        }
        if (this.inlineSlice) {
            this.scene.remove(this.inlineSlice);
            this.inlineSlice.geometry.dispose();
            (this.inlineSlice.material as THREE.Material).dispose();
        }
        if (this.crosslineSlice) {
            this.scene.remove(this.crosslineSlice);
            this.crosslineSlice.geometry.dispose();
            (this.crosslineSlice.material as THREE.Material).dispose();
        }
        if (this.timeSlice) {
            this.scene.remove(this.timeSlice);
            this.timeSlice.geometry.dispose();
            (this.timeSlice.material as THREE.Material).dispose();
        }
    }
}
