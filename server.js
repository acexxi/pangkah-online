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
    // LEGENDARY
    'ancient_ancestor': {t:'level',v:50}, 'pangkah_god': {t:'pangkahs',v:500}, 'unbreakable': {t:'streak',v:10},
    'thousand_victories': {t:'wins',v:1000}, 'sect_master': {t:'games',v:2000}, 'immortal': {t:'xp',v:100000},
    'card_billionaire': {t:'maxCardsHeld',v:30}, 'comeback_king': {t:'comebacks',v:5}, 'perfect_game': {t:'perfectWins',v:10},
    'no_life': {t:'games',v:5000}, 'ultimate_loser': {t:'losses',v:500}, 'clean_legend': {t:'cleanWins',v:500},
    'hand_emperor': {t:'handsAbsorbed',v:200},
    // EPIC
    'grandmaster': {t:'level',v:30}, 'pangkah_master': {t:'pangkahs',v:200}, 'untouchable': {t:'streak',v:7},
    'champion': {t:'wins',v:500}, 'veteran': {t:'games',v:1000}, 'enlightened': {t:'xp',v:50000},
    'absorber': {t:'handsAbsorbed',v:100}, 'night_owl': {t:'nightGames',v:100}, 'card_hoarder': {t:'maxCardsHeld',v:25},
    'serial_loser': {t:'losses',v:100}, 'survivor': {t:'comebacks',v:50}, 'sleepwalker': {t:'autoPlays',v:100},
    'punching_bag': {t:'pangkahsReceived',v:200}, 'santa_claus': {t:'handsGiven',v:50}, 'clean_master': {t:'cleanWins',v:200},
    'bronze_collector': {t:'thirdPlace',v:50},
    // RARE
    'master': {t:'level',v:15}, 'pangkah_adept': {t:'pangkahs',v:50}, 'hot_streak': {t:'streak',v:5},
    'conqueror': {t:'wins',v:100}, 'dedicated': {t:'games',v:500}, 'cultivator': {t:'xp',v:10000},
    'hand_collector': {t:'handsAbsorbed',v:30}, 'consistent': {t:'topTwo',v:50}, 'second_best': {t:'secondPlace',v:25},
    'card_magnet': {t:'maxCardsHeld',v:20}, 'generous_soul': {t:'handsGiven',v:20}, 'afk_master': {t:'autoPlays',v:50},
    'clean_player': {t:'cleanWins',v:100}, 'pangkah_victim': {t:'pangkahsReceived',v:100}, 'elder': {t:'level',v:20},
    // COMMON
    'warrior': {t:'level',v:5}, 'first_pangkah': {t:'pangkahs',v:1}, 'first_blood': {t:'wins',v:1},
    'newcomer': {t:'games',v:10}, 'regular': {t:'games',v:50}, 'learner': {t:'xp',v:1000},
    'pangkah_novice': {t:'pangkahs',v:10}, 'victor': {t:'wins',v:10}, 'determined': {t:'wins',v:25},
    'hand_taker': {t:'handsAbsorbed',v:5}, 'streak_starter': {t:'streak',v:3}, 'persistent': {t:'games',v:100},
    'collector': {t:'cardsPlayed',v:1000}, 'runner_up': {t:'secondPlace',v:5}, 'third_wheel': {t:'thirdPlace',v:5},
    'first_loser': {t:'losses',v:1}, 'unlucky': {t:'losses',v:10}, 'sleepy': {t:'autoPlays',v:10},
    'give_hand': {t:'handsGiven',v:1}, 'heavy_hand': {t:'maxCardsHeld',v:15}, 'clean_start': {t:'cleanWins',v:10}
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
        case 'handsGiven': return player.handsGiven || 0;
        case 'maxCardsHeld': return player.maxCardsHeld || 0;
        case 'autoPlays': return player.autoPlays || 0;
        case 'cardsPlayed': return player.cardsPlayed || 0;
        case 'secondPlace': return player.secondPlace || 0;
        case 'thirdPlace': return player.thirdPlace || 0;
        case 'topTwo': return player.topTwo || 0;
        case 'nightGames': return player.nightGames || 0;
        case 'comebacks': return player.comebacks || 0;
        case 'perfectWins': return player.perfectWins || 0;
        case 'pangkahsReceived': return player.pangkahsReceived || 0;
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
            // Check and unlock any titles the player has earned
            const newTitles = await checkAndUnlockTitles(player);
            if (newTitles.length > 0) {
                await player.save();
                console.log('[API] Unlocked new titles for', player.displayName, ':', newTitles);
            }
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
        
        // Check if title can be equipped
        if (titleId) {
            // GM titles (celestial_marshal, shadow_magistrate) - check if player is GM (handled by client, server trusts)
            const gmTitleIds = ['celestial_marshal', 'shadow_magistrate'];
            // Beta titles - check if player is beta tester
            const betaTitleIds = ['dragon_vanguard', 'founders_circle', 'supreme_leader'];
            
            const isGMTitle = gmTitleIds.includes(titleId);
            const isBetaTitle = betaTitleIds.includes(titleId);
            
            // Allow if: unlocked, OR beta tester equipping beta title
            const canEquip = player.unlockedTitles.includes(titleId) || 
                            (isBetaTitle && player.isBetaTester) ||
                            isGMTitle; // GM status checked client-side
            
            if (!canEquip) {
                return res.status(400).json({ error: 'Title not unlocked' });
            }
        }
        
        player.equippedTitle = titleId || null;
        await player.save();
        res.json({ success: true, equippedTitle: player.equippedTitle });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/leaderboard/:type', async (req, res) => {
    try {
        const { type } = req.params;
        
        // For rate-based sorting, we need to fetch all and sort in memory
        if (type === 'winrate' || type === 'loserate') {
            const players = await Player.find({ games: { $gt: 0 } })
                .select('displayName userID xp wins losses games pangkahs pangkahsReceived bestStreak secondPlace thirdPlace fourthToTenth');
            
            // Calculate rates and sort
            const withRates = players.map(p => ({
                ...p.toObject(),
                winRate: (p.wins || 0) / (p.games || 1),
                loseRate: (p.losses || 0) / (p.games || 1)
            }));
            
            // Sort by the appropriate rate (descending)
            if (type === 'winrate') {
                withRates.sort((a, b) => b.winRate - a.winRate);
            } else {
                withRates.sort((a, b) => b.loseRate - a.loseRate);
            }
            
            return res.json(withRates.slice(0, 100));
        }
        
        // For direct field sorting
        const sortFields = {
            'wins': 'wins',
            'losses': 'losses',
            'pangkahs': 'pangkahs',
            'pangkahsReceived': 'pangkahsReceived',
            'streak': 'bestStreak',
            'xp': 'xp',
            'games': 'games'
        };
        
        const sortField = sortFields[type] || 'xp';
        const players = await Player.find().sort({ [sortField]: -1 }).limit(100)
            .select('displayName userID xp wins losses games pangkahs pangkahsReceived bestStreak secondPlace thirdPlace fourthToTenth');
        res.json(players);
    } catch (err) { 
        console.error('Leaderboard error:', err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

app.get('/api/hof-frames', async (req, res) => {
    try {
        const MIN_GAMES = 10;
        const SCALE_FACTOR = 20;
        
        const players = await Player.find({ games: { $gte: MIN_GAMES } }).select('userID wins losses games pangkahs pangkahsReceived bestStreak');
        if (players.length === 0) return res.json({ holders: {} });
        
        // Weighted score function - rewards both rate and volume
        const getWeightedScore = (rate, games) => {
            const volumeWeight = 1 - Math.exp(-games / SCALE_FACTOR);
            return rate * volumeWeight;
        };
        
        const rates = players.map(p => {
            const games = p.games || 1;
            const winRate = ((p.wins || 0) / games) * 100;
            const loseRate = ((p.losses || 0) / games) * 100;
            
            return { 
                userID: p.userID, 
                winRate,
                loseRate,
                weightedWinRate: getWeightedScore(winRate, games),
                weightedLoseRate: getWeightedScore(loseRate, games),
                bestStreak: p.bestStreak || 0, 
                pangkahs: p.pangkahs || 0, 
                pangkahsReceived: p.pangkahsReceived || 0,
                games
            };
        });
        
        // ============================================================================
        // FRAME PRIORITY SYSTEM
        // ============================================================================
        // Priority order (highest to lowest):
        // 1. winrate (👑 The Chosen One) - Most prestigious
        // 2. streak (🔥 Unstoppable Menace) 
        // 3. pangkah (⚡ Pangkah Terrorist)
        // 4. loserate (🤡 Professional Clown)
        // 5. magnet (🎯 Human Dartboard)
        //
        // If a player qualifies for multiple frames, they get the highest priority one.
        // Lower priority frames cascade to the next best player who doesn't have a frame yet.
        // ============================================================================
        
        const holders = {};
        const assignedPlayers = new Set(); // Track who already has a frame
        
        // Helper to find best player for a stat (excluding already assigned)
        const findBestAvailable = (arr, key, excludeSet) => {
            const available = arr.filter(p => !excludeSet.has(p.userID));
            if (available.length === 0) return null;
            return available.reduce((best, p) => 
                (parseFloat(p[key]) || 0) > (parseFloat(best[key]) || 0) ? p : best, 
                available[0]
            );
        };
        
        // Assign frames in priority order
        // Priority 1: Win Rate Champion
        const winrateHolder = findBestAvailable(rates, 'weightedWinRate', assignedPlayers);
        if (winrateHolder && winrateHolder.weightedWinRate > 0) {
            holders.winrate = winrateHolder.userID;
            assignedPlayers.add(winrateHolder.userID);
        }
        
        // Priority 2: Best Streak
        const streakHolder = findBestAvailable(rates, 'bestStreak', assignedPlayers);
        if (streakHolder && streakHolder.bestStreak > 0) {
            holders.streak = streakHolder.userID;
            assignedPlayers.add(streakHolder.userID);
        }
        
        // Priority 3: Most Pangkahs Dealt
        const pangkahHolder = findBestAvailable(rates, 'pangkahs', assignedPlayers);
        if (pangkahHolder && pangkahHolder.pangkahs > 0) {
            holders.pangkah = pangkahHolder.userID;
            assignedPlayers.add(pangkahHolder.userID);
        }
        
        // Priority 4: Highest Lose Rate (shame frame)
        const loserateHolder = findBestAvailable(rates, 'weightedLoseRate', assignedPlayers);
        if (loserateHolder && loserateHolder.weightedLoseRate > 0) {
            holders.loserate = loserateHolder.userID;
            assignedPlayers.add(loserateHolder.userID);
        }
        
        // Priority 5: Most Pangkahs Received (magnet frame)
        const magnetHolder = findBestAvailable(rates, 'pangkahsReceived', assignedPlayers);
        if (magnetHolder && magnetHolder.pangkahsReceived > 0) {
            holders.magnet = magnetHolder.userID;
            assignedPlayers.add(magnetHolder.userID);
        }
        
        console.log('[HOF Frames] Assigned:', holders);
        res.json({ holders });
    } catch (err) { 
        console.error('HOF Frames error:', err);
        res.status(500).json({ error: 'Failed' }); 
    }
});

app.get('/api/hall-of-fame', async (req, res) => {
    try {
        const players = await Player.find({ games: { $gt: 0 } });
        if (players.length === 0) return res.json({ records: [] });
        
        const records = [];
        
        // ============================================================================
        // FAIR RANKING SYSTEM FOR RATE-BASED RECORDS
        // ============================================================================
        // Problem: Player A with 1 win / 1 game (100%) vs Player B with 44 wins / 100 games (44%)
        // Solution: Use weighted score that rewards BOTH high rate AND volume
        //
        // Formula: Adjusted Score = Rate * (1 - e^(-games/k))
        // Where k = scaling factor (higher k = more games needed for full weight)
        //
        // Example with k=20:
        // - 1 game at 100%: 100 * (1 - e^(-1/20)) = 100 * 0.049 = 4.9 adjusted
        // - 44 games at 27%: 27 * (1 - e^(-44/20)) = 27 * 0.889 = 24.0 adjusted
        // Player with 44 games wins despite lower raw rate!
        // ============================================================================
        
        const SCALE_FACTOR = 20; // Games needed for ~86% weight
        const MIN_GAMES_DISPLAY = 10; // Minimum games to appear in rate-based records
        
        // Weighted score function - rewards both rate and volume
        const getWeightedScore = (rate, games) => {
            const volumeWeight = 1 - Math.exp(-games / SCALE_FACTOR);
            return parseFloat(rate) * volumeWeight;
        };
        
        const playersWithRates = players.map(p => {
            const games = p.games || 1;
            const wins = p.wins || 0;
            const losses = p.losses || 0;
            const pangkahs = p.pangkahs || 0;
            const pangkahsReceived = p.pangkahsReceived || 0;
            
            const winRate = ((wins) / games * 100);
            const loseRate = ((losses) / games * 100);
            
            return {
                name: p.displayName || 'Unknown',
                xp: p.xp || 0,
                wins: wins,
                losses: losses,
                games: games,
                pangkahs: pangkahs,
                pangkahsReceived: pangkahsReceived,
                bestStreak: p.bestStreak || 0,
                cleanWins: p.cleanWins || 0,
                handsAbsorbed: p.handsAbsorbed || 0,
                handsGiven: p.handsGiven || 0,
                autoPlays: p.autoPlays || 0,
                maxCardsHeld: p.maxCardsHeld || 0,
                secondPlace: p.secondPlace || 0,
                thirdPlace: p.thirdPlace || 0,
                fourthToTenth: p.fourthToTenth || 0,
                topTwo: p.topTwo || 0,
                nightGames: p.nightGames || 0,
                comebacks: p.comebacks || 0,
                perfectWins: p.perfectWins || 0,
                lossesToBot: p.lossesToBot || 0,
                pangkahsReceivedFromBot: p.pangkahsReceivedFromBot || 0,
                handsAbsorbedFromBot: p.handsAbsorbedFromBot || 0,
                cardsPlayed: p.cardsPlayed || 0,
                // Raw rates (for display)
                winRate: winRate.toFixed(1),
                loseRate: loseRate.toFixed(1),
                // Weighted scores (for ranking) - fair comparison!
                weightedWinRate: getWeightedScore(winRate, games),
                weightedLoseRate: getWeightedScore(loseRate, games),
                pangkahRatio: pangkahsReceived > 0 ? (pangkahs / pangkahsReceived).toFixed(2) : pangkahs,
                avgPangkahsPerGame: (pangkahs / games).toFixed(2),
                avgPangkahsReceivedPerGame: (pangkahsReceived / games).toFixed(2),
                notTopTwo: games - (p.topTwo || 0),
                totalPodium: wins + (p.secondPlace || 0) + (p.thirdPlace || 0)
            };
        });
        
        // Rate-eligible players (minimum games for rate-based records)
        const rateEligible = playersWithRates.filter(p => p.games >= MIN_GAMES_DISPLAY);
        
        // Helper to find best player for a stat
        const findBest = (arr, key) => {
            if (!arr.length) return null;
            return arr.reduce((best, p) => (parseFloat(p[key]) || 0) > (parseFloat(best[key]) || 0) ? p : best, arr[0]);
        };
        
        // ===== GLORY RECORDS =====
        
        // Win Rate Champion (using WEIGHTED score for fairness)
        if (rateEligible.length > 0) {
            const best = findBest(rateEligible, 'weightedWinRate');
            if (parseFloat(best.winRate) > 0) {
                records.push({
                    id: 'winrate', category: 'glory', icon: '👑',
                    title: 'The Chosen One', player: best.name,
                    value: `${best.winRate}% win rate (${best.games} games)`,
                    description: `${best.name} dominates with ${best.winRate}% win rate across ${best.games} games. The more they play, the more they win! 🌟`
                });
            }
        }
        
        // Most Wins
        const winKing = findBest(playersWithRates, 'wins');
        if (winKing && winKing.wins > 0) {
            records.push({
                id: 'wins', category: 'glory', icon: '🏆',
                title: 'Victory Addict', player: winKing.name,
                value: `${winKing.wins} wins`,
                description: `${winKing.name} has won ${winKing.wins} times. At this point, winning isn't a hobby - it's a lifestyle. Touch grass? Never heard of it. 💪`
            });
        }
        
        // Best Streak
        const streakKing = findBest(playersWithRates, 'bestStreak');
        if (streakKing && streakKing.bestStreak > 0) {
            records.push({
                id: 'streak', category: 'glory', icon: '🔥',
                title: 'Unstoppable Menace', player: streakKing.name,
                value: `${streakKing.bestStreak} streak`,
                description: `${streakKing.name} went absolutely DEMON MODE with ${streakKing.bestStreak} consecutive victories! Were they cheating? No. Are they just built different? Absolutely. 😈`
            });
        }
        
        // Most XP
        const xpKing = findBest(playersWithRates, 'xp');
        if (xpKing && xpKing.xp > 0) {
            records.push({
                id: 'xp', category: 'glory', icon: '✨',
                title: 'XP Goblin', player: xpKing.name,
                value: `${xpKing.xp.toLocaleString()} XP`,
                description: `${xpKing.name} has hoarded ${xpKing.xp.toLocaleString()} XP like a dragon hoards gold. Sleep? That's for people with less XP. 🐉`
            });
        }
        
        // Most Pangkahs Dealt
        const pangkahDealer = findBest(playersWithRates, 'pangkahs');
        if (pangkahDealer && pangkahDealer.pangkahs > 0) {
            records.push({
                id: 'pangkahs', category: 'glory', icon: '⚡',
                title: 'Pangkah Terrorist', player: pangkahDealer.name,
                value: `${pangkahDealer.pangkahs} dealt`,
                description: `${pangkahDealer.name} has dealt ${pangkahDealer.pangkahs} pangkahs. This player woke up and chose violence. Every. Single. Game. 💀`
            });
        }
        
        // Most Clean Wins
        const cleanMaster = findBest(playersWithRates, 'cleanWins');
        if (cleanMaster && cleanMaster.cleanWins > 0) {
            records.push({
                id: 'cleanwins', category: 'glory', icon: '🧼',
                title: 'Mr. Clean', player: cleanMaster.name,
                value: `${cleanMaster.cleanWins} clean rounds`,
                description: `${cleanMaster.name} has won ${cleanMaster.cleanWins} clean rounds. So fresh, so clean! Marie Kondo would be proud. ✨`
            });
        }
        
        // Most Games Played
        const grinder = findBest(playersWithRates, 'games');
        if (grinder && grinder.games > 0) {
            records.push({
                id: 'games', category: 'glory', icon: '🎮',
                title: 'No-Life Achievement', player: grinder.name,
                value: `${grinder.games} games`,
                description: `${grinder.name} has played ${grinder.games} games. What is grass? What is sunlight? These are questions they stopped asking long ago. 🌿❌`
            });
        }
        
        // ===== SHAME RECORDS =====
        
        // Highest Lose Rate (using WEIGHTED score for fairness)
        if (rateEligible.length > 0) {
            const worst = findBest(rateEligible, 'weightedLoseRate');
            if (parseFloat(worst.loseRate) > 0) {
                records.push({
                    id: 'loserate', category: 'shame', icon: '🤡',
                    title: 'Professional Clown', player: worst.name,
                    value: `${worst.loseRate}% lose rate (${worst.games} games)`,
                    description: `${worst.name} loses ${worst.loseRate}% of their ${worst.games} games. Consistent at being inconsistent! 🎪`
                });
            }
        }
        
        // Most Losses
        const loseKing = findBest(playersWithRates, 'losses');
        if (loseKing && loseKing.losses > 0) {
            records.push({
                id: 'losses', category: 'shame', icon: '💀',
                title: 'L Collector', player: loseKing.name,
                value: `${loseKing.losses} losses`,
                description: `${loseKing.name} has collected ${loseKing.losses} L's like they're Pokemon cards. Gotta catch 'em all! At least they're #1 at something... 😭`
            });
        }
        
        // Most Pangkahs Received
        const pangkahVictim = findBest(playersWithRates, 'pangkahsReceived');
        if (pangkahVictim && pangkahVictim.pangkahsReceived > 0) {
            records.push({
                id: 'gotpangkah', category: 'shame', icon: '🎯',
                title: 'Human Dartboard', player: pangkahVictim.name,
                value: `${pangkahVictim.pangkahsReceived} received`,
                description: `${pangkahVictim.name} has eaten ${pangkahVictim.pangkahsReceived} pangkahs to the face. If getting pangkah'd was an Olympic sport, they'd have gold! 🥊`
            });
        }
        
        // Most Auto-Plays (AFK)
        const afkKing = findBest(playersWithRates, 'autoPlays');
        if (afkKing && afkKing.autoPlays > 0) {
            records.push({
                id: 'afk', category: 'shame', icon: '😴',
                title: 'AFK Speedrunner', player: afkKing.name,
                value: `${afkKing.autoPlays} auto-plays`,
                description: `${afkKing.name} has ${afkKing.autoPlays} auto-plays. Are they playing the game or is the game playing them? We'll never know because they're probably asleep. 💤`
            });
        }
        
        // Most Cards Held
        const cardHoarder = findBest(playersWithRates, 'maxCardsHeld');
        if (cardHoarder && cardHoarder.maxCardsHeld > 0) {
            records.push({
                id: 'maxcards', category: 'shame', icon: '🐿️',
                title: 'Card Hoarder', player: cardHoarder.name,
                value: `${cardHoarder.maxCardsHeld} cards`,
                description: `${cardHoarder.name} once held ${cardHoarder.maxCardsHeld} cards in their hand. Were they playing cards or building a house? This isn't UNO, bestie! 🃏`
            });
        }
        
        // Most Hands Given Away
        const handGiver = findBest(playersWithRates, 'handsGiven');
        if (handGiver && handGiver.handsGiven > 0) {
            records.push({
                id: 'given', category: 'shame', icon: '🎅',
                title: 'Santa Claus', player: handGiver.name,
                value: `${handGiver.handsGiven} hands given`,
                description: `${handGiver.name} has generously donated ${handGiver.handsGiven} hands to other players. So giving! So charitable! So... wait, that's a bad thing here. 🎁`
            });
        }
        
        // ===== MISC RECORDS =====
        
        // Most Hands Absorbed (Soul Stealer)
        const handAbsorber = findBest(playersWithRates, 'handsAbsorbed');
        if (handAbsorber && handAbsorber.handsAbsorbed > 0) {
            records.push({
                id: 'absorbed', category: 'misc', icon: '🦑',
                title: 'Soul Stealer', player: handAbsorber.name,
                value: `${handAbsorber.handsAbsorbed} hands absorbed`,
                description: `${handAbsorber.name} has absorbed ${handAbsorber.handsAbsorbed} hands from other players. "Your cards... will make a fine addition to my collection." 🫴`
            });
        }
        
        // Most Second Places (Always Bridesmaid)
        const silverCollector = findBest(playersWithRates, 'secondPlace');
        if (silverCollector && silverCollector.secondPlace > 0) {
            records.push({
                id: 'second', category: 'misc', icon: '🥈',
                title: 'Always Bridesmaid', player: silverCollector.name,
                value: `${silverCollector.secondPlace} second places`,
                description: `${silverCollector.name} has finished 2nd place ${silverCollector.secondPlace} times. So close yet so far! Maybe next time, champ. Maybe next time... 😢`
            });
        }
        
        // Most Third Places (Bronze Collector)
        const bronzeCollector = findBest(playersWithRates, 'thirdPlace');
        if (bronzeCollector && bronzeCollector.thirdPlace > 0) {
            records.push({
                id: 'third', category: 'misc', icon: '🥉',
                title: 'Bronze Enthusiast', player: bronzeCollector.name,
                value: `${bronzeCollector.thirdPlace} third places`,
                description: `${bronzeCollector.name} has claimed ${bronzeCollector.thirdPlace} bronze medals. Not quite podium, not quite loser. The Switzerland of Pangkah. 🇨🇭`
            });
        }
        
        // Night Owl (Most Night Games)
        const nightOwl = findBest(playersWithRates, 'nightGames');
        if (nightOwl && nightOwl.nightGames > 0) {
            records.push({
                id: 'night', category: 'misc', icon: '🦉',
                title: 'Night Owl', player: nightOwl.name,
                value: `${nightOwl.nightGames} night games`,
                description: `${nightOwl.name} has played ${nightOwl.nightGames} games between 10PM-6AM. Sleep is for the weak! (Please get some rest though) 🌙`
            });
        }
        
        // Most Comebacks
        const comebackKing = findBest(playersWithRates, 'comebacks');
        if (comebackKing && comebackKing.comebacks > 0) {
            records.push({
                id: 'comeback', category: 'misc', icon: '🔄',
                title: 'Comeback Kid', player: comebackKing.name,
                value: `${comebackKing.comebacks} comebacks`,
                description: `${comebackKing.name} has pulled off ${comebackKing.comebacks} epic comebacks from 15+ cards! "Call an ambulance... but not for me!" 💪`
            });
        }
        
        // Bot Victim (Lost to Bots)
        const botVictim = findBest(playersWithRates, 'lossesToBot');
        if (botVictim && botVictim.lossesToBot > 0) {
            records.push({
                id: 'botvictim', category: 'misc', icon: '🤖',
                title: 'Bot Food', player: botVictim.name,
                value: `${botVictim.lossesToBot} losses to bots`,
                description: `${botVictim.name} has lost to BOTS ${botVictim.lossesToBot} times. The AI uprising has already begun... for them at least. Beep boop! 🤖`
            });
        }
        
        // Most Cards Played
        const cardSpammer = findBest(playersWithRates, 'cardsPlayed');
        if (cardSpammer && cardSpammer.cardsPlayed > 0) {
            records.push({
                id: 'cardsplayed', category: 'misc', icon: '🃏',
                title: 'Card Slinger', player: cardSpammer.name,
                value: `${cardSpammer.cardsPlayed.toLocaleString()} cards played`,
                description: `${cardSpammer.name} has played ${cardSpammer.cardsPlayed.toLocaleString()} cards total. That's a LOT of clicking. RIP their mouse. 🖱️💀`
            });
        }
        
        // ===== ADDITIONAL RECORDS =====
        
        // Perfect Wins (won without receiving any pangkah)
        const perfectionist = findBest(playersWithRates, 'perfectWins');
        if (perfectionist && perfectionist.perfectWins > 0) {
            records.push({
                id: 'perfect', category: 'glory', icon: '💎',
                title: 'Flawless Victory', player: perfectionist.name,
                value: `${perfectionist.perfectWins} perfect wins`,
                description: `${perfectionist.name} has won ${perfectionist.perfectWins} games WITHOUT receiving a single pangkah. Are they Neo from The Matrix? Is this even legal?! 🕶️`
            });
        }
        
        // Pangkah Ratio (dealt vs received) - Glory if positive
        const ratioEligible = playersWithRates.filter(p => p.pangkahs >= 10 && p.pangkahsReceived >= 10);
        if (ratioEligible.length > 0) {
            const bestRatio = findBest(ratioEligible, 'pangkahRatio');
            if (bestRatio && parseFloat(bestRatio.pangkahRatio) > 1) {
                records.push({
                    id: 'ratio', category: 'glory', icon: '⚖️',
                    title: 'Karma Dealer', player: bestRatio.name,
                    value: `${bestRatio.pangkahRatio}x ratio`,
                    description: `${bestRatio.name} dishes out ${bestRatio.pangkahRatio}x more pangkahs than they receive. They don't get mad, they get even... and then some! 😏`
                });
            }
        }
        
        // Top Two Consistency (wins + 2nd places)
        const consistent = findBest(playersWithRates.filter(p => p.games >= MIN_GAMES_DISPLAY), 'topTwo');
        if (consistent && consistent.topTwo > 0) {
            const topTwoRate = ((consistent.topTwo / consistent.games) * 100).toFixed(1);
            records.push({
                id: 'toptwo', category: 'glory', icon: '🎖️',
                title: 'Consistent King', player: consistent.name,
                value: `${consistent.topTwo} top-2 finishes (${topTwoRate}%)`,
                description: `${consistent.name} finishes in top 2 like it's their job (${topTwoRate}% of ${consistent.games} games). Reliable? More like UNSHAKEABLE! 📈`
            });
        }
        
        // Bot Bully (absorbed hands from bots)
        const botBully = findBest(playersWithRates, 'handsAbsorbedFromBot');
        if (botBully && botBully.handsAbsorbedFromBot > 0) {
            records.push({
                id: 'botbully', category: 'misc', icon: '🔨',
                title: 'Bot Bully', player: botBully.name,
                value: `${botBully.handsAbsorbedFromBot} bot hands stolen`,
                description: `${botBully.name} has stolen ${botBully.handsAbsorbedFromBot} hands from helpless bots. They can't fight back! This is basically cyber-bullying! 🤖😢`
            });
        }
        
        // Pangkah Magnet from Bots
        const botTarget = findBest(playersWithRates, 'pangkahsReceivedFromBot');
        if (botTarget && botTarget.pangkahsReceivedFromBot > 0) {
            records.push({
                id: 'bottarget', category: 'shame', icon: '🎪',
                title: 'Bot\'s Favorite Target', player: botTarget.name,
                value: `${botTarget.pangkahsReceivedFromBot} from bots`,
                description: `${botTarget.name} has been pangkah'd by BOTS ${botTarget.pangkahsReceivedFromBot} times. Even the AI knows an easy target when it sees one! 🎯🤖`
            });
        }
        
        // Middle Child (most 4th-10th place finishes)
        const middleChild = findBest(playersWithRates, 'fourthToTenth');
        if (middleChild && middleChild.fourthToTenth > 0) {
            records.push({
                id: 'middle', category: 'shame', icon: '😐',
                title: 'Painfully Average', player: middleChild.name,
                value: `${middleChild.fourthToTenth} mid finishes`,
                description: `${middleChild.name} has finished 4th-10th place ${middleChild.fourthToTenth} times. Not good, not bad, just... there. The human equivalent of room temperature water. 🚿`
            });
        }
        
        // Podium Collector (total 1st + 2nd + 3rd)
        const podiumKing = findBest(playersWithRates, 'totalPodium');
        if (podiumKing && podiumKing.totalPodium > 0) {
            records.push({
                id: 'podium', category: 'glory', icon: '🏅',
                title: 'Podium Addict', player: podiumKing.name,
                value: `${podiumKing.totalPodium} podium finishes`,
                description: `${podiumKing.name} has stood on the podium ${podiumKing.totalPodium} times. Their trophy shelf is crying for mercy! 🏆🏆🏆`
            });
        }
        
        // Highest Average Pangkahs per Game (aggression) - weighted
        const aggroEligible = playersWithRates.filter(p => p.games >= MIN_GAMES_DISPLAY);
        if (aggroEligible.length > 0) {
            const aggressor = findBest(aggroEligible, 'avgPangkahsPerGame');
            if (aggressor && parseFloat(aggressor.avgPangkahsPerGame) > 0) {
                records.push({
                    id: 'aggro', category: 'misc', icon: '😈',
                    title: 'Agent of Chaos', player: aggressor.name,
                    value: `${aggressor.avgPangkahsPerGame} pangkahs/game`,
                    description: `${aggressor.name} averages ${aggressor.avgPangkahsPerGame} pangkahs per game across ${aggressor.games} games. They don't play to win, they play to watch the world BURN! 🔥`
                });
            }
        }
        
        // Highest Average Pangkahs RECEIVED per Game (unlucky) - weighted
        if (aggroEligible.length > 0) {
            const unlucky = findBest(aggroEligible, 'avgPangkahsReceivedPerGame');
            if (unlucky && parseFloat(unlucky.avgPangkahsReceivedPerGame) > 0) {
                records.push({
                    id: 'unlucky', category: 'shame', icon: '🍀',
                    title: 'Reverse Lucky Charm', player: unlucky.name,
                    value: `${unlucky.avgPangkahsReceivedPerGame} received/game`,
                    description: `${unlucky.name} receives ${unlucky.avgPangkahsReceivedPerGame} pangkahs per game on average across ${unlucky.games} games. If bad luck was a person, it would be them. 🪬❌`
                });
            }
        }
        
        // Worst Pangkah Ratio (received more than dealt)
        if (ratioEligible.length > 0) {
            const worstRatio = ratioEligible.reduce((worst, p) => 
                parseFloat(p.pangkahRatio) < parseFloat(worst.pangkahRatio) ? p : worst, ratioEligible[0]);
            if (worstRatio && parseFloat(worstRatio.pangkahRatio) < 1) {
                records.push({
                    id: 'badratio', category: 'shame', icon: '📉',
                    title: 'Karma\'s Punching Bag', player: worstRatio.name,
                    value: `${worstRatio.pangkahRatio}x ratio`,
                    description: `${worstRatio.name} receives ${(1/worstRatio.pangkahRatio).toFixed(1)}x more pangkahs than they deal. The universe said "no" and meant it! 💫`
                });
            }
        }
        
        // Never Top Two (most games without reaching top 2)
        const neverShines = findBest(playersWithRates.filter(p => p.games >= MIN_GAMES_DISPLAY), 'notTopTwo');
        if (neverShines && neverShines.notTopTwo > 0) {
            const failRate = ((neverShines.notTopTwo / neverShines.games) * 100).toFixed(1);
            records.push({
                id: 'nevertop', category: 'shame', icon: '🌑',
                title: 'Never Their Day', player: neverShines.name,
                value: `${neverShines.notTopTwo} non-top-2 (${failRate}%)`,
                description: `${neverShines.name} has failed to reach top 2 in ${neverShines.notTopTwo} of ${neverShines.games} games. Tomorrow is another day... to disappoint! 🌅`
            });
        }
        
        // The Veteran (oldest player by createdAt)
        const veteran = players.reduce((oldest, p) => 
            new Date(p.createdAt) < new Date(oldest.createdAt) ? p : oldest, players[0]);
        if (veteran && veteran.games >= 1) {
            const daysSince = Math.floor((new Date() - new Date(veteran.createdAt)) / (1000 * 60 * 60 * 24));
            records.push({
                id: 'veteran', category: 'misc', icon: '👴',
                title: 'Elder of the Sect', player: veteran.displayName,
                value: `${daysSince} days`,
                description: `${veteran.displayName} has been here for ${daysSince} days. They remember when this game had bugs. Oh wait, it still does. But they stayed anyway! 🏛️`
            });
        }
        
        res.json({ records });
    } catch (err) {
        console.error('Hall of Fame error:', err);
        res.status(500).json({ error: 'Failed to get hall of fame' });
    }
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

app.post('/api/gm/delete-player', async (req, res) => {
    try {
        const { targetUserID } = req.body;
        if (!targetUserID) return res.status(400).json({ error: 'userID required' });
        
        console.log('[GM] ☠️ DELETE request for:', targetUserID);
        const player = await Player.findOneAndDelete({ userID: targetUserID });
        
        if (!player) {
            console.log('[GM] Player not found for delete:', targetUserID);
            return res.status(404).json({ error: 'Player not found' });
        }
        
        console.log('[GM] ☠️ DELETED player:', player.displayName, '(', player.userID, ')');
        res.json({ success: true, deletedPlayer: player.displayName });
    } catch (err) {
        console.error('[GM] Delete error:', err);
        res.status(500).json({ error: 'Delete failed' });
    }
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
            const totalPlayers = room.players.length;
            const isWin = pos === 1;
            const isLose = pos === totalPlayers; // Last place = loser
            
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
            } else if (pos >= 4 && !isLose) {
                // 4th-10th place but NOT the loser (last place)
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
    // Shuffle player seats
    shuffle(room.players);
    
    // Shuffle and deal cards
    const deck = shuffle(createDeck());
    room.players.forEach(p => p.hand = []);
    deck.forEach((c,i) => room.players[i % room.players.length].hand.push(c));
    room.turn = room.players.findIndex(p => p.hand.some(c => c.suit==='Spades' && c.rank==='K'));
    room.isFirstMove = true;
    
    // Reset AI memory for new game
    resetAIMemory(room.id);
}
function generateBotName() {
    const names = [
        'Keanu Reeves', 'Shrek', 'Gordon Ramsay', 'Snoop Dogg', 'Bob Ross',
        'Mr. Bean', 'Jackie Chan', 'Danny DeVito', 'Morgan Freeman', 'The Rock',
        'Samuel L Jackson', 'Chuck Norris', 'Will Smith', 'Rick Astley', 'John Cena',
        'Elon Musk', 'Batman', 'Darth Vader', 'Yoda', 'SpongeBob',
        'Thanos', 'Groot', 'Gandalf', 'Dumbledore', 'Sherlock',
        'Mike Tyson', 'Cristiano', 'Messi', 'Lebron', 'Michael Jordan',
        'Einstein', 'Newton', 'Tesla', 'Mozart', 'Shakespeare',
        'Obama', 'Queen Elizabeth', 'Napoleon', 'Cleopatra', 'Caesar'
    ];
    return '[BOT] ' + names[Math.floor(Math.random() * names.length)];
}
function initStats(p) { p.gameStats = { pangkahsDealt:0, pangkahsReceived:0, pangkahsReceivedFromBot:0, cleanWins:0, cardsPlayed:0, comebacks:0, hadMostCards:false, maxCardsThisGame: p.hand?.length||0, finishPosition:0, lossesToBot:0 }; }

// Timers
const turnTimerIntervals = {};
function startTimer(rid) {
    clearTimer(rid);
    const room = rooms[rid];
    if (!room?.gameStarted || room.players[room.turn]?.isBot) return;
    
    let timeLeft = Math.floor(TURN_LIMIT / 1000);
    
    // Send initial time
    io.to(rid).emit('turnTimer', { timeLeft });
    
    // Countdown interval
    turnTimerIntervals[rid] = setInterval(() => {
        timeLeft--;
        io.to(rid).emit('turnTimer', { timeLeft });
        if (timeLeft <= 0) {
            clearInterval(turnTimerIntervals[rid]);
            delete turnTimerIntervals[rid];
        }
    }, 1000);
    
    // Auto-play timeout
    turnTimers[rid] = setTimeout(async () => {
        const r = rooms[rid]; if (!r?.gameStarted) return;
        const p = r.players[r.turn]; if (!p?.hand.length) return;
        let card = r.isFirstMove ? p.hand.find(c=>c.suit==='Spades'&&c.rank==='K') : r.currentSuit ? p.hand.find(c=>c.suit===r.currentSuit) : null;
        if (!card) card = p.hand[0];
        if (!p.isBot) await trackAutoPlay(p.userID);
        io.to(rid).emit('autoPlayed', { playerName: p.name, card, players: r.players, turn: r.turn, table: r.table, currentSuit: r.currentSuit });
        processCard(rid, r.turn, card);
    }, TURN_LIMIT);
}
function clearTimer(rid) { 
    if(turnTimers[rid]){clearTimeout(turnTimers[rid]);delete turnTimers[rid];} 
    if(turnTimerIntervals[rid]){clearInterval(turnTimerIntervals[rid]);delete turnTimerIntervals[rid];}
    io.to(rid).emit('turnTimer', { timeLeft: 0 });
}

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
    
    // Update AI memory before clearing table
    updateAIMemory(rid, room, isPangkah);
    
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
        const finalTable = [...room.table]; // Save table before clearing
        room.table = []; room.currentSuit = null; room.turn = winIdx; room.resolving = false;
        io.to(rid).emit('clearTable', { msg: isPangkah?'Pangkah!':'Clean!', winner: winner.name, winnerUserID: winner.userID, pangkahDealerUserID: isPangkah?room.pangkahDealer:null, turn: room.turn, players: room.players, fateAces: room.fateAces, finalTable: finalTable });
        setTimeout(() => { if(room.players[room.turn]?.isBot) botTurn(rid, true); else startTimer(rid); }, 500);
    }
}

// ============================================================================
// PANGKAH AI BRAIN ENGINE v3 - STRATEGIC AI
// ============================================================================
// 
// CORE UNDERSTANDING:
// - Goal: Empty your hand first (fewer cards = winning)
// - Receiving pangkah = BAD (you get MORE cards)
// - Dealing pangkah = GOOD (dump card + punish opponent)
// - To deal pangkah: Must be VOID in a suit (have no cards of that suit)
//
// GAME PHASES:
// - EARLY GAME (>70% cards remain): 
//   * AGGRESSIVE! Low risk of receiving pangkah
//   * Dump high cards freely
//   * Work on eliminating suits (to gain pangkah ability)
//   * Observe opponent patterns
//
// - MID GAME (35-70% cards remain):
//   * CAUTIOUS, use early game observations
//   * Set up baits if you have void suits
//   * Avoid leading with high cards
//
// - LATE GAME (<35% cards remain):
//   * VERY DANGEROUS to lead rounds
//   * Many cards discarded = easier to get pangkahed
//   * Avoid being the highest card at all costs
//   * Play under the current highest when possible
//
// ============================================================================

// Global AI memory per room
const roomAIMemory = new Map();

function getAIMemory(roomID) {
    if (!roomAIMemory.has(roomID)) {
        roomAIMemory.set(roomID, {
            discardedCards: [],
            knownVoidSuits: new Map(), // playerIdx -> Set of suits
            cardsPlayedThisGame: [],
            roundsPlayed: 0
        });
    }
    return roomAIMemory.get(roomID);
}

function resetAIMemory(roomID) {
    roomAIMemory.set(roomID, {
        discardedCards: [],
        knownVoidSuits: new Map(),
        cardsPlayedThisGame: [],
        roundsPlayed: 0
    });
}

function updateAIMemory(roomID, room, isPangkah) {
    const mem = getAIMemory(roomID);
    mem.roundsPlayed++;
    
    if (room.table) {
        room.table.forEach(t => mem.cardsPlayedThisGame.push(t.card));
    }
    
    if (isPangkah && room.table && room.currentSuit) {
        // Track void suits from pangkah events
        room.table.forEach(t => {
            if (t.card.suit !== room.currentSuit) {
                if (!mem.knownVoidSuits.has(t.playerIdx)) {
                    mem.knownVoidSuits.set(t.playerIdx, new Set());
                }
                mem.knownVoidSuits.get(t.playerIdx).add(room.currentSuit);
            }
        });
    } else if (room.table) {
        // Clean round - track discarded cards
        room.table.forEach(t => mem.discardedCards.push(t.card));
    }
}

function getGamePhase(room) {
    const totalCards = room.players.reduce((sum, p) => sum + p.hand.length, 0);
    const pct = totalCards / 52;
    if (pct > 0.70) return 'early';
    if (pct > 0.35) return 'mid';
    return 'late';
}

function isPlayerVoid(mem, playerIdx, suit) {
    const voids = mem.knownVoidSuits.get(playerIdx);
    return voids ? voids.has(suit) : false;
}

function getPlayersAfterBot(room, botIdx) {
    const after = [];
    let idx = (botIdx + 1) % room.players.length;
    while (idx !== botIdx) {
        if (room.players[idx].hand.length > 0 && !room.table.some(t => t.playerIdx === idx)) {
            after.push(idx);
        }
        idx = (idx + 1) % room.players.length;
    }
    return after;
}

function getTableHigh(room) {
    if (!room.table || !room.currentSuit) return -1;
    return room.table.filter(t => t.card.suit === room.currentSuit)
        .reduce((max, t) => Math.max(max, t.card.val), -1);
}

function getHighestInPlayBySuit(mem, botHand) {
    const highest = { Spades: 12, Hearts: 12, Diamonds: 12, Clubs: 12 };
    // Remove discarded
    mem.discardedCards.forEach(c => {
        if (c.val === highest[c.suit]) highest[c.suit]--;
    });
    // Remove bot's own cards
    botHand.forEach(c => {
        if (c.val === highest[c.suit]) highest[c.suit]--;
    });
    return highest;
}

// Main AI decision function
function botDecide(room, botIdx) {
    const bot = room.players[botIdx];
    const hand = bot.hand;
    const mem = getAIMemory(room.id);
    const phase = getGamePhase(room);
    const isLeading = room.table.length === 0;
    
    // Must play K♠ first
    if (room.isFirstMove) {
        return hand.find(c => c.suit === 'Spades' && c.rank === 'K');
    }
    
    // Group by suit
    const bySuit = { Spades: [], Hearts: [], Diamonds: [], Clubs: [] };
    hand.forEach(c => bySuit[c.suit].push(c));
    Object.values(bySuit).forEach(arr => arr.sort((a,b) => a.val - b.val));
    
    // ========== LEADING A ROUND ==========
    if (isLeading) {
        const playersAfter = getPlayersAfterBot(room, botIdx);
        const highInPlay = getHighestInPlayBySuit(mem, hand);
        
        // EARLY GAME: Aggressive - dump high cards, eliminate suits
        if (phase === 'early') {
            // Find singleton suits (one card) - play to eliminate!
            const singletons = Object.entries(bySuit).filter(([s, arr]) => arr.length === 1);
            if (singletons.length > 0) {
                // Dump highest value singleton
                const best = singletons.reduce((a, b) => a[1][0].val > b[1][0].val ? a : b);
                console.log(`[AI Early] Eliminating singleton ${best[0]}`);
                return best[1][0];
            }
            
            // Dump high card from most common suit
            const mostCommon = Object.entries(bySuit)
                .filter(([s, arr]) => arr.length > 0)
                .sort((a, b) => b[1].length - a[1].length)[0];
            if (mostCommon) {
                const highCard = mostCommon[1][mostCommon[1].length - 1];
                console.log(`[AI Early] Dumping high ${highCard.rank}${highCard.suit[0]}`);
                return highCard;
            }
        }
        
        // MID GAME: Look for bait opportunities
        if (phase === 'mid') {
            for (const [suit, cards] of Object.entries(bySuit)) {
                if (cards.length === 0) continue;
                
                // Check if someone after us is void in this suit
                const voidAfter = playersAfter.filter(idx => isPlayerVoid(mem, idx, suit));
                if (voidAfter.length > 0) {
                    // Bait! But only if we're not the highest
                    const myHigh = cards[cards.length - 1].val;
                    if (myHigh < highInPlay[suit]) {
                        console.log(`[AI Mid] BAIT: ${cards[0].rank}${suit[0]}, player ${voidAfter[0]} is void!`);
                        return cards[0]; // Low card bait
                    }
                }
            }
            
            // No bait - play low from common suit
            const safeSuit = Object.entries(bySuit)
                .filter(([s, arr]) => arr.length > 0)
                .sort((a, b) => b[1].length - a[1].length)[0];
            if (safeSuit) return safeSuit[1][0];
        }
        
        // LATE GAME: Very cautious - play safest low card
        if (phase === 'late') {
            // Find suit with most cards still in play (safest)
            let safest = null, safestCount = -1;
            for (const [suit, cards] of Object.entries(bySuit)) {
                if (cards.length === 0) continue;
                // Count cards of this suit NOT in bot's hand or discarded
                let remaining = 13 - cards.length - mem.discardedCards.filter(c => c.suit === suit).length;
                if (remaining > safestCount) {
                    safestCount = remaining;
                    safest = [suit, cards];
                }
            }
            if (safest) {
                console.log(`[AI Late] Safest low: ${safest[1][0].rank}${safest[0][0]}`);
                return safest[1][0];
            }
        }
        
        // Fallback
        return hand.sort((a,b) => a.val - b.val)[0];
    }
    
    // ========== FOLLOWING A ROUND ==========
    const currentSuit = room.currentSuit;
    const suitCards = bySuit[currentSuit] || [];
    const tableHigh = getTableHigh(room);
    const playersAfter = getPlayersAfterBot(room, botIdx);
    
    if (suitCards.length > 0) {
        // We have matching suit cards
        const canBeat = suitCards.filter(c => c.val > tableHigh);
        const cantBeat = suitCards.filter(c => c.val <= tableHigh);
        
        // Check pangkah risk from players after us
        const voidAfter = playersAfter.filter(idx => isPlayerVoid(mem, idx, currentSuit));
        
        // MID/LATE + PANGKAH RISK = AVOID WINNING!
        if ((phase === 'mid' || phase === 'late') && voidAfter.length > 0) {
            if (cantBeat.length > 0) {
                // Play highest card that WON'T win (play under strategy)
                const playUnder = cantBeat[cantBeat.length - 1];
                console.log(`[AI] Pangkah risk! Playing under: ${playUnder.rank}`);
                return playUnder;
            }
            // Must beat - play lowest winner
            if (canBeat.length > 0) return canBeat[0];
        }
        
        // LAST TO PLAY - Safe to win
        if (playersAfter.length === 0 && canBeat.length > 0) {
            console.log(`[AI] Last player, taking win with ${canBeat[0].rank}`);
            return canBeat[0];
        }
        
        // EARLY GAME - More aggressive
        if (phase === 'early' && canBeat.length > 0) {
            console.log(`[AI] Early game, playing high to win`);
            return canBeat[canBeat.length - 1];
        }
        
        // DEFAULT: Play under if possible
        if (cantBeat.length > 0) {
            return cantBeat[cantBeat.length - 1]; // Highest non-winner
        }
        
        return canBeat[0] || suitCards[0];
    }
    
    // ========== PANGKAH TIME! (No matching suit) ==========
    console.log(`[AI] PANGKAH! Phase: ${phase}`);
    
    // Priority 1: Eliminate a suit
    const singletons = Object.entries(bySuit).filter(([s, arr]) => arr.length === 1);
    if (singletons.length > 0) {
        const best = singletons.reduce((a, b) => a[1][0].val > b[1][0].val ? a : b);
        console.log(`[AI Pangkah] Eliminating suit ${best[0]}`);
        return best[1][0];
    }
    
    // Priority 2: Dump highest card overall
    const allSorted = [...hand].sort((a, b) => b.val - a.val);
    
    // Late game: dump from most common suit
    if (phase === 'late') {
        const mostCommon = Object.entries(bySuit)
            .filter(([s, arr]) => arr.length > 0)
            .sort((a, b) => b[1].length - a[1].length)[0];
        if (mostCommon) {
            console.log(`[AI Pangkah] Late game dump from ${mostCommon[0]}`);
            return mostCommon[1][mostCommon[1].length - 1];
        }
    }
    
    console.log(`[AI Pangkah] Dumping highest: ${allSorted[0].rank}${allSorted[0].suit[0]}`);
    return allSorted[0];
}

function botTurn(rid, leading = false) {
    const room = rooms[rid]; if(!room?.gameStarted) return;
    const bot = room.players[room.turn]; if(!bot?.isBot || !bot.hand.length) return;
    
    setTimeout(() => {
        if (!rooms[rid]?.gameStarted || rooms[rid].turn !== room.players.indexOf(bot)) return;
        
        const botIdx = room.players.indexOf(bot);
        const card = botDecide(room, botIdx);
        const phase = getGamePhase(room);
        
        console.log(`[AI ${bot.name}] Phase: ${phase}, Cards: ${bot.hand.length}, Play: ${card?.rank}${card?.suit[0]}`);
        
        // Contextual emotes
        if (Math.random() < 0.12) {
            let emotes;
            if (card && room.currentSuit && card.suit !== room.currentSuit) {
                emotes = ['😈', '💀', '🔥', '⚡', '🎯', '💣']; // Pangkah!
            } else if (bot.hand.length <= 3) {
                emotes = ['😎', '💪', '🏆', '✨', '🎉']; // Winning
            } else if (phase === 'late' && bot.hand.length > 10) {
                emotes = ['😰', '😅', '🥲', '💀', '🙏']; // Struggling
            } else {
                emotes = ['🤖', '🃏', '🤔', '👀', '😌'];
            }
            io.to(rid).emit('botEmote', { botName: bot.name, emote: emotes[Math.floor(Math.random() * emotes.length)] });
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
        
        // Pause timer during swap request
        clearTimer(roomID);
        
        if (target.isBot) {
            // Bot auto-accepts after delay
            io.to(roomID).emit('botSwapPending', { botName: target.name, countdown: 3 });
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
                } else {
                    // Restart timer after bot swap
                    startTimer(roomID);
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
    
    socket.on('declineSwap', ({ roomID, fromUserID }) => { 
        const room = rooms[roomID]; 
        const req = room?.players.find(p=>p.userID===fromUserID); 
        if(req) io.to(req.id).emit('swapDeclined');
        // Restart timer after declined swap
        if(room?.gameStarted) startTimer(roomID);
    });
    socket.on('updateTitle', ({ roomID, userID, title }) => { const room = rooms[roomID]; const p = room?.players.find(x=>x.userID===userID); if(p){p.equippedTitle=title;io.to(roomID).emit('playerTitleUpdated',{userID,title,players:room.players});} });
    socket.on('requestRematch', ({ roomID, userID }) => { 
        const room = rooms[roomID]; 
        if(!room||room.gameStarted) return; 
        const p = room.players.find(x=>x.userID===userID); 
        if(p){
            p.rematchReady=true;
            const readyCount = room.players.filter(x=>x.rematchReady).length;
            const totalCount = room.players.length;
            const allReady = room.players.every(x=>x.rematchReady);
            io.to(roomID).emit('rematchStatus',{readyCount,totalCount,allReady});
            
            // Auto-start when all ready
            if(allReady && room.players.length >= MIN_PLAYERS){
                setTimeout(() => {
                    room.gameNumber++; 
                    room.gameStarted = true; 
                    room.finishOrder = []; 
                    room.fateAces = []; 
                    room.discarded = []; 
                    room.pangkahDealer = null;
                    room.players.forEach(pl => { pl.rematchReady = false; initStats(pl); });
                    deal(room);
                    io.to(roomID).emit('gameStarted', { players: room.players, turn: room.turn, gameNumber: room.gameNumber });
                    broadcastRooms();
                    if (room.players[room.turn].isBot) botTurn(roomID, true); else startTimer(roomID);
                }, 1500);
            }
        }
    });
    socket.on('sendEmote', ({ roomID, userID, playerName, emoji }) => { if(roomID) socket.to(roomID).emit('receiveEmote', { userID, playerName, emoji }); });
    socket.on('leaveRoom', ({ roomID, userID }) => { const room = rooms[roomID]; if(!room) return; const idx = room.players.findIndex(p=>p.userID===userID); if(idx!==-1){const p=room.players.splice(idx,1)[0];socket.leave(roomID);if(!room.players.filter(x=>!x.isBot).length)delete rooms[roomID];else io.to(roomID).emit('playerLeft',{name:p.name,playersCount:room.players.filter(x=>!x.isBot).length});}broadcastRooms(); });
    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🎴 Pangkah Server v3 (MongoDB) on port ' + PORT));
