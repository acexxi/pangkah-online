const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ====================================
// MONGODB CONNECTION
// ====================================
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    })
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB connection error:', err));
} else {
    console.log('⚠️  No MONGODB_URI found, running without database');
}

// Constants
const ROUND_RESOLUTION_DELAY = 1500;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const TURN_TIMER_SECONDS = 15;

// Fate configuration: how many aces to discard per player count
const FATE_CONFIG = {
    4: 0,   // 52 cards / 4 = 13 each, 0 leftover
    5: 2,   // 52 cards / 5 = 10 each, 2 leftover -> discard 2 random aces
    6: 4,   // 52 cards / 6 = 8 each, 4 leftover -> discard all 4 aces
    7: 3,   // 52 cards / 7 = 7 each, 3 leftover -> discard 3 random aces
    8: 4,   // 52 cards / 8 = 6 each, 4 leftover -> discard all 4 aces
    10: 2   // 52 cards / 10 = 5 each, 2 leftover -> discard 2 random aces
};

// ====================================
// MONGODB SCHEMAS
// ====================================

// Player Stats Schema
const PlayerStatsSchema = new mongoose.Schema({
    userID: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    stats: {
        version: { type: Number, default: 1 },
        xp: { type: Number, default: 0 },
        pangkahs: { type: Number, default: 0 },
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        games: { type: Number, default: 0 },
        currentStreak: { type: Number, default: 0 },
        bestStreak: { type: Number, default: 0 },
        handsAbsorbed: { type: Number, default: 0 },
        cardsPlayed: { type: Number, default: 0 },
        secondPlace: { type: Number, default: 0 },
        thirdPlace: { type: Number, default: 0 },
        topTwo: { type: Number, default: 0 },
        nightGames: { type: Number, default: 0 },
        uniquePlayers: { type: [String], default: [] },
        unlockedTitles: { type: [String], default: [] },
        equippedTitle: { type: String, default: '' },
        maxCardsHeld: { type: Number, default: 0 },
        pangkahsReceived: { type: Number, default: 0 },
        cleanWins: { type: Number, default: 0 },
        handsGiven: { type: Number, default: 0 },
        autoPlays: { type: Number, default: 0 }
    },
    isGM: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastPlayed: { type: Date, default: Date.now }
});

const PlayerStats = mongoose.model('PlayerStats', PlayerStatsSchema);

// Game History Schema
const GameHistorySchema = new mongoose.Schema({
    roomID: { type: String, required: true },
    players: [{
        userID: String,
        name: String,
        finalPosition: Number,
        cardsRemaining: Number
    }],
    winner: {
        userID: String,
        name: String
    },
    totalRounds: { type: Number, default: 0 },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    duration: { type: Number } // in seconds
});

const GameHistory = mongoose.model('GameHistory', GameHistorySchema);

// ====================================
// MONGODB HELPER FUNCTIONS
// ====================================

/**
 * Load player stats from database
 */
async function loadPlayerStats(userID) {
    if (!MONGODB_URI) return null;
    
    try {
        let player = await PlayerStats.findOne({ userID });
        if (!player) {
            // Create new player with default stats
            player = new PlayerStats({
                userID,
                name: 'Player',
                stats: {
                    version: 1,
                    xp: 0,
                    pangkahs: 0,
                    wins: 0,
                    losses: 0,
                    games: 0,
                    currentStreak: 0,
                    bestStreak: 0,
                    handsAbsorbed: 0,
                    cardsPlayed: 0,
                    secondPlace: 0,
                    thirdPlace: 0,
                    topTwo: 0,
                    nightGames: 0,
                    uniquePlayers: [],
                    unlockedTitles: [],
                    equippedTitle: '',
                    maxCardsHeld: 0,
                    pangkahsReceived: 0,
                    cleanWins: 0,
                    handsGiven: 0,
                    autoPlays: 0
                }
            });
            await player.save();
            console.log(`📊 New player created: ${userID}`);
        }
        return player.stats;
    } catch (err) {
        console.error('Error loading stats:', err);
        return null;
    }
}

/**
 * Save player stats to database
 */
async function savePlayerStats(userID, name, stats) {
    if (!MONGODB_URI) return;
    
    try {
        await PlayerStats.findOneAndUpdate(
            { userID },
            { 
                name,
                stats,
                lastPlayed: new Date()
            },
            { upsert: true, new: true }
        );
        console.log(`💾 Stats saved for ${name}`);
    } catch (err) {
        console.error('Error saving stats:', err);
    }
}

/**
 * Save game history to database
 */
async function saveGameHistory(room, winner, duration) {
    if (!MONGODB_URI) return;
    
    try {
        const gameHistory = new GameHistory({
            roomID: room.roomID,
            players: room.players.map((p, idx) => ({
                userID: p.userID,
                name: p.name,
                finalPosition: idx + 1,
                cardsRemaining: p.hand.length
            })),
            winner: {
                userID: winner.userID,
                name: winner.name
            },
            totalRounds: room.roundNumber || 0,
            startTime: room.startTime || new Date(),
            endTime: new Date(),
            duration
        });
        await gameHistory.save();
        console.log(`📜 Game history saved for room ${room.roomID}`);
    } catch (err) {
        console.error('Error saving game history:', err);
    }
}

/**
 * Check if user is Game Master
 */
async function checkGameMaster(userID) {
    if (!MONGODB_URI) return false;
    
    try {
        const player = await PlayerStats.findOne({ userID });
        return player?.isGM || false;
    } catch (err) {
        console.error('Error checking GM status:', err);
        return false;
    }
}

/**
 * Set Game Master status (requires correct password)
 */
async function setGameMaster(userID, password) {
    const GM_PASSWORD = process.env.GM_PASSWORD || 'pangkah_gm_2024';
    
    if (password !== GM_PASSWORD) {
        return { success: false, message: 'Invalid password' };
    }
    
    try {
        await PlayerStats.findOneAndUpdate(
            { userID },
            { isGM: true },
            { upsert: true }
        );
        console.log(`👑 GM status granted to ${userID}`);
        return { success: true, message: 'GM status granted' };
    } catch (err) {
        console.error('Error setting GM:', err);
        return { success: false, message: 'Database error' };
    }
}

/**
 * Get leaderboard
 */
async function getLeaderboard(sortBy = 'xp', limit = 10) {
    if (!MONGODB_URI) return [];
    
    try {
        const sort = {};
        sort[`stats.${sortBy}`] = -1;
        
        const players = await PlayerStats
            .find({})
            .sort(sort)
            .limit(limit)
            .select('userID name stats.xp stats.wins stats.games stats.pangkahs isGM');
        
        return players.map(p => ({
            userID: p.userID,
            name: p.name,
            xp: p.stats.xp,
            wins: p.stats.wins,
            games: p.stats.games,
            pangkahs: p.stats.pangkahs,
            level: p.isGM ? '∞' : Math.floor(p.stats.xp / 100) + 1,
            isGM: p.isGM
        }));
    } catch (err) {
        console.error('Error getting leaderboard:', err);
        return [];
    }
}

let rooms = {};
let turnTimers = {}; // Store turn timers per room

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
 * Clear turn timer for a room
 */
function clearTurnTimer(roomID) {
    if (turnTimers[roomID]) {
        clearTimeout(turnTimers[roomID].timeout);
        clearInterval(turnTimers[roomID].interval);
        delete turnTimers[roomID];
    }
}

/**
 * Start turn timer for current player
 */
function startTurnTimer(roomID) {
    const room = rooms[roomID];
    if (!room || !room.gameStarted) return;
    
    // Clear existing timer
    clearTurnTimer(roomID);
    
    const player = room.players[room.turn];
    if (!player || player.hand.length === 0) return;
    
    let timeLeft = TURN_TIMER_SECONDS;
    
    // Emit initial timer
    io.to(roomID).emit('turnTimer', { timeLeft, playerIdx: room.turn });
    
    // Countdown interval
    turnTimers[roomID] = {
        interval: setInterval(() => {
            timeLeft--;
            io.to(roomID).emit('turnTimer', { timeLeft, playerIdx: room.turn });
            if (timeLeft <= 0) {
                clearInterval(turnTimers[roomID]?.interval);
            }
        }, 1000),
        timeout: setTimeout(() => {
            autoPlayCard(roomID);
        }, TURN_TIMER_SECONDS * 1000)
    };
}

/**
 * Auto-play card when timer expires
 */
function autoPlayCard(roomID) {
    // Clear the timer first to stop any more timer events
    clearTurnTimer(roomID);
    
    const room = rooms[roomID];
    if (!room || room.resolving) return;
    
    const currentTurn = room.turn;
    const player = room.players[currentTurn];
    if (!player || player.hand.length === 0) return;
    
    let cardToPlay = null;
    
    // First move - must play King of Spades
    if (room.isFirstMove) {
        cardToPlay = player.hand.find(c => c.suit === 'Spades' && c.rank === 'K');
    } 
    // Has lead suit - play highest of that suit
    else if (room.currentSuit) {
        const suitCards = player.hand.filter(c => c.suit === room.currentSuit);
        if (suitCards.length > 0) {
            cardToPlay = suitCards.reduce((max, c) => c.val > max.val ? c : max);
        }
    }
    
    // No lead suit or starting new round - play lowest card
    if (!cardToPlay) {
        cardToPlay = player.hand.reduce((min, c) => c.val < min.val ? c : min);
    }
    
    if (cardToPlay) {
        console.log(`Auto-play for ${player.name}: ${cardToPlay.rank} of ${cardToPlay.suit}`);
        
        // Process the card play directly (no delay)
        const playedCard = player.hand.find(c => c.suit === cardToPlay.suit && c.rank === cardToPlay.rank);
        if (!playedCard) return;
        
        const cardIndex = player.hand.indexOf(playedCard);
        player.hand.splice(cardIndex, 1);
        
        if (room.isFirstMove) {
            room.isFirstMove = false;
        }
        
        room.table.push({ 
            playerIdx: currentTurn, 
            playerName: player.name, 
            card: playedCard 
        });
        
        if (player.gameStats) {
            player.gameStats.cardsPlayed++;
        }
        
        if (room.table.length === 1) {
            room.currentSuit = playedCard.suit;
        }
        
        // Emit autoPlayed with FULL game state so client can render properly
        io.to(roomID).emit('autoPlayed', { 
            playerName: player.name,
            playerUserID: player.userID,
            card: cardToPlay,
            // Include full state for re-render
            table: room.table,
            turn: room.turn,
            players: room.players,
            currentSuit: room.currentSuit,
            fateAces: room.fateAces
        });
        
        // Determine if Pangkah occurred
        let isPangkah = playedCard.suit !== room.currentSuit;
        
        if (player.gameStats && isPangkah) {
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
                resolveRound(roomID, isPangkah);
            }, ROUND_RESOLUTION_DELAY);
        } else {
            advanceToNextPlayer(roomID);
        }
    }
}

/**
 * Process card play (shared logic for manual and auto play)
 */
function processCardPlay(roomID, playerIdx, cardObject) {
    const room = rooms[roomID];
    if (!room) return;
    
    const player = room.players[playerIdx];
    const cardIndex = player.hand.findIndex(c => 
        c.suit === cardObject.suit && c.rank === cardObject.rank
    );
    
    if (cardIndex === -1) return;
    
    const playedCard = player.hand[cardIndex];
    
    // Clear timer
    clearTurnTimer(roomID);
    
    // Update first move flag
    if (room.isFirstMove) {
        room.isFirstMove = false;
    }

    // Play the card
    player.hand.splice(cardIndex, 1);
    room.table.push({ 
        playerIdx: playerIdx, 
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
            resolveRound(roomID, isPangkah);
        }, ROUND_RESOLUTION_DELAY);
    } else {
        // Next player's turn
        advanceToNextPlayer(roomID);
    }
}

/**
 * Advance to next player with cards
 */
function advanceToNextPlayer(roomID) {
    const room = rooms[roomID];
    if (!room) return;
    
    let nextTurn = (room.turn + 1) % room.players.length;
    let attempts = 0;
    
    while (room.players[nextTurn].hand.length === 0 && attempts < room.players.length) {
        nextTurn = (nextTurn + 1) % room.players.length;
        attempts++;
    }
    
    room.turn = nextTurn;
    
    io.to(roomID).emit('nextTurn', { 
        turn: room.turn, 
        players: room.players,
        currentSuit: room.currentSuit,
        table: room.table,
        fateAces: room.fateAces
    });
    
    // Start timer for next player
    startTurnTimer(roomID);
}

/**
 * Resolve round (pangkah or clean)
 */
function resolveRound(roomID, isPangkah) {
    const room = rooms[roomID];
    if (!room) return;
    
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
        winner.hand.push(...room.table.map(t => t.card));
        
        if (winner.gameStats) {
            winner.gameStats.pangkahsReceived++;
            const maxCards = Math.max(...room.players.map(p => p.hand.length));
            if (winner.hand.length === maxCards && winner.hand.length >= 15) {
                winner.gameStats.hadMostCards = true;
            }
        }
    } else {
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
            
            if (p.gameStats.hadMostCards && p.gameStats.finishPosition <= 2) {
                p.gameStats.comebacks++;
            }
        }
    });
    
    if (survivors.length <= 1) {
        // Game over
        clearTurnTimer(roomID);
        
        if (survivors[0]) {
            survivors[0].gameStats.finishPosition = room.players.length;
            room.finishOrder.push(survivors[0].userID);
        }
        
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
            gameNumber: room.gameNumber,
            performanceData
        });
        
        // Save game history to database
        if (MONGODB_URI && room.startTime) {
            const winner = room.players.find(p => p.userID === room.finishOrder[0]);
            const duration = Math.floor((Date.now() - room.startTime.getTime()) / 1000);
            await saveGameHistory(room, winner, duration);
        }
        
        room.gameStarted = false;
        broadcastRooms();
        
        console.log(`Game #${room.gameNumber} ended in room ${roomID}. Loser: ${survivors[0]?.name || 'None'}`);
    } else {
        // Continue game
        room.table = [];
        room.currentSuit = null;
        room.turn = winnerIdx;
        room.resolving = false;
        
        io.to(roomID).emit('clearTable', { 
            msg: isPangkah ? 'Pangkah!' : 'Clean!', 
            winner: winner.name,
            winnerUserID: winner.userID,
            turn: room.turn, 
            players: room.players,
            fateAces: room.fateAces
        });
        
        // Start timer for winner (next round leader)
        setTimeout(() => {
            startTurnTimer(roomID);
        }, 500);
    }
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
        cardsPlayed: 0,
        pangkahsDealt: 0,
        pangkahsReceived: 0,
        cleanWins: 0,
        finishPosition: null,
        hadMostCards: false,
        comebacks: 0
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
            finishOrder: [],
            gameNumber: 0
        };
        
        socket.join(roomID);
        socket.emit('roomCreated', { roomID });
        io.to(roomID).emit('updatePlayers', { players: rooms[roomID].players });
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
        
        if (room.gameStarted) {
            return socket.emit('errorMsg', 'Game already in progress!');
        }
        
        if (room.players.length >= room.maxPlayers) {
            return socket.emit('errorMsg', 'Room is full!');
        }
        
        if (room.players.some(p => p.userID === userID)) {
            return socket.emit('errorMsg', 'You are already in this room!');
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
        socket.emit('joinedRoom', { roomID });
        io.to(roomID).emit('updatePlayers', { players: room.players });
        io.to(roomID).emit('chatMsg', { msg: `${playerName} joined the room!` });
        broadcastRooms();
        console.log(`${playerName} joined room ${roomID}`);
    });

    /**
     * LEAVE ROOM
     */
    socket.on('leaveRoom', ({ roomID, userID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const pIdx = room.players.findIndex(p => p.userID === userID);
        if (pIdx === -1) return;
        
        const playerName = room.players[pIdx].name;
        room.players.splice(pIdx, 1);
        socket.leave(roomID);
        
        if (room.players.length === 0) {
            delete rooms[roomID];
            console.log(`Room ${roomID} deleted (empty)`);
        } else {
            io.to(roomID).emit('updatePlayers', { players: room.players });
            io.to(roomID).emit('chatMsg', { msg: `${playerName} left the room.` });
        }
        
        broadcastRooms();
        console.log(`${playerName} left room ${roomID}`);
    });

    /**
     * START GAME - Internal function
     */
    async function startGameForRoom(roomID) {
        const room = rooms[roomID];
        if (!room) return false;
        
        const playerCount = room.players.length;
        
        if (playerCount < MIN_PLAYERS) {
            return false;
        }
        
        // Check if player count is valid (has a fate config)
        if (FATE_CONFIG[playerCount] === undefined) {
            return false;
        }
        
        room.gameStarted = true;
        room.resolving = false;
        room.table = [];
        room.currentSuit = null;
        room.gameNumber = (room.gameNumber || 0) + 1;
        room.finishOrder = [];
        room.startTime = new Date(); // Track game start time for history
        
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
        
        // Start turn timer for first player
        setTimeout(() => {
            startTurnTimer(roomID);
        }, 1000);
        
        console.log(`Game #${room.gameNumber} started in room ${roomID} with ${playerCount} players. ${room.players[room.turn].name} has K♠`);
        return true;
    }

    /**
     * START GAME - Socket Handler
     */
    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const playerCount = room.players.length;
        
        if (playerCount < MIN_PLAYERS) {
            return socket.emit('errorMsg', `Need at least ${MIN_PLAYERS} players to start`);
        }
        
        if (FATE_CONFIG[playerCount] === undefined) {
            return socket.emit('errorMsg', `Cannot start with ${playerCount} players. Valid: 4, 5, 6, 7, 8, or 10 players.`);
        }
        
        startGameForRoom(roomID);
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

            io.to(roomID).emit('updatePlayers', { players: room.players });
            
            // Check if all players are ready
            const allReady = room.players.every(p => p.rematchReady);
            if (allReady) {
                io.to(roomID).emit('chatMsg', { msg: 'All players ready! Starting new game...' });
                setTimeout(() => {
                    startGameForRoom(roomID);
                }, 2000);
            } else {
                const readyCount = room.players.filter(p => p.rematchReady).length;
                io.to(roomID).emit('chatMsg', { 
                    msg: `${player.name} is ready for rematch! (${readyCount}/${room.players.length})` 
                });
            }
        }
    });

    /**
     * CHAT MESSAGE
     */
    socket.on('chatMsg', ({ roomID, playerName, msg }) => {
        if (!roomID || !msg) return;
        io.to(roomID).emit('chatMsg', { playerName, msg });
    });

    /**
     * SWAP REQUEST - Player requests to absorb another's hand
     */
    socket.on('requestSwap', ({ roomID, fromUserID, toUserID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const requester = room.players.find(p => p.userID === fromUserID);
        const target = room.players.find(p => p.userID === toUserID);
        
        if (!requester || !target) {
            return socket.emit('errorMsg', 'Invalid swap request');
        }
        
        if (target.hand.length === 0) {
            return socket.emit('errorMsg', `${target.name} has no cards to give!`);
        }
        
        // Send request to target player
        const targetSocket = io.sockets.sockets.get(target.id);
        if (targetSocket) {
            targetSocket.emit('receiveSwapRequest', {
                fromUserID: requester.userID,
                fromName: requester.name
            });
        }
        
        console.log(`${requester.name} requested hand swap from ${target.name}`);
    });

    /**
     * SWAP ANSWER - Target accepts/declines
     */
    socket.on('answerSwap', ({ roomID, fromUserID, myUserID, accepted }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const requester = room.players.find(p => p.userID === fromUserID);
        const accepter = room.players.find(p => p.userID === myUserID);
        
        if (!requester || !accepter) {
            return socket.emit('errorMsg', 'Invalid swap participants');
        }
        
        if (!accepted) {
            io.to(roomID).emit('chatMsg', { 
                msg: `${accepter.name} declined ${requester.name}'s hand absorption request.` 
            });
            return;
        }
        
        // Check again if accepter still has cards
        if (accepter.hand.length === 0) {
            return socket.emit('errorMsg', 'You have no cards to give!');
        }
        
        // Transfer all cards
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
     * SWAP DECLINE - Explicit decline
     */
    socket.on('declineSwap', ({ roomID, fromUserID, myUserID }) => {
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
        }

        // RULE 2: Must follow suit if possible
        if (room.table.length > 0 && playedCard.suit !== room.currentSuit) {
            if (player.hand.some(c => c.suit === room.currentSuit)) {
                return socket.emit('errorMsg', `Must follow suit: ${room.currentSuit}`);
            }
        }

        // Process the card play
        processCardPlay(roomID, room.turn, cardObject);
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
     * MONGODB: LOAD PLAYER STATS
     */
    socket.on('loadStats', async ({ userID }) => {
        if (!userID) return;
        const stats = await loadPlayerStats(userID);
        if (stats) {
            socket.emit('statsLoaded', stats);
        }
    });

    /**
     * MONGODB: SAVE PLAYER STATS
     */
    socket.on('saveStats', async ({ userID, name, stats }) => {
        if (!userID || !stats) return;
        await savePlayerStats(userID, name, stats);
        socket.emit('statsSaved', { success: true });
    });

    /**
     * MONGODB: GM LOGIN
     */
    socket.on('gmLogin', async ({ userID, password }) => {
        const result = await setGameMaster(userID, password);
        socket.emit('gmLoginResult', result);
    });

    /**
     * MONGODB: CHECK GM STATUS
     */
    socket.on('checkGM', async ({ userID }) => {
        const isGM = await checkGameMaster(userID);
        socket.emit('gmStatus', { isGM });
    });

    /**
     * MONGODB: GET LEADERBOARD
     */
    socket.on('getLeaderboard', async ({ sortBy = 'xp', limit = 10 }) => {
        const leaderboard = await getLeaderboard(sortBy, limit);
        socket.emit('leaderboardData', leaderboard);
    });

    /**
     * DISCONNECT HANDLER
     */
    socket.on('disconnect', async () => {
        console.log('Client disconnected:', socket.id);
        
        // Find and save stats for disconnecting player
        for (let rid in rooms) {
            const player = rooms[rid].players.find(p => p.id === socket.id);
            if (player && player.userID && player.localStats) {
                await savePlayerStats(player.userID, player.name, player.localStats);
                console.log(`💾 Auto-saved stats for ${player.name} on disconnect`);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎴 Pangkah Server v2 active on port ${PORT}`));
