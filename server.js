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
const MAX_PLAYERS = 10;

// Fate configuration: how many aces to discard per player count
const FATE_CONFIG = {
    4: 0,   // 52 cards / 4 = 13 each, 0 leftover
    5: 2,   // 52 cards / 5 = 10 each, 2 leftover -> discard 2 random aces
    6: 4,   // 52 cards / 6 = 8 each, 4 leftover -> discard all 4 aces
    7: 3,   // 52 cards / 7 = 7 each, 3 leftover -> discard 3 random aces
    8: 4,   // 52 cards / 8 = 6 each, 4 leftover -> discard all 4 aces
    10: 2   // 52 cards / 10 = 5 each, 2 leftover -> discard 2 random aces
};

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
        max: rooms[id].maxPlayers,
        inGame: rooms[id].gameStarted
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
        
        if (attempts >= room.players.length) {
            return -1;
        }
    } while (room.players[nextIdx].hand.length === 0);
    
    return nextIdx;
}

/**
 * Initialize player game stats for a new game
 */
function initPlayerGameStats(player) {
    player.gameStats = {
        pangkahsDealt: 0,      // Times they pangkah'd someone
        pangkahsReceived: 0,   // Times they got pangkah'd
        cleanWins: 0,          // Clean rounds they won
        cardsPlayed: 0,        // Total cards played
        perfectRounds: 0,      // Rounds where they played optimally
        comebacks: 0,          // Times they recovered from 15+ cards
        hadMostCards: false,   // At some point had most cards
        finishPosition: 0      // Final position (1st, 2nd, etc.)
    };
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
                    fateAces: rooms[rid].fateAces || [],
                    gameStarted: rooms[rid].gameStarted,
                    isFirstMove: rooms[rid].isFirstMove,
                    currentSuit: rooms[rid].currentSuit,
                    resolving: rooms[rid].resolving || false,
                    gameNumber: rooms[rid].gameNumber || 1
                });
                console.log(`User ${userID} reconnected to room ${rid}`);
                return;
            }
        }
    });

    /**
     * CLOSE ROOM
     */
    socket.on('requestCloseRoom', ({ roomID }) => {
        if (!roomID || !rooms[roomID]) return;
        
        io.to(roomID).emit('roomClosed');
        io.in(roomID).socketsLeave(roomID);
        delete rooms[roomID];
        broadcastRooms();
        console.log(`Room ${roomID} disbanded.`);
    });

    /**
     * CREATE ROOM
     */
    socket.on('createRoom', ({ roomID, playerName, maxPlayers, userID, equippedTitle, level }) => {
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
        
        rooms[roomID] = {
            id: roomID, 
            maxPlayers: max,
            players: [{ 
                id: socket.id, 
                name: playerName, 
                userID: userID, 
                hand: [],
                equippedTitle: equippedTitle || null,
                level: level || 1,
                gameStats: null,
                rematchReady: false
            }],
            turn: 0, 
            table: [], 
            currentSuit: null, 
            isFirstMove: true, 
            discarded: [],
            fateAces: [],
            gameStarted: false,
            resolving: false,
            gameNumber: 0,
            finishOrder: []
        };
        
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players);
        broadcastRooms();
        console.log(`Room ${roomID} created by ${playerName}`);
    });

    /**
     * JOIN ROOM
     */
    socket.on('joinRoom', ({ roomID, playerName, userID, equippedTitle, level }) => {
        if (!roomID || !playerName || !userID) {
            return socket.emit('errorMsg', 'Missing required fields');
        }
        
        const room = rooms[roomID];
        if (!room) {
            return socket.emit('errorMsg', 'Room not found!');
        }
        
        let existing = room.players.find(p => p.userID === userID);
        if (existing) {
            existing.id = socket.id;
            existing.equippedTitle = equippedTitle || existing.equippedTitle;
            existing.level = level || existing.level || 1;
            socket.join(roomID);
            console.log(`${playerName} rejoined room ${roomID}`);
        } else {
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
                hand: [],
                equippedTitle: equippedTitle || null,
                level: level || 1,
                gameStats: null,
                rematchReady: false
            });
            socket.join(roomID);
            console.log(`${playerName} joined room ${roomID}`);
        }
        
        io.to(roomID).emit('updatePlayers', room.players);
        broadcastRooms();
    });

    /**
     * UPDATE EQUIPPED TITLE
     */
    socket.on('updateTitle', ({ roomID, userID, title }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const player = room.players.find(p => p.userID === userID);
        if (player) {
            player.equippedTitle = title;
            io.to(roomID).emit('updatePlayers', room.players);
        }
    });

    /**
     * START GAME
     */
    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const playerCount = room.players.length;
        
        if (playerCount < MIN_PLAYERS) {
            return socket.emit('errorMsg', `Need at least ${MIN_PLAYERS} players to start`);
        }
        
        // Check if player count is valid (has a fate config)
        if (FATE_CONFIG[playerCount] === undefined) {
            return socket.emit('errorMsg', `Cannot start with ${playerCount} players. Valid: 4, 5, 6, 7, 8, or 10 players.`);
        }
        
        room.gameStarted = true;
        room.resolving = false;
        room.table = [];
        room.currentSuit = null;
        room.gameNumber = (room.gameNumber || 0) + 1;
        room.finishOrder = [];
        
        // Reset rematch flags
        room.players.forEach(p => {
            p.rematchReady = false;
            initPlayerGameStats(p);
        });
        
        let deck = generateDeck();
        room.discarded = [];
        room.fateAces = []; // Separate array for initial discarded aces

        // Fate Rule: Remove Aces based on player count
        const discardCount = FATE_CONFIG[playerCount];
        if (discardCount > 0) {
            let aceIndices = [];
            deck.forEach((card, idx) => { 
                if (card.rank === 'A') aceIndices.push(idx); 
            });
            
            shuffle(aceIndices);
            let toRemove = aceIndices.slice(0, discardCount).sort((a, b) => b - a);
            toRemove.forEach(idx => { 
                room.fateAces.push(deck.splice(idx, 1)[0]); 
            });
        }

        // Deal cards evenly
        let cardsPerPlayer = Math.floor(deck.length / playerCount);
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
            fateAces: room.fateAces,
            isFirstMove: room.isFirstMove,
            gameNumber: room.gameNumber
        });
        
        console.log(`Game #${room.gameNumber} started in room ${roomID} with ${playerCount} players. ${room.players[room.turn].name} has K♠`);
    });

    /**
     * REMATCH - Player ready
     */
    socket.on('rematchReady', ({ roomID, userID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const player = room.players.find(p => p.userID === userID);
        if (player) {
            player.rematchReady = true;
            
            // Check if all players are ready
            const allReady = room.players.every(p => p.rematchReady);
            
            io.to(roomID).emit('rematchStatus', {
                readyCount: room.players.filter(p => p.rematchReady).length,
                totalCount: room.players.length,
                allReady
            });
            
            // Auto-start if all ready
            if (allReady) {
                setTimeout(() => {
                    if (rooms[roomID]) {
                        socket.emit('startGame', roomID);
                    }
                }, 1000);
            }
        }
    });

    /**
     * HAND SWAP - Send Request
     */
    socket.on('sendSwapRequest', ({ roomID, fromUserID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const myIdx = room.players.findIndex(p => p.userID === fromUserID);
        if (myIdx === -1) {
            return socket.emit('errorMsg', 'Player not found');
        }
        
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
     */
    socket.on('acceptSwap', ({ roomID, fromUserID, myUserID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const requester = room.players.find(p => p.userID === fromUserID);
        const accepter = room.players.find(p => p.userID === myUserID);
        
        if (!requester || !accepter) {
            return socket.emit('errorMsg', 'Invalid swap participants');
        }
        
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
     * PLAY CARD - Core game logic
     */
    socket.on('playCard', ({ roomID, cardObject }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        if (room.resolving) {
            return socket.emit('errorMsg', 'Round is being resolved, please wait...');
        }
        
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

        // RULE 2: Must follow suit if possible
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
        
        // Track stats
        if (player.gameStats) {
            player.gameStats.cardsPlayed++;
        }
        
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
        
        // Track pangkah stats
        if (isPangkah && player.gameStats) {
            player.gameStats.pangkahsDealt++;
        }
        
        // Count active players
        let activePlayers = room.players.filter(p => 
            p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p))
        );
        let roundComplete = room.table.length >= activePlayers.length;

        if (isPangkah || roundComplete) {
            room.resolving = true;
            
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
                
                if (winnerIdx === -1) {
                    winnerIdx = room.table[0].playerIdx;
                    console.warn('Warning: No player played lead suit!');
                }
                
                const winner = room.players[winnerIdx];
                
                // Handle round outcome
                if (isPangkah) {
                    // Track comeback potential
                    const cardsBefore = winner.hand.length;
                    
                    winner.hand.push(...room.table.map(t => t.card));
                    
                    // Track stats
                    if (winner.gameStats) {
                        winner.gameStats.pangkahsReceived++;
                        
                        // Check for most cards
                        const maxCards = Math.max(...room.players.map(p => p.hand.length));
                        if (winner.hand.length === maxCards && winner.hand.length >= 15) {
                            winner.gameStats.hadMostCards = true;
                        }
                    }
                } else {
                    // Clean round
                    room.discarded.push(...room.table.map(t => t.card));
                    
                    if (winner.gameStats) {
                        winner.gameStats.cleanWins++;
                    }
                }
                
                // Check for game over
                let survivors = room.players.filter(p => p.hand.length > 0);
                
                // Track finish order
                room.players.forEach((p, idx) => {
                    if (p.hand.length === 0 && !room.finishOrder.includes(p.userID)) {
                        room.finishOrder.push(p.userID);
                        p.gameStats.finishPosition = room.finishOrder.length;
                        
                        // Check for comeback achievement
                        if (p.gameStats.hadMostCards && p.gameStats.finishPosition <= 2) {
                            p.gameStats.comebacks++;
                        }
                    }
                });
                
                if (survivors.length <= 1) {
                    // Game over - mark loser
                    if (survivors[0]) {
                        survivors[0].gameStats.finishPosition = room.players.length;
                        room.finishOrder.push(survivors[0].userID);
                    }
                    
                    // Calculate performance bonuses for each player
                    const performanceData = room.players.map(p => ({
                        userID: p.userID,
                        name: p.name,
                        position: p.gameStats.finishPosition,
                        stats: p.gameStats,
                        equippedTitle: p.equippedTitle
                    }));
                    
                    io.to(roomID).emit('gameOver', { 
                        loser: survivors[0]?.name || 'None',
                        loserUserID: survivors[0]?.userID || null,
                        finishOrder: room.finishOrder,
                        performanceData,
                        gameNumber: room.gameNumber
                    });
                    
                    console.log(`Game #${room.gameNumber} over in room ${roomID}. Loser: ${survivors[0]?.name || 'None'}`);
                    
                    room.gameStarted = false;
                    room.resolving = false;
                    room.table = [];
                    room.currentSuit = null;
                    room.isFirstMove = true;
                    
                    broadcastRooms();
                } else {
                    // Continue game
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
                        winner: winner.name,
                        winnerUserID: winner.userID,
                        players: room.players,
                        fateAces: room.fateAces,
                        msg: isPangkah ? "Pangkah!" : "Clean"
                    });
                }
            }, ROUND_RESOLUTION_DELAY);
        } else {
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
     * EMOTE HANDLER
     */
    socket.on('sendEmote', ({ roomID, userID, playerName, emoji }) => {
        if (!roomID) return;
        // Broadcast emote to all players in room except sender
        socket.to(roomID).emit('receiveEmote', { userID, playerName, emoji });
    });

    /**
     * DISCONNECT HANDLER
     */
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎴 Pangkah Server v2 active on port ${PORT}`));
