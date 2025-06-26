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

app.use(express.json());
app.use(express.static(__dirname));

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

// Serve homepage
app.get('/', (req, res) => {
    let html = `
    <head>
        <title>Pokebot - Discord Bot</title>
        <link rel="icon" type="image/png" href="https://raw.githubusercontent.com/Yo0l0/ssss/refs/heads/main/GengarImages.png">
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #2c003e, #0d001d);
                color: #fff;
                display: flex;
                flex-direction: column;
                align-items: center;
                min-height: 100vh;
                margin: 0;
            }
            .container {
                text-align: center;
                margin-top: 80px;
                padding: 20px;
                animation: fadeIn 1.2s ease;
            }
            .bot-image {
                width: 150px;
                height: 150px;
                border-radius: 50%;
                border: 3px solid #00cc99;
                object-fit: cover;
                margin-bottom: 20px;
            }
            h1 { font-size: 2em; margin-bottom: 10px; }
            p { max-width: 600px; margin: 0 auto 30px; line-height: 1.5; }
            .btn {
                display: block;
                margin: 10px auto;
                padding: 15px 30px;
                background: #cc0066;
                color: #fff;
                text-decoration: none;
                border-radius: 8px;
                font-weight: bold;
                min-width: 220px;
                transition: background 0.3s, box-shadow 0.3s;
                box-shadow: 0 0 10px rgba(204, 0, 102, 0.4);
            }
            .btn:hover {
                background: #b30059;
                box-shadow: 0 0 20px rgba(204, 0, 102, 0.8);
            }
            .features { margin-top: 40px; text-align: center; }
            ul { list-style: none; padding: 0; }
            li { margin: 10px 0; font-size: 1.1em; }
            .footer { margin-top: auto; padding: 20px; font-size: 0.9em; color: #888; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

            .topright {
                position: absolute;
                top: 20px;
                right: 20px;
                display: flex;
                align-items: center;
                cursor: pointer;
                position: fixed;
            }
            .topright img {
                width: 40px;
                height: 40px;
                border-radius: 50%;
            }
            .dropdown {
                display: none;
                position: absolute;
                top: 60px;
                right: 0;
                background: #2c003e;
                border: 1px solid #00cc99;
                border-radius: 8px;
                min-width: 120px;
                z-index: 999;
                text-align: left;
            }
            .dropdown a {
                display: block;
                padding: 10px;
                color: white;
                text-decoration: none;
            }
            .dropdown a:hover {
                background: #b30059;
            }
        </style>
    </head>
    <body>
    `;

    // Top-right icon area
    html += `<div class="topright" id="profileBtn">`;

    if (req.session.user) {
        html += `<img src="https://cdn.discordapp.com/avatars/${req.session.user.id}/${req.session.user.avatar}.png" alt="PFP">`;
    } else {
        html += `<img src="https://raw.githubusercontent.com/Yo0l0/ssss/main/Pokebot.png" alt="Pokebot">`;
    }

    html += `
        <div class="dropdown" id="dropdownMenu">
    `;

    if (req.session.user) {
        html += `<a href="/logout">Logout</a>`;
    } else {
        html += `<a href="/login">Login</a>`;
    }

    html += `
        </div>
    </div>
    
    <div class="container">
        <img src="https://raw.githubusercontent.com/Yo0l0/ssss/main/Pokebot.png" alt="Pokebot Icon" class="bot-image">
        <h1>🔥 Pokebot — Collect, Battle, Trade!</h1>
        <p>The ultimate Pokémon-inspired Discord bot. Build your card collection, battle friends, trade rare cards, and climb the leaderboards!</p>

        <a class="btn" href="https://discord.com/oauth2/authorize?client_id=1362516883785515199&permissions=534723951680&scope=bot+applications.commands">✨ Invite Pokebot</a>
        <a class="btn" href="https://discord.gg/g7AAsmJA">💬 Join Support Server</a>
        <a class="btn" href="https://top.gg/bot/1362516883785515199">✅ Vote Here!</a>
        <a class="btn" href="${req.session.user ? '/dashboard' : '/login'}">🗂️ View Your Collection</a>

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
    </div>

    <div class="footer">© 2024 Pokebot. All rights reserved.</div>

    <script>
        const profileBtn = document.getElementById('profileBtn');
        const dropdown = document.getElementById('dropdownMenu');

        profileBtn.addEventListener('click', () => {
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });

        window.addEventListener('click', (e) => {
            if (!profileBtn.contains(e.target)) {
                dropdown.style.display = 'none';
            }
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
    const inventoryUrl = 'https://raw.githubusercontent.com/Yo0l0/ssss/main/user_inventory.json';
    const page = parseInt(req.query.page) || 1;
    const perPage = 250;
    const selectedRarity = req.query.rarity || 'all';
    const searchTerm = req.query.search?.toLowerCase() || '';

    try {
        const response = await axios.get(inventoryUrl, { maxContentLength: Infinity, maxBodyLength: Infinity });
        const data = response.data;
        const collection = (data[userId]?.cards) || [];

        // Filter before pagination
        let filteredCollection = collection.filter(card => {
            const matchesRarity = selectedRarity === 'all' || card.rarity.toLowerCase() === selectedRarity;
            const matchesSearch = card.name.toLowerCase().includes(searchTerm) || card.code.toLowerCase().includes(searchTerm);
            return matchesRarity && matchesSearch;
        });

        const totalPages = Math.ceil(filteredCollection.length / perPage);
        const pageCards = filteredCollection.slice((page - 1) * perPage, page * perPage);

        let html = `
        <head>
            <link rel="icon" type="image/png" href="https://raw.githubusercontent.com/Yo0l0/ssss/refs/heads/main/GengarImages.png">
            <style>
                body { font-family: Arial, sans-serif; background: #0d001d; color: white; text-align: center; padding: 20px; }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; justify-items: center; margin-top: 30px; }
                .card { background: #2c003e; padding: 15px; border-radius: 10px; width: 220px; }
                img { width: 200px; height: 280px; object-fit: contain; margin-bottom: 10px; border-radius: 8px; }
                a { color: #00cc99; text-decoration: none; }
                .grade { color: #ffcc00; font-weight: bold; margin-top: 5px; }
                .pagination { margin-top: 30px; }
                .pagination a {
                    display: inline-block;
                    margin: 0 5px;
                    padding: 8px 15px;
                    background: #cc0066;
                    color: white;
                    border-radius: 5px;
                    text-decoration: none;
                }
                .pagination a.active { background: #b30059; font-weight: bold; }
                select, input[type="text"] { padding: 8px; font-size: 1em; margin: 10px; }
            </style>
        </head>
        <body>
            <h1>Welcome, ${req.session.user.username}</h1>
            <h2>Your Collection:</h2>

            <form method="get" action="/dashboard">
                <select name="rarity" onchange="this.form.submit()">
                    <option value="all" ${selectedRarity === 'all' ? 'selected' : ''}>All</option>
                    <option value="common" ${selectedRarity === 'common' ? 'selected' : ''}>Common</option>
                    <option value="uncommon" ${selectedRarity === 'uncommon' ? 'selected' : ''}>Uncommon</option>
                    <option value="rare" ${selectedRarity === 'rare' ? 'selected' : ''}>Rare</option>
                    <option value="promo" ${selectedRarity === 'promo' ? 'selected' : ''}>Promo</option>
                    <option value="holo" ${selectedRarity === 'holo' ? 'selected' : ''}>Holo</option>
                </select>

                <input type="text" name="search" placeholder="Search name or code..." value="${searchTerm}" oninput="this.form.submit()">
                <input type="hidden" name="page" value="1">
            </form>

            <div class="grid">
        `;

        if (pageCards.length === 0) {
            html += `<p>No cards in your collection.</p>`;
        } else {
            pageCards.forEach(card => {
                html += `
                <div class="card">
                    <img src="${card.image}" alt="${card.name}">
                    <strong>${card.name}</strong>
                    <p>${card.rarity}, ${card.set}</p>
                    <p><small>Code: ${card.code}</small></p>
                    ${card.grade ? `<div class="grade">Graded: ${card.grade}</div>` : ''}
                </div>`;
            });
        }

        html += `</div>`;

        // Pagination links
        if (totalPages > 1) {
            html += `<div class="pagination">`;
            for (let i = 1; i <= totalPages; i++) {
                html += `<a href="/dashboard?page=${i}&rarity=${selectedRarity}&search=${encodeURIComponent(searchTerm)}" class="${i === page ? 'active' : ''}">${i}</a>`;
            }
            html += `</div>`;
        }

        html += `<a href="/" style="position: fixed; top: 20px; left: 20px; background: #2c003e; color: #00cc99; text-decoration: none; padding: 10px 15px; border-radius: 8px; font-weight: bold; z-index: 999;">⬅️ Back to Homepage</a>`;

        html += `</body>`;

        res.send(html);

    } catch (err) {
        console.error('❌ Failed to fetch inventory:', err.message);
        res.send('<h1>Error loading your collection. Please try again later.</h1><p><a href="/">Back to Homepage</a></p>');
    }
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
