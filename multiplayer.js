// multiplayer.js
// Libreria client per il multiplayer WebSocket (stanze, broadcast, stato)
const Multiplayer = (function () {
    // ---------- variabili private ----------
    let ws = null;
    let isConnected = false;
    let myPlayerId = null;
    let currentRoom = null;
    let currentPlayerName = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 5;
    let reconnectTimer = null;
    let debugMode = false;
    let autoReconnect = true;

    // Eventi registrati
    const eventHandlers = {
        connected: [],
        disconnected: [],
        players: [],
        playerJoined: [],
        playerLeft: [],
        state: [],
        action: [],
        ready: [],
        error: []
    };

    // ---------- funzioni interne ----------
    function log(...args) {
        if (debugMode) console.log('[MP]', ...args);
    }

    function emit(event, ...data) {
        if (eventHandlers[event]) {
            eventHandlers[event].forEach(fn => fn(...data));
        } else {
            log('Evento sconosciuto:', event);
        }
    }

    function handleMessage(msg) {
        try {
            const data = JSON.parse(msg);
            log('📨 Ricevuto:', data);
            switch (data.type) {
                case 'connected':
                    myPlayerId = data.playerId;
                    currentRoom = data.room;
                    currentPlayerName = data.playerName;
                    isConnected = true;
                    emit('connected', data);
                    break;
                case 'players':
                    emit('players', data.players);
                    break;
                case 'playerJoined':
                    emit('playerJoined', data.player);
                    break;
                case 'playerLeft':
                    emit('playerLeft', data.playerId);
                    break;
                case 'state':
                    emit('state', data.state);
                    break;
                case 'action':
                    emit('action', data.playerId, data.action, data.data);
                    break;
                case 'ready':
                    emit('ready', data.playerId, data.ready);
                    break;
                case 'error':
                    emit('error', data.message);
                    break;
                case 'disconnected':
                    isConnected = false;
                    emit('disconnected');
                    break;
                default:
                    log('Tipo messaggio non gestito:', data.type);
            }
        } catch (e) {
            log('Errore nel parsing del messaggio:', e);
        }
    }

    function connectWebSocket(serverUrl, options) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            log('Già connesso, disconnessione prima di riconnettere.');
            ws.close();
        }

        ws = new WebSocket(serverUrl);

        ws.onopen = () => {
            log('WebSocket aperto, invio handshake');
            reconnectAttempts = 0;
            // Invia i dati di connessione
            const payload = {
                type: 'connect',
                playerName: options.playerName || 'Anonimo',
                room: options.room || 'default'
            };
            ws.send(JSON.stringify(payload));
        };

        ws.onmessage = (event) => {
            handleMessage(event.data);
        };

        ws.onclose = (event) => {
            log('WebSocket chiuso', event.code, event.reason);
            isConnected = false;
            emit('disconnected');
            if (autoReconnect && reconnectAttempts < MAX_RECONNECT) {
                reconnectAttempts++;
                const delay = Math.min(1000 * reconnectAttempts, 10000);
                log(`Tentativo di riconnessione ${reconnectAttempts} tra ${delay}ms`);
                clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(() => {
                    connectWebSocket(serverUrl, options);
                }, delay);
            } else if (reconnectAttempts >= MAX_RECONNECT) {
                emit('error', 'Riconnessione fallita dopo troppi tentativi');
            }
        };

        ws.onerror = (err) => {
            log('Errore WebSocket:', err);
            emit('error', 'Errore di connessione');
        };
    }

    // ---------- API pubblica ----------
    return {
        /**
         * Inizializza la libreria (configura opzioni)
         * @param {Object} opts - { server: 'ws://...', autoConnect: false, debug: false }
         */
        init(opts = {}) {
            debugMode = opts.debug || false;
            autoReconnect = opts.autoConnect !== undefined ? opts.autoConnect : true;
            // Non connette subito, aspetta che l'utente chiami .connect()
            log('Multiplayer inizializzato con opzioni:', opts);
            if (opts.autoConnect) {
                // Se autoConnect è true, cerca di connettere subito con le opzioni passate
                this.connect(opts);
            }
        },

        /**
         * Connette al server WebSocket
         * @param {Object} opts - { playerName, room, server? }
         */
        connect(opts = {}) {
            const server = opts.server || (window.MP_SERVER || 'ws://localhost:8080');
            const playerName = opts.playerName || 'Anonimo';
            const room = opts.room || 'default';

            if (ws && ws.readyState === WebSocket.OPEN) {
                log('Già connesso, se vuoi riconnettere chiama .leave() prima.');
                return;
            }

            // Chiudi eventuale connessione pendente
            if (ws) {
                ws.close();
                ws = null;
            }

            connectWebSocket(server, { playerName, room });
        },

        /**
         * Abbandona la stanza e chiude la connessione
         */
        leave() {
            autoReconnect = false; // impedisce la riconnessione automatica
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'leave' }));
                ws.close();
            } else if (ws) {
                ws.close();
            }
            ws = null;
            isConnected = false;
            myPlayerId = null;
            currentRoom = null;
            clearTimeout(reconnectTimer);
            emit('disconnected');
        },

        /**
         * Invia un'azione generica a tutti i giocatori nella stanza
         * @param {string} action - nome azione (es. 'risposta', 'attacco')
         * @param {*} data - dati aggiuntivi
         */
        sendAction(action, data = {}) {
            if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
                log('Impossibile inviare azione: non connesso');
                return;
            }
            const payload = {
                type: 'action',
                action: action,
                data: data
            };
            ws.send(JSON.stringify(payload));
        },

        /**
         * Invia lo stato del gioco (sincronizzato con tutti)
         * @param {*} state - stato da condividere
         */
        sendState(state) {
            if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
                log('Impossibile inviare stato: non connesso');
                return;
            }
            const payload = {
                type: 'state',
                state: state
            };
            ws.send(JSON.stringify(payload));
        },

        /**
         * Imposta lo stato "pronto" del giocatore
         * @param {boolean} ready
         */
        setReady(ready) {
            if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
                log('Impossibile impostare ready: non connesso');
                return;
            }
            const payload = {
                type: 'ready',
                ready: ready
            };
            ws.send(JSON.stringify(payload));
        },

        /**
         * Registra un listener per un evento
         * Eventi: connected, disconnected, players, playerJoined, playerLeft, state, action, ready, error
         */
        on(event, callback) {
            if (eventHandlers[event]) {
                eventHandlers[event].push(callback);
            } else {
                log('Evento non supportato:', event);
            }
        },

        /**
         * Rimuove un listener
         */
        off(event, callback) {
            if (eventHandlers[event]) {
                const idx = eventHandlers[event].indexOf(callback);
                if (idx !== -1) eventHandlers[event].splice(idx, 1);
            }
        },

        // Getter per lo stato
        get isConnected() { return isConnected; },
        get playerId() { return myPlayerId; },
        get room() { return currentRoom; },
        get playerName() { return currentPlayerName; },
    };
})();

// Esporta nel globale
if (typeof window !== 'undefined') {
    window.Multiplayer = Multiplayer;
}
