const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Constants
const ROUND_RESOLUTION_DELAY = 1500;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 6;

let rooms = {};

/**
 * Fisher-Yates shuffle - unbiased randomization
 */
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Generate a shuffled 52-card deck
 */
function generateDeck() {
    const suits = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
    const ranks = [
        {n:'A',v:1}, {n:'2',v:2}, {n:'3',v:3}, {n:'4',v:4}, {n:'5',v:5},
        {n:'6',v:6}, {n:'7',v:7}, {n:'8',v:8}, {n:'9',v:9}, {n:'10',v:10},
        {n:'J',v:11}, {n:'Q',v:12}, {n:'K',v:13}
    ];
    let deck = [];
    suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r.n, val: r.v })));
    return shuffle(deck);
}

/**
 * Broadcast current room list to all clients
 */
const broadcastRooms = () => {
    const list = Object.keys(rooms).map(id => ({
        id, 
        count: rooms[id].players.length, 
        max: rooms[id].maxPlayers
    }));
    io.emit('roomList', list);
};

/**
 * Find the next active player (with cards in hand)
 */
function getNextActivePlayer(room, startIdx) {
    let nextIdx = startIdx;
    let attempts = 0;
    
    do {
        nextIdx = (nextIdx + 1) % room.players.length;
        attempts++;
        
        // Prevent infinite loop if no active players
        if (attempts >= room.players.length) {
            return -1;
        }
    } while (room.players[nextIdx].hand.length === 0);
    
    return nextIdx;
}

/**
 * Health check endpoint for Render
 */
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        rooms: Object.keys(rooms).length,
        uptime: process.uptime()
    });
});

/**
 * Main socket connection handler
 */
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    broadcastRooms();

    /**
     * SESSION RECONNECTION
     * Check if user was in a room and reconnect them
     */
    socket.on('checkSession', ({ userID }) => {
        if (!userID) return;
        
        for (let rid in rooms) {
            let pIdx = rooms[rid].players.findIndex(p => p.userID === userID);
            if (pIdx !== -1) {
                rooms[rid].players[pIdx].id = socket.id;
                socket.join(rid);
                socket.emit('reconnectSuccess', { 
                    roomID: rid, 
                    players: rooms[rid].players, 
                    turn: rooms[rid].turn, 
                    table: rooms[rid].table,
                    discarded: rooms[rid].discarded,
                    gameStarted: rooms[rid].gameStarted,
                    isFirstMove: rooms[rid].isFirstMove,
                    currentSuit: rooms[rid].currentSuit,
                    resolving: rooms[rid].resolving || false
                });
                console.log(`User ${userID} reconnected to room ${rid}`);
                return;
            }
        }
    });

    /**
     * CLOSE ROOM
     * Host can disband the room
     */
    socket.on('requestCloseRoom', ({ roomID }) => {
        if (!roomID || !rooms[roomID]) return;
        
        // Notify all players
        io.to(roomID).emit('roomClosed');
        
        // Remove all sockets from the room
        io.in(roomID).socketsLeave(roomID);
        
        // Delete room from memory
        delete rooms[roomID];
        
        // Update lobby
        broadcastRooms();
        console.log(`Room ${roomID} disbanded.`);
    });

    /**
     * CREATE ROOM
     * Initialize a new game room
     */
    socket.on('createRoom', ({ roomID, playerName, maxPlayers, userID }) => {
        // Validation
        if (!roomID || !playerName || !userID) {
            return socket.emit('errorMsg', 'Missing required fields');
        }
        
        if (rooms[roomID]) {
            return socket.emit('errorMsg', 'Room ID already exists!');
        }
        
        const max = parseInt(maxPlayers);
        if (isNaN(max) || max < MIN_PLAYERS || max > MAX_PLAYERS) {
            return socket.emit('errorMsg', `Max players must be ${MIN_PLAYERS}-${MAX_PLAYERS}`);
        }
        
        // Create room
        rooms[roomID] = {
            id: roomID, 
            maxPlayers: max,
            players: [{ 
                id: socket.id, 
                name: playerName, 
                userID: userID, 
                hand: [] 
            }],
            turn: 0, 
            table: [], 
            currentSuit: null, 
            isFirstMove: true, 
            discarded: [], 
            gameStarted: false,
            resolving: false // NEW: Prevent plays during resolution
        };
        
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players);
        broadcastRooms();
        console.log(`Room ${roomID} created by ${playerName}`);
    });

    /**
     * JOIN ROOM
     * Add player to existing room
     */
    socket.on('joinRoom', ({ roomID, playerName, userID }) => {
        // Validation
        if (!roomID || !playerName || !userID) {
            return socket.emit('errorMsg', 'Missing required fields');
        }
        
        const room = rooms[roomID];
        if (!room) {
            return socket.emit('errorMsg', 'Room not found!');
        }
        
        // Check if player is reconnecting
        let existing = room.players.find(p => p.userID === userID);
        if (existing) {
            existing.id = socket.id;
            socket.join(roomID);
            console.log(`${playerName} rejoined room ${roomID}`);
        } else {
            // New player
            if (room.players.length >= room.maxPlayers) {
                return socket.emit('errorMsg', 'Room full!');
            }
            
            if (room.gameStarted) {
                return socket.emit('errorMsg', 'Game already in progress!');
            }
            
            room.players.push({ 
                id: socket.id, 
                name: playerName, 
                userID: userID, 
                hand: [] 
            });
            socket.join(roomID);
            console.log(`${playerName} joined room ${roomID}`);
        }
        
        io.to(roomID).emit('updatePlayers', room.players);
        broadcastRooms();
    });

    /**
     * START GAME
     * Deal cards and begin the duel
     */
    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        
        if (room.players.length < MIN_PLAYERS) {
            return socket.emit('errorMsg', `Need at least ${MIN_PLAYERS} players to start`);
        }
        
        room.gameStarted = true;
        room.resolving = false;
        room.table = [];
        room.currentSuit = null;
        
        let deck = generateDeck();
        room.discarded = [];

        // Cultivation Rule: Remove Aces for 5-6 players
        if (room.players.length === 5 || room.players.length === 6) {
            const discardCount = room.players.length === 5 ? 2 : 4;
            let aceIndices = [];
            deck.forEach((card, idx) => { 
                if (card.rank === 'A') aceIndices.push(idx); 
            });
            
            // Randomly select aces to remove
            shuffle(aceIndices);
            let toRemove = aceIndices.slice(0, discardCount).sort((a, b) => b - a);
            toRemove.forEach(idx => { 
                room.discarded.push(deck.splice(idx, 1)[0]); 
            });
        }

        // Deal cards evenly
        let cardsPerPlayer = Math.floor(deck.length / room.players.length);
        room.players.forEach(p => { 
            p.hand = deck.splice(0, cardsPerPlayer); 
        });

        // Find player with King of Spades
        let starterIdx = room.players.findIndex(p => 
            p.hand.some(c => c.suit === 'Spades' && c.rank === 'K')
        );
        
        room.turn = starterIdx !== -1 ? starterIdx : 0;
        room.isFirstMove = true;
        
        io.to(roomID).emit('gameInit', { 
            players: room.players, 
            turn: room.turn, 
            discarded: room.discarded,
            isFirstMove: room.isFirstMove
        });
        
        console.log(`Game started in room ${roomID}. ${room.players[room.turn].name} has K♠`);
    });

    /**
     * HAND SWAP - Send Request
     * Request to absorb next player's hand
     */
    socket.on('sendSwapRequest', ({ roomID, fromUserID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const myIdx = room.players.findIndex(p => p.userID === fromUserID);
        if (myIdx === -1) {
            return socket.emit('errorMsg', 'Player not found');
        }
        
        // Find next player with cards
        let targetIdx = (myIdx + 1) % room.players.length;
        let attempts = 0;
        
        while (room.players[targetIdx].hand.length === 0 && attempts < room.players.length) {
            targetIdx = (targetIdx + 1) % room.players.length;
            attempts++;
        }
        
        if (attempts >= room.players.length) {
            return socket.emit('errorMsg', 'No valid target for hand absorption');
        }
        
        io.to(room.players[targetIdx].id).emit('receiveSwapRequest', { 
            fromName: room.players[myIdx].name, 
            fromUserID 
        });
        
        console.log(`${room.players[myIdx].name} requests to absorb ${room.players[targetIdx].name}'s hand`);
    });

    /**
     * HAND SWAP - Accept Request
     * Target player accepts absorption
     */
    socket.on('acceptSwap', ({ roomID, fromUserID, myUserID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const requester = room.players.find(p => p.userID === fromUserID);
        const accepter = room.players.find(p => p.userID === myUserID);
        
        if (!requester || !accepter) {
            return socket.emit('errorMsg', 'Invalid swap participants');
        }
        
        // Requester absorbs accepter's hand
        requester.hand.push(...accepter.hand);
        accepter.hand = [];
        
        io.to(roomID).emit('swapOccurred', { 
            msg: `${requester.name} absorbed ${accepter.name}'s hand!`,
            requesterUserID: requester.userID,
            accepterUserID: accepter.userID,
            requesterName: requester.name,
            accepterName: accepter.name,
            players: room.players,
            turn: room.turn,
            table: room.table
        });
        
        console.log(`${requester.name} absorbed ${accepter.name}'s hand`);
    });

    /**
     * PLAY CARD
     * Core game logic
     */
    socket.on('playCard', ({ roomID, cardObject }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        // Prevent plays during round resolution
        if (room.resolving) {
            return socket.emit('errorMsg', 'Round is being resolved, please wait...');
        }
        
        // Validate it's player's turn
        if (room.players[room.turn].id !== socket.id) {
            return socket.emit('errorMsg', 'Not your turn!');
        }

        const player = room.players[room.turn];
        const cardIndex = player.hand.findIndex(c => 
            c.suit === cardObject.suit && c.rank === cardObject.rank
        );
        
        if (cardIndex === -1) {
            return socket.emit('errorMsg', 'Card not found in hand');
        }
        
        const playedCard = player.hand[cardIndex];

        // RULE 1: First move MUST be King of Spades
        if (room.isFirstMove) {
            if (playedCard.suit !== 'Spades' || playedCard.rank !== 'K') {
                return socket.emit('errorMsg', "First move MUST be King of Spades!");
            }
            room.isFirstMove = false;
        }

        // RULE 2: Must follow suit if possible (Pangkah detection)
        if (room.table.length > 0 && playedCard.suit !== room.currentSuit) {
            if (player.hand.some(c => c.suit === room.currentSuit)) {
                return socket.emit('errorMsg', `Must follow suit: ${room.currentSuit}`);
            }
        }

        // Play the card
        player.hand.splice(cardIndex, 1);
        room.table.push({ 
            playerIdx: room.turn, 
            playerName: player.name, 
            card: playedCard 
        });
        
        // Set lead suit if first card
        if (room.table.length === 1) {
            room.currentSuit = playedCard.suit;
        }

        io.to(roomID).emit('updateTable', { 
            table: room.table, 
            turn: room.turn, 
            players: room.players,
            currentSuit: room.currentSuit
        });

        // Determine if Pangkah occurred
        let isPangkah = playedCard.suit !== room.currentSuit;
        
        // Count active players (those with cards OR who just played their last card this round)
        let playersInRound = room.players.filter(p => 
            p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p))
        ).length;
        
        // Check if round is complete (everyone who should play has played)
        let activePlayers = room.players.filter(p => p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p)));
        let roundComplete = room.table.length >= activePlayers.length;

        if (isPangkah || roundComplete) {
            // Lock the room to prevent more plays
            room.resolving = true;
            
            // Resolve the round after delay
            setTimeout(() => {
                // Find winner (highest card of lead suit)
                let winnerIdx = -1;
                let highVal = -1;
                
                room.table.forEach(t => {
                    if (t.card.suit === room.currentSuit && t.card.val > highVal) {
                        highVal = t.card.val;
                        winnerIdx = t.playerIdx;
                    }
                });
                
                // Fallback: if no one played lead suit (shouldn't happen)
                if (winnerIdx === -1) {
                    winnerIdx = room.table[0].playerIdx;
                    console.warn('Warning: No player played lead suit!');
                }
                
                // Handle round outcome
                if (isPangkah) {
                    // Pangkah: winner takes all cards
                    room.players[winnerIdx].hand.push(...room.table.map(t => t.card));
                } else {
                    // Clean round: discard all cards
                    room.discarded.push(...room.table.map(t => t.card));
                }
                
                // Check for game over
                let survivors = room.players.filter(p => p.hand.length > 0);
                
                if (survivors.length <= 1) {
                    io.to(roomID).emit('gameOver', { 
                        loser: survivors[0]?.name || 'None',
                        loserUserID: survivors[0]?.userID || null
                    });
                    
                    console.log(`Game over in room ${roomID}. Loser: ${survivors[0]?.name || 'None'}`);
                    
                    // Reset room for potential restart instead of deleting
                    room.gameStarted = false;
                    room.resolving = false;
                    room.table = [];
                    room.currentSuit = null;
                    room.isFirstMove = true;
                    
                    broadcastRooms();
                } else {
                    // Continue game - find next active player
                    // If winner has no cards, find next player with cards
                    if (room.players[winnerIdx].hand.length === 0) {
                        room.turn = getNextActivePlayer(room, winnerIdx);
                    } else {
                        room.turn = winnerIdx;
                    }
                    
                    room.table = [];
                    room.currentSuit = null;
                    room.resolving = false;
                    
                    io.to(roomID).emit('clearTable', { 
                        turn: room.turn, 
                        winner: room.players[winnerIdx].name, 
                        players: room.players,
                        discarded: room.discarded,
                        msg: isPangkah ? "Pangkah!" : "Clean"
                    });
                }
            }, ROUND_RESOLUTION_DELAY);
        } else {
            // Move to next active player
            let nextIdx = getNextActivePlayer(room, room.turn);
            
            if (nextIdx === -1) {
                console.error('No active players found!');
                return;
            }
            
            room.turn = nextIdx;
            io.to(roomID).emit('nextTurn', { 
                turn: room.turn, 
                players: room.players, 
                table: room.table,
                currentSuit: room.currentSuit
            });
        }
    });

    /**
     * DISCONNECT HANDLER
     * Clean up when player disconnects
     */
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // Optional: Mark player as disconnected but keep them in game
        // for potential reconnection via checkSession
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎴 Pangkah Server active on port ${PORT}`));
