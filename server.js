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
            currentSuit: null
        };
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players);
    });

    socket.on('joinRoom', ({ roomID, playerName }) => {
        const room = rooms[roomID];
        if (!room || room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Bilik penuh/tidak wujud!');
        room.players.push({ id: socket.id, name: playerName, hand: [] });
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        let deck = generateDeck();
        let cardsPerPlayer = Math.floor(52 / room.maxPlayers);
        
        room.players.forEach(p => { 
            p.hand = deck.splice(0, cardsPerPlayer);
        });

        let starterIdx = 0;
        room.players.forEach((p, index) => {
            if (p.hand.some(c => c.suit === 'Spades' && c.rank === 'K')) starterIdx = index;
        });

        room.turn = starterIdx;
        io.to(roomID).emit('gameInit', { players: room.players, turn: room.turn });
    });

    socket.on('playCard', ({ roomID, cardObject }) => {
        const room = rooms[roomID];
        if (!room || room.players[room.turn].id !== socket.id) return;

        const player = room.players[room.turn];
        // Mencari index berdasarkan identiti kad, bukan urutan UI
        const cardIndex = player.hand.findIndex(c => c.suit === cardObject.suit && c.rank === cardObject.rank);

        if (cardIndex !== -1) {
            const playedCard = player.hand.splice(cardIndex, 1)[0];
            room.table.push({ playerIdx: room.turn, playerName: player.name, card: playedCard });

            if (room.table.length === 1) room.currentSuit = playedCard.suit;

            let nextTurn = room.turn;
            let activePlayersCount = room.players.filter(p => p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p))).length;

            if (room.table.length < activePlayersCount) {
                do {
                    nextTurn = (nextTurn + 1) % room.players.length;
                } while (room.players[nextTurn].hand.length === 0);
                room.turn = nextTurn;
            }

            io.to(roomID).emit('updateTable', { table: room.table, turn: room.turn, suit: room.currentSuit, players: room.players });

            if (room.table.length === activePlayersCount) {
                setTimeout(() => {
                    let winnerIdx = room.table[0].playerIdx;
                    let bestCard = room.table[0].card;
                    let adaPangkah = false;

                    room.table.forEach(item => {
                        if (item.card.suit !== room.currentSuit) {
                            if (!adaPangkah || item.card.val > bestCard.val) {
                                adaPangkah = true;
                                bestCard = item.card;
                                winnerIdx = item.playerIdx;
                            }
                        } else if (!adaPangkah && item.card.val > bestCard.val) {
                            bestCard = item.card;
                            winnerIdx = item.playerIdx;
                        }
                    });

                    let survivors = room.players.filter(p => p.hand.length > 0);
                    if (survivors.length <= 1) {
                        io.to(roomID).emit('gameOver', { players: room.players, loser: survivors[0]?.name || "Tiada" });
                        delete rooms[roomID];
                    } else {
                        let nextStarter = winnerIdx;
                        while (room.players[nextStarter].hand.length === 0) {
                            nextStarter = (nextStarter + 1) % room.players.length;
                        }
                        room.turn = nextStarter;
                        room.table = [];
                        room.currentSuit = null;
                        io.to(roomID).emit('clearTable', { turn: room.turn, winner: room.players[winnerIdx].name, players: room.players });
                    }
                }, 3000);
            }
        }
    });
});

server.listen(process.env.PORT || 3000, '0.0.0.0', () => {
    console.log('Server is live on port 3000');
});
