import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// --- API Routes ---

// Store active campaigns and their SSE clients
const campaigns = new Map<string, {
  logs: any[],
  progress: number,
  target: number,
  clients: express.Response[]
}>();

function broadcastLog(campaignId: string, message: string, phase: string, progress?: number) {
  const campaign = campaigns.get(campaignId);
  if (!campaign) return;

  const logEntry = {
    id: Math.random().toString(36).substring(7),
    message,
    phase,
    timestamp: new Date().toISOString()
  };
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
  
  const TAVILY_KEY = process.env.TAVILY_API_KEY || process.env.TAVILY_KEY;
  const NVIDIA_KEY = process.env.NVIDIA_API_KEY || process.env.NVIDIA_KEY;

  if (!TAVILY_KEY || !NVIDIA_KEY) {
    const missing = [];
    if (!TAVILY_KEY) missing.push('Tavily API Key');
    if (!NVIDIA_KEY) missing.push('Nvidia API Key');
    return res.status(400).json({ error: `Missing API Keys: ${missing.join(', ')}. Please add them in your environment settings to run a real campaign.` });
  }

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
    broadcastLog(campaignId, `ERROR: ${err.message}`, 'error');
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
  broadcastLog(id, `Starting campaign for ${targetCount} ${leadType} leads in ${location}...`, 'search', 0);

  const TAVILY_KEY = process.env.TAVILY_API_KEY || process.env.TAVILY_KEY;
  const NVIDIA_KEY = process.env.NVIDIA_API_KEY || process.env.NVIDIA_KEY;
  const BREVO_KEY = process.env.BREVO_API_KEY || process.env.BREVO_KEY;

  if (!TAVILY_KEY || !NVIDIA_KEY || !BREVO_KEY) {
    const missing = [];
    if (!TAVILY_KEY) missing.push('TAVILY_API_KEY');
    if (!NVIDIA_KEY) missing.push('NVIDIA_API_KEY');
    if (!BREVO_KEY) missing.push('BREVO_API_KEY');
    broadcastLog(id, `ERROR: Missing API Keys: ${missing.join(', ')}. Please add them in settings.`, 'error');
    return;
  }

  let leadsFound: any[] = [];

  // Phase 1: Tavily Search
  broadcastLog(id, `Phase 1 (Tavily): Searching for high-quality leads...`, 'search');
  try {
    const tavilyRes = await axios.post('https://api.tavily.com/search', {
      api_key: TAVILY_KEY,
      query: `Find ${targetCount} ${leadType} businesses in ${location}. Include their website and contact email.`,
      search_depth: "advanced",
      include_raw_content: false,
      max_results: targetCount * 2 // Ask for more to filter
    });
    
    const results = tavilyRes.data.results || [];
    for (const res of results) {
      if (leadsFound.length >= targetCount) break;
      
      // Very basic email extraction from content
      const emailMatch = res.content.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi);
      const email = emailMatch ? emailMatch[0] : `contact@${res.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}`;
      
      leadsFound.push({
        name: res.title || new URL(res.url).hostname.replace('www.', ''),
        url: res.url,
        email: email.toLowerCase()
      });
    }
    
    if (leadsFound.length === 0) {
      broadcastLog(id, `Tavily Search returned 0 leads. Try a broader search.`, 'error');
      return;
    }
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || error.message;
    broadcastLog(id, `Tavily Search Failed: ${errorMsg}`, 'error');
    return;
  }

  broadcastLog(id, `Found ${leadsFound.length} leads. Starting analysis and outreach...`, 'search');
  
  // Update the target to the actual number of leads found
  const campaign = campaigns.get(id);
  if (campaign) {
    campaign.target = leadsFound.length;
  }

  for (let i = 0; i < leadsFound.length; i++) {
    const lead = leadsFound[i];
    let pitch = '';

    // Phase 2: Nvidia Falcon-3 Analysis
    broadcastLog(id, `[Lead ${i + 1}/${leadsFound.length}] Phase 2 (Falcon-3): Analyzing lead and writing pitch for ${lead.name}...`, 'analyze');
    try {
      const nvRes = await axios.post('https://integrate.api.nvidia.com/v1/chat/completions', {
        model: "tiiuae/falcon3-7b-instruct",
        messages: [{ role: "user", content: `Write a short, high-conversion cold email for ${lead.name} about their services. Keep it under 100 words. Do not include subject line.` }],
        max_tokens: 200
      }, {
        headers: { 'Authorization': `Bearer ${NVIDIA_KEY}`, 'Content-Type': 'application/json' }
      });
      pitch = nvRes.data.choices[0].message.content;
      broadcastLog(id, `[Lead ${i + 1}/${leadsFound.length}] Pitch generated successfully.`, 'analyze');
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.response?.data?.message || error.message;
      broadcastLog(id, `[Lead ${i + 1}/${leadsFound.length}] Nvidia API Failed: ${errorMsg}`, 'error');
      pitch = `Hi there,\n\nI noticed ${lead.name} is doing great work. Let's connect!`; // Fallback pitch if AI fails for one lead
    }

    // Phase 3: Brevo Email
    broadcastLog(id, `[Lead ${i + 1}/${leadsFound.length}] Phase 3 (Brevo): Preparing and sending email to ${lead.email}...`, 'email');
    let emailStatus = 'Email Sent';
    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: "Hebe Hack", email: "hebehack2@gmail.com" },
        to: [{ email: lead.email, name: lead.name }],
        subject: `Quick question about ${lead.name}`,
        htmlContent: `<p>${pitch.replace(/\n/g, '<br>')}</p>`
      }, {
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' }
      });
      broadcastLog(id, `[Lead ${i + 1}/${leadsFound.length}] Email sent to ${lead.email}.`, 'email');
    } catch (error: any) {
      broadcastLog(id, `[Lead ${i + 1}/${leadsFound.length}] Brevo API Failed: ${error.message}`, 'error');
      emailStatus = 'Failed';
    }

    // Save Lead to Supabase
    if (supabase && userId) {
      try {
        await supabase.from('leads').insert({
          user_id: userId,
          business_name: lead.name,
          email: lead.email,
          website: lead.url,
          pitch: pitch,
          status: emailStatus
        });
      } catch (e) {
        console.error('Failed to save lead to Supabase', e);
      }
    }

    broadcastLog(id, `[Lead ${i + 1}/${leadsFound.length}] Successfully processed.`, 'done', i + 1);
  }

  // Phase 4: Summary Email
  broadcastLog(id, `Phase 4: Sending summary email to you...`, 'done');
  try {
    let userEmail = "hebehack2@gmail.com";
    let userName = "Hebe Hack";
    
    if (supabase && userId) {
      const { data: userData } = await supabase.auth.admin.getUserById(userId);
      if (userData?.user?.email) {
        userEmail = userData.user.email;
        userName = userData.user.user_metadata?.full_name || userEmail.split('@')[0];
      }
    }

    if (BREVO_KEY) {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender: { name: "LeadGen Master", email: "noreply@leadgenmaster.com" },
        to: [{ email: userEmail, name: userName }],
        subject: `Campaign Finished! ${leadsFound.length} Leads contacted.`,
        htmlContent: `<p>Your campaign for ${leadType} in ${location} has finished successfully.</p><p>Total leads contacted: ${leadsFound.length}</p>`
      }, {
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' }
      });
    }
  } catch (error: any) {
    console.error('Failed to send summary email', error.message);
  }

  broadcastLog(id, `Campaign complete! Processed ${leadsFound.length} leads.`, 'done');
}

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
