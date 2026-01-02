const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let rooms = {};

function generateDeck() {
    const suits = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
    const ranks = [
        {n:'A',v:1}, {n:'2',v:2}, {n:'3',v:3}, {n:'4',v:4}, {n:'5',v:5},
        {n:'6',v:6}, {n:'7',v:7}, {n:'8',v:8}, {n:'9',v:9}, {n:'10',v:10},
        {n:'J',v:11}, {n:'Q',v:12}, {n:'K',v:13}
    ];
    let deck = [];
    suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r.n, val: r.v })));
    return deck.sort(() => Math.random() - 0.5);
}

const broadcastRooms = () => {
    const list = Object.keys(rooms).map(id => ({
        id, count: rooms[id].players.length, max: rooms[id].maxPlayers
    }));
    io.emit('roomList', list);
};

io.on('connection', (socket) => {
    broadcastRooms();

    socket.on('checkSession', ({ userID }) => {
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
                    gameStarted: rooms[rid].gameStarted
                });
                return;
            }
        }
    });

    socket.on('updateName', ({ roomID, userID, newName }) => {
        const room = rooms[roomID];
        if (room) {
            const p = room.players.find(player => player.userID === userID);
            if (p) { p.name = newName; io.to(roomID).emit('updatePlayers', room.players); }
        }
    });

    socket.on('createRoom', ({ roomID, playerName, maxPlayers, userID }) => {
        if (rooms[roomID]) return socket.emit('errorMsg', 'Room ID already exists!');
        rooms[roomID] = {
            id: roomID, maxPlayers: parseInt(maxPlayers),
            players: [{ id: socket.id, name: playerName, userID: userID, hand: [] }],
            turn: 0, table: [], currentSuit: null, isFirstMove: true, discarded: [], gameStarted: false
        };
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players);
        broadcastRooms();
    });

    socket.on('joinRoom', ({ roomID, playerName, userID }) => {
        const room = rooms[roomID];
        if (!room) return socket.emit('errorMsg', 'Room not found!');
        let existing = room.players.find(p => p.userID === userID);
        if (existing) {
            existing.id = socket.id;
            socket.join(roomID);
        } else {
            if (room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Room full!');
            room.players.push({ id: socket.id, name: playerName, userID: userID, hand: [] });
            socket.join(roomID);
        }
        io.to(roomID).emit('updatePlayers', room.players);
        broadcastRooms();
    });

    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        room.gameStarted = true;
        let deck = generateDeck();
        room.discarded = [];

        if (room.maxPlayers >= 5) {
            const discardCount = room.maxPlayers === 5 ? 2 : 4;
            let aceIndices = [];
            deck.forEach((card, idx) => { if (card.rank === 'A') aceIndices.push(idx); });
            aceIndices.sort(() => Math.random() - 0.5);
            let toRemove = aceIndices.slice(0, discardCount).sort((a, b) => b - a);
            toRemove.forEach(idx => { room.discarded.push(deck.splice(idx, 1)[0]); });
        }

        let cardsPerPlayer = Math.floor(deck.length / room.maxPlayers);
        room.players.forEach(p => { p.hand = deck.splice(0, cardsPerPlayer); });
        let starterIdx = room.players.findIndex(p => p.hand.some(c => c.suit === 'Spades' && c.rank === 'K'));
        room.turn = starterIdx !== -1 ? starterIdx : 0;
        room.isFirstMove = true;
        io.to(roomID).emit('gameInit', { players: room.players, turn: room.turn, discarded: room.discarded });
    });

    socket.on('requestSwap', ({ roomID, userID }) => {
        const room = rooms[roomID];
        if (!room || !room.gameStarted) return;
        const myIdx = room.players.findIndex(p => p.userID === userID);
        let targetIdx = (myIdx + 1) % room.players.length;
        while (room.players[targetIdx].hand.length === 0 && targetIdx !== myIdx) targetIdx = (targetIdx + 1) % room.players.length;
        
        if (targetIdx === myIdx) return;
        const target = room.players[targetIdx];
        const me = room.players[myIdx];
        let temp = [...me.hand];
        me.hand = [...target.hand];
        target.hand = temp;

        io.to(roomID).emit('swapOccurred', { msg: `${me.name} took ${target.name}'s hand!`, players: room.players });
    });

    socket.on('playCard', ({ roomID, cardObject }) => {
        const room = rooms[roomID];
        if (!room || room.players[room.turn].id !== socket.id) return;
        const player = room.players[room.turn];
        const cardIndex = player.hand.findIndex(c => c.suit === cardObject.suit && c.rank === cardObject.rank);
        if (cardIndex === -1) return;
        const playedCard = player.hand[cardIndex];

        if (room.isFirstMove && (playedCard.suit !== 'Spades' || playedCard.rank !== 'K')) return socket.emit('errorMsg', "First move: King of Spades!");
        if (room.table.length > 0 && playedCard.suit !== room.currentSuit && player.hand.some(c => c.suit === room.currentSuit)) return socket.emit('errorMsg', `Must follow suit: ${room.currentSuit}`);

        room.isFirstMove = false;
        player.hand.splice(cardIndex, 1);
        room.table.push({ playerIdx: room.turn, playerName: player.name, card: playedCard });
        if (room.table.length === 1) room.currentSuit = playedCard.suit;

        io.to(roomID).emit('updateTable', { table: room.table, turn: room.turn, players: room.players });

        let isPangkah = playedCard.suit !== room.currentSuit;
        let activePlayers = room.players.filter(p => p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p)));

        if (isPangkah || room.table.length === activePlayers.length) {
            setTimeout(() => {
                let winIdx = -1; let high = -1;
                room.table.forEach(t => { if(t.card.suit === room.currentSuit && t.card.val > high) { high = t.card.val; winIdx = t.playerIdx; } });
                if (isPangkah) room.players[winIdx].hand.push(...room.table.map(t => t.card));
                
                let survivors = room.players.filter(p => p.hand.length > 0);
                if (survivors.length <= 1) {
                    io.to(roomID).emit('gameOver', { loser: survivors[0]?.name || 'None' });
                    delete rooms[roomID];
                } else {
                    room.turn = winIdx; room.table = []; room.currentSuit = null;
                    io.to(roomID).emit('clearTable', { turn: room.turn, winner: room.players[winIdx].name, players: room.players, msg: isPangkah ? "Pangkah!" : "Clean" });
                }
            }, 1200);
        } else {
            do { room.turn = (room.turn + 1) % room.players.length; } while (room.players[room.turn].hand.length === 0);
            io.to(roomID).emit('nextTurn', { turn: room.turn, players: room.players, table: room.table });
        }
    });
});

server.listen(3000, () => console.log('Server running on port 3000'));
