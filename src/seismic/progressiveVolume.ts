/**
 * Progressive Seismic Volume Visualization using bricked multi-resolution loading.
 * 
 * Loads coarse data first for instant feedback, then progressively refines
 * as the user explores the volume.
 */

import * as THREE from 'three';
import { BrickManager } from './brickManager';
import { applyColormapToArray } from './colormap';

interface SeismicDimensions {
    nx: number;
    ny: number;
    nz: number;
}

interface ProgressiveVolumeOptions {
    colormap: Uint8Array;
    basePath?: string;
}

type LoadingStateCallback = (state: 'loading' | 'refining' | 'ready', detail?: string) => void;

export class ProgressiveSeismicVolume {
    private scene: THREE.Scene;
    private brickManager: BrickManager;
    private colormap: Uint8Array;

    // Current state
    private currentLevel: number = -1;
    private dimensions: SeismicDimensions = { nx: 0, ny: 0, nz: 0 };
    private originalDimensions: SeismicDimensions = { nx: 0, ny: 0, nz: 0 };

    // Slice meshes
    private inlineMesh: THREE.Mesh | null = null;
    private crosslineMesh: THREE.Mesh | null = null;
    private timeMesh: THREE.Mesh | null = null;
    private boundingBox: THREE.LineSegments | null = null;

    // Current slice positions (in original coordinates)
    private inlinePos: number = 0;
    private crosslinePos: number = 0;
    private timePos: number = 0;
    private opacity: number = 0.8;

    // Loading state
    private isLoading: boolean = false;
    private onLoadingState: LoadingStateCallback | null = null;

    constructor(scene: THREE.Scene, options: ProgressiveVolumeOptions) {
        this.scene = scene;
        this.colormap = options.colormap;
        this.brickManager = new BrickManager(options.basePath || '/data/bricks');

        this.brickManager.setProgressCallback((progress, level) => {
            if (this.onLoadingState) {
                this.onLoadingState('loading', `Level ${level}: ${Math.round(progress * 100)}%`);
            }
        });
    }

    /**
     * Set callback for loading state changes
     */
    setLoadingStateCallback(callback: LoadingStateCallback): void {
        this.onLoadingState = callback;
    }

    /**
     * Initialize by loading manifest and coarsest level
     */
    async initialize(): Promise<SeismicDimensions> {
        if (this.onLoadingState) {
            this.onLoadingState('loading', 'Loading manifest...');
        }

        const manifest = await this.brickManager.loadManifest();

        const [nx, ny, nz] = manifest.original_dimensions;
        this.originalDimensions = { nx, ny, nz };

        // Start with coarsest level
        const coarsestLevel = manifest.num_levels - 1;
        await this.loadLevel(coarsestLevel);

        // Create bounding box
        this.createBoundingBox();

        // Set initial slice positions to center
        this.inlinePos = Math.floor(nx / 2);
        this.crosslinePos = Math.floor(ny / 2);
        this.timePos = Math.floor(nz / 2);

        return this.originalDimensions;
    }

    /**
     * Load a specific resolution level
     */
    private async loadLevel(level: number): Promise<void> {
        if (this.isLoading) return;

        this.isLoading = true;
        this.currentLevel = level;

        const dims = this.brickManager.getLevelDimensions(level);
        if (dims) {
            const [nx, ny, nz] = dims;
            this.dimensions = { nx, ny, nz };
        }

        if (this.onLoadingState) {
            this.onLoadingState('loading', `Loading level ${level}...`);
        }

        // Load the level (this caches all bricks)
        await this.brickManager.loadLevel(level);

        this.isLoading = false;

        if (this.onLoadingState) {
            this.onLoadingState('ready');
        }
    }

    /**
     * Progressively refine to a finer level
     */
    async refineToLevel(targetLevel: number): Promise<void> {
        const manifest = this.brickManager.getManifest();
        if (!manifest) return;

        // Clamp to valid range
        targetLevel = Math.max(0, Math.min(targetLevel, manifest.num_levels - 1));

        // Load progressively from current to target
        for (let level = this.currentLevel - 1; level >= targetLevel; level--) {
            if (this.onLoadingState) {
                this.onLoadingState('refining', `Refining to level ${level}...`);
            }

            await this.loadLevel(level);
            await this.updateSlices(this.inlinePos, this.crosslinePos, this.timePos, this.opacity);
        }
    }

    /**
     * Create the bounding box visualization
     */
    private createBoundingBox(): void {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const edges = new THREE.EdgesGeometry(geometry);
        const material = new THREE.LineBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.5
        });

        this.boundingBox = new THREE.LineSegments(edges, material);
        this.boundingBox.position.set(0, 0, 0);
        this.scene.add(this.boundingBox);
    }

    /**
     * Create a texture from slice data
     */
    private createTextureFromSlice(
        data: Float32Array,
        width: number,
        height: number
    ): THREE.DataTexture {
        const rgbaData = applyColormapToArray(data, this.colormap);

        const texture = new THREE.DataTexture(
            rgbaData,
            width,
            height,
            THREE.RGBAFormat,
            THREE.UnsignedByteType
        );

        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;

        return texture;
    }

    /**
     * Update all slice positions
     */
    async updateSlices(
        inlinePos: number,
        crosslinePos: number,
        timePos: number,
        opacity: number = 0.8
    ): Promise<void> {
        this.inlinePos = inlinePos;
        this.crosslinePos = crosslinePos;
        this.timePos = timePos;
        this.opacity = opacity;

        // Convert original coordinates to current level coordinates
        const [levelInline, levelCrossline, levelTime] = this.brickManager.originalToLevelCoords(
            inlinePos, crosslinePos, timePos, this.currentLevel
        );

        // Clamp to level dimensions
        const clampedInline = Math.max(0, Math.min(levelInline, this.dimensions.nx - 1));
        const clampedCrossline = Math.max(0, Math.min(levelCrossline, this.dimensions.ny - 1));
        const clampedTime = Math.max(0, Math.min(levelTime, this.dimensions.nz - 1));

        // Fetch slice data from bricks
        const [inlineSlice, crosslineSlice, timeSlice] = await Promise.all([
            this.brickManager.getInlineSlice(clampedInline, this.currentLevel),
            this.brickManager.getCrosslineSlice(clampedCrossline, this.currentLevel),
            this.brickManager.getTimeSlice(clampedTime, this.currentLevel)
        ]);

        // Update inline slice
        this.updateInlineMesh(inlineSlice, inlinePos, opacity);

        // Update crossline slice
        this.updateCrosslineMesh(crosslineSlice, crosslinePos, opacity);

        // Update time slice
        this.updateTimeMesh(timeSlice, timePos, opacity);
    }

    private updateInlineMesh(
        slice: { data: Float32Array; width: number; height: number },
        inlinePos: number,
        opacity: number
    ): void {
        const texture = this.createTextureFromSlice(slice.data, slice.width, slice.height);

        // Position as fraction of original volume
        const xPos = inlinePos / this.originalDimensions.nx - 0.5;

        if (this.inlineMesh) {
            (this.inlineMesh.material as THREE.MeshBasicMaterial).map?.dispose();
            (this.inlineMesh.material as THREE.MeshBasicMaterial).map = texture;
            (this.inlineMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
            this.inlineMesh.position.x = xPos;
        } else {
            const geometry = new THREE.PlaneGeometry(1, 1);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: opacity
            });

            this.inlineMesh = new THREE.Mesh(geometry, material);
            this.inlineMesh.rotation.y = Math.PI / 2;
            this.inlineMesh.position.x = xPos;
            this.scene.add(this.inlineMesh);
        }
    }

    private updateCrosslineMesh(
        slice: { data: Float32Array; width: number; height: number },
        crosslinePos: number,
        opacity: number
    ): void {
        const texture = this.createTextureFromSlice(slice.data, slice.width, slice.height);

        const yPos = crosslinePos / this.originalDimensions.ny - 0.5;

        if (this.crosslineMesh) {
            (this.crosslineMesh.material as THREE.MeshBasicMaterial).map?.dispose();
            (this.crosslineMesh.material as THREE.MeshBasicMaterial).map = texture;
            (this.crosslineMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
            this.crosslineMesh.position.z = yPos;
        } else {
            const geometry = new THREE.PlaneGeometry(1, 1);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: opacity
            });

            this.crosslineMesh = new THREE.Mesh(geometry, material);
            this.crosslineMesh.position.z = yPos;
            this.scene.add(this.crosslineMesh);
        }
    }

    private updateTimeMesh(
        slice: { data: Float32Array; width: number; height: number },
        timePos: number,
        opacity: number
    ): void {
        const texture = this.createTextureFromSlice(slice.data, slice.width, slice.height);

        const zPos = timePos / this.originalDimensions.nz - 0.5;

        if (this.timeMesh) {
            (this.timeMesh.material as THREE.MeshBasicMaterial).map?.dispose();
            (this.timeMesh.material as THREE.MeshBasicMaterial).map = texture;
            (this.timeMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
            this.timeMesh.position.y = -zPos;
        } else {
            const geometry = new THREE.PlaneGeometry(1, 1);
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: opacity
            });

            this.timeMesh = new THREE.Mesh(geometry, material);
            this.timeMesh.rotation.x = -Math.PI / 2;
            this.timeMesh.position.y = -zPos;
            this.scene.add(this.timeMesh);
        }
    }

    /**
     * Update the colormap
     */
    setColormap(colormap: Uint8Array): void {
        this.colormap = colormap;
    }

    /**
     * Get the original (full resolution) dimensions
     */
    getOriginalDimensions(): SeismicDimensions {
        return this.originalDimensions;
    }

    /**
     * Get the current resolution level
     */
    getCurrentLevel(): number {
        return this.currentLevel;
    }

    /**
     * Get available levels
     */
    getNumLevels(): number {
        return this.brickManager.getManifest()?.num_levels ?? 0;
    }

    /**
     * Cleanup resources
     */
    dispose(): void {
        if (this.inlineMesh) {
            (this.inlineMesh.material as THREE.MeshBasicMaterial).map?.dispose();
            (this.inlineMesh.material as THREE.MeshBasicMaterial).dispose();
            this.inlineMesh.geometry.dispose();
            this.scene.remove(this.inlineMesh);
        }

        if (this.crosslineMesh) {
            (this.crosslineMesh.material as THREE.MeshBasicMaterial).map?.dispose();
            (this.crosslineMesh.material as THREE.MeshBasicMaterial).dispose();
            this.crosslineMesh.geometry.dispose();
            this.scene.remove(this.crosslineMesh);
        }

        if (this.timeMesh) {
            (this.timeMesh.material as THREE.MeshBasicMaterial).map?.dispose();
            (this.timeMesh.material as THREE.MeshBasicMaterial).dispose();
            this.timeMesh.geometry.dispose();
            this.scene.remove(this.timeMesh);
        }

        if (this.boundingBox) {
            (this.boundingBox.material as THREE.LineBasicMaterial).dispose();
            this.boundingBox.geometry.dispose();
            this.scene.remove(this.boundingBox);
        }

        this.brickManager.clearCache();
    }
}
