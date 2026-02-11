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
                const rgb = applyColormap(value, this.colormap);

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
                const rgb = applyColormap(value, this.colormap);

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
                const rgb = applyColormap(value, this.colormap);

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
    public updateSlices(inlinePos: number, crosslinePos: number, timePos: number, opacity: number = 0.8): void {
        const { nx, ny, nz } = this.dimensions;

        // Remove old slices
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

        // Create inline slice (XZ plane at constant Y in world coords)
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
        this.inlineSlice.position.x = (inlinePos / nx - 0.5) * this.scale.x;
        this.scene.add(this.inlineSlice);

        // Create crossline slice (YZ plane at constant X in world coords)
        const crosslineGeom = new THREE.PlaneGeometry(this.scale.x, this.scale.y);
        const crosslineTex = this.createCrosslineTexture(crosslinePos);
        const crosslineMat = new THREE.MeshBasicMaterial({
            map: crosslineTex,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: opacity
        });
        this.crosslineSlice = new THREE.Mesh(crosslineGeom, crosslineMat);
        this.crosslineSlice.position.z = (crosslinePos / ny - 0.5) * this.scale.z;
        this.scene.add(this.crosslineSlice);

        // Create time slice (XY plane at constant Z in world coords)
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
        this.timeSlice.position.y = (0.5 - timePos / nz) * this.scale.y;
        this.scene.add(this.timeSlice);
    }

    /**
     * Update the colormap
     */
    public setColormap(colormap: Uint8Array): void {
        this.colormap = colormap;
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
