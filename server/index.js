// server/index.js
// Minimalny Express proxy: POST /api/adql {adql:"..."} -> TAP /sync (REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=...)
const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const app = express();
app.use(bodyParser.json({ limit: '5mb' }));

const TAP_URL = process.env.TAP_URL || 'https://data.lsst.cloud/api/tap'; // zmień jeśli inny endpoint
const TAP_TOKEN = process.env.TAP_TOKEN || ''; // jeśli wymagany, ustaw jako zmienna środowiskowa

app.post('/api/adql', async (req, res) => {
  try {
    const { adql } = req.body;
    if (!adql) return res.status(400).json({ error: 'no adql provided' });
    const body = `REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=${encodeURIComponent(adql)}`;
    const resp = await fetch(`${TAP_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(TAP_TOKEN ? { Authorization: `Bearer ${TAP_TOKEN}` } : {})
      },
      body
    });
    const text = await resp.text();
    // forward exact response body (JSON expected)
    res.type('application/json').send(text);
  } catch (err) {
    console.error('proxy error', err);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Proxy listening on ${port}, TAP_URL=${TAP_URL}`));
