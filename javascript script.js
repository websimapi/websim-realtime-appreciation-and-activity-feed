import * as C from './config.js';
import * as THREE from 'three';
// Import OrbitControls for camera movement
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const room = new WebsimSocket();

// Existing DOM Elements
const heartIcon = document.getElementById('heart-icon');
const heartCount = document.getElementById('heart-count');
const activityList = document.getElementById('activity-list');
const chatMessages = document.getElementById('chat-messages');
const chatInputField = document.getElementById('chat-input-field');
const sendButton = document.getElementById('send-button');
const userList = document.getElementById('user-list');

// New 3D/Audio Elements
const canvas = document.getElementById('webgl-canvas');
const soundButton = document.getElementById('sound-button');

let localHeartClicks = 0;
const MAX_ACTIVITY_ITEMS = C.MAX_ACTIVITY_ITEMS;
const MAX_CHAT_MESSAGES = C.MAX_CHAT_MESSAGES;

// --- 3D Scene Variables ---
let scene, camera, renderer, controls;
let groundPlane;
const playerModels = {}; // Map clientId to player model (THREE.Group)
const keyboardState = {}; // Track pressed keys

// --- Audio Variables ---
let audioContext;
let oscillator;
let gainNode;

// --- Initialization ---
async function initialize() {
    // Initialize 3D Scene
    initThreeJS();

    // Initialize Audio
    initAudio();

    // Initialize Websim Room
    await room.initialize();

    // Initialize own presence with position
    room.updatePresence({
        x: 0,
        y: C.PLAYER_HEIGHT / 2, // Start slightly above ground
        z: 0,
        rotationY: 0,
        color: `#${Math.floor(Math.random()*16777215).toString(16)}` // Assign random color
    });


    // Initialize room state if it doesn't exist
    if (!room.roomState.heartClicks) {
        room.updateRoomState({ heartClicks: 0 });
    }
    if (!room.roomState.chatHistory) {
        room.updateRoomState({ chatHistory: {} }); // Use object for chat history
    }
    if (!room.roomState.activityLog) {
        room.updateRoomState({ activityLog: {} }); // Use object for activity log
    }

    // Initial render based on current state
    updateHeartDisplay(room.roomState.heartClicks || 0);
    renderChatHistory();
    renderActivityLog();
    updateUserList(); // Initial user list draw

    // --- Event Listeners ---
    heartIcon.addEventListener('click', handleHeartClick);
    sendButton.addEventListener('click', sendChatMessage);
    chatInputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });
    soundButton.addEventListener('click', playSound);

    // Keyboard listeners for movement
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // --- Subscriptions ---
    room.subscribeRoomState(handleRoomStateUpdate);
    room.subscribePresence(handlePresenceUpdate);

    // Add initial join activity (after presence is set)
    logActivity(`${room.peers[room.clientId].username} joined.`);

    // Start 3D animation loop
    animate();
}

// --- 3D Scene Setup ---
function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue background

    // Camera
    camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 2000);
    camera.position.set(0, 5, 10); // Position camera to see the scene

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true }); // Enable antialias for smoother models
    renderer.setSize(canvas.width, canvas.height);
    renderer.shadowMap.enabled = true; // Enable shadows

    // Controls - Allow camera rotation/zoom
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // Smooth camera movement
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 2;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent camera going below ground

    // Basic Lighting
    const ambientLight = new THREE.AmbientLight(0xcccccc, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true; // Enable shadow casting
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    scene.add(directionalLight);

    // Ground Plane (Large and Flat)
    const groundGeometry = new THREE.PlaneGeometry(1000, 1000); // Large plane
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x228b22, // Forest green
        roughness: 0.9,
        metalness: 0.1
    });
    groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    groundPlane.rotation.x = -Math.PI / 2; // Rotate to be horizontal
    groundPlane.receiveShadow = true; // Allow ground to receive shadows
    scene.add(groundPlane);

    // Fog for "infinite" feel
    scene.fog = new THREE.Fog(0x87ceeb, 50, 250);
}

// --- Player Model Creation ---
function createPlayerModel(color = 0xffffff) {
    const group = new THREE.Group();

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
    group.add(bodyMesh); // Body centered at group origin for now

    // Head (Sphere)
    const headGeometry = new THREE.SphereGeometry(headRadius, 16, 12);
    const headMesh = new THREE.Mesh(headGeometry, bodyMaterial);
    headMesh.position.y = (bodyHeight / 2) + headRadius * 0.9; // Position head on top of body
    headMesh.castShadow = true;
    group.add(headMesh);

    // Direction Indicator (optional, simple triangle)
    const indicatorGeometry = new THREE.ConeGeometry(headRadius * 0.5, headRadius, 3);
    const indicatorMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const indicatorMesh = new THREE.Mesh(indicatorGeometry, indicatorMaterial);
    indicatorMesh.position.y = headMesh.position.y; // Same height as head
    indicatorMesh.position.z = bodyRadius + 0.01; // Slightly in front of body
    indicatorMesh.rotation.x = Math.PI / 2;
    group.add(indicatorMesh);


    // Adjust group pivot point if needed (e.g., to be at the base)
    // group.position.y = C.PLAYER_HEIGHT / 2; // This is handled by setting presence y

    return group;
}


// --- 3D Animation Loop ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta(); // Time since last frame

    handleMovement(delta); // Process local player movement based on keyboard state
    controls.update(); // Update camera controls

    // Simple animation for player models (e.g., slight bobbing) - could be added here
    Object.values(playerModels).forEach(model => {
        // Example: model.position.y += Math.sin(Date.now() * 0.005) * 0.005;
    });


    renderer.render(scene, camera);
}

// --- Audio Setup ---
// ... existing initAudio and playSound functions ...
function initAudio() {
    // Create AudioContext on first user interaction (in playSound)
}

function playSound() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Ensure only one "voice" plays at a time
    if (oscillator) {
        try {
            oscillator.stop();
            oscillator.disconnect();
        } catch (e) {
            // Ignore errors if already stopped
        }
    }
    if (gainNode) {
        gainNode.disconnect();
    }

    // Create single oscillator (voice)
    oscillator = audioContext.createOscillator();
    gainNode = audioContext.createGain();

    oscillator.type = 'square'; // Simple retro sound
    oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 note

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime); // Volume
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.5); // Fade out

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.5); // Play for 0.5 seconds
}


// --- State Update Handlers ---
function handleRoomStateUpdate(newState) {
    // Update Heart
    if (newState.heartClicks !== undefined) {
        updateHeartDisplay(newState.heartClicks);
    }
    // Update Chat
    if (newState.chatHistory) {
        renderChatHistory();
    }
    // Update Activity
    if (newState.activityLog) {
        renderActivityLog();
    }
}

function handlePresenceUpdate(newPresence) {
    updateUserList(); // Update connected user list UI

    const currentClientIds = Object.keys(newPresence);
    const existingModelIds = Object.keys(playerModels);

    // Add/Update players
    currentClientIds.forEach(clientId => {
        const playerData = newPresence[clientId];
        if (!playerData || playerData.x === undefined) return; // Skip if presence data is incomplete

        if (playerModels[clientId]) {
            // Update existing model
            const model = playerModels[clientId];
            model.position.set(playerData.x, playerData.y, playerData.z);
            model.rotation.y = playerData.rotationY || 0;
            // Update color if changed (optional)
             if (playerData.color && model.userData.color !== playerData.color) {
                 const bodyMaterial = model.children[0].material; // Assuming body is first child
                 bodyMaterial.color.set(playerData.color);
                 model.userData.color = playerData.color;
             }

        } else {
            // Create new model for new player
            console.log(`Creating model for ${clientId}`);
            const playerModel = createPlayerModel(playerData.color || '#ffffff');
            playerModel.position.set(playerData.x, playerData.y, playerData.z);
            playerModel.rotation.y = playerData.rotationY || 0;
            playerModel.userData.color = playerData.color; // Store color for comparison
            scene.add(playerModel);
            playerModels[clientId] = playerModel;
        }
    });

    // Remove players who left
    existingModelIds.forEach(clientId => {
        if (!newPresence[clientId]) {
            console.log(`Removing model for ${clientId}`);
            const modelToRemove = playerModels[clientId];
            scene.remove(modelToRemove);
            // Dispose geometry/material if needed
            modelToRemove.traverse(child => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    child.material.dispose();
                }
            });
            delete playerModels[clientId];
            logActivity(`${room.peers[clientId]?.username || 'Someone'} left.`); // Log leaving
        }
    });
}


// --- UI Update Functions ---
// ... existing updateHeartDisplay, renderChatHistory, renderActivityLog, updateUserList ...
function updateHeartDisplay(clicks) {
    heartCount.textContent = clicks;
    const scale = 1 + Math.min(clicks * 0.01, 1); // Grow heart slightly with clicks, max scale 2
    heartIcon.style.transform = `scale(${scale})`;
}

function renderChatHistory() {
    chatMessages.innerHTML = ''; // Clear existing messages
    const history = room.roomState.chatHistory || {};
    const sortedMessages = Object.values(history)
        .filter(msg => msg) // Filter out null/deleted messages
        .sort((a, b) => a.timestamp - b.timestamp); // Sort by timestamp ASC

    sortedMessages.slice(-MAX_CHAT_MESSAGES).forEach(addChatMessageToDOM); // Display latest N messages
    chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
}

function renderActivityLog() {
    activityList.innerHTML = ''; // Clear existing activities
    const log = room.roomState.activityLog || {};
    const sortedActivities = Object.values(log)
        .filter(act => act) // Filter out null/deleted activities
        .sort((a, b) => a.timestamp - b.timestamp); // Sort by timestamp ASC

    sortedActivities.slice(-MAX_ACTIVITY_ITEMS).forEach(addActivityToDOM); // Display latest N activities
}

function updateUserList() {
    userList.innerHTML = ''; // Clear existing list
    const peers = room.peers || {};
    Object.values(peers).forEach(peer => {
        const li = document.createElement('li');
        const img = document.createElement('img');
        img.src = peer.avatarUrl || 'https://via.placeholder.com/24'; // Fallback avatar
        img.alt = `${peer.username}'s avatar`;
        img.classList.add('user-avatar');
        li.appendChild(img);
        li.appendChild(document.createTextNode(peer.username));

        // Add player color indicator
        const playerPresence = room.presence[peer.id];
        if (playerPresence && playerPresence.color) {
             const colorSwatch = document.createElement('span');
             colorSwatch.style.display = 'inline-block';
             colorSwatch.style.width = '12px';
             colorSwatch.style.height = '12px';
             colorSwatch.style.backgroundColor = playerPresence.color;
             colorSwatch.style.borderRadius = '50%';
             colorSwatch.style.marginLeft = '8px';
             colorSwatch.style.border = '1px solid #ccc';
             li.appendChild(colorSwatch);
        }

        userList.appendChild(li);
    });
}


// --- Action Handlers ---
// ... existing handleHeartClick, sendChatMessage, logActivity ...
function handleHeartClick() {
    localHeartClicks++;
    const currentTotalClicks = (room.roomState.heartClicks || 0) + 1;

    // Optimistic UI update
    updateHeartDisplay(currentTotalClicks);
    // Add subtle animation
    heartIcon.style.transition = 'transform 0.1s ease-in-out';
    heartIcon.style.transform += ' scale(1.1)';
    setTimeout(() => {
        // Reset transition for next click scaling
        heartIcon.style.transition = 'transform 0.2s ease-in-out';
        updateHeartDisplay(room.roomState.heartClicks || currentTotalClicks); // Ensure sync after animation
    }, 100);

    // Update shared state
    room.updateRoomState({
        heartClicks: currentTotalClicks
    });

    // Log activity (only log once per session threshold to avoid spam)
    if (localHeartClicks === 1 || localHeartClicks % 5 === 0) { // Log first click and every 5th
        logActivity(`${room.peers[room.clientId].username} showed appreciation! ❤️`);
    }
}

function sendChatMessage() {
    const messageText = chatInputField.value.trim();
    if (!messageText) return;

    const messageId = `msg-${room.clientId}-${Date.now()}`;
    const newMessage = {
        id: messageId,
        clientId: room.clientId,
        username: room.peers[room.clientId].username,
        avatarUrl: room.peers[room.clientId].avatarUrl,
        text: messageText,
        timestamp: Date.now()
    };

    // Update room state with the new message using its ID as the key
    room.updateRoomState({
        chatHistory: {
            ...room.roomState.chatHistory, // Keep existing messages
            [messageId]: newMessage // Add the new message
        }
    });

    // Log chat activity
    logActivity(`${newMessage.username} sent a message.`);

    chatInputField.value = ''; // Clear input field
}

function logActivity(text) {
    const activityId = `act-${room.clientId}-${Date.now()}`;
    const currentUser = room.peers[room.clientId] || { username: 'System', avatarUrl: ''}; // Handle case where peer might not be ready?
    const newActivity = {
        id: activityId,
        clientId: room.clientId, // Store who triggered the activity
        username: currentUser.username,
        avatarUrl: currentUser.avatarUrl,
        text: text,
        timestamp: Date.now()
    };

    // Add new activity
    let updatedActivityLog = {
        ...(room.roomState.activityLog || {}), // Ensure log exists
        [activityId]: newActivity
    };

    // Prune old activities if exceeding max count
    const activityKeys = Object.keys(updatedActivityLog).filter(k => updatedActivityLog[k]); // Filter out null keys
    if (activityKeys.length > MAX_ACTIVITY_ITEMS) {
        // Find the oldest activity based on timestamp
        const sortedActivities = Object.values(updatedActivityLog)
            .filter(act => act)
            .sort((a, b) => a.timestamp - b.timestamp);
        if (sortedActivities.length > MAX_ACTIVITY_ITEMS) {
            const oldestActivityId = sortedActivities[0].id;
            // Set the oldest activity to null to remove it effectively
            updatedActivityLog[oldestActivityId] = null;
        }
    }

    room.updateRoomState({ activityLog: updatedActivityLog });
}


// --- Movement Handling ---
function handleKeyDown(event) {
    // Prevent movement if chat input is focused
    if (document.activeElement === chatInputField) return;
    keyboardState[event.code] = true;
}

function handleKeyUp(event) {
    keyboardState[event.code] = false;
}

function handleMovement(deltaTime) {
    if (!room.clientId || !room.presence[room.clientId]) return; // Ensure presence is initialized

    const currentPresence = room.presence[room.clientId];
    let moved = false;
    const moveDistance = C.PLAYER_MOVE_SPEED * deltaTime;
    const rotateAngle = C.PLAYER_TURN_SPEED * deltaTime;

    let dx = 0;
    let dz = 0;
    let rotationY = currentPresence.rotationY || 0;

    // Rotation
    if (keyboardState['KeyA'] || keyboardState['ArrowLeft']) {
        rotationY += rotateAngle;
        moved = true;
    }
    if (keyboardState['KeyD'] || keyboardState['ArrowRight']) {
        rotationY -= rotateAngle;
        moved = true;
    }

    // Forward/Backward Movement (relative to current rotation)
    if (keyboardState['KeyW'] || keyboardState['ArrowUp']) {
        dx += Math.sin(rotationY) * moveDistance;
        dz += Math.cos(rotationY) * moveDistance;
        moved = true;
    }
    if (keyboardState['KeyS'] || keyboardState['ArrowDown']) {
        dx -= Math.sin(rotationY) * moveDistance;
        dz -= Math.cos(rotationY) * moveDistance;
        moved = true;
    }

     // Basic collision detection with ground (simple clamp) - Replace with better physics later if needed
    const newX = currentPresence.x + dx;
    const newZ = currentPresence.z + dz;

    // Boundary check (optional, based on plane size)
    const maxCoord = 490; // Slightly less than half plane size
    const clampedX = Math.max(-maxCoord, Math.min(maxCoord, newX));
    const clampedZ = Math.max(-maxCoord, Math.min(maxCoord, newZ));


    if (moved) {
        room.updatePresence({
            ...currentPresence, // Keep existing properties like color
            x: clampedX,
            // y is fixed for flat terrain, maybe add jumping later
            z: clampedZ,
            rotationY: rotationY
        });
    }
}


// --- DOM Manipulation Helpers ---
// ... existing addChatMessageToDOM, addActivityToDOM ...
function addChatMessageToDOM(message) {
    if (!message) return; // Skip if message is null (deleted)

    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');
    if (message.clientId === room.clientId) {
        messageElement.classList.add('own-message');
    }

    const avatar = document.createElement('img');
    avatar.src = message.avatarUrl || 'https://via.placeholder.com/30';
    avatar.alt = `${message.username}'s avatar`;
    avatar.classList.add('user-avatar');

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content-wrapper'); // Optional wrapper if needed

    const authorSpan = document.createElement('div');
    authorSpan.classList.add('message-author');
    authorSpan.textContent = message.username;

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message-content');
    messageDiv.textContent = message.text;

    contentDiv.appendChild(authorSpan);
    contentDiv.appendChild(messageDiv);

    messageElement.appendChild(avatar);
    messageElement.appendChild(contentDiv);

    chatMessages.appendChild(messageElement);
}

function addActivityToDOM(activity) {
    if (!activity) return; // Skip if activity is null (deleted)

    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = activity.avatarUrl || 'https://via.placeholder.com/20'; // Fallback avatar
    img.alt = `${activity.username}'s avatar`;
    img.classList.add('user-avatar');

    li.appendChild(img);
    li.appendChild(document.createTextNode(` ${activity.text}`)); // Add space after avatar
    activityList.appendChild(li);
}


// --- Start the application ---
initialize();