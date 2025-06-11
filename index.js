const express = require('express');
const { Webhook } = require('@top-gg/sdk');
const app = express();
const fs = require('fs');
app.use(express.json());
const webhook = new Webhook('252566'); // Must match Top.gg exactly

app.post('/dblwebhook', webhook.middleware(), (req, res) => {
  const userId = req.vote.user;
  console.log('✅ Vote received from', userId);

  let data = {};
  if (fs.existsSync('vote_rewards.json')) {
    data = JSON.parse(fs.readFileSync('vote_rewards.json', 'utf8') || '{}');
  }

  data[userId] = { pending: true, timestamp: Date.now() };
  fs.writeFileSync('vote_rewards.json', JSON.stringify(data, null, 2));

});

app.get('/', (req, res) => {
  res.send('✅ Webhook server running.');
});
app.get('/vote_rewards.json', (req, res) => {
  const data = fs.readFileSync('vote_rewards.json', 'utf8');
  res.setHeader('Content-Type', 'application/json');
  res.send(data);
});
app.post('/clear_vote', (req, res) => {
  const { userId } = req.body;
  const path = 'vote_rewards.json';

  if (fs.existsSync(path)) {
    const data = JSON.parse(fs.readFileSync(path));
    if (data[userId]) {
      delete data[userId];
      fs.writeFileSync(path, JSON.stringify(data, null, 2));
      return res.status(200).send('Vote cleared');
    }
  }
  res.status(404).send('User not found');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Listening on port ${PORT}`);
});
