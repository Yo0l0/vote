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
    secret: 'adf32rfdfdswf', // Replace with your own random secret
    resave: false,
    saveUninitialized: false
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
    res.sendFile(path.join(__dirname, 'Public.html'));
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
        const params = new URLSearchParams();
        params.append('client_id', CLIENT_ID);
        params.append('client_secret', CLIENT_SECRET);
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', REDIRECT_URI);
        params.append('scope', 'identify');

        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params);
        const token = tokenRes.data.access_token;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
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
    const inventoryUrl = 'https://thepokebot.com/user_inventory.json';

    try {
        const response = await axios.get(inventoryUrl, { maxContentLength: Infinity, maxBodyLength: Infinity });
        const data = response.data;
        const collection = (data[userId]?.cards) || [];

        let html = `
        <head>
            <style>
                body { font-family: Arial, sans-serif; background: #0d001d; color: white; text-align: center; padding: 50px; }
                .card { background: #2c003e; margin: 15px auto; padding: 15px; border-radius: 8px; width: 300px; display: flex; flex-direction: column; align-items: center; }
                img { width: 150px; height: 150px; object-fit: contain; margin-bottom: 10px; border: 2px solid #00cc99; border-radius: 8px; }
                a { color: #00cc99; text-decoration: none; }
            </style>
        </head>
        <body>
            <h1>Welcome, ${req.session.user.username}</h1>
            <h2>Your Collection:</h2>
        `;

        if (collection.length === 0) {
            html += `<p>No cards in your collection.</p>`;
        } else {
            collection.forEach(card => {
                html += `
                    <div class="card">
                        <img src="${card.image}" alt="${card.name}">
                        <strong>${card.name}</strong>
                        <p>${card.rarity}, ${card.set}</p>
                    </div>
                `;
            });
        }

        html += `<p><a href="/">Back to Homepage</a></p></body>`;
        res.send(html);

    } catch (err) {
        console.error('❌ Failed to fetch inventory:', err.message);
        return res.send('<h1>Error loading your collection. Please try again later.</h1><p><a href="/">Back to Homepage</a></p>');
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
