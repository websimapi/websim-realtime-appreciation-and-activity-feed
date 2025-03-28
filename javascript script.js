import * as C from './config.js';
// Import THREE only if needed directly in this file, otherwise handled by SceneManager
// import * as THREE from 'three';
// Removed OrbitControls import, now handled by scene.js
import { SceneManager } from './scene.js'; // Import the new SceneManager

const room = new WebsimSocket();

// Existing DOM Elements
const heartIcon = document.getElementById('heart-icon');
const heartCount = document.getElementById('heart-count');
const activityList = document.getElementById('activity-list');
const chatMessages = document.getElementById('chat-messages');
const chatInputField = document.getElementById('chat-input-field');
const sendButton = document.getElementById('send-button');
const userList = document.getElementById('user-list');

// 3D/Audio Elements
const canvas = document.getElementById('webgl-canvas');
const soundButton = document.getElementById('sound-button');

let localHeartClicks = 0;
const MAX_ACTIVITY_ITEMS = C.MAX_ACTIVITY_ITEMS;
const MAX_CHAT_MESSAGES = C.MAX_CHAT_MESSAGES;

// --- 3D Scene Variables ---
// Moved to SceneManager: scene, camera, renderer, controls, groundPlane, playerModels, clock
let sceneManager; // Instance of the SceneManager class
const keyboardState = {}; // Track pressed keys

// --- Audio Variables ---
let audioContext;
let oscillator;
let gainNode;

// --- Initialization ---
async function initialize() {
    // Initialize 3D Scene using SceneManager
    sceneManager = new SceneManager(canvas);
    sceneManager.init();

    // Initialize Audio
    initAudio();

    // Initialize Websim Room
    await room.initialize();

    // Initialize own presence with position and color
    room.updatePresence({
        x: Math.random() * 10 - 5, // Start in a small random area
        y: C.PLAYER_HEIGHT / 2, // Start slightly above ground
        z: Math.random() * 10 - 5,
        rotationY: Math.random() * Math.PI * 2,
        color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}` // Assign random color, ensure 6 digits
    });

    // Initialize room state if it doesn't exist
    if (room.roomState.heartClicks === undefined) {
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
    room.subscribePresence(handlePresenceUpdate); // This will now handle adding/updating models via SceneManager

    // Add initial join activity (after presence is set and peer info is available)
    // Use a slight delay to ensure peer data is likely populated
    setTimeout(() => {
         if(room.peers[room.clientId]) {
             logActivity(`${room.peers[room.clientId].username} joined.`);
         }
    }, 500);


    // Start 3D animation loop
    animate();
}

// --- 3D Scene Setup ---
// Function `initThreeJS` removed - logic moved to SceneManager
// Function `createPlayerModel` removed - logic moved to SceneManager


// --- 3D Animation Loop ---
// Variable `clock` removed - managed by SceneManager
function animate() {
    requestAnimationFrame(animate);
    // const delta = clock.getDelta(); // Delta time now handled within SceneManager.update()

    handleMovement(); // Process local player movement based on keyboard state & update presence
    sceneManager.update(); // Update and render the scene (handles controls, animations, rendering)
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
    if (newState.heartClicks !== undefined && newState.heartClicks !== room.roomState.heartClicks) {
        updateHeartDisplay(newState.heartClicks);
    }
    // Update Chat
    if (newState.chatHistory && newState.chatHistory !== room.roomState.chatHistory) { // Basic check for changes
        renderChatHistory();
    }
    // Update Activity
    if (newState.activityLog && newState.activityLog !== room.roomState.activityLog) { // Basic check for changes
        renderActivityLog();
    }
}

function handlePresenceUpdate(newPresence) {
    updateUserList(); // Update connected user list UI

    const currentClientIds = Object.keys(newPresence);
    const knownModelIds = sceneManager ? Object.keys(playerModels) : []; // playerModels is now internal to sceneManager

    // Use Set for efficient lookup
    const currentClientIdsSet = new Set(currentClientIds);

    // Add/Update players using SceneManager
    currentClientIds.forEach(clientId => {
        const playerData = newPresence[clientId];
        if (sceneManager && playerData) { // Ensure sceneManager is initialized
             sceneManager.addOrUpdatePlayer(clientId, playerData);
        }
    });

    // Remove players who left using SceneManager
    const modelsToRemove = Object.keys(playerModels).filter(id => !currentClientIdsSet.has(id));
    modelsToRemove.forEach(clientId => {
        if (sceneManager) { // Ensure sceneManager is initialized
            const peerUsername = room.peers[clientId]?.username || 'Someone';
            logActivity(`${peerUsername} left.`); // Log leaving
            sceneManager.removePlayer(clientId);
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
    const scrollBefore = chatMessages.scrollHeight - chatMessages.scrollTop; // Preserve scroll unless near bottom
    const isScrolledToBottom = scrollBefore < chatMessages.clientHeight + 50; // Tolerance

    chatMessages.innerHTML = ''; // Clear existing messages
    const history = room.roomState.chatHistory || {};
    const sortedMessages = Object.values(history)
        .filter(msg => msg) // Filter out null/deleted messages
        .sort((a, b) => a.timestamp - b.timestamp); // Sort by timestamp ASC

    sortedMessages.slice(-MAX_CHAT_MESSAGES).forEach(addChatMessageToDOM); // Display latest N messages

    if (isScrolledToBottom) {
        chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
    } else {
         chatMessages.scrollTop = chatMessages.scrollHeight - scrollBefore; // Restore scroll position
    }
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
    heartIcon.style.transform = `scale(${1 + Math.min(currentTotalClicks * 0.01, 1) + 0.1})`; // Apply scale based on new count + bump
    setTimeout(() => {
        // Reset transition for next click scaling
        heartIcon.style.transition = 'transform 0.2s ease-in-out';
        updateHeartDisplay(room.roomState.heartClicks || currentTotalClicks); // Ensure sync after animation based on actual state
    }, 100);

    // Update shared state
    room.updateRoomState({
        heartClicks: currentTotalClicks
    });

    // Log activity (only log once per session threshold to avoid spam)
    if (localHeartClicks === 1 || localHeartClicks % 5 === 0) { // Log first click and every 5th
         if(room.peers[room.clientId]) {
            logActivity(`${room.peers[room.clientId].username} showed appreciation! ❤️`);
         }
    }
}

function sendChatMessage() {
    const messageText = chatInputField.value.trim();
    if (!messageText || !room.peers[room.clientId]) return;

    const messageId = `msg-${room.clientId}-${Date.now()}`;
    const newMessage = {
        id: messageId,
        clientId: room.clientId,
        username: room.peers[room.clientId].username,
        avatarUrl: room.peers[room.clientId].avatarUrl,
        text: messageText,
        timestamp: Date.now()
    };

    // Use functional update for room state if necessary to avoid race conditions,
    // but simple update is usually fine here.
    const currentChatHistory = room.roomState.chatHistory || {};
    room.updateRoomState({
        chatHistory: {
            ...currentChatHistory,
            [messageId]: newMessage
        }
    });

    // Log chat activity
    logActivity(`${newMessage.username} sent a message.`);

    chatInputField.value = ''; // Clear input field
    // Optionally re-render immediately for local user
    // addChatMessageToDOM(newMessage);
    // chatMessages.scrollTop = chatMessages.scrollHeight;
    // Note: The subscription will trigger a re-render anyway
}

function logActivity(text) {
    if (!room.clientId || !room.peers[room.clientId]) {
        console.warn("Cannot log activity, client info not ready.");
        return;
    }
    const activityId = `act-${room.clientId}-${Date.now()}`;
    const currentUser = room.peers[room.clientId];
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
    const activityEntries = Object.entries(updatedActivityLog).filter(([, act]) => act); // Filter out null entries
    if (activityEntries.length > MAX_ACTIVITY_ITEMS) {
        // Sort by timestamp ASC to find the oldest
        activityEntries.sort(([, a], [, b]) => a.timestamp - b.timestamp);
        const oldestActivityId = activityEntries[0][0]; // Get the ID (key) of the oldest
        updatedActivityLog[oldestActivityId] = null; // Set to null to remove
    }


    room.updateRoomState({ activityLog: updatedActivityLog });
     // Optionally re-render immediately for local user
    // addActivityToDOM(newActivity);
    // Note: The subscription will trigger a re-render anyway
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

// Debounce presence updates to avoid overwhelming the network
let lastPresenceUpdateTime = 0;
const PRESENCE_UPDATE_INTERVAL = 1000 / 20; // Target ~20 updates per second

function handleMovement() {
    // We need deltaTime for consistent movement speed
    const deltaTime = sceneManager.clock.getDelta(); // Get delta from SceneManager's clock

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
        // Move forward along the current direction vector (cos(angle) for Z, sin(angle) for X)
        dx += Math.sin(rotationY) * moveDistance;
        dz += Math.cos(rotationY) * moveDistance;
        moved = true;
    }
    if (keyboardState['KeyS'] || keyboardState['ArrowDown']) {
         // Move backward along the current direction vector
        dx -= Math.sin(rotationY) * moveDistance;
        dz -= Math.cos(rotationY) * moveDistance;
        moved = true;
    }

    if (moved) {
        const newX = currentPresence.x + dx;
        const newZ = currentPresence.z + dz;

        // Boundary check (optional, based on plane size) - adjust if needed
        const maxCoord = 490; // Slightly less than half plane size
        const clampedX = Math.max(-maxCoord, Math.min(maxCoord, newX));
        const clampedZ = Math.max(-maxCoord, Math.min(maxCoord, newZ));

        // Check if enough time has passed since the last update
        const now = performance.now();
        if (now - lastPresenceUpdateTime > PRESENCE_UPDATE_INTERVAL) {
            room.updatePresence({
                // Only send updated fields to minimize data transfer
                x: clampedX,
                z: clampedZ,
                rotationY: rotationY
                // Note: y and color are not updated here, they are set initially
                // or via other means if needed. Websim merges updates.
            });
            lastPresenceUpdateTime = now;

             // Also update the local model immediately for responsiveness,
             // even though the subscription will update it again shortly.
             // The sceneManager lerps, so this is less critical, but good practice.
             if (sceneManager && playerModels[room.clientId]) {
                 const localModel = playerModels[room.clientId];
                 localModel.position.set(clampedX, currentPresence.y, clampedZ);
                 localModel.rotation.y = rotationY;
                 localModel.userData.moving = true; // Set moving flag for animation
             }
        }
    } else {
         // Ensure the moving flag is false if no keys are pressed
         if (sceneManager && playerModels[room.clientId]) {
             playerModels[room.clientId].userData.moving = false;
         }
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
    contentDiv.classList.add('message-content-wrapper');

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