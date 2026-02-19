
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

let builderId: string | null = null;
let moved = false;
let attempts = 0;

socket.on('connect', () => {
    console.log('Connected to server');
    // Start a custom game immediately
    socket.emit('createCustomGame', { mapType: 'random', botCount: 0, difficulty: 1 });
});

socket.on('gameStarted', (data: any) => {
    console.log('Game started', data);
});

socket.on('unitsData', (units: any[]) => {
    const builder = units.find(u => u.type === 'builder' && u.ownerId === socket.id);
    if (builder) {
        if (!builderId) {
            console.log(`Builder found: ${builder.id} at ${builder.x}, ${builder.y}`);
            builderId = builder.id;
            // Try to move immediately
            triggerMove(builder);
        } else if (moved) {
            // Check if it actually moved
            console.log(`Builder updated: ${builder.x.toFixed(1)}, ${builder.y.toFixed(1)}`);
        }
    }
});

function triggerMove(builder: any) {
    attempts++;
    // Try different directions based on attempt
    // 1: +X, 2: -X, 3: +Y, 4: -Y
    let dx = 0;
    let dy = 0;
    
    if (attempts === 1) dx = 40;
    else if (attempts === 2) dx = -40;
    else if (attempts === 3) dy = 40;
    else if (attempts === 4) dy = -40;
    else {
        // Random
        dx = (Math.random() - 0.5) * 80;
        dy = (Math.random() - 0.5) * 80;
    }

    const targetX = builder.x + dx;
    const targetY = builder.y + dy; 
    
    console.log(`[Attempt ${attempts}] Moving builder ${builder.id} to ${targetX.toFixed(1)}, ${targetY.toFixed(1)} (dx=${dx}, dy=${dy})`);
    
    socket.emit('move', {
        unitIds: [builder.id],
        x: targetX,
        y: targetY
    });
    
    moved = true;

    // Retry if not successful after a bit
    if (attempts < 10) {
        setTimeout(() => {
             triggerMove({ id: builderId, x: targetX, y: targetY }); // Naive update
        }, 2000);
    } else {
        console.log('Finished attempts');
        process.exit(0);
    }
}

// Handle errors
socket.on('connect_error', (err) => {
    console.error('Connection error:', err);
    process.exit(1);
});

// Keep alive for a bit
setTimeout(() => {
    console.log('Timeout reached');
    process.exit(0);
}, 15000);
