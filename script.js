import * as C from './config.js';

const room = new WebsimSocket();

const heartIcon = document.getElementById('heart-icon');
const heartCount = document.getElementById('heart-count');
const activityList = document.getElementById('activity-list');
const chatMessages = document.getElementById('chat-messages');
const chatInputField = document.getElementById('chat-input-field');
const sendButton = document.getElementById('send-button');
const userList = document.getElementById('user-list');

let localHeartClicks = 0;
const MAX_ACTIVITY_ITEMS = C.MAX_ACTIVITY_ITEMS;
const MAX_CHAT_MESSAGES = C.MAX_CHAT_MESSAGES;

// --- Initialization ---
async function initialize() {
    await room.initialize();

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
    updateUserList();


    // --- Event Listeners ---
    heartIcon.addEventListener('click', handleHeartClick);
    sendButton.addEventListener('click', sendChatMessage);
    chatInputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });

    // --- Subscriptions ---
    room.subscribeRoomState(handleRoomStateUpdate);
    room.subscribePresence(handlePresenceUpdate);

    // Add initial join activity
    logActivity(`${room.peers[room.clientId].username} joined.`);
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
    updateUserList();
    // Could add join/leave messages to activity here if needed,
    // but currently handling joins in initialize and leaves via peer detection below
}

// --- UI Update Functions ---

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
        userList.appendChild(li);
    });
}

// --- Action Handlers ---

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
    const newActivity = {
        id: activityId,
        clientId: room.clientId, // Store who triggered the activity
        username: room.peers[room.clientId].username,
        avatarUrl: room.peers[room.clientId].avatarUrl,
        text: text,
        timestamp: Date.now()
    };

     // Add new activity
    let updatedActivityLog = {
        ...room.roomState.activityLog,
        [activityId]: newActivity
    };

    // Prune old activities if exceeding max count
    const activityKeys = Object.keys(updatedActivityLog);
    if (activityKeys.length > MAX_ACTIVITY_ITEMS) {
        // Find the oldest activity based on timestamp
        const sortedActivities = Object.values(updatedActivityLog)
                                      .filter(act => act)
                                      .sort((a, b) => a.timestamp - b.timestamp);
        const oldestActivityId = sortedActivities[0].id;
         // Set the oldest activity to null to remove it
         updatedActivityLog[oldestActivityId] = null;
    }

    room.updateRoomState({ activityLog: updatedActivityLog });
}


// --- DOM Manipulation Helpers ---

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

