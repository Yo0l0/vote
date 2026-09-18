// tools/dev.js — run the site locally in DEMO mode (synthetic inventory, a stubbed login).
const path = require('path');
process.chdir(path.join(__dirname, '..'));
process.env.DEMO = process.env.DEMO || '1';
process.env.DEV_USER = process.env.DEV_USER || '000000000000000001';
process.env.PORT = process.env.PORT || '3000';
require('../index.js');
