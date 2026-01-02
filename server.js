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
        if (rooms[roomID]) return socket.emit('errorMsg', 'Room ID already exists!');
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
        if (!room || room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Room full or not found!');
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

        const playedCard = player.hand[cardIndex];

        if (room.table.length > 0 && playedCard.suit !== room.currentSuit) {
            const hasSuitInHand = player.hand.some(c => c.suit === room.currentSuit);
            if (hasSuitInHand) {
                return socket.emit('errorMsg', `Invalid move! You still have ${room.currentSuit} in hand.`);
            }
        }

        player.hand.splice(cardIndex, 1);
        room.table.push({ playerIdx: room.turn, playerName: player.name, card: playedCard });

        let isPangkah = false;
        if (room.table.length === 1) {
            room.currentSuit = playedCard.suit;
        } else if (playedCard.suit !== room.currentSuit) {
            isPangkah = true;
        }

        io.to(roomID).emit('updateTable', { table: room.table, turn: room.turn, players: room.players });

        let activeInRound = room.players.filter(p => p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p))).length;

        if (isPangkah || room.table.length === activeInRound) {
            setTimeout(() => {
                let leadWinnerIdx = -1;
                let highestLeadVal = -1;

                room.table.forEach(item => {
                    if (item.card.suit === room.currentSuit) {
                        if (item.card.val > highestLeadVal) {
                            highestLeadVal = item.card.val;
                            leadWinnerIdx = item.playerIdx;
                        }
                    }
                });

                let msg = isPangkah ? `${room.players[leadWinnerIdx].name} took all cards! (Pangkah Penalty)` : `Round cleared. Cards discarded.`;
                
                if (isPangkah) {
                    const cardsToTake = room.table.map(t => t.card);
                    room.players[leadWinnerIdx].hand.push(...cardsToTake);
                }

                let survivors = room.players.filter(p => p.hand.length > 0);
                if (survivors.length <= 1) {
                    io.to(roomID).emit('gameOver', { loser: survivors[0]?.name || "None" });
                    delete rooms[roomID];
                } else {
                    room.turn = leadWinnerIdx;
                    room.table = [];
                    room.currentSuit = null;
                    io.to(roomID).emit('clearTable', { 
                        turn: room.turn, 
                        winner: room.players[leadWinnerIdx].name, 
                        players: room.players, 
                        msg: msg 
                    });
                }
            }, 2000);
        } else {
            do {
                room.turn = (room.turn + 1) % room.players.length;
            } while (room.players[room.turn].hand.length === 0);
            io.to(roomID).emit('nextTurn', { turn: room.turn, players: room.players, table: room.table });
        }
    });
});

server.listen(process.env.PORT || 3000, '0.0.0.0');
