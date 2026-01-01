const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let rooms = {};

// Logik bina deck kad
function generateDeck() {
    const suits = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
    const ranks = [
        {n:'2', v:2}, {n:'3', v:3}, {n:'4', v:4}, {n:'5', v:5}, {n:'6', v:6},
        {n:'7', v:7}, {n:'8', v:8}, {n:'9', v:9}, {n:'10', v:10},
        {n:'J', v:11}, {n:'Q', v:12}, {n:'K', v:13}, {n:'A', v:14}
    ];
    let deck = [];
    suits.forEach(s => {
        ranks.forEach(r => {
            deck.push({ suit: s, rank: r.n, val: r.v });
        });
    });
    return deck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // MENGURUSKAN ROOM
    socket.on('createRoom', ({ roomID, playerName, maxPlayers }) => {
        if (rooms[roomID]) return socket.emit('errorMsg', 'Room ID sudah wujud!');
        
        rooms[roomID] = {
            id: roomID,
            maxPlayers: parseInt(maxPlayers),
            players: [{ id: socket.id, name: playerName, hand: [] }],
            gameStarted: false,
            table: [],
            currentSuit: null
        };
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players);
    });

    socket.on('joinRoom', ({ roomID, playerName }) => {
        const room = rooms[roomID];
        if (!room) return socket.emit('errorMsg', 'Room tidak dijumpai!');
        if (room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Room penuh!');

        room.players.push({ id: socket.id, name: playerName, hand: [] });
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', room.players);
    });

    // MULA GAME & LOGIK KING SPADES
    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room || room.players.length < room.maxPlayers) return;

        let deck = generateDeck();
        let cardsPerPlayer = Math.floor(52 / room.maxPlayers);
        let remainder = 52 % room.maxPlayers;

        // Bahagi kad sama rata
        room.players.forEach(p => {
            p.hand = deck.splice(0, cardsPerPlayer);
        });

        // Logik: Pemilik King Spades ambil baki kad
        if (remainder > 0) {
            let kingOwner = room.players.find(p => 
                p.hand.some(c => c.suit === 'Spades' && c.rank === 'K')
            );
            if (kingOwner) {
                kingOwner.hand.push(...deck.splice(0, remainder));
            }
        }

        room.gameStarted = true;
        io.to(roomID).emit('gameInit', room.players);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));
