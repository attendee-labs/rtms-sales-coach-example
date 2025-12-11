require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const db = require('./db');
const OpenAI = require('openai');

const app = express();

// Config via .env (with sensible defaults)
const PORT = process.env.PORT || 5005;
const ATTENDEE_API_KEY = process.env.ATTENDEE_API_KEY;
const ATTENDEE_BASE_URL = process.env.ATTENDEE_BASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ZOOM_WEBHOOK_SECRET_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Parse JSON bodies
app.use(express.json());

// OWASP Security Headers for Zoom App Compliance
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://*.zoom.us wss://*.zoom.us; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'self' https://*.zoom.us https://*.zoomgov.com;");
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Serve the minimal client
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------
// SSE subscribers management
// ---------------------------
/** @type {Set<import('http').ServerResponse>} */
const subscribers = new Set();

function broadcast(msg) {
  const payload = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of [...subscribers]) {
    try {
      res.write(payload);
    } catch {
      subscribers.delete(res);
      try { res.end(); } catch {}
    }
  }
}

// -------------------------------------------
// Endpoint: Server-Sent Events for the client
// -------------------------------------------
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (process.env.CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN);
  }
  res.write(': connected\n\n');

  subscribers.add(res);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    subscribers.delete(res);
    try { res.end(); } catch {}
  });
});

// -------------------------------------
// Zoom webhook processing
// -------------------------------------
app.post('/', async (req, res) => {
  try {
    console.log('Received Zoom webhook. Payload:', req.body);
    const payload = req.body?.payload;
    const event = req.body?.event;

    // Broadcast every Zoom webhook generically
    broadcast({ source: 'zoom', event, payload });

    if (!ATTENDEE_API_KEY) {
      console.error('Missing ATTENDEE_API_KEY');
      return res.status(500).send('Server not configured');
    }
    if (!payload || !event) {
      return res.status(400).send('Missing payload or event');
    }

    if (event === 'meeting.rtms_started') {
      const response = await axios.post(
        `${ATTENDEE_BASE_URL}/api/v1/app_sessions`,
        {
          zoom_rtms: payload,
        },
        { headers: { Authorization: `Token ${ATTENDEE_API_KEY}` }, timeout: 15000 }
      );
      console.log('Response from App Session Creation:', response.data);
      
      // Save app session to database
      const session = db.sessions.create({
        id: response.data.id,
        zoom_rtms: payload,
        attendee_response: response.data,
        status: 'started'
      });
      console.log('Saved App Session to database:', session.id);
    }

    // Handle Zoom Webhook validation
    if (event === 'endpoint.url_validation') {
      const plainToken = payload?.plainToken;
      if (plainToken) {
        // Create encrypted token using HMAC SHA256
        const encryptedToken = crypto
          .createHmac('sha256', ZOOM_WEBHOOK_SECRET_TOKEN)
          .update(plainToken)
          .digest('hex');

        console.log('Validation request received. Responding with encrypted token.');
        return res.status(200).json({ plainToken, encryptedToken });
      } else {
        console.log('No plainToken found in validation request');
        return res.status(400).send('Invalid validation request');
      }
    }
  } catch (err) {
    console.error('Error handling Zoom webhook:', err.response?.data || err.message);
  }
  res.sendStatus(200);
});

// ----------------------------------------------------
// Attendee webhook processing
// ----------------------------------------------------
app.post('/attendee-webhook', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).send('invalid JSON');
  }

  console.log('Received Attendee webhook. Payload:', body);

  const trigger = body.trigger;
  const data = body.data;
  const app_session_id = body.app_session_id;


  const sessions = db.sessions.getAll();
  const session = sessions.find(s => s.id === app_session_id);
  const meeting_id = session?.zoom_rtms?.meeting_uuid;

  // Broadcast all Attendee webhooks to the client
  broadcast({ source: 'attendee', trigger, data, app_session_id, meeting_id });

  return res.status(200).send('');
});

// -------------------------------------
// Database API Endpoints
// -------------------------------------
// Get all sessions
app.get('/api/sessions', (_req, res) => {
  const sessions = db.sessions.getAll();
  res.json(sessions);
});

// Get a specific session
app.get('/api/sessions/:id', (req, res) => {
  const session = db.sessions.getById(req.params.id);
  if (session) {
    res.json(session);
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// Get all transcripts
app.get('/api/transcripts', (_req, res) => {
  const transcripts = db.transcripts.getAll();
  res.json(transcripts);
});

// Get transcripts for a specific session
app.get('/api/sessions/:id/transcripts', (req, res) => {
  const transcripts = db.transcripts.getBySessionId(req.params.id);
  res.json(transcripts);
});


// Chat endpoint with OpenAI streaming
app.post('/api/chat', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const { message, chatHistory = [], sessionData = [], transcripts = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Prepare context from session and transcript data
    let contextText = '';
    
    if (sessionData.length > 0) {
      contextText += '\n\nSession Data:\n';
      sessionData.forEach(session => {
        contextText += `- Session ID: ${session.id}\n`;
        contextText += `  Status: ${session.status}\n`;
        contextText += `  Created: ${session.created_at}\n`;
      });
    }

    if (transcripts.length > 0) {
      contextText += '\n\nTranscript Data:\n';
      transcripts.forEach(transcript => {
        const data = transcript.data;
        if (data) {
          const speaker = data.speaker_name || 'Unknown';
          const text = data.transcription?.transcript || data.transcript || '';
          if (text) {
            contextText += `- ${speaker}: ${text}\n`;
          }
        }
      });
    }

    // Build messages for OpenAI
    const messages = [
      {
        role: 'system',
        content: `You are a helpful assistant analyzing meeting session data and transcripts. You have access to the following data:${contextText}\n\nUse this data to answer questions accurately. If the data doesn't contain information to answer a question, say so politely.`
      },
      ...chatHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      {
        role: 'user',
        content: message
      }
    ];

    console.log('Full prompt being sent to OpenAI:');
    console.log('Messages:', JSON.stringify(messages, null, 2));

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Create streaming completion
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 300,
    });

    // Stream the response
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: [DONE]\n\n`);
    res.end();

  } catch (err) {
    console.error('Chat API error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process chat request' });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`);
      res.end();
    }
  }
});

// -------------------------------------
// Root: serve the sales assistant client HTML
// -------------------------------------
app.get('/sales_coach', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sales_coach.html'));
});

// Get session by meeting ID
app.get('/api/sessions/by-meeting/:meetingId', (req, res) => {
  const meetingId = decodeURIComponent(req.params.meetingId);
  const sessions = db.sessions.getAll();
  console.log('Finding session by meeting ID:', meetingId);
  const session = sessions.find(s => s.zoom_rtms?.meeting_uuid === meetingId);

  console.log('Session found:', session || 'None');
  
  if (session) {
    res.json(session);
  } else {
    res.status(404).json({ error: 'Session not found for meeting ID' });
  }
});

app.listen(PORT, () => {
  console.log(`Webhook server running at http://localhost:${PORT}`);
  console.log('Open http://localhost:%s in a browser to view the stream client', PORT);
});
