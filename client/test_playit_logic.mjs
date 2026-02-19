
import { io } from "socket.io-client";

async function testConnection() {
    console.log("--- Starting Connection Test ---");

    // 1. Simulate Parsing Logic
    const testInputs = [
        { input: "PLAYIT:localhost:3001", expected: "http://localhost:3001" },
        { input: "ws://localhost:3001", expected: "ws://localhost:3001" },
        { input: "localhost:3001", expected: "http://localhost:3001" }
    ];

    for (const test of testInputs) {
        let targetUrl = test.input;
        
        // Logic from socket.ts
        if (test.input.startsWith('PLAYIT:')) {
            const parts = test.input.split(':');
            targetUrl = `http://${parts[1]}:${parts[2]}`;
        } else if (!test.input.startsWith('http') && !test.input.startsWith('ws')) {
             if (test.input.includes(':')) {
                 targetUrl = `http://${test.input}`;
             }
        }
        
        console.log(`Input: ${test.input} -> Parsed: ${targetUrl}`);
        
        // 2. Test Real Connection
        if (targetUrl.includes('localhost:3001')) {
            console.log(`Attempting connection to ${targetUrl}...`);
            const socket = io(targetUrl, {
                transports: ['websocket', 'polling'],
                reconnection: false
            });

            await new Promise((resolve) => {
                socket.on('connect', () => {
                    console.log(`✅ Connected successfully to ${targetUrl}`);
                    socket.disconnect();
                    resolve();
                });
                
                socket.on('connect_error', (err) => {
                    console.error(`❌ Connection failed: ${err.message}`);
                    resolve();
                });
                
                setTimeout(() => {
                    if (!socket.connected) {
                        console.error('❌ Timeout');
                        socket.disconnect();
                        resolve();
                    }
                }, 2000);
            });
        }
    }
    console.log("--- Test Finished ---");
}

testConnection();
