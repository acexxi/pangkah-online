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
        {n:'2',v:2},{n:'3',v:3},{n:'4',v:4},{n:'5',v:5},{n:'6',v:6},
        {n:'7',v:7},{n:'8',v:8},{n:'9',v:9},{n:'10',v:10},
        {n:'J',v:11},{n:'Q',v:12},{n:'K',v:13},{n:'A',v:14}
    ];
    let deck = [];
    suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r.n, val: r.v })));
    return deck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    socket.on('createRoom', ({ roomID, playerName, maxPlayers }) => {
        if (rooms[roomID]) return socket.emit('errorMsg', 'ID Room sudah wujud!');
        rooms[roomID] = {
            id: roomID,
            maxPlayers: parseInt(maxPlayers),
            players: [{ id: socket.id, name: playerName, hand: [] }],
            turn: 0,
            table: [],
            currentSuit: null,
            gameStarted: false
        };
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players);
    });

    socket.on('joinRoom', ({ roomID, playerName }) => {
        const room = rooms[roomID];
        if (!room || room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Room penuh/tidak wujud!');
        room.players.push({ id: socket.id, name: playerName, hand: [] });
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        let deck = generateDeck();
        let cardsPerPlayer = Math.floor(52 / room.maxPlayers);
        let remainder = 52 % room.maxPlayers;

        room.players.forEach(p => p.hand = deck.splice(0, cardsPerPlayer));

        // Logik: King Spades ambil baki & mula dulu
        let starterIdx = 0;
        room.players.forEach((p, index) => {
            if (p.hand.some(c => c.suit === 'Spades' && c.rank === 'K')) {
                starterIdx = index;
                if (remainder > 0) p.hand.push(...deck.splice(0, remainder));
            }
        });

        room.turn = starterIdx;
        room.gameStarted = true;
        io.to(roomID).emit('gameInit', { players: room.players, turn: room.turn });
    });

    socket.on('playCard', ({ roomID, cardIndex }) => {
        const room = rooms[roomID];
        if (!room || room.players[room.turn].id !== socket.id) return;

        const playedCard = room.players[room.turn].hand.splice(cardIndex, 1)[0];
        if (!room.table) room.table = [];
        room.table.push({ player: room.players[room.turn].name, card: playedCard });

        if (room.table.length === 1) room.currentSuit = playedCard.suit;

        // Clockwise Turn
        room.turn = (room.turn + 1) % room.players.length;

        io.to(roomID).emit('updateTable', { 
            table: room.table, 
            turn: room.turn, 
            suit: room.currentSuit,
            players: room.players 
        });

        if (room.table.length === room.players.length) {
            setTimeout(() => {
                room.table = [];
                room.currentSuit = null;
                io.to(roomID).emit('clearTable', { turn: room.turn });
            }, 3000);
        }
    });
});

server.listen(process.env.PORT || 3000);
