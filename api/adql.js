// api/adql.js
// Vercel serverless function: przyjmuje POST { adql: "..." } i przekazuje do TAP /sync
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.status(400).json({ error: 'no adql provided (use POST with JSON {adql})' });
      return;
    }
    const body = req.body;
    if (!body || !body.adql) {
      res.status(400).json({ error: 'no adql provided' });
      return;
    }

    const TAP_URL = process.env.TAP_URL || 'https://data.lsst.cloud/api/tap';
    const TAP_TOKEN = process.env.TAP_TOKEN || '';

    // Zbuduj body form-urlencoded do /sync
    const form = `REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=${encodeURIComponent(body.adql)}`;

    // Wykonaj request do TAP
    const tapResp = await fetch(`${TAP_URL.replace(/\/$/, '')}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(TAP_TOKEN ? { 'Authorization': `Bearer ${TAP_TOKEN}` } : {})
      },
      body: form,
    });

    const text = await tapResp.text();

    // Forward response: spróbuj ustawić content-type jako JSON jeśli to JSON, inaczej plain text
    const ct = tapResp.headers.get('content-type') || '';
    if (ct.includes('application/json') || (text && text.trim().startsWith('{'))) {
      try {
        const json = JSON.parse(text);
        res.status(tapResp.status).json(json);
      } catch(e) {
        // jeśli nie parsowalne, zwracamy jako text
        res.status(tapResp.status).type('text').send(text);
      }
    } else {
      res.status(tapResp.status).type('text').send(text);
    }
  } catch (err) {
    console.error('adql function error:', err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}
