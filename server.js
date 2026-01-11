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

// Player Schema
const playerSchema = new mongoose.Schema({
    userID: { type: String, required: true, unique: true },
    displayName: { type: String, default: 'Player' },
    discordId: { type: String, default: null },
    discordUsername: { type: String, default: null },
    
    // Stats
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
    
    // Titles
    unlockedTitles: { type: [String], default: [] },
    equippedTitle: { type: String, default: null },
    
    // Special Status
    isBetaTester: { type: Boolean, default: false },
    
    // Timestamps
    createdAt: { type: Date, default: Date.now },
    lastPlayedAt: { type: Date, default: Date.now }
});

const Player = mongoose.model('Player', playerSchema);

// API Routes for stats
app.post('/api/stats/save', async (req, res) => {
    try {
        const { userID, displayName, stats } = req.body;
        if (!userID) return res.status(400).json({ error: 'userID required' });
        
        const updateData = {
            displayName: displayName || 'Player',
            lastPlayedAt: new Date(),
            ...stats
        };
        
        const player = await Player.findOneAndUpdate(
            { userID },
            { $set: updateData },
            { upsert: true, new: true }
        );
        
        res.json({ success: true, player });
    } catch (err) {
        console.error('Save stats error:', err);
        res.status(500).json({ error: 'Failed to save stats' });
    }
});

app.get('/api/stats/:userID', async (req, res) => {
    try {
        const player = await Player.findOne({ userID: req.params.userID });
        if (!player) return res.status(404).json({ error: 'Player not found' });
        res.json(player);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

app.get('/api/leaderboard/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        
        let sortField = 'xp';
        if (type === 'wins') sortField = 'wins';
        if (type === 'losses') sortField = 'losses';
        if (type === 'pangkahs') sortField = 'pangkahs';
        if (type === 'pangkahsReceived') sortField = 'pangkahsReceived';
        if (type === 'games') sortField = 'games';
        if (type === 'streak') sortField = 'bestStreak';
        if (type === 'winrate') sortField = 'wins'; // Will sort by wins, winrate calculated client-side
        
        const players = await Player.find()
            .sort({ [sortField]: -1 })
            .limit(limit)
            .select('displayName userID xp wins losses games pangkahs pangkahsReceived bestStreak equippedTitle secondPlace thirdPlace fourthToTenth');
        
        res.json(players);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

// Hall of Fame API - Get record holders
app.get('/api/hall-of-fame', async (req, res) => {
    try {
        // Get all players with at least 1 game
        const players = await Player.find({ games: { $gt: 0 } })
            .select('displayName xp wins losses games pangkahs pangkahsReceived bestStreak secondPlace thirdPlace fourthToTenth handsAbsorbed handsGiven cleanWins autoPlays maxCardsHeld');
        
        if (players.length === 0) {
            return res.json({ records: [] });
        }
        
        // Calculate rates for each player
        const playersWithRates = players.map(p => {
            const games = p.games || 1;
            return {
                name: p.displayName || 'Unknown',
                xp: p.xp || 0,
                wins: p.wins || 0,
                losses: p.losses || 0,
                games: games,
                pangkahs: p.pangkahs || 0,
                pangkahsReceived: p.pangkahsReceived || 0,
                bestStreak: p.bestStreak || 0,
                secondPlace: p.secondPlace || 0,
                thirdPlace: p.thirdPlace || 0,
                fourthToTenth: p.fourthToTenth || 0,
                handsAbsorbed: p.handsAbsorbed || 0,
                handsGiven: p.handsGiven || 0,
                cleanWins: p.cleanWins || 0,
                autoPlays: p.autoPlays || 0,
                maxCardsHeld: p.maxCardsHeld || 0,
                winRate: ((p.wins || 0) / games * 100).toFixed(1),
                loseRate: ((p.losses || 0) / games * 100).toFixed(1),
                pangkahPerGame: ((p.pangkahs || 0) / games).toFixed(2),
                gotPangkahPerGame: ((p.pangkahsReceived || 0) / games).toFixed(2),
                cleanPerGame: ((p.cleanWins || 0) / games).toFixed(2)
            };
        });
        
        // Find record holders (need at least 5 games for rate-based records)
        const minGamesForRates = 5;
        const rateEligible = playersWithRates.filter(p => p.games >= minGamesForRates);
        
        const records = [];
        
        // ============ PAGE 1: GLORY RECORDS (9 records) ============
        
        // 1. Highest Win Rate
        if (rateEligible.length > 0) {
            const best = rateEligible.reduce((a, b) => parseFloat(a.winRate) > parseFloat(b.winRate) ? a : b);
            if (parseFloat(best.winRate) > 0) {
                records.push({
                    id: 'winrate',
                    category: 'glory',
                    icon: '👑',
                    title: 'The Chosen One',
                    player: best.name,
                    value: `${best.winRate}% win rate`,
                    description: `${best.name} was probably born under a lucky star. With ${best.winRate}% win rate, they're living proof that some people just have it all! 🌟`
                });
            }
        }
        
        // 2. Most Wins
        const winKing = playersWithRates.reduce((a, b) => a.wins > b.wins ? a : b);
        if (winKing.wins > 0) {
            records.push({
                id: 'wins',
                category: 'glory',
                icon: '🏆',
                title: 'Victory Addict',
                player: winKing.name,
                value: `${winKing.wins} wins`,
                description: `${winKing.name} has won ${winKing.wins} times. At this point, winning isn't a hobby - it's a lifestyle. Others play for fun, they play for DOMINANCE! 💪`
            });
        }
        
        // 3. Best Win Streak
        const streakKing = playersWithRates.reduce((a, b) => a.bestStreak > b.bestStreak ? a : b);
        if (streakKing.bestStreak > 0) {
            records.push({
                id: 'streak',
                category: 'glory',
                icon: '🔥',
                title: 'Unstoppable Menace',
                player: streakKing.name,
                value: `${streakKing.bestStreak} streak`,
                description: `${streakKing.name} went absolutely DEMON MODE with ${streakKing.bestStreak} consecutive victories! Legend says opponents forfeit just seeing their name. 😈`
            });
        }
        
        // 4. Most XP
        const xpKing = playersWithRates.reduce((a, b) => a.xp > b.xp ? a : b);
        if (xpKing.xp > 0) {
            records.push({
                id: 'xp',
                category: 'glory',
                icon: '✨',
                title: 'XP Goblin',
                player: xpKing.name,
                value: `${xpKing.xp.toLocaleString()} XP`,
                description: `${xpKing.name} has hoarded ${xpKing.xp.toLocaleString()} XP like a dragon hoards gold. Touch grass? Never heard of her! 🐉`
            });
        }
        
        // 5. Most Pangkahs Dealt
        const pangkahDealer = playersWithRates.reduce((a, b) => a.pangkahs > b.pangkahs ? a : b);
        if (pangkahDealer.pangkahs > 0) {
            records.push({
                id: 'pangkahs',
                category: 'glory',
                icon: '⚡',
                title: 'Pangkah Terrorist',
                player: pangkahDealer.name,
                value: `${pangkahDealer.pangkahs} dealt`,
                description: `${pangkahDealer.name} has dealt ${pangkahDealer.pangkahs} pangkahs. Geneva Convention? More like Geneva SUGGESTION! This player chose violence and never looked back! 💀`
            });
        }
        
        // 6. Most Clean Wins
        const cleanMaster = playersWithRates.reduce((a, b) => a.cleanWins > b.cleanWins ? a : b);
        if (cleanMaster.cleanWins > 0) {
            records.push({
                id: 'cleanwins',
                category: 'glory',
                icon: '🧼',
                title: 'Mr. Clean',
                player: cleanMaster.name,
                value: `${cleanMaster.cleanWins} clean rounds`,
                description: `${cleanMaster.name} has won ${cleanMaster.cleanWins} clean rounds. So clean you could eat off their gameplay! OCD? No, just EXCELLENCE! ✨`
            });
        }
        
        // 7. Most Games Played
        const grinder = playersWithRates.reduce((a, b) => a.games > b.games ? a : b);
        if (grinder.games > 0) {
            records.push({
                id: 'games',
                category: 'glory',
                icon: '🎮',
                title: 'No-Life Achievement',
                player: grinder.name,
                value: `${grinder.games} games`,
                description: `${grinder.name} has played ${grinder.games} games. What is grass? What is sunlight? This gamer doesn't know and doesn't CARE! 🌿❌`
            });
        }
        
        // 8. Hand Absorber (Soul Stealer)
        const handAbsorber = playersWithRates.reduce((a, b) => a.handsAbsorbed > b.handsAbsorbed ? a : b);
        if (handAbsorber.handsAbsorbed > 0) {
            records.push({
                id: 'absorbed',
                category: 'glory',
                icon: '🦑',
                title: 'Soul Stealer',
                player: handAbsorber.name,
                value: `${handAbsorber.handsAbsorbed} hands`,
                description: `${handAbsorber.name} has absorbed ${handAbsorber.handsAbsorbed} hands. They collect cards like Thanos collects infinity stones! "I am inevitable!" 🫴`
            });
        }
        
        // 9. Pangkah per Game (Chaos Agent)
        if (rateEligible.length > 0) {
            const pangkahSpammer = rateEligible.reduce((a, b) => parseFloat(a.pangkahPerGame) > parseFloat(b.pangkahPerGame) ? a : b);
            if (parseFloat(pangkahSpammer.pangkahPerGame) > 0) {
                records.push({
                    id: 'pangkahrate',
                    category: 'glory',
                    icon: '💣',
                    title: 'Chaos Agent',
                    player: pangkahSpammer.name,
                    value: `${pangkahSpammer.pangkahPerGame}/game`,
                    description: `${pangkahSpammer.name} deals ${pangkahSpammer.pangkahPerGame} pangkahs per game on average. Some people just want to watch the world burn! 🔥`
                });
            }
        }
        
        // ============ PAGE 2: SHAME RECORDS (9 records) ============
        
        // 1. Highest Lose Rate
        if (rateEligible.length > 0) {
            const worst = rateEligible.reduce((a, b) => parseFloat(a.loseRate) > parseFloat(b.loseRate) ? a : b);
            if (parseFloat(worst.loseRate) > 0) {
                records.push({
                    id: 'loserate',
                    category: 'shame',
                    icon: '🤡',
                    title: 'Professional Clown',
                    player: worst.name,
                    value: `${worst.loseRate}% lose rate`,
                    description: `${worst.name} needs an intervention... ${worst.loseRate}% lose rate! At this point, losing is their special talent. Should we start a GoFundMe? 🎪`
                });
            }
        }
        
        // 2. Most Losses
        const loseKing = playersWithRates.reduce((a, b) => a.losses > b.losses ? a : b);
        if (loseKing.losses > 0) {
            records.push({
                id: 'losses',
                category: 'shame',
                icon: '💀',
                title: 'L Collector',
                player: loseKing.name,
                value: `${loseKing.losses} losses`,
                description: `${loseKing.name} has collected ${loseKing.losses} L's like Pokemon cards. Gotta catch 'em all! Their parents must be so proud... or concerned. 😭`
            });
        }
        
        // 3. Most Pangkahs Received
        const pangkahVictim = playersWithRates.reduce((a, b) => a.pangkahsReceived > b.pangkahsReceived ? a : b);
        if (pangkahVictim.pangkahsReceived > 0) {
            records.push({
                id: 'gotpangkah',
                category: 'shame',
                icon: '🎯',
                title: 'Human Dartboard',
                player: pangkahVictim.name,
                value: `${pangkahVictim.pangkahsReceived} received`,
                description: `${pangkahVictim.name} has eaten ${pangkahVictim.pangkahsReceived} pangkahs. They're not unlucky, they're just a MAGNET for disaster! Everyone's favorite target practice! 🥊`
            });
        }
        
        // 4. Most AFK/Auto-plays
        const afkKing = playersWithRates.reduce((a, b) => a.autoPlays > b.autoPlays ? a : b);
        if (afkKing.autoPlays > 0) {
            records.push({
                id: 'afk',
                category: 'shame',
                icon: '😴',
                title: 'AFK Speedrunner',
                player: afkKing.name,
                value: `${afkKing.autoPlays} auto-plays`,
                description: `${afkKing.name} has ${afkKing.autoPlays} auto-plays. Are they playing or just decorating the room? Their keyboard must be collecting dust! 💤`
            });
        }
        
        // 5. Got Pangkah per Game (Unluckiest)
        if (rateEligible.length > 0) {
            const unlucky = rateEligible.reduce((a, b) => parseFloat(a.gotPangkahPerGame) > parseFloat(b.gotPangkahPerGame) ? a : b);
            if (parseFloat(unlucky.gotPangkahPerGame) > 0) {
                records.push({
                    id: 'unlucky',
                    category: 'shame',
                    icon: '🍀',
                    title: 'Unluckiest Player',
                    player: unlucky.name,
                    value: `${unlucky.gotPangkahPerGame}/game`,
                    description: `${unlucky.name} receives ${unlucky.gotPangkahPerGame} pangkahs per game. If bad luck was a person, it would be them! Maybe try a lucky charm? 🐈‍⬛`
                });
            }
        }
        
        // 6. Most Cards Held (Card Hoarder - moved to shame)
        const cardHoarder = playersWithRates.reduce((a, b) => a.maxCardsHeld > b.maxCardsHeld ? a : b);
        if (cardHoarder.maxCardsHeld > 0) {
            records.push({
                id: 'maxcards',
                category: 'shame',
                icon: '🐿️',
                title: 'Card Hoarder',
                player: cardHoarder.name,
                value: `${cardHoarder.maxCardsHeld} cards`,
                description: `${cardHoarder.name} once held ${cardHoarder.maxCardsHeld} cards in one game! They needed TWO HANDS just to hold them all! How did it feel being a walking deck? 🃏`
            });
        }
        
        // 7. Hand Giver (Santa - moved to shame, it's giving away wins!)
        const handGiver = playersWithRates.reduce((a, b) => a.handsGiven > b.handsGiven ? a : b);
        if (handGiver.handsGiven > 0) {
            records.push({
                id: 'given',
                category: 'shame',
                icon: '🎅',
                title: 'Santa Claus',
                player: handGiver.name,
                value: `${handGiver.handsGiven} hands given`,
                description: `${handGiver.name} has given away ${handGiver.handsGiven} hands. So generous! So kind! So... why are you helping others win?! 🎁`
            });
        }
        
        // 8. Lowest Win Rate (among eligible players)
        if (rateEligible.length > 0) {
            const worstWinRate = rateEligible.reduce((a, b) => parseFloat(a.winRate) < parseFloat(b.winRate) ? a : b);
            records.push({
                id: 'lowestwinrate',
                category: 'shame',
                icon: '📉',
                title: 'Rock Bottom',
                player: worstWinRate.name,
                value: `${worstWinRate.winRate}% win rate`,
                description: `${worstWinRate.name} has a ${worstWinRate.winRate}% win rate. At least they're consistent... consistently losing! The floor is their ceiling! 🪨`
            });
        }
        
        // 9. Most Games Without Improvement (high games, low win rate)
        if (rateEligible.length > 0) {
            const hopeless = rateEligible
                .filter(p => p.games >= 10)
                .sort((a, b) => (b.games * (100 - parseFloat(b.winRate))) - (a.games * (100 - parseFloat(a.winRate))))[0];
            if (hopeless) {
                records.push({
                    id: 'hopeless',
                    category: 'shame',
                    icon: '🪦',
                    title: 'Lost Cause',
                    player: hopeless.name,
                    value: `${hopeless.games} games, ${hopeless.winRate}% WR`,
                    description: `${hopeless.name} has played ${hopeless.games} games but still has ${hopeless.winRate}% win rate. Definition of insanity: doing the same thing expecting different results! 🔄`
                });
            }
        }
        
        // ============ PAGE 3: MISC RECORDS (9 records) ============
        
        // 1. Always 2nd Place
        const silverMedalist = playersWithRates.reduce((a, b) => a.secondPlace > b.secondPlace ? a : b);
        if (silverMedalist.secondPlace > 0) {
            records.push({
                id: 'second',
                category: 'misc',
                icon: '🥈',
                title: 'Forever Bridesmaid',
                player: silverMedalist.name,
                value: `${silverMedalist.secondPlace} times`,
                description: `${silverMedalist.name} has finished 2nd place ${silverMedalist.secondPlace} times. SO CLOSE yet SO FAR! They're allergic to 1st place! Always the bridesmaid, never the bride! 💔`
            });
        }
        
        // 2. Bronze Collector
        const bronzeCollector = playersWithRates.reduce((a, b) => a.thirdPlace > b.thirdPlace ? a : b);
        if (bronzeCollector.thirdPlace > 0) {
            records.push({
                id: 'third',
                category: 'misc',
                icon: '🥉',
                title: 'Bronze Enthusiast',
                player: bronzeCollector.name,
                value: `${bronzeCollector.thirdPlace} times`,
                description: `${bronzeCollector.name} has collected ${bronzeCollector.thirdPlace} bronze medals. Not first, not last, just... there. The embodiment of "at least I tried"! 🤷`
            });
        }
        
        // 3. Middle Child (4th-10th place)
        const middleChild = playersWithRates.reduce((a, b) => a.fourthToTenth > b.fourthToTenth ? a : b);
        if (middleChild.fourthToTenth > 0) {
            records.push({
                id: 'middle',
                category: 'misc',
                icon: '😐',
                title: 'Forgettable Player',
                player: middleChild.name,
                value: `${middleChild.fourthToTenth} times`,
                description: `${middleChild.name} has finished 4th-10th place ${middleChild.fourthToTenth} times. Not good enough to win, not bad enough to meme. Just... existing. 🫥`
            });
        }
        
        // 4. Most Consistent (closest to 50% win rate)
        if (rateEligible.length > 0) {
            const consistent = rateEligible.reduce((a, b) => 
                Math.abs(50 - parseFloat(a.winRate)) < Math.abs(50 - parseFloat(b.winRate)) ? a : b
            );
            records.push({
                id: 'consistent',
                category: 'misc',
                icon: '⚖️',
                title: 'Perfectly Balanced',
                player: consistent.name,
                value: `${consistent.winRate}% win rate`,
                description: `${consistent.name} has exactly ${consistent.winRate}% win rate. Perfectly balanced, as all things should be. Thanos would be proud! 💜`
            });
        }
        
        // 5. Clean Per Game
        if (rateEligible.length > 0) {
            const cleanRate = rateEligible.reduce((a, b) => parseFloat(a.cleanPerGame) > parseFloat(b.cleanPerGame) ? a : b);
            if (parseFloat(cleanRate.cleanPerGame) > 0) {
                records.push({
                    id: 'cleanrate',
                    category: 'misc',
                    icon: '🧹',
                    title: 'Neat Freak',
                    player: cleanRate.name,
                    value: `${cleanRate.cleanPerGame}/game`,
                    description: `${cleanRate.name} wins ${cleanRate.cleanPerGame} clean rounds per game. They keep it clean, they keep it tidy, they keep it WINNING! 🧽`
                });
            }
        }
        
        // 6. Most Top 2 Finishes
        const topTwoKing = playersWithRates.reduce((a, b) => (a.wins + a.secondPlace) > (b.wins + b.secondPlace) ? a : b);
        if ((topTwoKing.wins + topTwoKing.secondPlace) > 0) {
            records.push({
                id: 'toptwo',
                category: 'misc',
                icon: '🎖️',
                title: 'Podium Regular',
                player: topTwoKing.name,
                value: `${topTwoKing.wins + topTwoKing.secondPlace} times`,
                description: `${topTwoKing.name} has finished top 2 a total of ${topTwoKing.wins + topTwoKing.secondPlace} times. They may not always win, but they're ALWAYS up there! 🏅`
            });
        }
        
        // 7. Best Pangkah Ratio (dealt vs received)
        const pangkahRatioPlayers = playersWithRates.filter(p => p.pangkahsReceived > 0);
        if (pangkahRatioPlayers.length > 0) {
            const bestRatio = pangkahRatioPlayers.reduce((a, b) => 
                (a.pangkahs / a.pangkahsReceived) > (b.pangkahs / b.pangkahsReceived) ? a : b
            );
            const ratio = (bestRatio.pangkahs / bestRatio.pangkahsReceived).toFixed(2);
            records.push({
                id: 'pangkahratio',
                category: 'misc',
                icon: '🎭',
                title: 'Karma Dealer',
                player: bestRatio.name,
                value: `${ratio}x ratio`,
                description: `${bestRatio.name} deals ${ratio}x more pangkahs than they receive. They dish it out but never take it! Ultimate uno reverse energy! 🔄`
            });
        }
        
        // 8. Worst Pangkah Ratio (received more than dealt)
        if (pangkahRatioPlayers.length > 0) {
            const worstRatio = pangkahRatioPlayers.reduce((a, b) => 
                (a.pangkahsReceived / Math.max(a.pangkahs, 1)) > (b.pangkahsReceived / Math.max(b.pangkahs, 1)) ? a : b
            );
            const ratio = (worstRatio.pangkahsReceived / Math.max(worstRatio.pangkahs, 1)).toFixed(2);
            records.push({
                id: 'badkarma',
                category: 'misc',
                icon: '☯️',
                title: 'Bad Karma',
                player: worstRatio.name,
                value: `${ratio}x ratio`,
                description: `${worstRatio.name} receives ${ratio}x more pangkahs than they deal. What did they do in their past life?! The universe is NOT on their side! 😵`
            });
        }
        
        // 9. Jack of All Trades (has wins, losses, pangkahs, clean wins - well rounded)
        const allRounder = playersWithRates
            .filter(p => p.wins > 0 && p.losses > 0 && p.pangkahs > 0 && p.cleanWins > 0)
            .sort((a, b) => (b.wins + b.pangkahs + b.cleanWins) - (a.wins + a.pangkahs + a.cleanWins))[0];
        if (allRounder) {
            records.push({
                id: 'allrounder',
                category: 'misc',
                icon: '🎪',
                title: 'Jack of All Trades',
                player: allRounder.name,
                value: `${allRounder.wins}W/${allRounder.pangkahs}P/${allRounder.cleanWins}C`,
                description: `${allRounder.name} does it all! ${allRounder.wins} wins, ${allRounder.pangkahs} pangkahs dealt, ${allRounder.cleanWins} clean rounds. Master of none? More like master of EVERYTHING! 🌟`
            });
        }
        
        res.json({ records });
    } catch (err) {
        console.error('Hall of Fame error:', err);
        res.status(500).json({ error: 'Failed to get hall of fame' });
    }
});

// Update player name API
app.post('/api/player/update-name', async (req, res) => {
    try {
        const { userID, displayName } = req.body;
        if (!userID || !displayName) {
            return res.status(400).json({ error: 'userID and displayName required' });
        }
        
        // Validate name length
        const trimmedName = displayName.trim();
        if (trimmedName.length < 1 || trimmedName.length > 20) {
            return res.status(400).json({ error: 'Name must be 1-20 characters' });
        }
        
        const player = await Player.findOneAndUpdate(
            { userID },
            { $set: { displayName: trimmedName } },
            { new: true }
        );
        
        if (!player) {
            return res.status(404).json({ error: 'Player not found' });
        }
        
        res.json({ success: true, displayName: player.displayName });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update name' });
    }
});

// Discord linking
app.post('/api/discord/link', async (req, res) => {
    try {
        const { userID, discordId, discordUsername } = req.body;
        if (!userID || !discordId) return res.status(400).json({ error: 'userID and discordId required' });
        
        // Check if discord already linked to another account
        const existing = await Player.findOne({ discordId, userID: { $ne: userID } });
        if (existing) return res.status(400).json({ error: 'Discord already linked to another account' });
        
        const player = await Player.findOneAndUpdate(
            { userID },
            { $set: { discordId, discordUsername } },
            { new: true }
        );
        
        if (!player) return res.status(404).json({ error: 'Player not found' });
        res.json({ success: true, player });
    } catch (err) {
        res.status(500).json({ error: 'Failed to link Discord' });
    }
});

app.get('/api/discord/:discordId', async (req, res) => {
    try {
        const player = await Player.findOne({ discordId: req.params.discordId });
        if (!player) return res.status(404).json({ error: 'Player not found' });
        res.json(player);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get player' });
    }
});

// GM Authentication
const GM_PASSWORD = process.env.GM_PASSWORD || 'default_gm_password';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'default_admin_password';

app.post('/api/gm/verify', (req, res) => {
    const { password } = req.body;
    if (password === GM_PASSWORD) {
        res.json({ success: true, isGM: true });
    } else {
        res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

// Admin API Routes (protected by password)
app.post('/api/admin/reset-player/:userID', async (req, res) => {
    try {
        const { password } = req.body;
        if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
        
        const player = await Player.findOneAndUpdate(
            { userID: req.params.userID },
            { $set: {
                xp: 0, wins: 0, losses: 0, games: 0, pangkahs: 0, pangkahsReceived: 0,
                bestStreak: 0, currentStreak: 0, handsAbsorbed: 0, handsGiven: 0,
                cleanWins: 0, maxCardsHeld: 0, autoPlays: 0, cardsPlayed: 0,
                secondPlace: 0, thirdPlace: 0, fourthToTenth: 0, topTwo: 0, nightGames: 0,
                unlockedTitles: [], equippedTitle: null
            }},
            { new: true }
        );
        if (!player) return res.status(404).json({ error: 'Player not found' });
        res.json({ success: true, player });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset player' });
    }
});

app.post('/api/admin/update-player/:userID', async (req, res) => {
    try {
        const { password, updates } = req.body;
        if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
        
        const player = await Player.findOneAndUpdate(
            { userID: req.params.userID },
            { $set: updates },
            { new: true }
        );
        if (!player) return res.status(404).json({ error: 'Player not found' });
        res.json({ success: true, player });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update player' });
    }
});

app.post('/api/admin/reset-all', async (req, res) => {
    try {
        const { password, confirm } = req.body;
        if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
        if (confirm !== 'RESET_ALL_PLAYERS') return res.status(400).json({ error: 'Confirmation required' });
        
        await Player.updateMany({}, { $set: {
            xp: 0, wins: 0, losses: 0, games: 0, pangkahs: 0, pangkahsReceived: 0,
            bestStreak: 0, currentStreak: 0, handsAbsorbed: 0, handsGiven: 0,
            cleanWins: 0, maxCardsHeld: 0, autoPlays: 0, cardsPlayed: 0,
            secondPlace: 0, thirdPlace: 0, fourthToTenth: 0, topTwo: 0, nightGames: 0,
            unlockedTitles: [], equippedTitle: null
        }});
        res.json({ success: true, message: 'All players reset' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset all players' });
    }
});

app.get('/api/admin/players', async (req, res) => {
    try {
        const { password } = req.query;
        if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
        
        const players = await Player.find().select('userID displayName xp wins games lastPlayedAt');
        res.json(players);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get players' });
    }
});

// Constants
const ROUND_RESOLUTION_DELAY = 1500;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const TURN_TIMER_SECONDS = 15;

// Fate configuration: how many aces to discard per player count
const FATE_CONFIG = {
    4: 0,   // 52 cards / 4 = 13 each, 0 leftover
    5: 2,   // 52 cards / 5 = 10 each, 2 leftover -> discard 2 random aces
    6: 4,   // 52 cards / 6 = 8 each, 4 leftover -> discard all 4 aces
    7: 3,   // 52 cards / 7 = 7 each, 3 leftover -> discard 3 random aces
    8: 4,   // 52 cards / 8 = 6 each, 4 leftover -> discard all 4 aces
    10: 2   // 52 cards / 10 = 5 each, 2 leftover -> discard 2 random aces
};

let rooms = {};
let turnTimers = {}; // Store turn timers per room

// Bot Configuration
const BOT_NAMES = [
    'Keanu Reeves', 'Shrek', 'Gandalf', 'Yoda', 'SpongeBob', 
    'Dobby', 'Groot', 'Pikachu', 'Batman', 'Gollum',
    'Thanos', 'Dumbledore', 'Sherlock', 'Mario', 'Sonic',
    'Elsa', 'Buzz Lightyear', 'Dora', 'Mr Bean', 'John Wick',
    'Naruto', 'Goku', 'Luffy', 'Saitama', 'Levi Ackerman'
];

const BOT_EMOTES = ['😂', '👍', '😡', '🔥', '💀', '👏', '🤡', '😎', '🥲', '💪'];

/**
 * Get random bot name
 */
function getRandomBotName(existingNames = []) {
    const available = BOT_NAMES.filter(n => !existingNames.includes(`[BOT] ${n}`));
    if (available.length === 0) return `[BOT] Bot${Math.floor(Math.random() * 1000)}`;
    return `[BOT] ${available[Math.floor(Math.random() * available.length)]}`;
}

/**
 * Create bot player object
 */
function createBot(existingNames = []) {
    const botName = getRandomBotName(existingNames);
    return {
        id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: botName,
        userID: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        hand: [],
        equippedTitle: null,
        level: Math.floor(Math.random() * 10) + 1,
        isGM: false,
        isBot: true,
        gameStats: null,
        rematchReady: false
    };
}

/**
 * Bot plays a card (AI logic)
 */
function botPlayCard(roomID) {
    const room = rooms[roomID];
    if (!room || room.resolving) return;
    
    const player = room.players[room.turn];
    if (!player || !player.isBot || player.hand.length === 0) return;
    
    // Random delay to feel more human (1-2.5 seconds)
    const delay = 1000 + Math.random() * 1500;
    
    setTimeout(() => {
        if (!rooms[roomID] || rooms[roomID].resolving) return;
        if (rooms[roomID].turn !== room.players.indexOf(player)) return;
        
        let cardToPlay = null;
        const hand = player.hand;
        
        // Helper: Count cards per suit
        const getSuitCounts = () => {
            const counts = {};
            hand.forEach(c => {
                counts[c.suit] = (counts[c.suit] || 0) + 1;
            });
            return counts;
        };
        
        // Helper: Get suit with fewest cards (to clear it)
        const getRarestSuit = () => {
            const counts = getSuitCounts();
            let rarest = null;
            let minCount = Infinity;
            for (const suit in counts) {
                if (counts[suit] < minCount) {
                    minCount = counts[suit];
                    rarest = suit;
                }
            }
            return rarest;
        };
        
        // First move - must play King of Spades
        if (room.isFirstMove) {
            cardToPlay = hand.find(c => c.suit === 'Spades' && c.rank === 'K');
        }
        // Has lead suit - must follow
        else if (room.currentSuit) {
            const suitCards = hand.filter(c => c.suit === room.currentSuit);
            if (suitCards.length > 0) {
                // STRATEGY: Play LOWEST card of lead suit to avoid winning
                // Winning = you lead next round = others can pangkah YOU
                // 80% play lowest, 20% random
                if (Math.random() < 0.8) {
                    cardToPlay = suitCards.reduce((min, c) => c.val < min.val ? c : min);
                } else {
                    cardToPlay = suitCards[Math.floor(Math.random() * suitCards.length)];
                }
            } else {
                // No lead suit - PANGKAH TIME!
                // STRATEGY: Play HIGHEST card to dump high-value cards
                // High cards are bad because they win rounds
                // 85% play highest, 15% random
                if (Math.random() < 0.85) {
                    cardToPlay = hand.reduce((max, c) => c.val > max.val ? c : max);
                } else {
                    cardToPlay = hand[Math.floor(Math.random() * hand.length)];
                }
            }
        }
        
        // Leading a new round (no current suit)
        if (!cardToPlay) {
            // STRATEGY: Clear suits with fewest cards to create pangkah opportunities
            // If I have only 1 Heart, play it! Then next time Hearts lead, I can pangkah!
            // 70% play from rarest suit (lowest card), 30% random
            if (Math.random() < 0.7) {
                const rarestSuit = getRarestSuit();
                const rarestCards = hand.filter(c => c.suit === rarestSuit);
                // Play lowest of rarest suit to not win
                cardToPlay = rarestCards.reduce((min, c) => c.val < min.val ? c : min);
            } else {
                // Random card
                cardToPlay = hand[Math.floor(Math.random() * hand.length)];
            }
        }
        
        if (cardToPlay) {
            // Sometimes send emote (20% chance)
            if (Math.random() < 0.2) {
                const emote = BOT_EMOTES[Math.floor(Math.random() * BOT_EMOTES.length)];
                io.to(roomID).emit('emote', { 
                    from: player.name, 
                    emote: emote,
                    playerIdx: room.players.indexOf(player)
                });
            }
            
            processCardPlay(roomID, room.turn, cardToPlay);
        }
    }, delay);
}

/**
 * Check if current player is bot and trigger bot play
 */
function checkBotTurn(roomID) {
    const room = rooms[roomID];
    if (!room || !room.gameStarted || room.resolving) return;
    
    const currentPlayer = room.players[room.turn];
    if (currentPlayer && currentPlayer.isBot && currentPlayer.hand.length > 0) {
        botPlayCard(roomID);
    }
}

/**
 * Fisher-Yates shuffle - unbiased randomization
 */
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Generate a shuffled 52-card deck
 */
function generateDeck() {
    const suits = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
    const ranks = [
        {n:'A',v:1}, {n:'2',v:2}, {n:'3',v:3}, {n:'4',v:4}, {n:'5',v:5},
        {n:'6',v:6}, {n:'7',v:7}, {n:'8',v:8}, {n:'9',v:9}, {n:'10',v:10},
        {n:'J',v:11}, {n:'Q',v:12}, {n:'K',v:13}
    ];
    let deck = [];
    suits.forEach(s => ranks.forEach(r => deck.push({ suit: s, rank: r.n, val: r.v })));
    return shuffle(deck);
}

/**
 * Clear turn timer for a room
 */
function clearTurnTimer(roomID) {
    if (turnTimers[roomID]) {
        clearTimeout(turnTimers[roomID].timeout);
        clearInterval(turnTimers[roomID].interval);
        delete turnTimers[roomID];
    }
}

/**
 * Start turn timer for current player
 */
function startTurnTimer(roomID) {
    const room = rooms[roomID];
    if (!room || !room.gameStarted) return;
    
    // Clear existing timer
    clearTurnTimer(roomID);
    
    const player = room.players[room.turn];
    if (!player || player.hand.length === 0) return;
    
    let timeLeft = TURN_TIMER_SECONDS;
    
    // Emit initial timer
    io.to(roomID).emit('turnTimer', { timeLeft, playerIdx: room.turn });
    
    // Countdown interval
    turnTimers[roomID] = {
        interval: setInterval(() => {
            timeLeft--;
            io.to(roomID).emit('turnTimer', { timeLeft, playerIdx: room.turn });
            if (timeLeft <= 0) {
                clearInterval(turnTimers[roomID]?.interval);
            }
        }, 1000),
        timeout: setTimeout(() => {
            autoPlayCard(roomID);
        }, TURN_TIMER_SECONDS * 1000)
    };
}

/**
 * Auto-play card when timer expires
 */
function autoPlayCard(roomID) {
    // Clear the timer first to stop any more timer events
    clearTurnTimer(roomID);
    
    const room = rooms[roomID];
    if (!room || room.resolving) return;
    
    const currentTurn = room.turn;
    const player = room.players[currentTurn];
    if (!player || player.hand.length === 0) return;
    
    let cardToPlay = null;
    
    // First move - must play King of Spades
    if (room.isFirstMove) {
        cardToPlay = player.hand.find(c => c.suit === 'Spades' && c.rank === 'K');
    } 
    // Has lead suit - play highest of that suit
    else if (room.currentSuit) {
        const suitCards = player.hand.filter(c => c.suit === room.currentSuit);
        if (suitCards.length > 0) {
            cardToPlay = suitCards.reduce((max, c) => c.val > max.val ? c : max);
        }
    }
    
    // No lead suit or starting new round - play lowest card
    if (!cardToPlay) {
        cardToPlay = player.hand.reduce((min, c) => c.val < min.val ? c : min);
    }
    
    if (cardToPlay) {
        console.log(`Auto-play for ${player.name}: ${cardToPlay.rank} of ${cardToPlay.suit}`);
        
        // Process the card play directly (no delay)
        const playedCard = player.hand.find(c => c.suit === cardToPlay.suit && c.rank === cardToPlay.rank);
        if (!playedCard) return;
        
        const cardIndex = player.hand.indexOf(playedCard);
        player.hand.splice(cardIndex, 1);
        
        if (room.isFirstMove) {
            room.isFirstMove = false;
        }
        
        room.table.push({ 
            playerIdx: currentTurn, 
            playerName: player.name, 
            card: playedCard 
        });
        
        if (player.gameStats) {
            player.gameStats.cardsPlayed++;
        }
        
        if (room.table.length === 1) {
            room.currentSuit = playedCard.suit;
        }
        
        // Emit autoPlayed with FULL game state so client can render properly
        io.to(roomID).emit('autoPlayed', { 
            playerName: player.name,
            playerUserID: player.userID,
            card: cardToPlay,
            // Include full state for re-render
            table: room.table,
            turn: room.turn,
            players: room.players,
            currentSuit: room.currentSuit,
            fateAces: room.fateAces
        });
        
        // Determine if Pangkah occurred
        let isPangkah = playedCard.suit !== room.currentSuit;
        
        if (player.gameStats && isPangkah) {
            player.gameStats.pangkahsDealt++;
            room.pangkahDealer = player.userID; // Track who dealt the pangkah
        }
        
        // Count active players
        let activePlayers = room.players.filter(p => 
            p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p))
        );
        let roundComplete = room.table.length >= activePlayers.length;

        if (isPangkah || roundComplete) {
            room.resolving = true;
            setTimeout(() => {
                resolveRound(roomID, isPangkah);
            }, ROUND_RESOLUTION_DELAY);
        } else {
            advanceToNextPlayer(roomID);
        }
    }
}

/**
 * Process card play (shared logic for manual and auto play)
 */
function processCardPlay(roomID, playerIdx, cardObject) {
    const room = rooms[roomID];
    if (!room) return;
    
    const player = room.players[playerIdx];
    const cardIndex = player.hand.findIndex(c => 
        c.suit === cardObject.suit && c.rank === cardObject.rank
    );
    
    if (cardIndex === -1) return;
    
    const playedCard = player.hand[cardIndex];
    
    // Clear timer
    clearTurnTimer(roomID);
    
    // Update first move flag
    if (room.isFirstMove) {
        room.isFirstMove = false;
    }

    // Play the card
    player.hand.splice(cardIndex, 1);
    room.table.push({ 
        playerIdx: playerIdx, 
        playerName: player.name, 
        card: playedCard 
    });
    
    // Track stats
    if (player.gameStats) {
        player.gameStats.cardsPlayed++;
    }
    
    // Set lead suit if first card
    if (room.table.length === 1) {
        room.currentSuit = playedCard.suit;
    }

    io.to(roomID).emit('updateTable', { 
        table: room.table, 
        turn: room.turn, 
        players: room.players,
        currentSuit: room.currentSuit
    });

    // Determine if Pangkah occurred
    let isPangkah = playedCard.suit !== room.currentSuit;
    
    // Track pangkah stats and dealer
    if (isPangkah && player.gameStats) {
        player.gameStats.pangkahsDealt++;
        room.pangkahDealer = player.userID; // Track who dealt the pangkah
    }
    
    // Count active players
    let activePlayers = room.players.filter(p => 
        p.hand.length > 0 || room.table.some(t => t.playerIdx === room.players.indexOf(p))
    );
    let roundComplete = room.table.length >= activePlayers.length;

    if (isPangkah || roundComplete) {
        room.resolving = true;
        
        setTimeout(() => {
            resolveRound(roomID, isPangkah);
        }, ROUND_RESOLUTION_DELAY);
    } else {
        // Next player's turn
        advanceToNextPlayer(roomID);
    }
}

/**
 * Advance to next player with cards
 */
function advanceToNextPlayer(roomID) {
    const room = rooms[roomID];
    if (!room) return;
    
    let nextTurn = (room.turn + 1) % room.players.length;
    let attempts = 0;
    
    while (room.players[nextTurn].hand.length === 0 && attempts < room.players.length) {
        nextTurn = (nextTurn + 1) % room.players.length;
        attempts++;
    }
    
    room.turn = nextTurn;
    
    io.to(roomID).emit('nextTurn', { 
        turn: room.turn, 
        players: room.players,
        currentSuit: room.currentSuit,
        table: room.table,
        fateAces: room.fateAces
    });
    
    // Check if next player is a bot
    const nextPlayer = room.players[room.turn];
    if (nextPlayer && nextPlayer.isBot) {
        checkBotTurn(roomID);
    } else {
        // Start timer for human player
        startTurnTimer(roomID);
    }
}

/**
 * Resolve round (pangkah or clean)
 */
function resolveRound(roomID, isPangkah) {
    const room = rooms[roomID];
    if (!room) return;
    
    // Find winner (highest card of lead suit)
    let winnerIdx = -1;
    let highVal = -1;
    
    room.table.forEach(t => {
        if (t.card.suit === room.currentSuit && t.card.val > highVal) {
            highVal = t.card.val;
            winnerIdx = t.playerIdx;
        }
    });
    
    if (winnerIdx === -1) {
        winnerIdx = room.table[0].playerIdx;
        console.warn('Warning: No player played lead suit!');
    }
    
    const winner = room.players[winnerIdx];
    
    // Handle round outcome
    if (isPangkah) {
        winner.hand.push(...room.table.map(t => t.card));
        
        if (winner.gameStats) {
            winner.gameStats.pangkahsReceived++;
            const maxCards = Math.max(...room.players.map(p => p.hand.length));
            if (winner.hand.length === maxCards && winner.hand.length >= 15) {
                winner.gameStats.hadMostCards = true;
            }
        }
    } else {
        room.discarded.push(...room.table.map(t => t.card));
        if (winner.gameStats) {
            winner.gameStats.cleanWins++;
        }
    }
    
    // Check for game over
    let survivors = room.players.filter(p => p.hand.length > 0);
    
    // Track finish order - players who just emptied their hand
    room.players.forEach((p, idx) => {
        if (p.hand.length === 0 && !room.finishOrder.includes(p.userID)) {
            room.finishOrder.push(p.userID);
            // Position 1 = first to empty (WINNER), Position N = last with cards (LOSER)
            p.gameStats.finishPosition = room.finishOrder.length;
            
            if (p.gameStats.hadMostCards && p.gameStats.finishPosition <= 2) {
                p.gameStats.comebacks++;
            }
        }
    });
    
    if (survivors.length <= 1) {
        // Game over - the last survivor is the LOSER
        clearTurnTimer(roomID);
        
        if (survivors[0]) {
            // Last player with cards = LAST PLACE (loser)
            room.finishOrder.push(survivors[0].userID);
            survivors[0].gameStats.finishPosition = room.players.length; // Last position
        }
        
        const performanceData = room.players.map(p => ({
            userID: p.userID,
            name: p.name,
            position: p.gameStats.finishPosition,
            stats: p.gameStats,
            equippedTitle: p.equippedTitle
        }));
        
        io.to(roomID).emit('gameOver', { 
            loser: survivors[0]?.name || 'None',
            loserUserID: survivors[0]?.userID || null,
            finishOrder: room.finishOrder,
            gameNumber: room.gameNumber,
            performanceData
        });
        
        room.gameStarted = false;
        
        // Auto-ready bots for rematch
        room.players.forEach(p => {
            if (p.isBot) {
                p.rematchReady = true;
            }
        });
        
        // Emit rematch status with bots already ready
        const botReadyCount = room.players.filter(p => p.isBot).length;
        if (botReadyCount > 0) {
            io.to(roomID).emit('rematchStatus', {
                readyCount: botReadyCount,
                totalCount: room.players.length,
                allReady: false
            });
        }
        
        broadcastRooms();
        
        console.log(`Game #${room.gameNumber} ended in room ${roomID}. Loser: ${survivors[0]?.name || 'None'}`);
    } else {
        // Continue game
        room.table = [];
        room.currentSuit = null;
        room.turn = winnerIdx;
        room.resolving = false;
        
        io.to(roomID).emit('clearTable', { 
            msg: isPangkah ? 'Pangkah!' : 'Clean!', 
            winner: winner.name,
            winnerUserID: winner.userID,
            pangkahDealerUserID: isPangkah ? room.pangkahDealer : null,
            turn: room.turn, 
            players: room.players,
            fateAces: room.fateAces
        });
        
        // Check if next player (winner) is a bot
        const nextPlayer = room.players[room.turn];
        setTimeout(() => {
            if (nextPlayer && nextPlayer.isBot) {
                checkBotTurn(roomID);
            } else {
                startTurnTimer(roomID);
            }
        }, 500);
    }
}

/**
 * Broadcast current room list to all clients
 */
const broadcastRooms = () => {
    const list = Object.keys(rooms).map(id => ({
        id, 
        count: rooms[id].players.length, 
        max: rooms[id].maxPlayers,
        inGame: rooms[id].gameStarted
    }));
    io.emit('roomList', list);
};

/**
 * Find the next active player (with cards in hand)
 */
function getNextActivePlayer(room, startIdx) {
    let nextIdx = startIdx;
    let attempts = 0;
    
    do {
        nextIdx = (nextIdx + 1) % room.players.length;
        attempts++;
        
        if (attempts >= room.players.length) {
            return -1;
        }
    } while (room.players[nextIdx].hand.length === 0);
    
    return nextIdx;
}

/**
 * Initialize player game stats for a new game
 */
function initPlayerGameStats(player) {
    player.gameStats = {
        pangkahsDealt: 0,      // Times they pangkah'd someone
        pangkahsReceived: 0,   // Times they got pangkah'd
        cleanWins: 0,          // Clean rounds they won
        cardsPlayed: 0,        // Total cards played
        perfectRounds: 0,      // Rounds where they played optimally
        comebacks: 0,          // Times they recovered from 15+ cards
        hadMostCards: false,   // At some point had most cards
        finishPosition: 0      // Final position (1st, 2nd, etc.)
    };
}

/**
 * Health check endpoint for Render
 */
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        rooms: Object.keys(rooms).length,
        uptime: process.uptime()
    });
});

/**
 * Main socket connection handler
 */
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    broadcastRooms();

    /**
     * SESSION RECONNECTION
     */
    socket.on('checkSession', ({ userID }) => {
        if (!userID) return;
        
        for (let rid in rooms) {
            let pIdx = rooms[rid].players.findIndex(p => p.userID === userID);
            if (pIdx !== -1) {
                rooms[rid].players[pIdx].id = socket.id;
                socket.join(rid);
                socket.emit('reconnectSuccess', { 
                    roomID: rid, 
                    players: rooms[rid].players, 
                    turn: rooms[rid].turn, 
                    table: rooms[rid].table,
                    fateAces: rooms[rid].fateAces || [],
                    gameStarted: rooms[rid].gameStarted,
                    isFirstMove: rooms[rid].isFirstMove,
                    currentSuit: rooms[rid].currentSuit,
                    resolving: rooms[rid].resolving || false,
                    gameNumber: rooms[rid].gameNumber || 1
                });
                console.log(`User ${userID} reconnected to room ${rid}`);
                return;
            }
        }
    });

    /**
     * CLOSE ROOM
     */
    socket.on('requestCloseRoom', ({ roomID }) => {
        if (!roomID || !rooms[roomID]) return;
        
        io.to(roomID).emit('roomClosed');
        io.in(roomID).socketsLeave(roomID);
        delete rooms[roomID];
        broadcastRooms();
        console.log(`Room ${roomID} disbanded.`);
    });

    /**
     * CREATE ROOM
     */
    socket.on('createRoom', ({ roomID, playerName, maxPlayers, userID, equippedTitle, level, isGM, botCount }) => {
        if (!roomID || !playerName || !userID) {
            return socket.emit('errorMsg', 'Missing required fields');
        }
        
        if (rooms[roomID]) {
            return socket.emit('errorMsg', 'Room ID already exists!');
        }
        
        const max = parseInt(maxPlayers);
        if (isNaN(max) || max < MIN_PLAYERS || max > MAX_PLAYERS) {
            return socket.emit('errorMsg', `Max players must be ${MIN_PLAYERS}-${MAX_PLAYERS}`);
        }
        
        // Validate bot count (0, 1, or 2)
        const numBots = Math.min(Math.max(parseInt(botCount) || 0, 0), 2);
        
        // Create room with host player
        rooms[roomID] = {
            id: roomID, 
            maxPlayers: max,
            players: [{ 
                id: socket.id, 
                name: playerName, 
                userID: userID, 
                hand: [],
                equippedTitle: equippedTitle || null,
                level: level || 1,
                isGM: isGM || false,
                isBot: false,
                gameStats: null,
                rematchReady: false
            }],
            turn: 0, 
            table: [], 
            currentSuit: null, 
            isFirstMove: true, 
            discarded: [],
            fateAces: [],
            gameStarted: false,
            resolving: false,
            gameNumber: 0,
            finishOrder: [],
            botCount: numBots
        };
        
        // Add bots
        const existingNames = [playerName];
        for (let i = 0; i < numBots; i++) {
            const bot = createBot(existingNames);
            existingNames.push(bot.name);
            rooms[roomID].players.push(bot);
        }
        
        socket.join(roomID);
        io.to(roomID).emit('updatePlayers', rooms[roomID].players, { maxPlayers: rooms[roomID].maxPlayers, botCount: numBots });
        broadcastRooms();
        console.log(`Room ${roomID} created by ${playerName}${isGM?' (GM)':''} with ${numBots} bot(s)`);
    });

    /**
     * JOIN ROOM
     */
    socket.on('joinRoom', ({ roomID, playerName, userID, equippedTitle, level, isGM }) => {
        if (!roomID || !playerName || !userID) {
            return socket.emit('errorMsg', 'Missing required fields');
        }
        
        const room = rooms[roomID];
        if (!room) {
            return socket.emit('errorMsg', 'Room not found!');
        }
        
        let existing = room.players.find(p => p.userID === userID);
        if (existing) {
            existing.id = socket.id;
            existing.equippedTitle = equippedTitle || existing.equippedTitle;
            existing.level = level || existing.level || 1;
            existing.isGM = isGM || existing.isGM || false;
            socket.join(roomID);
            console.log(`${playerName} rejoined room ${roomID}${isGM?' (GM)':''}`);
        } else {
            if (room.players.length >= room.maxPlayers) {
                return socket.emit('errorMsg', 'Room full!');
            }
            
            if (room.gameStarted) {
                return socket.emit('errorMsg', 'Game already in progress!');
            }
            
            room.players.push({ 
                id: socket.id, 
                name: playerName, 
                userID: userID, 
                hand: [],
                equippedTitle: equippedTitle || null,
                level: level || 1,
                isGM: isGM || false,
                gameStats: null,
                rematchReady: false
            });
            socket.join(roomID);
            console.log(`${playerName} joined room ${roomID}${isGM?' (GM)':''}`);
        }
        
        io.to(roomID).emit('updatePlayers', room.players, { maxPlayers: room.maxPlayers });
        broadcastRooms();
    });

    /**
     * UPDATE EQUIPPED TITLE
     */
    socket.on('updateTitle', ({ roomID, userID, title }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const player = room.players.find(p => p.userID === userID);
        if (player) {
            player.equippedTitle = title;
            io.to(roomID).emit('updatePlayers', room.players);
        }
    });

    /**
     * START GAME - Core Logic
     */
    function startGameForRoom(roomID) {
        const room = rooms[roomID];
        if (!room) return false;
        
        const playerCount = room.players.length;
        
        if (playerCount < MIN_PLAYERS) {
            return false;
        }
        
        // Check if player count is valid (has a fate config)
        if (FATE_CONFIG[playerCount] === undefined) {
            return false;
        }
        
        room.gameStarted = true;
        room.resolving = false;
        room.table = [];
        room.currentSuit = null;
        room.gameNumber = (room.gameNumber || 0) + 1;
        room.finishOrder = [];
        
        // Reset rematch flags
        room.players.forEach(p => {
            p.rematchReady = false;
            initPlayerGameStats(p);
        });
        
        let deck = generateDeck();
        room.discarded = [];
        room.fateAces = []; // Separate array for initial discarded aces

        // Fate Rule: Remove Aces based on player count
        const discardCount = FATE_CONFIG[playerCount];
        if (discardCount > 0) {
            let aceIndices = [];
            deck.forEach((card, idx) => { 
                if (card.rank === 'A') aceIndices.push(idx); 
            });
            
            shuffle(aceIndices);
            let toRemove = aceIndices.slice(0, discardCount).sort((a, b) => b - a);
            toRemove.forEach(idx => { 
                room.fateAces.push(deck.splice(idx, 1)[0]); 
            });
        }

        // Deal cards evenly
        let cardsPerPlayer = Math.floor(deck.length / playerCount);
        room.players.forEach(p => { 
            p.hand = deck.splice(0, cardsPerPlayer); 
        });

        // Find player with King of Spades
        let starterIdx = room.players.findIndex(p => 
            p.hand.some(c => c.suit === 'Spades' && c.rank === 'K')
        );
        
        room.turn = starterIdx !== -1 ? starterIdx : 0;
        room.isFirstMove = true;
        
        io.to(roomID).emit('gameInit', { 
            players: room.players, 
            turn: room.turn, 
            fateAces: room.fateAces,
            isFirstMove: room.isFirstMove,
            gameNumber: room.gameNumber
        });
        
        // Check if first player is a bot
        const firstPlayer = room.players[room.turn];
        setTimeout(() => {
            if (firstPlayer && firstPlayer.isBot) {
                checkBotTurn(roomID);
            } else {
                startTurnTimer(roomID);
            }
        }, 1000);
        
        console.log(`Game #${room.gameNumber} started in room ${roomID} with ${playerCount} players. ${room.players[room.turn].name} has K♠`);
        return true;
    }

    /**
     * START GAME - Socket Handler
     */
    socket.on('startGame', (roomID) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const playerCount = room.players.length;
        
        if (playerCount < MIN_PLAYERS) {
            return socket.emit('errorMsg', `Need at least ${MIN_PLAYERS} players to start`);
        }
        
        if (FATE_CONFIG[playerCount] === undefined) {
            return socket.emit('errorMsg', `Cannot start with ${playerCount} players. Valid: 4, 5, 6, 7, 8, or 10 players.`);
        }
        
        startGameForRoom(roomID);
    });

    /**
     * REMATCH - Player ready
     */
    socket.on('rematchReady', ({ roomID, userID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const player = room.players.find(p => p.userID === userID);
        if (player) {
            player.rematchReady = true;
            
            // Check if all players are ready
            const allReady = room.players.every(p => p.rematchReady);
            
            io.to(roomID).emit('rematchStatus', {
                readyCount: room.players.filter(p => p.rematchReady).length,
                totalCount: room.players.length,
                allReady
            });
            
            // Auto-start if all ready
            if (allReady) {
                setTimeout(() => {
                    startGameForRoom(roomID);
                }, 1500);
            }
        }
    });

    /**
     * HAND SWAP - Send Request (only allowed on your turn)
     */
    socket.on('sendSwapRequest', ({ roomID, fromUserID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const myIdx = room.players.findIndex(p => p.userID === fromUserID);
        if (myIdx === -1) {
            return socket.emit('errorMsg', 'Player not found');
        }
        
        // Check if it's the requester's turn
        if (room.turn !== myIdx) {
            return socket.emit('errorMsg', 'Wait for your turn!');
        }
        
        let targetIdx = (myIdx + 1) % room.players.length;
        let attempts = 0;
        
        while (room.players[targetIdx].hand.length === 0 && attempts < room.players.length) {
            targetIdx = (targetIdx + 1) % room.players.length;
            attempts++;
        }
        
        if (attempts >= room.players.length) {
            return socket.emit('errorMsg', 'No valid target for hand absorption');
        }
        
        io.to(room.players[targetIdx].id).emit('receiveSwapRequest', { 
            fromName: room.players[myIdx].name, 
            fromUserID 
        });
        
        console.log(`${room.players[myIdx].name} requests to absorb ${room.players[targetIdx].name}'s hand`);
    });

    /**
     * HAND SWAP - Accept Request
     */
    socket.on('acceptSwap', ({ roomID, fromUserID, myUserID }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        const requester = room.players.find(p => p.userID === fromUserID);
        const accepter = room.players.find(p => p.userID === myUserID);
        
        if (!requester || !accepter) {
            return socket.emit('errorMsg', 'Invalid swap participants');
        }
        
        requester.hand.push(...accepter.hand);
        accepter.hand = [];
        
        // IMPORTANT: Track finish order when player gives away their hand!
        // The accepter just emptied their hand, so they should be added to finishOrder
        if (room.finishOrder && !room.finishOrder.includes(accepter.userID)) {
            room.finishOrder.push(accepter.userID);
            if (accepter.gameStats) {
                accepter.gameStats.finishPosition = room.finishOrder.length;
            }
            console.log(`${accepter.name} finished in position ${room.finishOrder.length} (gave hand away)`);
        }
        
        io.to(roomID).emit('swapOccurred', { 
            msg: `${requester.name} absorbed ${accepter.name}'s hand!`,
            requesterUserID: requester.userID,
            accepterUserID: accepter.userID,
            requesterName: requester.name,
            accepterName: accepter.name,
            players: room.players,
            turn: room.turn,
            table: room.table,
            finishOrder: room.finishOrder // Send updated finish order
        });
        
        // Check if game should end (only 1 player left with cards)
        let survivors = room.players.filter(p => p.hand.length > 0);
        if (survivors.length <= 1 && room.gameStarted) {
            // Game over - the last survivor is the LOSER
            clearTurnTimer(roomID);
            
            if (survivors[0]) {
                room.finishOrder.push(survivors[0].userID);
                survivors[0].gameStats.finishPosition = room.players.length;
            }
            
            const performanceData = room.players.map(p => ({
                userID: p.userID,
                name: p.name,
                position: p.gameStats ? p.gameStats.finishPosition : 0,
                stats: p.gameStats,
                equippedTitle: p.equippedTitle
            }));
            
            io.to(roomID).emit('gameOver', { 
                loser: survivors[0]?.name || 'None',
                loserUserID: survivors[0]?.userID || null,
                finishOrder: room.finishOrder,
                gameNumber: room.gameNumber,
                performanceData
            });
            
            room.gameStarted = false;
            broadcastRooms();
            
            console.log(`Game #${room.gameNumber} ended in room ${roomID} (via hand swap). Loser: ${survivors[0]?.name || 'None'}`);
        } else {
            // Game continues - reset turn timer back to 15 seconds
            startTurnTimer(roomID);
        }
        
        console.log(`${requester.name} absorbed ${accepter.name}'s hand`);
    });

    /**
     * PLAY CARD - Core game logic
     */
    socket.on('playCard', ({ roomID, cardObject }) => {
        const room = rooms[roomID];
        if (!room) return;
        
        if (room.resolving) {
            return socket.emit('errorMsg', 'Round is being resolved, please wait...');
        }
        
        if (room.players[room.turn].id !== socket.id) {
            return socket.emit('errorMsg', 'Not your turn!');
        }

        const player = room.players[room.turn];
        const cardIndex = player.hand.findIndex(c => 
            c.suit === cardObject.suit && c.rank === cardObject.rank
        );
        
        if (cardIndex === -1) {
            return socket.emit('errorMsg', 'Card not found in hand');
        }
        
        const playedCard = player.hand[cardIndex];

        // RULE 1: First move MUST be King of Spades
        if (room.isFirstMove) {
            if (playedCard.suit !== 'Spades' || playedCard.rank !== 'K') {
                return socket.emit('errorMsg', "First move MUST be King of Spades!");
            }
        }

        // RULE 2: Must follow suit if possible
        if (room.table.length > 0 && playedCard.suit !== room.currentSuit) {
            if (player.hand.some(c => c.suit === room.currentSuit)) {
                return socket.emit('errorMsg', `Must follow suit: ${room.currentSuit}`);
            }
        }

        // Process the card play
        processCardPlay(roomID, room.turn, cardObject);
    });

    /**
     * EMOTE HANDLER
     */
    socket.on('sendEmote', ({ roomID, userID, playerName, emoji }) => {
        if (!roomID) return;
        // Broadcast emote to all players in room except sender
        socket.to(roomID).emit('receiveEmote', { userID, playerName, emoji });
    });

    /**
     * DISCONNECT HANDLER
     */
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎴 Pangkah Server v2 active on port ${PORT}`));
