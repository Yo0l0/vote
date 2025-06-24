const express = require('express');
const { Webhook } = require('@top-gg/sdk');
const fs = require('fs');
const path = require('path');

const app = express();
const webhook = new Webhook('252566'); // Must match Top.gg exactly

app.use(express.json());


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

// Serve Terms of Service
app.get('/terms-of-service', (req, res) => {
  res.sendFile(path.join(__dirname, 'terms-of-service.html'));
});

// Serve Privacy Policy
app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy-policy.html'));
});

// JSON file for vote rewards
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

