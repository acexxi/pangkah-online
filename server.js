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
            players: [{ id: socket.id, name: playerName, hand: [], score: 0, out: false }],
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
        room.players.push({ id: socket.id, name: playerName, hand: [], score: 0, out: false });
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        let deck = generateDeck();
        let cardsPerPlayer = Math.floor(52 / room.maxPlayers);
        let remainder = 52 % room.maxPlayers;

        room.players.forEach(p => { p.hand = deck.splice(0, cardsPerPlayer); p.score = 0; p.out = false; });

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
        room.table.push({ playerIdx: room.turn, playerName: room.players[room.turn].name, card: playedCard });

        if (room.table.length === 1) room.currentSuit = playedCard.suit;

        // Cari pemain seterusnya yang masih ada kad (Clockwise)
        let nextTurn = room.turn;
        do {
            nextTurn = (nextTurn + 1) % room.players.length;
        } while (room.players[nextTurn].hand.length === 0 && room.table.length < room.players.filter(p => p.hand.length > 0 || room.table.some(tc => tc.playerIdx === room.players.indexOf(p))).length);

        room.turn = nextTurn;

        io.to(roomID).emit('updateTable', { 
            table: room.table, 
            turn: room.turn, 
            suit: room.currentSuit,
            players: room.players 
        });

        // Pusingan tamat bila semua pemain yang aktif sudah baling kad
        const playersWithCards = room.players.filter(p => p.hand.length > 0 || room.table.some(tc => tc.playerIdx === room.players.indexOf(p)));
        
        if (room.table.length === playersWithCards.length) {
            setTimeout(() => {
                let winnerIdx = room.table[0].playerIdx;
                let bestCard = room.table[0].card;
                let adaPangkah = false;

                for (let i = 1; i < room.table.length; i++) {
                    let current = room.table[i];
                    if (current.card.suit !== room.currentSuit) {
                        if (!adaPangkah || current.card.val > bestCard.val) {
                            adaPangkah = true; bestCard = current.card; winnerIdx = current.playerIdx;
                        }
                    } else if (!adaPangkah && current.card.val > bestCard.val) {
                        bestCard = current.card; winnerIdx = current.playerIdx;
                    }
                }

                room.players[winnerIdx].score += room.table.length;
                
                // Cari siapa lagi yang masih ada kad
                let activePlayers = room.players.filter(p => p.hand.length > 0);
                
                if (activePlayers.length <= 1) {
                    io.to(roomID).emit('gameOver', { players: room.players, loser: activePlayers.length === 1 ? activePlayers[0].name : "Tiada" });
                } else {
                    // Pemenang pusingan jalan dulu, tapi jika dia sudah habis kad, cari orang sebelah dia
                    let nextStarter = winnerIdx;
                    while (room.players[nextStarter].hand.length === 0) {
                        nextStarter = (nextStarter + 1) % room.players.length;
                    }
                    room.turn = nextStarter;
                    room.table = [];
                    room.currentSuit = null;
                    io.to(roomID).emit('clearTable', { turn: room.turn, players: room.players, winner: room.players[winnerIdx].name });
                }
            }, 3000);
        }
    });
});

server.listen(process.env.PORT || 3000);
