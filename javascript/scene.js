import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as C from './config.js';

const playerModels = {}; // Map clientId to player model (THREE.Group)

/**
 * Manages the Three.js scene, camera, renderer, lighting, ground, and player models.
 */
export class SceneManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.groundPlane = null;
        this.clock = new THREE.Clock();
    }

    /**
     * Initializes the Three.js scene, camera, renderer, lights, and ground.
     */
    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // Sky blue background

        // Camera
        const aspectRatio = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 2000);
        this.camera.position.set(0, 5, 10); // Position camera to see the scene

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio); // Adjust for device pixel ratio
        this.renderer.shadowMap.enabled = true; // Enable shadows

        // Controls - Allow camera rotation/zoom
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true; // Smooth camera movement
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 2;
        this.controls.maxDistance = 50;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent camera going below ground

        // Basic Lighting
        const ambientLight = new THREE.AmbientLight(0xcccccc, 0.5);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 10, 7.5);
        directionalLight.castShadow = true; // Enable shadow casting
        directionalLight.shadow.mapSize.width = 1024;
        directionalLight.shadow.mapSize.height = 1024;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 50;
        this.scene.add(directionalLight);

        // Ground Plane (Large and Flat)
        const groundGeometry = new THREE.PlaneGeometry(1000, 1000); // Large plane
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x228b22, // Forest green
            roughness: 0.9,
            metalness: 0.1
        });
        this.groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        this.groundPlane.rotation.x = -Math.PI / 2; // Rotate to be horizontal
        this.groundPlane.receiveShadow = true; // Allow ground to receive shadows
        this.scene.add(this.groundPlane);

        // Fog for "infinite" feel
        this.scene.fog = new THREE.Fog(0x87ceeb, 50, 250);

        // Handle window resize
        window.addEventListener('resize', this.onWindowResize.bind(this));
        this.onWindowResize(); // Call once initially
    }

    /**
     * Creates a simple humanoid model.
     * @param {string} color - Hex color string (e.g., '#ff0000').
     * @returns {THREE.Group} The player model group.
     */
    createPlayerModel(color = '#ffffff') {
         const group = new THREE.Group();
         group.userData = { moving: false, bobTime: Math.random() * Math.PI * 2 }; // Add bobTime for varied starts

         const bodyHeight = C.PLAYER_HEIGHT * 0.7;
         const headRadius = C.PLAYER_HEIGHT * 0.15;
         const bodyRadius = C.PLAYER_HEIGHT * 0.1;

         // Body (Capsule-like: Cylinder + two Spheres)
         const bodyMaterial = new THREE.MeshStandardMaterial({
             color: color,
             roughness: 0.6,
             metalness: 0.2,
         });

         const bodyGeometry = new THREE.CylinderGeometry(bodyRadius, bodyRadius, bodyHeight, 16);
         const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
         bodyMesh.castShadow = true;
         bodyMesh.receiveShadow = true;
         bodyMesh.name = "body"; // Name for animation lookup
         group.add(bodyMesh); // Body centered at group origin for now

         // Head (Sphere)
         const headGeometry = new THREE.SphereGeometry(headRadius, 16, 12);
         const headMesh = new THREE.Mesh(headGeometry, bodyMaterial);
         headMesh.position.y = (bodyHeight / 2) + headRadius * 0.9; // Position head on top of body
         headMesh.castShadow = true;
         headMesh.name = "head"; // Name for animation lookup
         group.add(headMesh);

         // Direction Indicator (optional, simple triangle)
         const indicatorGeometry = new THREE.ConeGeometry(headRadius * 0.5, headRadius, 3);
         const indicatorMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
         const indicatorMesh = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
         indicatorMesh.position.y = headMesh.position.y; // Same height as head
         indicatorMesh.position.z = bodyRadius + 0.01; // Slightly in front of body
         indicatorMesh.rotation.x = Math.PI / 2;
         indicatorMesh.name = "indicator"; // Name for animation lookup
         group.add(indicatorMesh);

         return group;
    }

    /**
     * Adds a new player model to the scene or updates an existing one.
     * @param {string} clientId - The unique ID of the player.
     * @param {object} playerData - The presence data for the player (must include x, y, z, rotationY, color).
     */
    addOrUpdatePlayer(clientId, playerData) {
        if (!playerData || playerData.x === undefined) return; // Skip if presence data is incomplete

        let model = playerModels[clientId];
        let wasMoving = model ? model.userData.moving : false;

        if (model) {
            // Update existing model
            const targetPosition = new THREE.Vector3(playerData.x, playerData.y, playerData.z);

            // Determine if moving based on position change
            const movedDistance = model.position.distanceTo(targetPosition);
            model.userData.moving = movedDistance > 0.01; // Threshold to detect movement


            // Smooth interpolation (Lerp) for position
            model.position.lerp(targetPosition, 0.2); // Adjust lerp factor for smoothness

            // Smooth interpolation for rotation (Slerp for quaternions is better, but lerp for Y is ok here)
            const targetRotation = playerData.rotationY || 0;
            model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, targetRotation, 0.2);


            // Update color if changed
             if (playerData.color && model.userData.color !== playerData.color) {
                 const bodyMaterial = model.getObjectByName("body")?.material; // Find body/head by name
                 const headMaterial = model.getObjectByName("head")?.material;
                 if (bodyMaterial) bodyMaterial.color.set(playerData.color);
                 if (headMaterial) headMaterial.color.set(playerData.color); // Assume same material for now
                 model.userData.color = playerData.color;
             }

        } else {
            // Create new model for new player
            console.log(`Creating model for ${clientId}`);
            model = this.createPlayerModel(playerData.color || '#ffffff');
            model.position.set(playerData.x, playerData.y, playerData.z);
            model.rotation.y = playerData.rotationY || 0;
            model.userData.color = playerData.color; // Store color for comparison
            this.scene.add(model);
            playerModels[clientId] = model;
            model.userData.moving = false; // Start as not moving
        }
    }

    /**
     * Removes a player model from the scene.
     * @param {string} clientId - The ID of the player to remove.
     */
    removePlayer(clientId) {
        const modelToRemove = playerModels[clientId];
        if (modelToRemove) {
            console.log(`Removing model for ${clientId}`);
            this.scene.remove(modelToRemove);
            // Dispose geometry/material
            modelToRemove.traverse(child => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    if (child.material.isMaterial) {
                        // If materials are shared, be careful here. Assuming unique for now.
                        child.material.dispose();
                    } else {
                        // For multi-materials
                        for (const material of child.material) material.dispose();
                    }
                }
            });
            delete playerModels[clientId];
        }
    }

    /**
     * Updates the scene, performs animations, and renders.
     */
    update() {
        const delta = this.clock.getDelta(); // Time since last frame
        this.controls.update(); // Update camera controls

        // Animate player models (e.g., bobbing when moving)
        Object.values(playerModels).forEach(model => {
            if (model.userData.moving) {
                model.userData.bobTime += delta * 8; // Adjust speed of bobbing
                const bobAmount = Math.sin(model.userData.bobTime) * 0.05; // Adjust height of bobbing
                // Apply bobbing to body and head relative to base position
                const body = model.getObjectByName("body");
                const head = model.getObjectByName("head");
                const indicator = model.getObjectByName("indicator");

                if (body) body.position.y = bobAmount;
                if (head) head.position.y = (C.PLAYER_HEIGHT * 0.7 / 2) + (C.PLAYER_HEIGHT * 0.15 * 0.9) + bobAmount;
                 if (indicator) indicator.position.y = head.position.y;


            } else {
                 // Reset bobbing if stopped
                const body = model.getObjectByName("body");
                const head = model.getObjectByName("head");
                const indicator = model.getObjectByName("indicator");

                if (body && body.position.y !== 0) body.position.y = THREE.MathUtils.lerp(body.position.y, 0, 0.1);
                const headBaseY = (C.PLAYER_HEIGHT * 0.7 / 2) + (C.PLAYER_HEIGHT * 0.15 * 0.9);
                if (head && head.position.y !== headBaseY) head.position.y = THREE.MathUtils.lerp(head.position.y, headBaseY, 0.1);
                if (indicator && indicator.position.y !== head.position.y) indicator.position.y = head.position.y;
                model.userData.bobTime = Math.random() * Math.PI * 2; // Reset bob phase
            }
        });

        this.renderer.render(this.scene, this.camera);
    }

     /**
     * Handles window resize events to update camera aspect ratio and renderer size.
     */
    onWindowResize() {
        const width = this.canvas.parentElement.clientWidth; // Use parent width
        // Calculate height based on a fixed aspect ratio (e.g., 16:9) or keep current height calculation
        const height = width * (9 / 16); // Example: Enforce 16:9 aspect ratio
        // const height = this.canvas.clientHeight; // Or keep using the CSS defined height relative to width

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
}
