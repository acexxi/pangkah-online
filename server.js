require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pangkah';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// Player Schema - MongoDB is the SINGLE SOURCE OF TRUTH
const playerSchema = new mongoose.Schema({
    userID: { type: String, required: true, unique: true },
    displayName: { type: String, default: 'Player' },
    xp: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    games: { type: Number, default: 0 },
    pangkahs: { type: Number, default: 0 },
    pangkahsReceived: { type: Number, default: 0 },
    bestStreak: { type: Number, default: 0 },
    currentStreak: { type: Number, default: 0 },
    handsAbsorbed: { type: Number, default: 0 },
    handsGiven: { type: Number, default: 0 },
    cleanWins: { type: Number, default: 0 },
    maxCardsHeld: { type: Number, default: 0 },
    autoPlays: { type: Number, default: 0 },
    cardsPlayed: { type: Number, default: 0 },
    secondPlace: { type: Number, default: 0 },
    thirdPlace: { type: Number, default: 0 },
    fourthToTenth: { type: Number, default: 0 },
    topTwo: { type: Number, default: 0 },
    nightGames: { type: Number, default: 0 },
    comebacks: { type: Number, default: 0 },
    perfectWins: { type: Number, default: 0 },
    pangkahsReceivedFromBot: { type: Number, default: 0 },
    lossesToBot: { type: Number, default: 0 },
    handsAbsorbedFromBot: { type: Number, default: 0 },
    unlockedTitles: { type: [String], default: [] },
    equippedTitle: { type: String, default: null },
    isBetaTester: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastPlayedAt: { type: Date, default: Date.now }
});

const Player = mongoose.model('Player', playerSchema);

const XP_PER_LEVEL = 100;
function getLevel(xp) { return Math.floor((xp || 0) / XP_PER_LEVEL) + 1; }

// Title requirements for server-side validation
const TITLE_REQS = {
    'ancient_ancestor': {t:'level',v:50}, 'pangkah_god': {t:'pangkahs',v:500}, 'unbreakable': {t:'streak',v:10},
    'thousand_victories': {t:'wins',v:1000}, 'sect_master': {t:'games',v:2000}, 'immortal': {t:'xp',v:100000},
    'warrior': {t:'level',v:5}, 'first_pangkah': {t:'pangkahs',v:1}, 'first_blood': {t:'wins',v:1},
    'newcomer': {t:'games',v:10}, 'learner': {t:'xp',v:1000}, 'victor': {t:'wins',v:10}
};

function getStatValue(player, type) {
    switch(type) {
        case 'level': return getLevel(player.xp);
        case 'pangkahs': return player.pangkahs || 0;
        case 'streak': return player.bestStreak || 0;
        case 'wins': return player.wins || 0;
        case 'games': return player.games || 0;
        case 'xp': return player.xp || 0;
        case 'losses': return player.losses || 0;
        case 'cleanWins': return player.cleanWins || 0;
        case 'handsAbsorbed': return player.handsAbsorbed || 0;
        default: return 0;
    }
}

async function checkAndUnlockTitles(player) {
    const newTitles = [];
    for (const [id, req] of Object.entries(TITLE_REQS)) {
        if (!player.unlockedTitles.includes(id) && getStatValue(player, req.t) >= req.v) {
            player.unlockedTitles.push(id);
            newTitles.push(id);
        }
    }
    return newTitles;
}

// ============ API ROUTES ============
app.get('/api/player/:userID', async (req, res) => {
    try {
        console.log('[API] Get player request for:', req.params.userID);
        let player = await Player.findOne({ userID: req.params.userID });
        if (!player) {
            player = new Player({ userID: req.params.userID, displayName: 'Disciple' + Math.floor(Math.random() * 999) });
            await player.save();
            console.log('[API] Created new player:', player.displayName);
        } else {
            console.log('[API] Found player:', player.displayName, '- XP:', player.xp, 'Wins:', player.wins);
        }
        res.json(player);
    } catch (err) { 
        console.error('[API] Get player error:', err);
        res.status(500).json({ error: 'Failed to get player' }); 
    }
});

app.post('/api/player/update-name', async (req, res) => {
    try {
        const { userID, displayName } = req.body;
        if (!userID || !displayName) return res.status(400).json({ error: 'Missing fields' });
        const trimmed = displayName.trim();
        if (trimmed.length < 1 || trimmed.length > 20) return res.status(400).json({ error: 'Name must be 1-20 chars' });
        const player = await Player.findOneAndUpdate({ userID }, { $set: { displayName: trimmed } }, { new: true });
        if (!player) return res.status(404).json({ error: 'Player not found' });
        res.json({ success: true, displayName: player.displayName });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/player/equip-title', async (req, res) => {
    try {
        const { userID, titleId } = req.body;
        const player = await Player.findOne({ userID });
        if (!player) return res.status(404).json({ error: 'Player not found' });
        if (titleId && !player.unlockedTitles.includes(titleId)) return res.status(400).json({ error: 'Title not unlocked' });
        player.equippedTitle = titleId || null;
        await player.save();
        res.json({ success: true, equippedTitle: player.equippedTitle });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/leaderboard/:type', async (req, res) => {
    try {
        const { type } = req.params;
        let sortField = type === 'wins' ? 'wins' : type === 'losses' ? 'losses' : type === 'pangkahs' ? 'pangkahs' : type === 'streak' ? 'bestStreak' : 'xp';
        const players = await Player.find().sort({ [sortField]: -1 }).limit(100)
            .select('displayName userID xp wins losses games pangkahs pangkahsReceived bestStreak secondPlace thirdPlace fourthToTenth');
        res.json(players);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/hof-frames', async (req, res) => {
    try {
        const players = await Player.find({ games: { $gte: 10 } }).select('userID wins losses games pangkahs pangkahsReceived bestStreak');
        if (players.length === 0) return res.json({ holders: {} });
        const holders = {};
        const rates = players.map(p => ({ userID: p.userID, winRate: (p.wins||0)/(p.games||1)*100, loseRate: (p.losses||0)/(p.games||1)*100, bestStreak: p.bestStreak||0, pangkahs: p.pangkahs||0, pangkahsReceived: p.pangkahsReceived||0 }));
        const best = (arr, key) => arr.reduce((a,b) => (a[key]||0) > (b[key]||0) ? a : b, {});
        holders.winrate = best(rates, 'winRate').userID;
        holders.streak = best(rates.filter(r=>r.userID!==holders.winrate), 'bestStreak').userID;
        holders.pangkah = best(rates.filter(r=>!Object.values(holders).includes(r.userID)), 'pangkahs').userID;
        holders.loserate = best(rates.filter(r=>!Object.values(holders).includes(r.userID)), 'loseRate').userID;
        holders.magnet = best(rates.filter(r=>!Object.values(holders).includes(r.userID)), 'pangkahsReceived').userID;
        res.json({ holders });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/hall-of-fame', async (req, res) => {
    try {
        const players = await Player.find({ games: { $gt: 0 } });
        if (players.length === 0) return res.json({ records: [] });
        const records = [];
        const rates = players.map(p => ({ name: p.displayName, xp: p.xp||0, wins: p.wins||0, losses: p.losses||0, games: p.games||1, pangkahs: p.pangkahs||0, pangkahsReceived: p.pangkahsReceived||0, bestStreak: p.bestStreak||0, cleanWins: p.cleanWins||0, handsAbsorbed: p.handsAbsorbed||0, autoPlays: p.autoPlays||0, maxCardsHeld: p.maxCardsHeld||0, handsGiven: p.handsGiven||0, winRate: ((p.wins||0)/(p.games||1)*100).toFixed(1), loseRate: ((p.losses||0)/(p.games||1)*100).toFixed(1) }));
        const best = (arr, key) => arr.reduce((a,b) => (parseFloat(a[key])||0) > (parseFloat(b[key])||0) ? a : b, rates[0]);
        const eligible = rates.filter(p => p.games >= 5);
        if (eligible.length) { const b = best(eligible,'winRate'); records.push({id:'winrate',category:'glory',icon:'👑',title:'The Chosen One',player:b.name,value:b.winRate+'% win rate',description:'Highest win rate!'}); }
        const w = best(rates,'wins'); if(w.wins>0) records.push({id:'wins',category:'glory',icon:'🏆',title:'Victory Addict',player:w.name,value:w.wins+' wins',description:'Most wins!'});
        const s = best(rates,'bestStreak'); if(s.bestStreak>0) records.push({id:'streak',category:'glory',icon:'🔥',title:'Unstoppable',player:s.name,value:s.bestStreak+' streak',description:'Best streak!'});
        const x = best(rates,'xp'); if(x.xp>0) records.push({id:'xp',category:'glory',icon:'✨',title:'XP Goblin',player:x.name,value:x.xp+' XP',description:'Most XP!'});
        const pk = best(rates,'pangkahs'); if(pk.pangkahs>0) records.push({id:'pangkahs',category:'glory',icon:'⚡',title:'Pangkah King',player:pk.name,value:pk.pangkahs+' dealt',description:'Most pangkahs!'});
        if (eligible.length) { const l = best(eligible,'loseRate'); records.push({id:'loserate',category:'shame',icon:'🤡',title:'Professional Clown',player:l.name,value:l.loseRate+'% lose rate',description:'Highest lose rate!'}); }
        const lo = best(rates,'losses'); if(lo.losses>0) records.push({id:'losses',category:'shame',icon:'💀',title:'L Collector',player:lo.name,value:lo.losses+' losses',description:'Most losses!'});
        const pv = best(rates,'pangkahsReceived'); if(pv.pangkahsReceived>0) records.push({id:'gotpangkah',category:'shame',icon:'🎯',title:'Human Dartboard',player:pv.name,value:pv.pangkahsReceived+' received',description:'Most pangkahs received!'});
        res.json({ records });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ============ GM API ============
const GM_PASSWORD = process.env.GM_PASSWORD || 'pangkahgm';

app.post('/api/gm/verify', (req, res) => {
    res.json({ success: req.body.password === GM_PASSWORD, isGM: req.body.password === GM_PASSWORD });
});

app.get('/api/gm/search-player', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json({ player: null });
        const player = await Player.findOne({ $or: [{ displayName: { $regex: q, $options: 'i' } }, { userID: q }] });
        res.json({ player: player ? { userID: player.userID, displayName: player.displayName, xp: player.xp, wins: player.wins, losses: player.losses, games: player.games, pangkahs: player.pangkahs, pangkahsReceived: player.pangkahsReceived, bestStreak: player.bestStreak, currentStreak: player.currentStreak, handsAbsorbed: player.handsAbsorbed, handsGiven: player.handsGiven, cleanWins: player.cleanWins, maxCardsHeld: player.maxCardsHeld, autoPlays: player.autoPlays, isBetaTester: player.isBetaTester, unlockedTitles: player.unlockedTitles, equippedTitle: player.equippedTitle } : null });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/gm/update-player', async (req, res) => {
    try {
        const { targetUserID, updates } = req.body;
        console.log('[GM] Update request for:', targetUserID, 'Updates:', updates);
        const allowed = ['xp','wins','losses','games','pangkahs','pangkahsReceived','bestStreak','currentStreak','handsAbsorbed','handsGiven','cleanWins','maxCardsHeld','autoPlays','secondPlace','thirdPlace','fourthToTenth'];
        const safe = {}; allowed.forEach(k => { if(updates[k] !== undefined) safe[k] = updates[k]; });
        console.log('[GM] Safe updates:', safe);
        const player = await Player.findOneAndUpdate({ userID: targetUserID }, { $set: safe }, { new: true });
        if (!player) {
            console.log('[GM] Player not found:', targetUserID);
            return res.status(404).json({ error: 'Not found' });
        }
        await checkAndUnlockTitles(player);
        await player.save();
        console.log('[GM] Updated successfully:', player.displayName, '- New XP:', player.xp, 'Wins:', player.wins);
        res.json({ success: true, player: { xp: player.xp, wins: player.wins, games: player.games } });
    } catch (err) { 
        console.error('[GM] Update error:', err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

app.post('/api/gm/reset-player', async (req, res) => {
    try {
        const { targetUserID } = req.body;
        console.log('[GM] Reset request for:', targetUserID);
        const player = await Player.findOneAndUpdate({ userID: targetUserID }, { $set: { xp:0,wins:0,losses:0,games:0,pangkahs:0,pangkahsReceived:0,bestStreak:0,currentStreak:0,handsAbsorbed:0,handsGiven:0,cleanWins:0,maxCardsHeld:0,autoPlays:0,secondPlace:0,thirdPlace:0,fourthToTenth:0,topTwo:0,nightGames:0,comebacks:0,perfectWins:0,pangkahsReceivedFromBot:0,lossesToBot:0,handsAbsorbedFromBot:0,unlockedTitles:[],equippedTitle:null,isBetaTester:false }}, { new: true });
        if (!player) {
            console.log('[GM] Player not found for reset:', targetUserID);
            return res.status(404).json({ error: 'Not found' });
        }
        console.log('[GM] RESET successful:', player.displayName, '- XP is now:', player.xp);
        res.json({ success: true });
    } catch (err) { 
        console.error('[GM] Reset error:', err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

app.post('/api/gm/toggle-beta-tester', async (req, res) => {
    try {
        const { targetUserID, isBetaTester } = req.body;
        const player = await Player.findOneAndUpdate({ userID: targetUserID }, { $set: { isBetaTester } }, { new: true });
        if (!player) return res.status(404).json({ error: 'Not found' });
        console.log('[GM] Beta tester', player.displayName, isBetaTester);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/gm/rooms', (req, res) => {
    const list = Object.values(rooms).map(r => ({ id: r.id, playerCount: r.players.filter(p=>!p.isBot).length, maxPlayers: r.maxPlayers, inGame: r.gameStarted, botCount: r.players.filter(p=>p.isBot).length }));
    res.json({ rooms: list });
});

app.post('/api/gm/force-close-room', (req, res) => {
    const { roomID } = req.body;
    if (!rooms[roomID]) return res.status(404).json({ error: 'Not found' });
    io.to(roomID).emit('roomClosed');
    delete rooms[roomID];
    res.json({ success: true });
});

// ============ GAME STATE ============
const rooms = {};
const MIN_PLAYERS = 2, MAX_PLAYERS = 10, ROUND_DELAY = 1500, BOT_DELAY = 1200, BOT_LEAD_DELAY = 2000, TURN_LIMIT = 15000;
const turnTimers = {};

// Server-side game result processing
async function processGameResults(room) {
    const isNight = new Date().getHours() >= 22 || new Date().getHours() < 6;
    for (const p of room.players) {
        if (p.isBot) continue;
        try {
            const db = await Player.findOne({ userID: p.userID });
            if (!db) continue;
            const pos = p.gameStats?.finishPosition || room.players.length;
            const isWin = pos === 1, isLose = pos === room.players.length;
            
            db.games = (db.games||0) + 1;
            db.lastPlayedAt = new Date();
            
            if (isWin) {
                db.wins = (db.wins||0) + 1;
                db.currentStreak = (db.currentStreak||0) + 1;
                if (db.currentStreak > (db.bestStreak||0)) db.bestStreak = db.currentStreak;
                db.topTwo = (db.topTwo||0) + 1;
                if (p.gameStats?.pangkahsReceived === 0) db.perfectWins = (db.perfectWins||0) + 1;
            } else if (pos === 2) {
                db.secondPlace = (db.secondPlace||0) + 1;
                db.topTwo = (db.topTwo||0) + 1;
                db.currentStreak = 0;
            } else if (pos === 3) {
                db.thirdPlace = (db.thirdPlace||0) + 1;
                db.currentStreak = 0;
            } else if (pos >= 4) {
                db.fourthToTenth = (db.fourthToTenth||0) + 1;
                db.currentStreak = 0;
            }
            
            if (isLose) {
                db.losses = (db.losses||0) + 1;
                db.currentStreak = 0;
                if (p.gameStats?.lossesToBot) db.lossesToBot = (db.lossesToBot||0) + 1;
            }
            
            if (p.gameStats) {
                db.pangkahs = (db.pangkahs||0) + (p.gameStats.pangkahsDealt||0);
                db.pangkahsReceived = (db.pangkahsReceived||0) + (p.gameStats.pangkahsReceived||0);
                db.cleanWins = (db.cleanWins||0) + (p.gameStats.cleanWins||0);
                db.cardsPlayed = (db.cardsPlayed||0) + (p.gameStats.cardsPlayed||0);
                if (p.gameStats.comebacks) db.comebacks = (db.comebacks||0) + p.gameStats.comebacks;
                if ((p.gameStats.maxCardsThisGame||0) > (db.maxCardsHeld||0)) db.maxCardsHeld = p.gameStats.maxCardsThisGame;
                if (p.gameStats.pangkahsReceivedFromBot) db.pangkahsReceivedFromBot = (db.pangkahsReceivedFromBot||0) + p.gameStats.pangkahsReceivedFromBot;
            }
            
            if (isNight) db.nightGames = (db.nightGames||0) + 1;
            
            let xp = isWin ? 15 + (db.currentStreak > 1 ? db.currentStreak * 2 : 0) : pos === 2 ? 8 : pos === 3 ? 5 : isLose ? -2 : 2;
            xp += (p.gameStats?.pangkahsDealt||0) * 3 + (p.gameStats?.cleanWins||0);
            db.xp = Math.max(0, (db.xp||0) + xp);
            
            const newTitles = await checkAndUnlockTitles(db);
            await db.save();
            
            console.log('[RESULT]', db.displayName, 'Pos:', pos, 'XP:', xp>0?'+'+xp:xp);
            
            const sock = room.players.find(x => x.userID === p.userID);
            if (sock?.id) io.to(sock.id).emit('statsUpdated', { xp: db.xp, wins: db.wins, losses: db.losses, games: db.games, pangkahs: db.pangkahs, bestStreak: db.bestStreak, currentStreak: db.currentStreak, unlockedTitles: db.unlockedTitles, newTitles, xpGain: xp, position: pos });
        } catch (e) { console.error('[RESULT ERR]', p.userID, e.message); }
    }
}

async function trackAutoPlay(userID) {
    await Player.findOneAndUpdate({ userID }, { $inc: { autoPlays: 1 } }).catch(()=>{});
}

async function trackHandAbsorb(absorbID, giveID, isBot) {
    await Player.findOneAndUpdate({ userID: absorbID }, { $inc: { handsAbsorbed: 1, ...(isBot ? { handsAbsorbedFromBot: 1 } : {}) } }).catch(()=>{});
    if (!isBot) await Player.findOneAndUpdate({ userID: giveID }, { $inc: { handsGiven: 1 } }).catch(()=>{});
}

// Deck
function createDeck() {
    const suits = ['Spades','Hearts','Diamonds','Clubs'], ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    return suits.flatMap(s => ranks.map((r,i) => ({ suit: s, rank: r, val: i })));
}
function shuffle(arr) { for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function deal(room) {
    const deck = shuffle(createDeck());
    room.players.forEach(p => p.hand = []);
    deck.forEach((c,i) => room.players[i % room.players.length].hand.push(c));
    room.turn = room.players.findIndex(p => p.hand.some(c => c.suit==='Spades' && c.rank==='K'));
}
function generateBotName() {
    const pre = ['Iron','Shadow','Thunder','Jade','Silent','Azure','Crimson','Golden','Silver','Dark'];
    const suf = ['Dragon','Phoenix','Tiger','Serpent','Lotus','Blade','Storm','Moon','Star','Fist'];
    return pre[Math.floor(Math.random()*pre.length)] + ' ' + suf[Math.floor(Math.random()*suf.length)];
}
function initStats(p) { p.gameStats = { pangkahsDealt:0, pangkahsReceived:0, pangkahsReceivedFromBot:0, cleanWins:0, cardsPlayed:0, comebacks:0, hadMostCards:false, maxCardsThisGame: p.hand?.length||0, finishPosition:0, lossesToBot:0 }; }

// Timers
function startTimer(rid) {
    clearTimer(rid);
    const room = rooms[rid];
    if (!room?.gameStarted || room.players[room.turn]?.isBot) return;
    turnTimers[rid] = setTimeout(async () => {
        const r = rooms[rid]; if (!r?.gameStarted) return;
        const p = r.players[r.turn]; if (!p?.hand.length) return;
        let card = r.isFirstMove ? p.hand.find(c=>c.suit==='Spades'&&c.rank==='K') : r.currentSuit ? p.hand.find(c=>c.suit===r.currentSuit) : null;
        if (!card) card = p.hand[0];
        if (!p.isBot) await trackAutoPlay(p.userID);
        processCard(rid, r.turn, card);
    }, TURN_LIMIT);
    io.to(rid).emit('turnTimerStarted', { timeLimit: TURN_LIMIT });
}
function clearTimer(rid) { if(turnTimers[rid]){clearTimeout(turnTimers[rid]);delete turnTimers[rid];} }

function processCard(rid, idx, card) {
    const room = rooms[rid]; if(!room) return;
    clearTimer(rid);
    const p = room.players[idx];
    const ci = p.hand.findIndex(c => c.suit===card.suit && c.rank===card.rank);
    if (ci === -1) return;
    const played = p.hand.splice(ci, 1)[0];
    if (p.gameStats) { p.gameStats.cardsPlayed++; if(p.hand.length > p.gameStats.maxCardsThisGame) p.gameStats.maxCardsThisGame = p.hand.length; }
    if (room.table.length === 0) room.currentSuit = played.suit;
    room.table.push({ card: played, playerIdx: idx, playerName: p.name });
    room.isFirstMove = false;
    const isPangkah = played.suit !== room.currentSuit;
    if (isPangkah && p.gameStats) { p.gameStats.pangkahsDealt++; room.pangkahDealer = p.userID; }
    io.to(rid).emit('cardPlayed', { playerIdx: idx, playerName: p.name, card: played, leadSuit: room.currentSuit, isPangkah, players: room.players, turn: room.turn, table: room.table });
    if (p.hand.length === 0 && !room.finishOrder.includes(p.userID)) {
        room.finishOrder.push(p.userID);
        if(p.gameStats) { p.gameStats.finishPosition = room.finishOrder.length; if(p.gameStats.hadMostCards && p.gameStats.finishPosition <= 2) p.gameStats.comebacks++; }
    }
    const complete = room.table.length >= room.players.filter(x => x.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(x))).length;
    if (isPangkah || complete) { room.resolving = true; setTimeout(() => resolveRound(rid, isPangkah), ROUND_DELAY); }
    else advancePlayer(rid);
}

function advancePlayer(rid) {
    const room = rooms[rid]; if(!room) return;
    let next = (room.turn + 1) % room.players.length, att = 0;
    while (room.players[next].hand.length === 0 && att < room.players.length) { next = (next + 1) % room.players.length; att++; }
    room.turn = next;
    io.to(rid).emit('nextTurn', { turn: room.turn, players: room.players, currentSuit: room.currentSuit, table: room.table, fateAces: room.fateAces });
    if (room.players[room.turn]?.isBot) botTurn(rid); else startTimer(rid);
}

function resolveRound(rid, isPangkah) {
    const room = rooms[rid]; if(!room) return;
    let winIdx = -1, high = -1;
    room.table.forEach(t => { if(t.card.suit === room.currentSuit && t.card.val > high) { high = t.card.val; winIdx = t.playerIdx; } });
    if (winIdx === -1) winIdx = room.table[0].playerIdx;
    const winner = room.players[winIdx];
    if (isPangkah) {
        winner.hand.push(...room.table.map(t => t.card));
        if (winner.gameStats) {
            winner.gameStats.pangkahsReceived++;
            const dealer = room.players.find(x => x.userID === room.pangkahDealer);
            if (dealer?.isBot && !winner.isBot) winner.gameStats.pangkahsReceivedFromBot = (winner.gameStats.pangkahsReceivedFromBot||0) + 1;
            if (winner.hand.length > winner.gameStats.maxCardsThisGame) winner.gameStats.maxCardsThisGame = winner.hand.length;
            if (winner.hand.length >= 15) winner.gameStats.hadMostCards = true;
        }
    } else {
        room.discarded.push(...room.table.map(t => t.card));
        if (winner.gameStats) winner.gameStats.cleanWins++;
    }
    room.players.forEach(p => { if(p.hand.length===0 && !room.finishOrder.includes(p.userID)) { room.finishOrder.push(p.userID); if(p.gameStats){p.gameStats.finishPosition=room.finishOrder.length;if(p.gameStats.hadMostCards&&p.gameStats.finishPosition<=2)p.gameStats.comebacks++;} } });
    const survivors = room.players.filter(p => p.hand.length > 0);
    if (survivors.length <= 1) {
        clearTimer(rid);
        const loser = survivors[0];
        if (loser) {
            room.finishOrder.push(loser.userID);
            if(loser.gameStats) loser.gameStats.finishPosition = room.players.length;
            if (!loser.isBot && room.finishOrder.length >= 2) {
                const prev = room.players.find(x => x.userID === room.finishOrder[room.finishOrder.length-2]);
                if (prev?.isBot && loser.gameStats) loser.gameStats.lossesToBot = 1;
            }
        }
        io.to(rid).emit('gameOver', { loser: loser?.name||'None', loserUserID: loser?.userID, finishOrder: room.finishOrder, gameNumber: room.gameNumber, performanceData: room.players.map(x=>({userID:x.userID,name:x.name,position:x.gameStats?.finishPosition||0,stats:x.gameStats,equippedTitle:x.equippedTitle,isBot:x.isBot})) });
        processGameResults(room);
        room.gameStarted = false;
        room.players.forEach(p => { if(p.isBot) p.rematchReady = true; });
        broadcastRooms();
    } else {
        room.table = []; room.currentSuit = null; room.turn = winIdx; room.resolving = false;
        io.to(rid).emit('clearTable', { msg: isPangkah?'Pangkah!':'Clean!', winner: winner.name, winnerUserID: winner.userID, pangkahDealerUserID: isPangkah?room.pangkahDealer:null, turn: room.turn, players: room.players, fateAces: room.fateAces });
        setTimeout(() => { if(room.players[room.turn]?.isBot) botTurn(rid, true); else startTimer(rid); }, 500);
    }
}

function botTurn(rid, leading = false) {
    const room = rooms[rid]; if(!room?.gameStarted) return;
    const bot = room.players[room.turn]; if(!bot?.isBot || !bot.hand.length) return;
    setTimeout(() => {
        if (!rooms[rid]?.gameStarted || rooms[rid].turn !== room.players.indexOf(bot)) return;
        let card;
        if (room.isFirstMove) card = bot.hand.find(c=>c.suit==='Spades'&&c.rank==='K');
        else {
            const suit = bot.hand.filter(c=>c.suit===room.currentSuit);
            if (suit.length) {
                const high = suit.reduce((a,b)=>a.val>b.val?a:b);
                const low = suit.reduce((a,b)=>a.val<b.val?a:b);
                const curHigh = room.table.filter(t=>t.card.suit===room.currentSuit).reduce((m,t)=>Math.max(m,t.card.val),-1);
                card = (high.val > curHigh && Math.random() > 0.3) ? high : low;
            } else card = bot.hand.reduce((a,b)=>a.val>b.val?a:b);
        }
        if (card) processCard(rid, room.turn, card);
    }, leading ? BOT_LEAD_DELAY : BOT_DELAY);
}

const broadcastRooms = () => io.emit('roomList', Object.keys(rooms).map(id => ({ id, count: rooms[id].players.length, max: rooms[id].maxPlayers, inGame: rooms[id].gameStarted })));

app.get('/health', (req, res) => res.json({ status: 'ok', rooms: Object.keys(rooms).length }));

// ============ SOCKETS ============
io.on('connection', (socket) => {
    broadcastRooms();
    
    socket.on('checkSession', ({ userID }) => {
        for (let rid in rooms) {
            const idx = rooms[rid].players.findIndex(p => p.userID === userID);
            if (idx !== -1) {
                rooms[rid].players[idx].id = socket.id;
                socket.join(rid);
                socket.emit('reconnectSuccess', { roomID: rid, players: rooms[rid].players, turn: rooms[rid].turn, table: rooms[rid].table, fateAces: rooms[rid].fateAces||[], gameStarted: rooms[rid].gameStarted, isFirstMove: rooms[rid].isFirstMove, currentSuit: rooms[rid].currentSuit, gameNumber: rooms[rid].gameNumber||1 });
                return;
            }
        }
    });
    
    socket.on('requestCloseRoom', ({ roomID }) => { if(rooms[roomID]){io.to(roomID).emit('roomClosed');delete rooms[roomID];broadcastRooms();} });
    
    socket.on('createRoom', async ({ roomID, playerName, maxPlayers, userID, equippedTitle, level, isGM, botCount }) => {
        if (!roomID || !playerName || !userID) return socket.emit('errorMsg', 'Missing fields');
        if (rooms[roomID]) return socket.emit('errorMsg', 'Room exists');
        const max = parseInt(maxPlayers); if (isNaN(max) || max < MIN_PLAYERS || max > MAX_PLAYERS) return socket.emit('errorMsg', 'Invalid max');
        let db = await Player.findOne({ userID }); if(!db) { db = new Player({ userID, displayName: playerName }); await db.save(); }
        const bots = Math.min(Math.max(parseInt(botCount)||0, 0), 3);
        rooms[roomID] = { id: roomID, maxPlayers: max, players: [{ id: socket.id, name: playerName, userID, hand: [], equippedTitle, level: getLevel(db.xp), isGM, isBetaTester: db.isBetaTester, isBot: false, gameStats: null, rematchReady: false }], turn: 0, table: [], currentSuit: null, isFirstMove: true, discarded: [], fateAces: [], gameStarted: false, resolving: false, gameNumber: 0, finishOrder: [], hostUserID: userID, pangkahDealer: null };
        for (let i = 0; i < bots; i++) rooms[roomID].players.push({ id: `bot_${roomID}_${i}`, name: generateBotName(), userID: `bot_${roomID}_${i}`, hand: [], level: Math.floor(Math.random()*20)+1, isBot: true, gameStats: null, rematchReady: false });
        socket.join(roomID);
        socket.emit('roomJoined', { roomID, players: rooms[roomID].players, isHost: true, maxPlayers: max });
        broadcastRooms();
    });
    
    socket.on('joinRoom', async ({ roomID, playerName, userID, equippedTitle, level, isGM }) => {
        if (!roomID || !playerName || !userID) return socket.emit('errorMsg', 'Missing fields');
        const room = rooms[roomID]; if (!room) return socket.emit('errorMsg', 'Not found');
        if (room.players.length >= room.maxPlayers) return socket.emit('errorMsg', 'Full');
        if (room.gameStarted) return socket.emit('errorMsg', 'In progress');
        let db = await Player.findOne({ userID }); if(!db) { db = new Player({ userID, displayName: playerName }); await db.save(); }
        room.players.push({ id: socket.id, name: playerName, userID, hand: [], equippedTitle, level: getLevel(db.xp), isGM, isBetaTester: db.isBetaTester, isBot: false, gameStats: null, rematchReady: false });
        socket.join(roomID);
        io.to(roomID).emit('playerJoined', { players: room.players, maxPlayers: room.maxPlayers });
        socket.emit('roomJoined', { roomID, players: room.players, isHost: room.hostUserID === userID, maxPlayers: room.maxPlayers });
        broadcastRooms();
    });
    
    socket.on('startGame', (roomID) => {
        const room = rooms[roomID]; if (!room) return;
        if (room.players.filter(p=>!p.isBot).length < 1) return socket.emit('errorMsg', 'Need human');
        if (room.players.length < MIN_PLAYERS) return socket.emit('errorMsg', 'Need more');
        room.gameNumber++; room.gameStarted = true; room.finishOrder = []; room.fateAces = []; room.discarded = []; room.pangkahDealer = null;
        room.players.forEach(p => { p.rematchReady = false; initStats(p); });
        deal(room);
        io.to(roomID).emit('gameStarted', { players: room.players, turn: room.turn, gameNumber: room.gameNumber });
        broadcastRooms();
        if (room.players[room.turn].isBot) botTurn(roomID, true); else startTimer(roomID);
    });
    
    socket.on('playCard', ({ roomID, cardObject }) => {
        const room = rooms[roomID]; if (!room || room.resolving) return;
        if (room.players[room.turn].id !== socket.id) return socket.emit('errorMsg', 'Not your turn');
        const p = room.players[room.turn];
        const ci = p.hand.findIndex(c => c.suit===cardObject.suit && c.rank===cardObject.rank);
        if (ci === -1) return socket.emit('errorMsg', 'Card not found');
        const card = p.hand[ci];
        if (room.isFirstMove && (card.suit !== 'Spades' || card.rank !== 'K')) return socket.emit('errorMsg', 'Must play K♠');
        if (room.table.length > 0 && card.suit !== room.currentSuit && p.hand.some(c => c.suit === room.currentSuit)) return socket.emit('errorMsg', 'Must follow suit');
        processCard(roomID, room.turn, cardObject);
    });
    
    socket.on('sendSwapRequest', async ({ roomID, fromUserID }) => {
        const room = rooms[roomID]; if (!room?.gameStarted) return;
        const myIdx = room.players.findIndex(p => p.userID === fromUserID);
        if (myIdx === -1 || room.turn !== myIdx) return;
        let tgt = (myIdx + 1) % room.players.length, att = 0;
        while (room.players[tgt].hand.length === 0 && att < room.players.length) { tgt = (tgt + 1) % room.players.length; att++; }
        if (tgt === myIdx || !room.players[tgt].hand.length) return;
        const target = room.players[tgt];
        if (target.isBot) {
            setTimeout(async () => {
                if (!rooms[roomID]) return;
                const req = room.players[myIdx];
                req.hand.push(...target.hand); target.hand = [];
                await trackHandAbsorb(req.userID, target.userID, true);
                if (!room.finishOrder.includes(target.userID)) { room.finishOrder.push(target.userID); if(target.gameStats) target.gameStats.finishPosition = room.finishOrder.length; }
                io.to(roomID).emit('swapOccurred', { msg: `${req.name} absorbed ${target.name}'s hand!`, requesterUserID: req.userID, accepterUserID: target.userID, players: room.players, turn: room.turn, table: room.table, finishOrder: room.finishOrder });
                const surv = room.players.filter(p => p.hand.length > 0);
                if (surv.length <= 1) {
                    clearTimer(roomID);
                    if (surv[0]) { room.finishOrder.push(surv[0].userID); if(surv[0].gameStats) surv[0].gameStats.finishPosition = room.players.length; }
                    io.to(roomID).emit('gameOver', { loser: surv[0]?.name||'None', loserUserID: surv[0]?.userID, finishOrder: room.finishOrder, gameNumber: room.gameNumber, performanceData: room.players.map(x=>({userID:x.userID,name:x.name,position:x.gameStats?.finishPosition||0,stats:x.gameStats,equippedTitle:x.equippedTitle})) });
                    processGameResults(room); room.gameStarted = false; broadcastRooms();
                }
            }, 3000);
        } else io.to(target.id).emit('receiveSwapRequest', { fromName: room.players[myIdx].name, fromUserID });
    });
    
    socket.on('acceptSwap', async ({ roomID, fromUserID, myUserID }) => {
        const room = rooms[roomID]; if (!room) return;
        const req = room.players.find(p => p.userID === fromUserID);
        const acc = room.players.find(p => p.userID === myUserID);
        if (!req || !acc) return;
        req.hand.push(...acc.hand); acc.hand = [];
        await trackHandAbsorb(req.userID, acc.userID, false);
        if (!room.finishOrder.includes(acc.userID)) { room.finishOrder.push(acc.userID); if(acc.gameStats) acc.gameStats.finishPosition = room.finishOrder.length; }
        io.to(roomID).emit('swapOccurred', { msg: `${req.name} absorbed ${acc.name}'s hand!`, requesterUserID: req.userID, accepterUserID: acc.userID, players: room.players, turn: room.turn, table: room.table, finishOrder: room.finishOrder });
        const surv = room.players.filter(p => p.hand.length > 0);
        if (surv.length <= 1) {
            clearTimer(roomID);
            if (surv[0]) { room.finishOrder.push(surv[0].userID); if(surv[0].gameStats) surv[0].gameStats.finishPosition = room.players.length; }
            io.to(roomID).emit('gameOver', { loser: surv[0]?.name||'None', loserUserID: surv[0]?.userID, finishOrder: room.finishOrder, gameNumber: room.gameNumber, performanceData: room.players.map(x=>({userID:x.userID,name:x.name,position:x.gameStats?.finishPosition||0,stats:x.gameStats,equippedTitle:x.equippedTitle})) });
            processGameResults(room); room.gameStarted = false; broadcastRooms();
        } else startTimer(roomID);
    });
    
    socket.on('declineSwap', ({ roomID, fromUserID }) => { const room = rooms[roomID]; const req = room?.players.find(p=>p.userID===fromUserID); if(req) io.to(req.id).emit('swapDeclined'); });
    socket.on('updateTitle', ({ roomID, userID, title }) => { const room = rooms[roomID]; const p = room?.players.find(x=>x.userID===userID); if(p){p.equippedTitle=title;io.to(roomID).emit('playerTitleUpdated',{userID,title,players:room.players});} });
    socket.on('requestRematch', ({ roomID, userID }) => { const room = rooms[roomID]; if(!room||room.gameStarted) return; const p = room.players.find(x=>x.userID===userID); if(p){p.rematchReady=true;io.to(roomID).emit('rematchStatus',{readyCount:room.players.filter(x=>x.rematchReady).length,totalCount:room.players.length,allReady:room.players.every(x=>x.rematchReady)});} });
    socket.on('sendEmote', ({ roomID, userID, playerName, emoji }) => { if(roomID) socket.to(roomID).emit('receiveEmote', { userID, playerName, emoji }); });
    socket.on('leaveRoom', ({ roomID, userID }) => { const room = rooms[roomID]; if(!room) return; const idx = room.players.findIndex(p=>p.userID===userID); if(idx!==-1){const p=room.players.splice(idx,1)[0];socket.leave(roomID);if(!room.players.filter(x=>!x.isBot).length)delete rooms[roomID];else io.to(roomID).emit('playerLeft',{name:p.name,playersCount:room.players.filter(x=>!x.isBot).length});}broadcastRooms(); });
    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🎴 Pangkah Server v3 (MongoDB) on port ' + PORT));
