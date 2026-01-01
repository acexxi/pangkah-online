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
    const ranks = [{n:'2',v:2},{n:'3',v:3},{n:'4',v:4},{n:'5',v:5},{n:'6',v:6},{n:'7',v:7},{n:'8',v:8},{n:'9',v:9},{n:'10',v:10},{n:'J',v:11},{n:'Q',v:12},{n:'K',v:13},{n:'A',v:14}];
    let deck = [];
    suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r.n, val: r.v })));
    return deck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    socket.on('createRoom', ({ roomID, playerName, maxPlayers }) => {
        if (rooms[roomID]) return socket.emit('errorMsg', 'Room ID sudah wujud!');
        rooms[roomID] = {
            id: roomID,
            maxPlayers: parseInt(maxPlayers),
            players: [{ id: socket.id, name: playerName, hand: [] }],
            turn: 0, // Indeks pemain yang perlu jalan
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
        let deck = generateDeck();
        let cardsPerPlayer = Math.floor(52 / room.maxPlayers);
        let remainder = 52 % room.maxPlayers;

        room.players.forEach(p => p.hand = deck.splice(0, cardsPerPlayer));

        // Cari King Spades untuk tentukan siapa MULA DULU
        let starterIdx = 0;
        room.players.forEach((p, index) => {
            if (p.hand.some(c => c.suit === 'Spades' && c.rank === 'K')) {
                starterIdx = index;
                if (remainder > 0) p.hand.push(...deck.splice(0, remainder));
            }
        });

        room.turn = starterIdx; // Pemegang King Spades jadi pemain pertama
        room.gameStarted = true;
        io.to(roomID).emit('gameInit', { players: room.players, turn: room.turn });
    });

    // Logik bila pemain baling kad
    socket.on('playCard', ({ roomID, cardIndex }) => {
        const room = rooms[roomID];
        // 1. Pastikan giliran dia
        if (room.players[room.turn].id !== socket.id) return;

        // 2. Gerakkan giliran ke pemain seterusnya (Clockwise)
        // Guna formula: (Turn Sekarang + 1) bahagi Jumlah Pemain
        room.turn = (room.turn + 1) % room.players.length;

        io.to(roomID).emit('nextTurn', { turn: room.turn });
    });
});

server.listen(process.env.PORT || 3000);
