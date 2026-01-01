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

io.on('connection', (socket) => {
    socket.on('createRoom', ({ roomID, playerName, maxPlayers }) => {
        if (rooms[roomID]) return socket.emit('errorMsg', 'Room ID exists!');
        rooms[roomID] = {
            id: roomID, maxPlayers: parseInt(maxPlayers),
            players: [{ id: socket.id, name: playerName, hand: [] }],
            turn: 0, table: [], currentSuit: null
        };
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players);
    });

    socket.on('joinRoom', ({ roomID, playerName }) => {
        const room = rooms[roomID];
        if (!room || room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Room full/not found!');
        room.players.push({ id: socket.id, name: playerName, hand: [] });
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        let deck = generateDeck();
        let cardsPerPlayer = Math.floor(52 / room.maxPlayers);
        room.players.forEach(p => p.hand = deck.splice(0, cardsPerPlayer));
        let starterIdx = room.players.findIndex(p => p.hand.some(c => c.suit === 'Spades' && c.rank === 'K'));
        room.turn = starterIdx !== -1 ? starterIdx : 0;
        io.to(roomID).emit('gameInit', { players: room.players, turn: room.turn });
    });

    socket.on('playCard', ({ roomID, cardObject }) => {
        const room = rooms[roomID];
        if (!room || room.players[room.turn].id !== socket.id) return;

        const player = room.players[room.turn];
        const cardIndex = player.hand.findIndex(c => c.suit === cardObject.suit && c.rank === cardObject.rank);
        if (cardIndex === -1) return;

        const playedCard = player.hand.splice(cardIndex, 1)[0];
        room.table.push({ playerIdx: room.turn, playerName: player.name, card: playedCard });

        let isPangkah = false;
        if (room.table.length === 1) {
            room.currentSuit = playedCard.suit;
        } else if (playedCard.suit !== room.currentSuit) {
            isPangkah = true;
        }

        io.to(roomID).emit('updateTable', { table: room.table, turn: room.turn, players: room.players });

        // Kira berapa ramai pemain yang masih ada kad dalam tangan
        let playersWithCards = room.players.filter(p => p.hand.length > 0).length;
        let activeInRound = room.players.filter(p => p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p))).length;

        // Tamat pusingan jika ada pangkah ATAU semua pemain aktif sudah jalan
        if (isPangkah || room.table.length === activeInRound) {
            setTimeout(() => {
                let winnerIdx = -1;
                let bestCardValue = -1;
                let pangkahFound = false;

                // Tentukan pemenang:
                // 1. Jika ada pangkah, cari nilai tertinggi di antara kad-kad pangkah sahaja.
                // 2. Jika tiada pangkah, cari nilai tertinggi bagi suit asal.

                room.table.forEach(item => {
                    const isItemPangkah = item.card.suit !== room.currentSuit;
                    if (isItemPangkah) {
                        if (!pangkahFound || item.card.val > bestCardValue) {
                            pangkahFound = true;
                            bestCardValue = item.card.val;
                            winnerIdx = item.playerIdx;
                        }
                    } else if (!pangkahFound && item.card.val > bestCardValue) {
                        bestCardValue = item.card.val;
                        winnerIdx = item.playerIdx;
                    }
                });

                let logMsg = "";
                if (isPangkah) {
                    // AMBIL KAD: Masukkan semua kad dari meja ke tangan pemenang
                    const cardsFromTable = room.table.map(t => t.card);
                    room.players[winnerIdx].hand.push(...cardsFromTable);
                    logMsg = `${room.players[winnerIdx].name} took the cards! (Pangkah)`;
                } else {
                    // BUANG KAD: Kad di meja dibakar
                    logMsg = `Round clear. Cards discarded.`;
                }

                // Cek jika game tamat (hanya tinggal 1 orang ada kad)
                let survivors = room.players.filter(p => p.hand.length > 0);
                if (survivors.length <= 1) {
                    io.to(roomID).emit('gameOver', { loser: survivors[0]?.name || "None" });
                    delete rooms[roomID];
                } else {
                    room.turn = winnerIdx; // Pemenang mulakan round baru
                    room.table = [];
                    room.currentSuit = null;
                    io.to(roomID).emit('clearTable', { 
                        turn: room.turn, 
                        winner: room.players[winnerIdx].name, 
                        players: room.players,
                        msg: logMsg
                    });
                }
            }, 2000);
        } else {
            // Tukar giliran seperti biasa
            do {
                room.turn = (room.turn + 1) % room.players.length;
            } while (room.players[room.turn].hand.length === 0);
            io.to(roomID).emit('nextTurn', { turn: room.turn, players: room.players, table: room.table });
        }
    });
});

server.listen(process.env.PORT || 3000, '0.0.0.0');
