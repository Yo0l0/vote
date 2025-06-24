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
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const userId = req.session.user.id;
    let collection = [];

    if (fs.existsSync('user_inventory.json')) {
        const data = JSON.parse(fs.readFileSync('user_inventory.json', 'utf8') || '{}');
        collection = data[userId] || [];
    }

    let html = `<h1>Welcome, ${req.session.user.username}</h1>`;
    html += `<h2>Your Collection:</h2>`;
    
    if (collection.length === 0) {
        html += `<p>No cards in your collection.</p>`;
    } else {
        html += `<ul>`;
        collection.forEach(card => {
            html += `<li>${card.name} (${card.rarity}, ${card.condition})</li>`;
        });
        html += `</ul>`;
    }

    html += `<p><a href="/">Back to Homepage</a></p>`;
    res.send(html);
});

// Vote rewards JSON
app.get('/vote_rewards.json', (req, res) => {
    const data = fs.readFileSync('vote_rewards.json', 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
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
