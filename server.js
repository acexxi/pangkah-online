<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Pangkah Elite | Emerald</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        :root { 
            --primary: #10b981; --bg: #020617; 
            --glass: rgba(255, 255, 255, 0.03); --glass-border: rgba(255, 255, 255, 0.1); 
        }
        * { box-sizing: border-box; font-family: 'Plus Jakarta Sans', sans-serif; }
        body { 
            margin: 0; height: 100vh; overflow: hidden; color: white;
            background: radial-gradient(circle at 50% -20%, #064e3b, #020617 80%);
            display: flex; flex-direction: column;
        }

        /* --- LOBBY --- */
        #lobby { 
            position: fixed; inset: 0; z-index: 5000; backdrop-filter: blur(40px);
            background: rgba(2, 6, 23, 0.9); display: flex; align-items: center; justify-content: center;
        }
        .lobby-panel {
            width: 90%; max-width: 420px; padding: 40px; border-radius: 32px;
            background: var(--glass); border: 1px solid var(--glass-border); text-align: center;
        }
        .user-section { 
            display: flex; align-items: center; justify-content: center; gap: 10px; 
            margin-bottom: 30px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 15px;
        }
        .room-list { 
            height: 120px; overflow-y: auto; background: rgba(0,0,0,0.3); 
            border-radius: 15px; margin: 20px 0; border: 1px solid var(--glass-border); text-align: left;
        }
        .room-item { 
            padding: 12px; border-bottom: 1px solid var(--glass-border); 
            display: flex; justify-content: space-between; cursor: pointer; font-size: 0.85rem;
        }
        .room-item:hover { background: rgba(16, 185, 129, 0.1); }

        /* --- GAME LAYOUT --- */
        .header { height: 65px; padding: 0 25px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--glass-border); }
        #turn-glow { 
            background: var(--primary); color: #022c22; padding: 6px 18px; border-radius: 100px;
            font-weight: 800; font-size: 0.75rem; box-shadow: 0 0 25px var(--primary); display: none;
        }

        #game-view { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .responsive-table {
            position: relative; width: 100%; height: 100%;
            max-width: 42vh; max-height: 42vh; aspect-ratio: 1/1; /* Portrait Safety */
        }
        .table-ring { position: absolute; inset: 0; border-radius: 50%; border: 1px dashed rgba(16,185,129,0.3); }

        /* AVATARS */
        .player-node { position: absolute; transform: translate(-50%, -50%); text-align: center; transition: 0.4s ease; }
        .av-circle { 
            width: 50px; height: 50px; border-radius: 50%; background: #0f172a;
            border: 2px solid var(--glass-border); display: flex; align-items: center; justify-content: center;
        }
        .active .av-circle { border-color: var(--primary); box-shadow: 0 0 20px var(--primary); }

        /* HAND */
        #hand-area { height: 22vh; min-height: 160px; padding: 20px; background: rgba(0,0,0,0.4); border-top: 1px solid var(--glass-border); overflow-x: auto; }
        .hand-flex { display: flex; gap: 8px; justify-content: center; }

        /* CARDS */
        .card { 
            width: 56px; height: 84px; border-radius: 10px; background: white; color: black; padding: 6px; 
            font-weight: 800; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between;
        }
        .card.red { color: #e11d48; }
        .card:hover { transform: translateY(-15px); }

        /* UI ELEMENTS */
        input, select { width: 100%; padding: 12px; border-radius: 12px; border: 1px solid var(--glass-border); background: #000; color: #fff; margin-bottom: 10px; }
        .btn-main { background: var(--primary); color: #022c22; border: none; padding: 14px; border-radius: 12px; width: 100%; font-weight: 800; cursor: pointer; margin: 5px 0; }
        .btn-sub { background: transparent; border: 1px solid var(--glass-border); color: white; padding: 12px; border-radius: 12px; width: 100%; font-weight: 600; cursor: pointer; }
    </style>
</head>
<body>

<div id="lobby">
    <div class="lobby-panel">
        <h2 style="margin:0 0 20px 0; color: var(--primary);">Pangkah Emerald</h2>
        
        <div class="user-section">
            <span id="name-label" style="font-weight: 800;">Player</span>
            <button onclick="editName()" style="background:none; border:none; color:var(--primary); cursor:pointer; font-size: 0.7rem;">[EDIT NAME]</button>
        </div>

        <div style="font-size: 0.7rem; text-align: left; opacity: 0.5;">ONGOING ROOMS</div>
        <div class="room-list" id="room-container"></div>

        <input type="text" id="room-input" placeholder="Room ID">
        <select id="max-players"><option value="4">4 Players</option><option value="5">5 Players</option></select>
        
        <button class="btn-main" onclick="handleEntry('create')">CREATE NEW ROOM</button>
        <button class="btn-sub" onclick="handleEntry('join')">JOIN EXISTING ROOM</button>
    </div>
</div>

<div class="header">
    <div id="room-tag" style="font-weight: 800; color: var(--primary);">LOBBY</div>
    <div id="turn-glow">YOUR TURN</div>
    <div style="font-size: 0.7rem; opacity: 0.5;" id="player-count">0 Players</div>
</div>

<div id="game-view">
    <div class="responsive-table" id="table-wrap">
        <div class="table-ring"></div>
        <div id="player-layer" style="position: absolute; inset: 0;"></div>
        <div id="card-layer" style="position:absolute; inset:0;"></div>
        <button id="start-btn" class="btn-main" style="display:none; position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:auto;" onclick="startGame()">START MATCH</button>
    </div>
</div>

<div id="hand-area">
    <div class="hand-flex" id="my-hand"></div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
    const socket = io();
    let currentRoom = "";
    let myName = localStorage.getItem('pangkah_username') || 'Player_' + Math.floor(Math.random()*999);
    const icons = { 'Spades': '♠', 'Hearts': '♥', 'Diamonds': '♦', 'Clubs': '♣' };

    document.getElementById('name-label').innerText = myName;

    function editName() {
        const n = prompt("Change your name:", myName);
        if(n) {
            myName = n;
            localStorage.setItem('pangkah_username', n);
            document.getElementById('name-label').innerText = n;
        }
    }

    function handleEntry(type) {
        const rid = document.getElementById('room-input').value;
        if(!rid) return alert("Enter a Room ID");
        currentRoom = rid;
        socket.emit(type === 'create' ? 'createRoom' : 'joinRoom', { 
            roomID: rid, playerName: myName, maxPlayers: document.getElementById('max-players').value 
        });
    }

    function startGame() { socket.emit('startGame', currentRoom); }

    socket.on('roomList', list => {
        const container = document.getElementById('room-container');
        container.innerHTML = list.length ? "" : '<div style="padding:20px; opacity:0.3; font-size:0.8rem;">No active rooms.</div>';
        list.forEach(r => {
            const div = document.createElement('div');
            div.className = 'room-item';
            div.innerHTML = `<span>#${r.id}</span> <span>${r.count}/${r.max}</span>`;
            div.onclick = () => document.getElementById('room-input').value = r.id;
            container.appendChild(div);
        });
    });

    socket.on('updatePlayers', p => {
        document.getElementById('lobby').style.display = 'none';
        document.getElementById('room-tag').innerText = "ROOM: " + currentRoom;
        document.getElementById('player-count').innerText = p.length + " Players";
        if(p.length >= 4) document.getElementById('start-btn').style.display = 'block';
        render(p, -1);
    });

    socket.on('gameInit', d => {
        document.getElementById('start-btn').style.display = 'none';
        render(d.players, d.turn);
    });

    socket.on('updateTable', d => render(d.players, d.turn, d.table));
    socket.on('nextTurn', d => render(d.players, d.turn, d.table));

    socket.on('errorMsg', m => alert(m));

    function render(players, turn, table = []) {
        const pLayer = document.getElementById('player-layer');
        pLayer.innerHTML = "";
        const radius = document.getElementById('table-wrap').offsetWidth / 2;

        players.forEach((p, i) => {
            const angle = (i * (360 / players.length) - 90) * (Math.PI / 180);
            const x = Math.cos(angle) * (radius + 20);
            const y = Math.sin(angle) * (radius + 20);
            const isActive = i === turn;

            const div = document.createElement('div');
            div.className = `player-node ${isActive ? 'active' : ''}`;
            div.style.left = `calc(50% + ${x}px)`;
            div.style.top = `calc(50% + ${y}px)`;
            div.innerHTML = `<div class="av-circle"><span style="font-weight:800;">${p.name[0]}</span></div><div style="font-size:9px;margin-top:5px">${p.name}</div>`;
            pLayer.appendChild(div);

            if(isActive && p.id === socket.id) document.getElementById('turn-glow').style.display = 'block';
            else if(p.id === socket.id) document.getElementById('turn-glow').style.display = 'none';
        });

        // Cards and Table rendering logic remains the same...
        const me = players.find(p => p.id === socket.id);
        const hDiv = document.getElementById('my-hand');
        hDiv.innerHTML = "";
        if(me) {
            me.hand.forEach(c => {
                const el = createCardUI(c);
                el.onclick = () => socket.emit('playCard', { roomID: currentRoom, cardObject: c });
                hDiv.appendChild(el);
            });
        }

        const tLayer = document.getElementById('card-layer');
        tLayer.innerHTML = "";
        table.forEach((tc, idx) => {
            const el = createCardUI(tc.card);
            el.style.position = 'absolute';
            el.style.top = '50%'; el.style.left = '50%';
            el.style.transform = `translate(-50%, -50%) rotate(${idx * 15}deg)`;
            tLayer.appendChild(el);
        });
    }

    function createCardUI(c) {
        const div = document.createElement('div');
        div.className = `card ${['Hearts','Diamonds'].includes(c.suit) ? 'red' : ''}`;
        div.innerHTML = `<div style="font-size:10px">${c.rank}</div><div style="font-size:24px;text-align:center">${icons[c.suit]}</div><div style="font-size:10px;transform:rotate(180deg)">${c.rank}</div>`;
        return div;
    }
</script>
</body>
</html>
