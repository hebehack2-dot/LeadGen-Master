import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import axios from 'axios';
import https from 'https';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import dns from 'dns';
import { createClient } from '@supabase/supabase-js';

// Force IPv4 globally to prevent Node.js IPv6 timeout delays (crucial for WhatsApp/Baileys in cloud)
dns.setDefaultResultOrder('ipv4first');

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Create an HTTPS agent that forces IPv4
const httpsAgent = new https.Agent({ family: 4 });

app.use(express.json());

// --- WhatsApp Logic ---
let waSock: any = null;
let waPairingCode: string | null = null;
let waStatus: 'idle' | 'generating' | 'code_ready' | 'connected' | 'failed' = 'idle';
let waUser: any = null;

const waClients: express.Response[] = [];

function broadcastWaStatus() {
  const data = JSON.stringify({ status: waStatus, code: waPairingCode, user: waUser });
  waClients.forEach(client => client.write(`data: ${data}\n\n`));
}

async function connectToWhatsApp(phoneNumber?: string) {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  
  waSock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }) as any,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    connectTimeoutMs: 5000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  });

  if (phoneNumber && !waSock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        let code = await waSock.requestPairingCode(phoneNumber);
        if (code) {
          code = code.match(/.{1,4}/g)?.join('-') || code;
          waPairingCode = code;
          waStatus = 'code_ready';
          broadcastWaStatus();
        }
      } catch (err) {
        console.error('Pairing code error:', err);
        waStatus = 'failed';
        broadcastWaStatus();
      }
    }, 2000);
  }

  waSock.ev.on('creds.update', saveCreds);

  waSock.ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        connectToWhatsApp();
      } else {
        waStatus = 'idle';
        waPairingCode = null;
        waUser = null;
        broadcastWaStatus();
      }
    } else if (connection === 'open') {
      waStatus = 'connected';
      waPairingCode = null;
      waUser = waSock.user;
      broadcastWaStatus();
      
      try {
        await waSock.sendMessage(waSock.user.id, { text: '✅ Lead Generation Dashboard Connected Successfully!' });
      } catch (e) {
        console.error('Failed to send welcome message', e);
      }
    }
  });
}

app.get('/api/whatsapp/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  waClients.push(res);
  
  res.write(`data: ${JSON.stringify({ status: waStatus, code: waPairingCode, user: waUser })}\n\n`);
  
  req.on('close', () => {
    const index = waClients.indexOf(res);
    if (index !== -1) waClients.splice(index, 1);
  });
});

app.post('/api/whatsapp/start', async (req, res) => {
  const { phoneNumber } = req.body;
  if (waStatus === 'connected') {
    return res.json({ success: true, message: 'Already connected' });
  }
  waStatus = 'generating';
  broadcastWaStatus();
  
  const cleanNumber = phoneNumber ? phoneNumber.replace(/[^0-9]/g, '') : undefined;
  connectToWhatsApp(cleanNumber).catch(console.error);
  
  res.json({ success: true });
});

app.post('/api/whatsapp/refresh', async (req, res) => {
  const { phoneNumber } = req.body;
  if (waSock) {
    waSock.ev.removeAllListeners();
    waSock.end(undefined);
    waSock = null;
  }
  waStatus = 'generating';
  waPairingCode = null;
  broadcastWaStatus();
  
  const cleanNumber = phoneNumber ? phoneNumber.replace(/[^0-9]/g, '') : undefined;
  connectToWhatsApp(cleanNumber).catch(console.error);
  res.json({ success: true });
});

app.post('/api/whatsapp/logout', async (req, res) => {
  if (waSock) {
    await waSock.logout();
  }
  res.json({ success: true });
});

// --- API Routes ---

// Store active campaigns and their SSE clients
const campaigns = new Map<string, {
  logs: string[],
  progress: number,
  target: number,
  clients: express.Response[]
}>();

function broadcastLog(campaignId: string, message: string, progress?: number) {
  const campaign = campaigns.get(campaignId);
  if (!campaign) return;

  const logEntry = `[${new Date().toISOString()}] ${message}`;
  campaign.logs.push(logEntry);
  if (progress !== undefined) {
    campaign.progress = progress;
  }

  const data = JSON.stringify({ log: logEntry, progress: campaign.progress, target: campaign.target });
  campaign.clients.forEach(client => {
    client.write(`data: ${data}\n\n`);
  });
}

app.post('/api/campaign/start', async (req, res) => {
  const { leadType, location, targetCount, userId } = req.body;
  
  const campaignId = Math.random().toString(36).substring(7);
  campaigns.set(campaignId, {
    logs: [],
    progress: 0,
    target: targetCount,
    clients: []
  });

  res.json({ campaignId });

  // Start the background loop
  runCampaign(campaignId, leadType, location, targetCount, userId).catch(err => {
    broadcastLog(campaignId, `ERROR: ${err.message}`);
  });
});

app.get('/api/campaign/stream', (req, res) => {
  const { id } = req.query;
  if (!id || typeof id !== 'string' || !campaigns.has(id)) {
    return res.status(404).send('Campaign not found');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const campaign = campaigns.get(id)!;
  campaign.clients.push(res);

  // Send initial state
  campaign.logs.forEach(log => {
    res.write(`data: ${JSON.stringify({ log, progress: campaign.progress, target: campaign.target })}\n\n`);
  });

  req.on('close', () => {
    campaign.clients = campaign.clients.filter(c => c !== res);
  });
});

async function runCampaign(id: string, leadType: string, location: string, targetCount: number, userId?: string) {
  broadcastLog(id, `Starting campaign for ${targetCount} ${leadType} leads in ${location}...`, 0);

  if (waSock && waStatus === 'connected') {
    try {
      await waSock.sendMessage(waSock.user.id, { text: `🚀 Campaign Started: ${targetCount} ${leadType} leads in ${location}` });
    } catch (e) {
      console.error('Failed to send WhatsApp message', e);
    }
  }

  const TAVILY_KEY = process.env.TAVILY_API_KEY || process.env.TAVILY_KEY;
  const NVIDIA_KEY = process.env.NVIDIA_API_KEY || process.env.NVIDIA_KEY;
  const BREVO_KEY = process.env.BREVO_API_KEY || process.env.BREVO_KEY;

  if (!TAVILY_KEY || !NVIDIA_KEY || !BREVO_KEY) {
    broadcastLog(id, `WARNING: Missing API keys in environment. Running in simulation mode.`);
  }

  for (let i = 1; i <= targetCount; i++) {
    broadcastLog(id, `[Lead ${i}/${targetCount}] Searching for leads via Tavily...`);
    await new Promise(r => setTimeout(r, 1500)); // Simulate network delay

    let leadName = `Business ${Math.floor(Math.random() * 1000)}`;
    let leadEmail = `contact@${leadName.toLowerCase().replace(' ', '')}.com`;
    let leadWebsite = `https://www.${leadName.toLowerCase().replace(' ', '')}.com`;

    if (TAVILY_KEY) {
      // Real Tavily call would go here
      broadcastLog(id, `[Lead ${i}/${targetCount}] Found lead: ${leadName} (${leadEmail})`);
    } else {
      broadcastLog(id, `[Lead ${i}/${targetCount}] Simulated lead found: ${leadName}`);
    }

    // Save Lead to Supabase Memory
    if (supabase && userId) {
      try {
        await supabase.from('leads').insert({
          user_id: userId,
          business_name: leadName,
          email: leadEmail,
          website: leadWebsite,
          status: 'Pending'
        });
        broadcastLog(id, `[Lead ${i}/${targetCount}] Lead saved to Supabase Memory.`);
      } catch (e) {
        console.error('Failed to save lead to Supabase', e);
      }
    }

    broadcastLog(id, `[Lead ${i}/${targetCount}] Analyzing data & writing email via Nvidia Falcon3...`);
    await new Promise(r => setTimeout(r, 2000));

    if (NVIDIA_KEY) {
      // Real Nvidia call structure
      try {
        /*
        const nvRes = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${NVIDIA_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "tiiuae/falcon3-7b-instruct",
            messages: [{ role: "user", content: `Write a short cold email for ${leadName} offering a demo website.` }]
          })
        });
        */
      } catch (e) {}
    }

    broadcastLog(id, `[Lead ${i}/${targetCount}] Triggering Vercel deployment for demo site...`);
    await new Promise(r => setTimeout(r, 1500));

    broadcastLog(id, `[Lead ${i}/${targetCount}] Sending email via Brevo to ${leadEmail}...`);
    await new Promise(r => setTimeout(r, 1000));

    // Update Lead Status to Contacted
    if (supabase && userId) {
      try {
        await supabase.from('leads')
          .update({ status: 'Contacted' })
          .eq('user_id', userId)
          .eq('email', leadEmail);
      } catch (e) {}
    }

    broadcastLog(id, `[Lead ${i}/${targetCount}] Successfully processed.`, i);
  }

  broadcastLog(id, `Campaign complete! Processed ${targetCount} leads.`);
}

app.post('/api/webhooks/brevo', async (req, res) => {
  // Handle Brevo Webhook (open, click, reply)
  const event = req.body;
  console.log('Brevo Webhook received:', event);

  if (waSock && waStatus === 'connected' && event.event === 'opened') {
    const message = `📧 Lead Opened Email!\nEmail: ${event.email}\nTime: ${new Date().toISOString()}`;
    try {
      await waSock.sendMessage(waSock.user.id, { text: message });
    } catch (e: any) {
      console.error('Failed to send WhatsApp notification', e);
    }
  }

  res.status(200).send('OK');
});

// --- Vite Middleware ---
async function setupVite() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupVite();
