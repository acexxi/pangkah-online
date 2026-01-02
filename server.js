// Add 'isFirstMove: true' to your room creation logic inside socket.on('createRoom')
// roomID: { ... turn: 0, table: [], currentSuit: null, isFirstMove: true }

socket.on('startGame', (roomID) => {
    const room = rooms[roomID];
    if (!room) return;
    let deck = generateDeck();
    let cardsPerPlayer = Math.floor(52 / room.maxPlayers);
    room.players.forEach(p => p.hand = deck.splice(0, cardsPerPlayer));
    
    // Find who has King of Spades
    let starterIdx = room.players.findIndex(p => p.hand.some(c => c.suit === 'Spades' && c.rank === 'K'));
    room.turn = starterIdx !== -1 ? starterIdx : 0;
    room.isFirstMove = true; // NEW: Track the very first move of the match
    io.to(roomID).emit('gameInit', { players: room.players, turn: room.turn });
});

socket.on('playCard', ({ roomID, cardObject }) => {
    const room = rooms[roomID];
    if (!room || room.players[room.turn].id !== socket.id) return;

    const player = room.players[room.turn];
    const cardIndex = player.hand.findIndex(c => c.suit === cardObject.suit && c.rank === cardObject.rank);
    if (cardIndex === -1) return;

    const playedCard = player.hand[cardIndex];

    // --- NEW: STRICT KING SPADE RULE ---
    if (room.isFirstMove) {
        if (playedCard.suit !== 'Spades' || playedCard.rank !== 'K') {
            return socket.emit('errorMsg', "The first card played must be the King of Spades!");
        }
        room.isFirstMove = false; // Rule satisfied, allow normal play now
    }

    // --- EXISTING SUIT VALIDATION ---
    if (room.table.length > 0 && playedCard.suit !== room.currentSuit) {
        const hasSuitInHand = player.hand.some(c => c.suit === room.currentSuit);
        if (hasSuitInHand) {
            return socket.emit('errorMsg', `Invalid move! You still have ${room.currentSuit} in hand.`);
        }
    }

    // ... (rest of the logic remains the same)
    player.hand.splice(cardIndex, 1);
    room.table.push({ playerIdx: room.turn, playerName: player.name, card: playedCard });
    
    let isPangkah = false;
    if (room.table.length === 1) {
        room.currentSuit = playedCard.suit;
    } else if (playedCard.suit !== room.currentSuit) {
        isPangkah = true;
    }

    io.to(roomID).emit('updateTable', { table: room.table, turn: room.turn, players: room.players });

    // Round end logic...
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

            let msg = isPangkah ? `${room.players[leadWinnerIdx].name} took all cards! (Penalty)` : `Round cleared.`;
            
            if (isPangkah) {
                room.players[leadWinnerIdx].hand.push(...room.table.map(t => t.card));
            }

            let survivors = room.players.filter(p => p.hand.length > 0);
            if (survivors.length <= 1) {
                io.to(roomID).emit('gameOver', { loser: survivors[0]?.name || "None" });
                delete rooms[roomID];
            } else {
                room.turn = leadWinnerIdx;
                room.table = [];
                room.currentSuit = null;
                io.to(roomID).emit('clearTable', { turn: room.turn, winner: room.players[leadWinnerIdx].name, players: room.players, msg: msg });
            }
        }, 2000);
    } else {
        do {
            room.turn = (room.turn + 1) % room.players.length;
        } while (room.players[room.turn].hand.length === 0);
        io.to(roomID).emit('nextTurn', { turn: room.turn, players: room.players, table: room.table });
    }
});
