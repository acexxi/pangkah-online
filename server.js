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

    socket.on('createRoom', ({ roomID, playerName, maxPlayers }) => {
        if (rooms[roomID]) return socket.emit('errorMsg', 'Room ID already exists!');
        rooms[roomID] = {
            id: roomID, maxPlayers: parseInt(maxPlayers),
            players: [{ id: socket.id, name: playerName, hand: [] }],
            turn: 0, table: [], currentSuit: null, isFirstMove: true, discarded: []
        };
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players);
        broadcastRooms();
    });

    socket.on('joinRoom', ({ roomID, playerName }) => {
        const room = rooms[roomID];
        if (!room) return socket.emit('errorMsg', 'Room not found!');
        if (room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Room full!');
        room.players.push({ id: socket.id, name: playerName, hand: [] });
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', room.players);
        broadcastRooms();
    });

    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        let deck = generateDeck();
        room.discarded = [];

        // BALANCE LOGIC: Discard Aces for 5 or 6 players
        if (room.maxPlayers === 5 || room.maxPlayers === 6) {
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

    socket.on('playCard', ({ roomID, cardObject }) => {
        const room = rooms[roomID];
        if (!room || room.players[room.turn].id !== socket.id) return;

        const player = room.players[room.turn];
        const cardIndex = player.hand.findIndex(c => c.suit === cardObject.suit && c.rank === cardObject.rank);
        const playedCard = player.hand[cardIndex];

        if (room.isFirstMove && (playedCard.suit !== 'Spades' || playedCard.rank !== 'K')) {
            return socket.emit('errorMsg', "First move must be King of Spades!");
        }

        if (room.table.length > 0 && playedCard.suit !== room.currentSuit) {
            if (player.hand.some(c => c.suit === room.currentSuit)) {
                return socket.emit('errorMsg', `Must follow suit: ${room.currentSuit}`);
            }
        }

        room.isFirstMove = false;
        player.hand.splice(cardIndex, 1);
        room.table.push({ playerIdx: room.turn, playerName: player.name, card: playedCard });
        if (room.table.length === 1) room.currentSuit = playedCard.suit;

        io.to(roomID).emit('updateTable', { table: room.table, turn: room.turn, players: room.players });

        let isPangkah = playedCard.suit !== room.currentSuit;
        let activeCount = room.players.filter(p => p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p))).length;

        if (isPangkah || room.table.length === activeCount) {
            setTimeout(() => {
                let winnerIdx = -1; let highVal = -1;
                room.table.forEach(t => {
                    if (t.card.suit === room.currentSuit && t.card.val > highVal) {
                        highVal = t.card.val; winnerIdx = t.playerIdx;
                    }
                });
                if (isPangkah) room.players[winnerIdx].hand.push(...room.table.map(t => t.card));
                
                let survivors = room.players.filter(p => p.hand.length > 0);
                if (survivors.length <= 1) {
                    io.to(roomID).emit('gameOver', { loser: survivors[0]?.name || 'None' });
                    delete rooms[roomID];
                    broadcastRooms();
                } else {
                    room.turn = winnerIdx; room.table = []; room.currentSuit = null;
                    io.to(roomID).emit('clearTable', { turn: room.turn, winner: room.players[winnerIdx].name, players: room.players, msg: isPangkah ? "Pangkah!" : "Clean" });
                }
            }, 1500);
        } else {
            do { room.turn = (room.turn + 1) % room.players.length; } while (room.players[room.turn].hand.length === 0);
            io.to(roomID).emit('nextTurn', { turn: room.turn, players: room.players, table: room.table });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server active on port ${PORT}`));
