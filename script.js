const socket = io(); // Assuming Socket.IO for real-time communication
let localStream = null;
let peerConnections = {};
let editor = null; // Placeholder for Monaco/Ace editor
let isHost = false;
let roomId = null;
let userId = generateUUID();
let whiteboard = null;

// Utility Functions
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Authentication
document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    // Simulated authentication (replace with real OAuth)
    socket.emit('authenticate', { email, password }, (response) => {
        if (response.success) {
            document.getElementById('auth-section').style.display = 'none';
            document.getElementById('home-section').style.display = 'block';
            document.getElementById('login-btn').style.display = 'none';
            document.getElementById('logout-btn').style.display = 'block';
        } else {
            alert('Authentication failed');
        }
    });
});

document.getElementById('google-auth').addEventListener('click', () => {
    // Implement Google OAuth
    alert('Google OAuth not implemented');
});

document.getElementById('logout-btn').addEventListener('click', () => {
    socket.emit('logout');
    document.getElementById('auth-section').style.display = 'block';
    document.getElementById('home-section').style.display = 'none';
    document.getElementById('login-btn').style.display = 'block';
    document.getElementById('logout-btn').style.display = 'none';
});

// Room Creation
document.getElementById('create-room-btn').addEventListener('click', () => {
    document.getElementById('home-section').style.display = 'none';
    document.getElementById('create-room-section').style.display = 'block';
});

document.getElementById('create-room-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const roomName = document.getElementById('room-name').value;
    const roomType = document.getElementById('room-type').value;
    const roomPassword = document.getElementById('room-password').value;
    isHost = true;
    socket.emit('create-room', {
        name: roomName,
        type: roomType,
        password: roomType === 'private' ? roomPassword : null
    }, (response) => {
        if (response.success) {
            roomId = response.roomId;
            joinRoom(roomId);
        } else {
            alert('Failed to create room');
        }
    });
});

document.getElementById('room-type').addEventListener('change', (e) => {
    const isPrivate = e.target.value === 'private';
    document.getElementById('room-password-label').style.display = isPrivate ? 'block' : 'none';
    document.getElementById('room-password').style.display = isPrivate ? 'block' : 'none';
});

// Join Room
document.getElementById('join-room-btn').addEventListener('click', () => {
    document.getElementById('home-section').style.display = 'none';
    document.getElementById('rooms-section').style.display = 'block';
    socket.emit('get-rooms');
});

socket.on('room-list', (rooms) => {
    const roomList = document.getElementById('room-list');
    roomList.innerHTML = '';
    rooms.forEach(room => {
        const roomCard = document.createElement('div');
        roomCard.className = 'room-card';
        roomCard.innerHTML = `
            <h3>${room.name}</h3>
            <p>Type: ${room.type}</p>
            <button onclick="promptJoinRoom('${room.id}', '${room.type}')">Join</button>
        `;
        roomList.appendChild(roomCard);
    });
});

window.promptJoinRoom = (id, type) => {
    if (type === 'private') {
        const password = prompt('Enter room password:');
        socket.emit('join-room', { roomId: id, password, userId }, handleJoinResponse);
    } else {
        socket.emit('join-room', { roomId: id, userId }, handleJoinResponse);
    }
};

function handleJoinResponse(response) {
    if (response.success) {
        roomId = response.roomId;
        isHost = response.isHost;
        joinRoom(roomId);
    } else {
        alert('Failed to join room: ' + response.message);
    }
}

function joinRoom(id) {
    document.getElementById('rooms-section').style.display = 'none';
    document.getElementById('room-section').style.display = 'block';
    document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
    document.getElementById('participant-management').style.display = isHost ? 'block' : 'none';
    initRoom();
}

// Room Initialization
async function initRoom() {
    // WebRTC Setup
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('host-video').srcObject = isHost ? localStream : null;
    } catch (err) {
        console.error('Media access error:', err);
    }

    // Initialize Code Editor (Simulated - Replace with Monaco/Ace)
    editor = document.getElementById('editor');
    editor.addEventListener('paste', (e) => e.preventDefault()); // Disable paste

    // Initialize Whiteboard
    whiteboard = document.getElementById('whiteboard');
    const ctx = whiteboard.getContext('2d');
    let isDrawing = false;

    whiteboard.addEventListener('mousedown', (e) => {
        isDrawing = true;
        ctx.beginPath();
        ctx.moveTo(e.offsetX, e.offsetY);
    });

    whiteboard.addEventListener('mousemove', (e) => {
        if (isDrawing) {
            ctx.lineTo(e.offsetX, e.offsetY);
            ctx.stroke();
            socket.emit('whiteboard-draw', { x: e.offsetX, y: e.offsetY, roomId });
        }
    });

    whiteboard.addEventListener('mouseup', () => {
        isDrawing = false;
        ctx.closePath();
    });

    socket.on('whiteboard-draw', (data) => {
        ctx.lineTo(data.x, data.y);
        ctx.stroke();
    });

    // Initialize WebRTC
    socket.on('user-joined', (user) => {
        if (isHost) {
            const peer = createPeerConnection(user.id);
            peerConnections[user.id] = peer;
            localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
        }
    });

    socket.on('offer', async ({ offer, from }) => {
        const peer = createPeerConnection(from);
        peerConnections[from] = peer;
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('answer', { answer, to: from, roomId });
    });

    socket.on('answer', async ({ answer, from }) => {
        await peerConnections[from].setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('ice-candidate', async ({ candidate, from }) => {
        if (peerConnections[from]) {
            await peerConnections[from].addIceCandidate(new RTCIceCandidate(candidate));
        }
    });
}

function createPeerConnection(userId) {
    const peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peer.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit('ice-candidate', { candidate: e.candidate, to: userId, roomId });
        }
    };

    peer.ontrack = (e) => {
        const video = document.createElement('video');
        video.autoplay = true;
        video.srcObject = e.streams[0];
        video.id = `video-${userId}`;
        document.getElementById('participant-videos').appendChild(video);
    };

    return peer;
}

// Host Controls
document.getElementById('start-session').addEventListener('click', () => {
    socket.emit('start-session', roomId);
});

document.getElementById('end-session').addEventListener('click', () => {
    socket.emit('end-session', roomId);
    leaveRoom();
});

document.getElementById('toggle-video').addEventListener('click', () => {
    socket.emit('toggle-video', roomId);
});

document.getElementById('toggle-chat').addEventListener('click', () => {
    socket.emit('toggle-chat', roomId);
});

document.getElementById('record-session').addEventListener('click', () => {
    // Implement recording (requires server-side support)
    alert('Recording feature not implemented');
});

document.getElementById('schedule-session').addEventListener('click', () => {
    document.getElementById('schedule-modal').style.display = 'flex';
});

// Code Editor
document.getElementById('run-code').addEventListener('click', () => {
    const code = editor.value;
    socket.emit('run-code', { code, roomId }, (response) => {
        alert('Code execution result: ' + response.output);
    });
});

document.getElementById('submit-code').addEventListener('click', () => {
    if (!isHost) {
        const code = editor.value;
        socket.emit('submit-code', { code, roomId, userId });
    }
});

socket.on('code-submission', ({ code, userId: submitterId }) => {
    if (isHost) {
        const modal = document.getElementById('code-review-modal');
        document.getElementById('submitted-code').textContent = code;
        modal.style.display = 'flex';
        document.getElementById('submit-feedback').onclick = () => {
            const feedback = document.getElementById('feedback-input').value;
            socket.emit('code-feedback', { feedback, userId: submitterId, roomId });
            modal.style.display = 'none';
        };
    }
});

socket.on('code-feedback', ({ feedback }) => {
    alert('Feedback from host: ' + feedback);
});

document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('code-review-modal').style.display = 'none';
});

// Video Controls
document.getElementById('toggle-mic').addEventListener('click', () => {
    if (localStream) {
        const enabled = localStream.getAudioTracks()[0].enabled;
        localStream.getAudioTracks()[0].enabled = !enabled;
    }
});

document.getElementById('toggle-cam').addEventListener('click', () => {
    if (localStream) {
        const enabled = localStream.getVideoTracks()[0].enabled;
        localStream.getVideoTracks()[0].enabled = !enabled;
    }
});

// Chat
document.getElementById('send-message').addEventListener('click', () => {
    const message = document.getElementById('chat-input').value;
    if (message.trim()) {
        socket.emit('chat-message', { message, roomId, userId });
        document.getElementById('chat-input').value = '';
    }
});

document.getElementById('private-message-btn').addEventListener('click', () => {
    const recipient = prompt('Enter recipient user ID:');
    const message = document.getElementById('chat-input').value;
    if (message.trim() && recipient) {
        socket.emit('private-message', { message, roomId, to: recipient, from: userId });
        document.getElementById('chat-input').value = '';
    }
});

socket.on('chat-message', ({ message, from }) => {
    const chat = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.textContent = `${from}: ${message}`;
    chat.appendChild(msgDiv);
    chat.scrollTop = chat.scrollHeight;
});

socket.on('private-message', ({ message, from }) => {
    const chat = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.textContent = `Private from ${from}: ${message}`;
    chat.appendChild(msgDiv);
    chat.scrollTop = chat.scrollHeight;
});

// Participant Management
socket.on('update-participants', (participants) => {
    const list = document.getElementById('participant-list');
    list.innerHTML = '';
    participants.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `
            ${p.id} 
            <button onclick="muteParticipant('${p.id}')">Mute</button>
            <button onclick="kickParticipant('${p.id}')">Kick</button>
        `;
        list.appendChild(li);
    });
});

window.muteParticipant = (id) => {
    socket.emit('mute-participant', { userId: id, roomId });
};

window.kickParticipant = (id) => {
    socket.emit('kick-participant', { userId: id, roomId });
};

socket.on('muted', () => {
    if (localStream) {
        localStream.getAudioTracks()[0].enabled = false;
    }
});

socket.on('kicked', () => {
    alert('You have been kicked from the room');
    leaveRoom();
});

// Schedule Session
document.getElementById('schedule-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('session-date').value;
    const time = document.getElementById('session-time').value;
    socket.emit('schedule-session', { roomId, date, time });
    document.getElementById('schedule-modal').style.display = 'none';
});

document.getElementById('close-schedule').addEventListener('click', () => {
    document.getElementById('schedule-modal').style.display = 'none';
});

socket.on('session-scheduled', ({ date, time }) => {
    alert(`Session scheduled for ${date} at ${time}`);
});

// Screen Sharing
function startScreenShare() {
    if (isHost) {
        navigator.mediaDevices.getDisplayMedia({ video: true }).then(stream => {
            const video = document.getElementById('host-video');
            video.srcObject = stream;
            stream.getVideoTracks()[0].onended = () => {
                video.srcObject = localStream;
            };
            Object.values(peerConnections).forEach(peer => {
                stream.getTracks().forEach(track => peer.addTrack(track, stream));
            });
        }).catch(err => console.error('Screen share error:', err));
    }
}

// Leave Room
function leaveRoom() {
    Object.values(peerConnections).forEach(peer => peer.close());
    peerConnections = {};
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    document.getElementById('room-section').style.display = 'none';
    document.getElementById('home-section').style.display = 'block';
    socket.emit('leave-room', { roomId, userId });
}

// Handle Socket Events
socket.on('session-started', () => {
    if (!isHost) {
        editor.removeAttribute('readonly');
    }
});

socket.on('session-ended', () => {
    leaveRoom();
});

socket.on('video-toggled', (enabled) => {
    document.getElementById('participant-videos').style.display = enabled ? 'block' : 'none';
});

socket.on('chat-toggled', (enabled) => {
    document.getElementById('chat-container').style.display = enabled ? 'block' : 'none';
});