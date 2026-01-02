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
    socket.on('checkSession', ({ userID }) => {
        for (let rid in rooms) {
            let pIdx = rooms[rid].players.findIndex(p => p.userID === userID);
            if (pIdx !== -1) {
                rooms[rid].players[pIdx].id = socket.id;
                socket.join(rid);
                socket.emit('reconnectSuccess', { roomID: rid, players: rooms[rid].players, turn: rooms[rid].turn, table: rooms[rid].table, discarded: rooms[rid].discarded, gameStarted: rooms[rid].gameStarted });
            }
        }
    });

    socket.on('createRoom', ({ roomID, playerName, maxPlayers, userID }) => {
        rooms[roomID] = { id: roomID, maxPlayers: parseInt(maxPlayers), players: [{ id: socket.id, name: playerName, userID, hand: [] }], turn: 0, table: [], currentSuit: null, isFirstMove: true, discarded: [], gameStarted: false };
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players);
    });

    socket.on('joinRoom', ({ roomID, playerName, userID }) => {
        const room = rooms[roomID];
        if (!room) return;
        let existing = room.players.find(p => p.userID === userID);
        if (existing) { existing.id = socket.id; socket.join(roomID); }
        else { room.players.push({ id: socket.id, name: playerName, userID, hand: [] }); socket.join(roomID); }
        io.to(roomID).emit('updatePlayers', room.players);
    });

    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        room.gameStarted = true;
        let deck = generateDeck();
        if (room.maxPlayers >= 5) {
            const count = room.maxPlayers === 5 ? 2 : 4;
            let aces = deck.filter(c => c.rank === 'A').sort(() => Math.random() - 0.5);
            room.discarded = aces.slice(0, count);
            room.discarded.forEach(card => {
                const idx = deck.findIndex(dc => dc.suit === card.suit && dc.rank === card.rank);
                deck.splice(idx, 1);
            });
        }
        let cpp = Math.floor(deck.length / room.maxPlayers);
        room.players.forEach(p => p.hand = deck.splice(0, cpp));
        room.turn = room.players.findIndex(p => p.hand.some(c => c.suit === 'Spades' && c.rank === 'K'));
        room.isFirstMove = true;
        io.to(roomID).emit('gameInit', { players: room.players, turn: room.turn, discarded: room.discarded });
    });

    // Swap Hand Request Logic
    socket.on('sendSwapRequest', ({ roomID, fromUserID }) => {
        const room = rooms[roomID];
        const myIdx = room.players.findIndex(p => p.userID === fromUserID);
        let targetIdx = (myIdx + 1) % room.players.length;
        while (room.players[targetIdx].hand.length === 0) targetIdx = (targetIdx + 1) % room.players.length;
        
        io.to(room.players[targetIdx].id).emit('receiveSwapRequest', { fromName: room.players[myIdx].name, fromUserID });
    });

    socket.on('acceptSwap', ({ roomID, fromUserID, myUserID }) => {
        const room = rooms[roomID];
        const p1 = room.players.find(p => p.userID === fromUserID);
        const p2 = room.players.find(p => p.userID === myUserID);
        let temp = [...p1.hand];
        p1.hand = [...p2.hand];
        p2.hand = temp;
        io.to(roomID).emit('swapOccurred', { msg: `${p1.name} swapped with ${p2.name}!`, players: room.players });
    });

    socket.on('playCard', ({ roomID, cardObject }) => {
        const room = rooms[roomID];
        if (!room || room.players[room.turn].id !== socket.id) return;
        const player = room.players[room.turn];
        const cardIdx = player.hand.findIndex(c => c.suit === cardObject.suit && c.rank === cardObject.rank);
        const card = player.hand[cardIdx];

        if (room.isFirstMove && (card.suit !== 'Spades' || card.rank !== 'K')) return socket.emit('errorMsg', "Play King of Spades!");
        if (room.table.length > 0 && card.suit !== room.currentSuit && player.hand.some(c => c.suit === room.currentSuit)) return socket.emit('errorMsg', `Follow suit: ${room.currentSuit}`);

        room.isFirstMove = false;
        player.hand.splice(cardIdx, 1);
        room.table.push({ playerIdx: room.turn, card });
        if (room.table.length === 1) room.currentSuit = card.suit;

        io.to(roomID).emit('updateTable', { table: room.table, turn: room.turn, players: room.players });

        let pangkah = card.suit !== room.currentSuit;
        let active = room.players.filter(p => p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p)));

        if (pangkah || room.table.length === active.length) {
            setTimeout(() => {
                let win = -1, high = -1;
                room.table.forEach(t => { if(t.card.suit === room.currentSuit && t.card.val > high) { high = t.card.val; win = t.playerIdx; }});
                if (pangkah) room.players[win].hand.push(...room.table.map(t => t.card));
                let survivors = room.players.filter(p => p.hand.length > 0);
                if (survivors.length <= 1) { io.to(roomID).emit('gameOver', { loser: survivors[0]?.name || 'None' }); delete rooms[roomID]; }
                else { room.turn = win; room.table = []; room.currentSuit = null; io.to(roomID).emit('clearTable', { turn: win, winner: room.players[win].name, players: room.players, msg: pangkah ? "Pangkah!" : "Clean" }); }
            }, 1200);
        } else {
            do { room.turn = (room.turn + 1) % room.players.length; } while (room.players[room.turn].hand.length === 0);
            io.to(roomID).emit('nextTurn', { turn: room.turn, players: room.players, table: room.table });
        }
    });
});
server.listen(3000);
