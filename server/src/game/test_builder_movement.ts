import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

let mapData: any = null;
let hasAttemptedMove = false;
let builderId: string | null = null;
let startPos: { x: number, y: number } | null = null;

console.log('Starting Builder Movement Test...');

socket.on('connect', () => {
    console.log('Connected to server. Creating Custom Game...');
    socket.emit('createCustomGame', { mapType: 'random', botCount: 0, difficulty: 1 });
});

socket.on('mapData', (data: any) => {
    mapData = data;
    // console.log('Map data received.');
});

socket.on('unitsData', (units: any[]) => {
    if (!mapData) return;

    const myUnits = units.filter((u: any) => u.ownerId === socket.id);
    const builder = myUnits.find((u: any) => u.type === 'builder');

    if (builder) {
        if (!builderId) {
            builderId = builder.id;
            startPos = { x: builder.x, y: builder.y };
            console.log(`Builder found at ${builder.x.toFixed(1)}, ${builder.y.toFixed(1)}`);
            
            // Find the base and island
            let base: any = null;
            let baseIsland: any = null;

            if (mapData && mapData.islands) {
                for (const island of mapData.islands) {
                    const foundBase = island.buildings.find((b: any) => b.type === 'base' && b.ownerId === socket.id);
                    if (foundBase) {
                        base = foundBase;
                        baseIsland = island;
                        break;
                    }
                }
            }

            if (base && baseIsland) {
                console.log(`Base found on Island ${baseIsland.id} at ${base.x}, ${base.y}`);
            } else {
                console.log('Base not found (or map data not ready).');
            }

            // Move Logic
            if (!hasAttemptedMove) {
                hasAttemptedMove = true;
                
                // Move 100px to the right (simple test)
                const targetX = builder.x + 100;
                const targetY = builder.y;
                
                console.log(`Attempting to move builder to ${targetX.toFixed(1)}, ${targetY.toFixed(1)}`);
                
                socket.emit('move', {
                    unitIds: [builder.id],
                    x: targetX,
                    y: targetY
                });

                // Schedule check
                setTimeout(() => {
                    checkResult();
                }, 2000);
            }
        } else {
            // Tracking movement
            if (hasAttemptedMove && startPos) {
                const targetX = startPos.x + 100;
                const targetY = startPos.y;
                const dx = targetX - builder.x;
                const dy = targetY - builder.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 5) {
                    console.log(`✅ Builder reached target at (${Math.round(builder.x)}, ${Math.round(builder.y)})!`);
                }
            }
        }
    }
});

function checkResult() {
    console.log('Test Finished. (Manual verification: Check logs above for movement updates)');
    process.exit(0);
}

socket.on('connect_error', (err: any) => {
    console.error('Connection Error:', err);
    process.exit(1);
});

// Safety Timeout
setTimeout(() => {
    console.log('Test Timeout.');
    process.exit(0);
}, 10000);
