/**
 * OPTIONAL: hosted AI for Jarvis general chat.
 * Skip this file if the on-phone model is enough for you.
 *
 * What it does: your hub sends the chat text plus your Firebase login token to this
 * function. The function checks the token, then asks a Claude model and returns
 * the answer. The API key stays on the server (never in index.html).
 * Your hub data (expenses, health, etc.) is NOT sent, only the chat messages.
 *
 * Setup (Firebase CLI, in your project folder):
 *   1. firebase init functions            (JavaScript, Node 20)
 *      Note: Cloud Functions need the Blaze (pay-as-you-go) plan.
 *   2. cd functions && npm i firebase-admin firebase-functions
 *   3. Put this file's contents in functions/index.js
 *   4. firebase functions:secrets:set ANTHROPIC_API_KEY     (paste your key)
 *   5. firebase deploy --only functions
 *   6. In the hub: ⚙️ Settings → Jarvis → Cloud AI URL = the printed jarvisChat URL
 *
 * Costs come from your Anthropic usage; the limiter below caps each user.
 */
const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

const MODEL = 'claude-haiku-5-5';
const SYSTEM =
  "You are Jarvis, a concise assistant inside the user's personal apps hub. " +
  'Answer in 1 to 4 short sentences unless asked for more. You cannot see or change the ' +
  "user's data in this chat. Never invent numbers or facts; say you are not sure instead. " +
  'Amounts are in Indian rupees.';

const MAX_PER_HOUR = 40;
const hits = new Map(); // simple per-instance limiter: uid -> [timestamps]

exports.jarvisChat = onRequest(
  {secrets: [ANTHROPIC_API_KEY], cors: true, region: 'asia-south1', maxInstances: 2, timeoutSeconds: 60},
  async (req, res) => {
    try {
      if (req.method !== 'POST') return res.status(405).json({error: 'POST only'});

      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      let user;
      try {
        user = await admin.auth().verifyIdToken(token);
      } catch (e) {
        return res.status(401).json({error: 'Please sign in again'});
      }

      const now = Date.now();
      const recent = (hits.get(user.uid) || []).filter((t) => now - t < 3600000);
      if (recent.length >= MAX_PER_HOUR) return res.status(429).json({error: 'Hourly limit reached, try later'});
      recent.push(now);
      hits.set(user.uid, recent);

      const messages = (Array.isArray(req.body && req.body.messages) ? req.body.messages : [])
        .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
        .slice(-10)
        .map((m) => ({role: m.role, content: m.content.slice(0, 2000)}));
      if (!messages.length || messages[messages.length - 1].role !== 'user') {
        return res.status(400).json({error: 'Send at least one user message'});
      }

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY.value(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({model: MODEL, max_tokens: 600, system: SYSTEM, messages}),
      });
      const j = await r.json();
      if (!r.ok) return res.status(502).json({error: (j.error && j.error.message) || 'AI service error'});

      const reply = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return res.json({reply});
    } catch (e) {
      console.error(e);
      return res.status(500).json({error: 'Server error'});
    }
  }
);
