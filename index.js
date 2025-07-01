const express = require('express');
const { Webhook } = require('@top-gg/sdk');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const axios = require('axios');

const app = express();
const webhook = new Webhook('252566'); // Your Top.gg webhook secret

// Replace with your actual bot values:
const CLIENT_ID = '1362516883785515199';
const CLIENT_SECRET = 'eXuBq95536h177-RfcgvBOybWouxwK5k';
const REDIRECT_URI = 'https://thepokebot.com/callback'; // Example: https://thepokebot.com/callback
let cachedInventory = null;
let lastFetch = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/faq', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public.html'));
});



app.use(session({
    secret: 'your-secret-key-here',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week session
        sameSite: 'lax',
        secure: false // set to true if forcing HTTPS only
    }
}));

app.post('/upload', (req, res) => {
    if (req.body.secret !== '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') return res.status(403).send('Forbidden');

    fs.writeFileSync('user_inventory.json', req.body.inventory, 'utf8');
    res.send('✅ File received');
});

app.get('/user_inventory.json', (req, res) => {
    res.sendFile(path.join(__dirname, 'user_inventory.json'));
});





// Webhook vote listener
app.post('/dblwebhook', webhook.middleware(), (req, res) => {
    const userId = req.vote.user;
    console.log('✅ Vote received from', userId);

    let data = {};
    if (fs.existsSync('vote_rewards.json')) {
        data = JSON.parse(fs.readFileSync('vote_rewards.json', 'utf8') || '{}');
    }

    data[userId] = { pending: true, timestamp: Date.now() };
    fs.writeFileSync('vote_rewards.json', JSON.stringify(data, null, 2));

    res.status(200).send('Vote recorded');
});

app.get('/stats', async (req, res) => {
    try {
        const inventoryUrl = 'https://raw.githubusercontent.com/Yo0l0/ssss/main/user_inventory.json';
        const response = await axios.get(inventoryUrl, { maxContentLength: Infinity, maxBodyLength: Infinity });
        const data = response.data;

        let totalCards = 0;
        let totalUsers = 0;
        let droppedToday = 0;
        const packTimestamps = new Set();

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        const dropCountsByDay = {}; // { "YYYY-MM-DD": count }

        for (const userId in data) {
            const user = data[userId];
            if (user.cards) {
                totalCards += user.cards.length;
                totalUsers += 1;

                user.cards.forEach(card => {
                    if (card.obtainedAt) {
                        packTimestamps.add(card.obtainedAt); // Packs based on unique timestamp

                        const date = new Date(card.obtainedAt);
                        const dayStr = date.toISOString().split('T')[0];

                        dropCountsByDay[dayStr] = (dropCountsByDay[dayStr] || 0) + 1;

                        if (card.obtainedAt >= todayStart) droppedToday++;
                    }
                });
            }
        }

        const totalPacks = packTimestamps.size;

        // Calculate weekly averages
        const sortedDays = Object.keys(dropCountsByDay).sort();
        const lastWeek = [];
        const thisWeek = [];

        const currentDayOfWeek = now.getDay(); // 0 = Sunday
        const todayStr = now.toISOString().split('T')[0];

        const lastWeekStart = new Date(todayStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - currentDayOfWeek - 7); 

        const lastWeekEnd = new Date(todayStart);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - currentDayOfWeek); 

        const thisWeekStart = new Date(todayStart);
        thisWeekStart.setDate(thisWeekStart.getDate() - currentDayOfWeek); 

        sortedDays.forEach(day => {
            const dayTime = new Date(day).getTime();

            if (dayTime >= lastWeekStart.getTime() && dayTime < lastWeekEnd.getTime()) {
                lastWeek.push(dropCountsByDay[day]);
            }

            if (dayTime >= thisWeekStart.getTime() && dayTime <= todayStart) {
                thisWeek.push(dropCountsByDay[day]);
            }
        });

        const lastWeekAvg = lastWeek.length ? Math.round(lastWeek.reduce((a, b) => a + b, 0) / lastWeek.length) : 0;
        const thisWeekAvg = thisWeek.length ? Math.round(thisWeek.reduce((a, b) => a + b, 0) / thisWeek.length) : 0;

        res.json({
            totalCards,
            totalUsers,
            totalPacks,
            droppedToday,
            lastWeekAvg,
            thisWeekAvg
        });

    } catch (err) {
        console.error('Failed to load stats:', err.message);
        res.json({
            totalCards: 0,
            totalUsers: 0,
            totalPacks: 0,
            droppedToday: 0,
            lastWeekAvg: 0,
            thisWeekAvg: 0
        });
    }
});




// Serve homepage
app.get('/', (req, res) => {
    let totalCards = 0;
    let totalUsers = 0;

    if (fs.existsSync('user_inventory.json')) {
        const data = JSON.parse(fs.readFileSync('user_inventory.json', 'utf8') || '{}');
        totalUsers = Object.keys(data).length;
        for (const userId in data) {
            const cards = data[userId]?.cards || [];
            totalCards += cards.length;
        }
    }

    let html = `
<head>
    <title>Pokebot - Discord Bot</title>
    <link rel="icon" type="image/png" href="https://raw.githubusercontent.com/Yo0l0/ssss/refs/heads/main/GengarImages.png">
    <style>
        body { font-family: Arial, sans-serif; background: linear-gradient(135deg, #2c003e, #0d001d); color: #fff; display: flex; flex-direction: column; align-items: center; min-height: 100vh; margin: 0; }
        .container { text-align: center; margin-top: 80px; padding: 20px; animation: fadeIn 1.2s ease; }
        .bot-image { width: 150px; height: 150px; border-radius: 50%; border: 3px solid #00cc99; object-fit: cover; margin-bottom: 20px; }
        h1 { font-size: 2em; margin-bottom: 10px; }
        p { max-width: 600px; margin: 0 auto 30px; line-height: 1.5; }
        .btn { display: block; margin: 10px auto; padding: 15px 30px; background: #cc0066; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; min-width: 220px; transition: background 0.3s, box-shadow 0.3s; box-shadow: 0 0 10px rgba(204, 0, 102, 0.4); }
        .btn:hover { background: #b30059; box-shadow: 0 0 20px rgba(204, 0, 102, 0.8); }
        .features, .stats { margin-top: 40px; text-align: center; }
        ul { list-style: none; padding: 0; }
        li { margin: 10px 0; font-size: 1.1em; }
        .footer { margin-top: auto; padding: 20px; font-size: 0.9em; color: #888; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .topright { position: absolute; top: 20px; right: 20px; display: flex; align-items: center; cursor: pointer; position: fixed; }
        .topright img { width: 40px; height: 40px; border-radius: 50%; }
        .dropdown { display: none; position: absolute; top: 60px; right: 0; background: #2c003e; border: 1px solid #00cc99; border-radius: 8px; min-width: 120px; z-index: 999; text-align: left; }
        .dropdown a { display: block; padding: 10px; color: white; text-decoration: none; }
        .dropdown a:hover { background: #b30059; }
    </style>
</head>
<body>

<div class="topright" id="profileBtn">
    ${req.session.user ? `<img src="https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png" alt="PFP">` : `<img src="https://raw.githubusercontent.com/Yo0l0/ssss/main/Pokebot.png" alt="Pokebot">`}
    <div class="dropdown" id="dropdownMenu">
        ${req.session.user ? `<a href="/logout">Logout</a>` : `<a href="/login">Login</a>`}
    </div>
</div>

<div class="container">
    <img src="https://raw.githubusercontent.com/Yo0l0/ssss/main/Pokebot.png" alt="Pokebot Icon" class="bot-image">
    <h1>🔥 Pokebot — Collect, Battle, Trade!</h1>
    <p>The ultimate Pokémon-inspired Discord bot. Build your card collection, battle friends, trade rare cards, and climb the leaderboards!</p>

    <a class="btn" href="https://discord.com/oauth2/authorize?client_id=1362516883785515199&permissions=534723951680&scope=bot+applications.commands">✨ Invite Pokebot</a>
    <a class="btn" href="https://discord.gg/g7AAsmJA">💬 Support Server</a>
    <a class="btn" href="https://top.gg/bot/1362516883785515199">✅ Vote Here!</a>
    <a class="btn" href="${req.session.user ? '/dashboard' : '/login'}">🗂️ View Your Collection</a>
   
<div id="google_translate_element" style="margin-top: 20px;"></div>
<div style="margin-top: 10px;">
    <a class="btn" href="https://thepokebot.com/faq" target="_blank">❓ FAQ / Help</a>
</div>
    <div class="features">
        <h2>Features:</h2>
        <ul>
            <li>✅ Card Collecting & Grading</li>
            <li>✅ Pack Opening from Classic Sets</li>
            <li>✅ Trading & Marketplace System</li>
            <li>✅ Competitive Battles & Duels</li>
            <li>✅ Leaderboards & Achievements</li>
        </ul>
    </div>

    <div class="stats">
        <h2>📊 Pokebot Stats:</h2>
        <p>📦 Total Cards Dropped: <strong id="cardCount">Loading...</strong></p>
        <p>👥 Total Users with Collections: <strong id="userCount">Loading...</strong></p>
<p>🎁 Total Packs Opened: <strong id="totalPacks">Loading...</strong></p>
<p>🎯 Cards Dropped Today: <strong id="droppedToday">Loading...</strong></p>
<p>📆 Last Week Avg Drops Per Day: <strong id="lastWeekAvg">Loading...</strong></p>
<p>📆 This Week Avg Drops Per Day: <strong id="thisWeekAvg">Loading...</strong></p>

    </div>

    <div class="footer">© 2024 Pokebot. All rights reserved.</div>

<script>
const previousCounts = {
    cardCount: 0,
    userCount: 0,
    totalPacks: 0,
    droppedToday: 0,
    lastWeekAvg: 0,
    thisWeekAvg: 0
};
function animateCount(id, start, end) {
    const el = document.getElementById(id);
    const step = Math.ceil((end - start) / 100) || 1;
    let current = start;

    const counter = setInterval(() => {
        current += step;
        if (current >= end) {
            el.innerText = end;
            clearInterval(counter);
        } else {
            el.innerText = current;
        }
    }, 15);
}
const profileBtn = document.getElementById('profileBtn');
const dropdown = document.getElementById('dropdownMenu');
profileBtn.addEventListener('click', () => { dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; });
window.addEventListener('click', (e) => { if (!profileBtn.contains(e.target)) dropdown.style.display = 'none'; });


async function updateStats() {
    try {
        const res = await fetch('/stats');
        const data = await res.json();

        if (data.totalCards !== previousCounts.cardCount) {
            animateCount('cardCount', previousCounts.cardCount, data.totalCards);
            previousCounts.cardCount = data.totalCards;
        }

        if (data.totalUsers !== previousCounts.userCount) {
            animateCount('userCount', previousCounts.userCount, data.totalUsers);
            previousCounts.userCount = data.totalUsers;
        }

        if (data.totalPacks !== previousCounts.totalPacks) {
            animateCount('totalPacks', previousCounts.totalPacks, data.totalPacks);
            previousCounts.totalPacks = data.totalPacks;
        }

        if (data.droppedToday !== previousCounts.droppedToday) {
            animateCount('droppedToday', previousCounts.droppedToday, data.droppedToday);
            previousCounts.droppedToday = data.droppedToday;
        }

        if (data.lastWeekAvg !== previousCounts.lastWeekAvg) {
            animateCount('lastWeekAvg', previousCounts.lastWeekAvg, data.lastWeekAvg);
            previousCounts.lastWeekAvg = data.lastWeekAvg;
        }

        if (data.thisWeekAvg !== previousCounts.thisWeekAvg) {
            animateCount('thisWeekAvg', previousCounts.thisWeekAvg, data.thisWeekAvg);
            previousCounts.thisWeekAvg = data.thisWeekAvg;
        }

    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

updateStats();
setInterval(updateStats, 5000);




// Load saved language
const savedLang = localStorage.getItem('preferredLang') || 'en';
langSelect.value = savedLang;

// Change handler
langSelect.addEventListener('change', function() {
    localStorage.setItem('preferredLang', this.value);
    alert('Language preference saved! (Full translations coming soon)');
});
</script>


</body>`;

    res.send(html);
});


app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Terms and Privacy
app.get('/terms-of-service', (req, res) => {
    res.sendFile(path.join(__dirname, 'terms-of-service.html'));
});
app.get('/privacy-policy', (req, res) => {
    res.sendFile(path.join(__dirname, 'privacy-policy.html'));
});

// Discord Login
app.get('/login', (req, res) => {
    const redirect = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify`;
    res.redirect(redirect);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.send('Missing code');

    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            scope: 'identify'
        }));

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
        });

        req.session.user = userRes.data;
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.send('Login error');
    }
});

// Collection Dashboard
app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const userId = req.session.user.id;

    let html = `
    <head>
        <link rel="icon" type="image/png" href="https://raw.githubusercontent.com/Yo0l0/ssss/refs/heads/main/GengarImages.png">
        <style>
            body { background: #0d001d; color: white; font-family: Arial; text-align: center; padding: 20px; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-top: 30px; }
            .card { background: #2c003e; padding: 15px; border-radius: 10px; }
            img { width: 200px; height: 280px; border-radius: 8px; }
            a { color: #00cc99; text-decoration: none; }
            .grade { color: #ffcc00; font-weight: bold; }
.pagination {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 20px;
}

.pagination button {
    padding: 10px 16px;
    min-width: 40px;
    background: #2c003e;
    color: #00cc99;
    border: 1px solid #00cc99;
    border-radius: 50px;
    cursor: pointer;
    transition: all 0.3s ease;
    font-weight: bold;
    box-shadow: 0 0 8px rgba(0, 204, 153, 0.3);
}

.pagination button:hover {
    background: #00cc99;
    color: #0d001d;
    transform: scale(1.05);
    box-shadow: 0 0 15px rgba(0, 204, 153, 0.7);
}

.pagination button.active {
    background: #00cc99;
    color: #0d001d;
    border-color: #00cc99;
    transform: scale(1.1);
    box-shadow: 0 0 20px rgba(0, 204, 153, 0.9);
}


            .filter-container { display: flex; flex-wrap: wrap; justify-content: center; gap: 15px; background: #2c003e; padding: 15px; border-radius: 10px; margin-top: 20px; }
            .filter-container select, .filter-container input[type="text"] { padding: 8px; border-radius: 5px; background: #0d001d; color: white; border: none; }
        </style>
    </head>
    <body>
    <h1>Welcome, ${req.session.user.username}</h1>
    <h2>Your Collection</h2>

    <div class="filter-container">
        <div>
            <label>Rarity:</label>
            <select id="filterRarity">
                <option value="all">All</option>
                <option value="common">Common</option>
                <option value="uncommon">Uncommon</option>
                <option value="rare">Rare</option>
                <option value="promo">Promo</option>
                <option value="holo">Holo</option>
            </select>
        </div>

        <div>
            <label>Grade:</label>
            <select id="filterGrade">
                <option value="all">All</option>
                ${[...Array(11).keys()].slice(1).map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>
        </div>

        <div>
            <label>Condition:</label>
            <select id="filterCondition">
                <option value="all">All</option>
                <option value="Pristine">Pristine</option>
                <option value="Mint">Mint</option>
                <option value="Near Mint">Near Mint</option>
                <option value="Good">Good</option>
                <option value="Played">Played</option>
                <option value="Damaged">Damaged</option>
            </select>
        </div>

        <div>
            <label>Search:</label>
            <input type="text" id="searchInput" placeholder="Search name or code..." autocomplete="off">
        </div>
    </div>

    <div class="grid" id="cardGrid"></div>
    <div id="pagination" style="margin-top: 20px;"></div>

    <a href="/" style="position: fixed; top: 20px; left: 20px; background:#2c003e; color:#00cc99; padding:10px; border-radius:8px;">⬅️ Back</a>

    <script>
    let currentPage = 1;
    let searchTimeout;

    function loadCards(page = 1) {
        currentPage = page;
        const rarity = document.getElementById('filterRarity').value;
        const grade = document.getElementById('filterGrade').value;
        const condition = document.getElementById('filterCondition').value;
        const search = document.getElementById('searchInput').value;

        fetch(\`/api/cards?rarity=\${rarity}&grade=\${grade}&condition=\${condition}&search=\${encodeURIComponent(search)}&page=\${page}\`)
            .then(res => res.json())
            .then(data => {
                const grid = document.getElementById('cardGrid');
                grid.innerHTML = '';

                if (data.cards.length === 0) {
                    grid.innerHTML = '<p>No matching cards found.</p>';
                } else {
                    data.cards.forEach(card => {
                        grid.innerHTML += \`
                        <div class="card">
                            <img src="\${card.image}" alt="\${card.name}">
                            <strong>\${card.name}</strong>
                            <p>\${card.rarity}, \${card.set}</p>
                            <p><small>Code: \${card.code}</small></p>
                            <p><small>Condition: \${card.condition || 'Unknown'}</small></p>
                            \${card.grade ? \`<div class="grade">Graded: \${card.grade}</div>\` : ''}
                        </div>\`;
                    });
                }

        const pagination = document.getElementById('pagination');
        pagination.innerHTML = '';
        
        for (let i = 1; i <= data.totalPages; i++) {
            const btn = document.createElement('button');
            btn.textContent = i;
            if (i === page) btn.classList.add('active');
            btn.onclick = () => loadCards(i);
            pagination.appendChild(btn);
        }
            })
            .catch(err => console.error('Failed to load cards:', err));
    }

    function delayedSearch() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadCards(1);
        }, 500);
    }

    window.onload = () => {
        loadCards(1);
        document.getElementById('filterRarity').addEventListener('change', () => loadCards(1));
        document.getElementById('filterGrade').addEventListener('change', () => loadCards(1));
        document.getElementById('filterCondition').addEventListener('change', () => loadCards(1));
        document.getElementById('searchInput').addEventListener('input', delayedSearch);
    };
    </script>
    </body>`;

    res.send(html);
});






app.get('/api/cards', async (req, res) => {
    if (!req.session.user) return res.status(403).json([]);

    const now = Date.now();
    if (!cachedInventory || now - lastFetch > CACHE_DURATION) {
        try {
            const response = await axios.get('https://raw.githubusercontent.com/Yo0l0/ssss/main/user_inventory.json');
            cachedInventory = response.data;
            lastFetch = now;
        } catch (err) {
            console.error('Failed to fetch inventory:', err.message);
            return res.status(500).json([]);
        }
    }

    const userId = req.session.user.id;
    const rarity = req.query.rarity || 'all';
    const grade = req.query.grade || 'all';
    const condition = req.query.condition || 'all';
    const search = req.query.search?.toLowerCase() || '';
    const page = parseInt(req.query.page) || 1;
    const perPage = 250;

    const collection = (cachedInventory[userId]?.cards) || [];

    const filtered = collection.filter(card => {
        const matchesRarity = rarity === 'all' || card.rarity.toLowerCase() === rarity;
        const matchesSearch = card.name.toLowerCase().includes(search) || card.code.toLowerCase().includes(search);
        const matchesGrade = grade === 'all' || String(card.grade || '') === grade;
        const matchesCondition = condition === 'all' || (card.condition?.toLowerCase() || '') === condition.toLowerCase();
        return matchesRarity && matchesSearch && matchesGrade && matchesCondition;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const pageCards = filtered.slice((page - 1) * perPage, page * perPage);

    res.json({ cards: pageCards, totalPages });
});


// Clear vote endpoint
app.post('/clear_vote', (req, res) => {
    const { userId } = req.body;
    const pathFile = 'vote_rewards.json';

    if (fs.existsSync(pathFile)) {
        const data = JSON.parse(fs.readFileSync(pathFile, 'utf8') || '{}');
        if (data[userId]) {
            delete data[userId];
            fs.writeFileSync(pathFile, JSON.stringify(data, null, 2));
            return res.status(200).send('Vote cleared');
        }
    }
    res.status(404).send('User not found');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
