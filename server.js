// server.js - Versione per Render
const WebSocket = require('ws');
const http = require('http');

// ---------- Configurazione ----------
const PORT = process.env.PORT || 8080; // Render assegna una porta automaticamente

// ---------- Stato del server ----------
const rooms = {};
const playerMap = {};
let nextId = 1;

function generateId() {
    return (nextId++).toString(36);
}

function getRoomPlayers(roomId) {
    if (!rooms[roomId]) return {};
    return rooms[roomId].players || {};
}

function broadcastToRoom(roomId, message, excludeWs = null) {
    const room = rooms[roomId];
    if (!room) return;
    const players = room.players;
    for (const pid in players) {
        const p = players[pid];
        if (p.ws && p.ws !== excludeWs && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify(message));
        }
    }
}

function removePlayer(playerId) {
    const p = playerMap[playerId];
    if (!p) return;
    const roomId = p.room;
    const room = rooms[roomId];
    if (room) {
        delete room.players[playerId];
        if (Object.keys(room.players).length === 0) {
            delete rooms[roomId];
        } else {
            broadcastToRoom(roomId, {
                type: 'playerLeft',
                playerId: playerId
            }, p.ws);
            broadcastToRoom(roomId, {
                type: 'players',
                players: room.players
            });
        }
    }
    delete playerMap[playerId];
}

// ---------- Crea server HTTP ----------
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
    } else {
        res.writeHead(404);
        res.end();
    }
});

// ---------- WebSocket Server ----------
const wss = new WebSocket.Server({ server });

// IMPORTANTE: Permetti connessioni da qualsiasi dominio (CORS per WebSocket)
wss.on('headers', (headers) => {
    headers.push('Access-Control-Allow-Origin: *');
});

wss.on('connection', (ws, req) => {
    console.log(`[${new Date().toISOString()}] Nuova connessione`);

    let currentPlayerId = null;
    let currentRoomId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log(`[${new Date().toISOString()}] Messaggio:`, data.type);

            switch (data.type) {
                case 'connect': {
                    const playerName = data.playerName || 'Anonimo';
                    const roomId = data.room || 'default';

                    if (currentPlayerId && playerMap[currentPlayerId]) {
                        removePlayer(currentPlayerId);
                    }

                    if (!rooms[roomId]) {
                        rooms[roomId] = { players: {} };
                    }
                    const room = rooms[roomId];

                    const playerId = generateId();
                    const player = {
                        id: playerId,
                        name: playerName,
                        ready: false,
                        ws: ws,
                        room: roomId
                    };
                    room.players[playerId] = player;
                    playerMap[playerId] = player;
                    currentPlayerId = playerId;
                    currentRoomId = roomId;

                    ws.send(JSON.stringify({
                        type: 'connected',
                        playerId: playerId,
                        playerName: playerName,
                        room: roomId,
                        players: room.players
                    }));

                    broadcastToRoom(roomId, {
                        type: 'playerJoined',
                        player: { id: playerId, name: playerName, ready: false }
                    }, ws);

                    broadcastToRoom(roomId, {
                        type: 'players',
                        players: room.players
                    });

                    console.log(`[${new Date().toISOString()}] ${playerName} (${playerId}) è entrato in stanza ${roomId}`);
                    break;
                }

                case 'leave': {
                    if (currentPlayerId) {
                        const name = playerMap[currentPlayerId]?.name || '?';
                        removePlayer(currentPlayerId);
                        console.log(`[${new Date().toISOString()}] ${name} ha lasciato`);
                        currentPlayerId = null;
                        currentRoomId = null;
                    }
                    ws.close();
                    break;
                }

                case 'action': {
                    if (!currentPlayerId || !currentRoomId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Non in una stanza' }));
                        return;
                    }
                    broadcastToRoom(currentRoomId, {
                        type: 'action',
                        playerId: currentPlayerId,
                        action: data.action,
                        data: data.data || {}
                    }, ws);
                    break;
                }

                case 'state': {
                    if (!currentPlayerId || !currentRoomId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Non in una stanza' }));
                        return;
                    }
                    broadcastToRoom(currentRoomId, {
                        type: 'state',
                        state: data.state || {}
                    }, ws);
                    break;
                }

                case 'ready': {
                    if (!currentPlayerId || !currentRoomId) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Non in una stanza' }));
                        return;
                    }
                    const ready = data.ready === true;
                    const p = playerMap[currentPlayerId];
                    if (p) {
                        p.ready = ready;
                        broadcastToRoom(currentRoomId, {
                            type: 'ready',
                            playerId: currentPlayerId,
                            ready: ready
                        });
                        const room = rooms[currentRoomId];
                        if (room) {
                            broadcastToRoom(currentRoomId, {
                                type: 'players',
                                players: room.players
                            });
                        }
                    }
                    break;
                }

                default:
                    ws.send(JSON.stringify({ type: 'error', message: 'Tipo sconosciuto' }));
            }
        } catch (err) {
            console.error('Errore parsing:', err);
            ws.send(JSON.stringify({ type: 'error', message: 'JSON invalido' }));
        }
    });

    ws.on('close', () => {
        if (currentPlayerId) {
            const name = playerMap[currentPlayerId]?.name || '?';
            console.log(`[${new Date().toISOString()}] ${name} ha chiuso la connessione`);
            removePlayer(currentPlayerId);
        }
    });

    ws.on('error', (err) => {
        console.error('Errore WebSocket:', err);
    });
});

// Avvia il server
server.listen(PORT, () => {
    console.log(`🚀 Server multiplayer in ascolto sulla porta ${PORT}`);
});