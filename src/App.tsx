import React, { useState, useEffect, useRef } from 'react';
import { Play, Settings, Terminal as TerminalIcon, CheckCircle2, XCircle, Loader2, Activity, Phone, Copy, LogOut } from 'lucide-react';
import { supabase } from './lib/supabase';
import Auth from './components/Auth';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [waStatus, setWaStatus] = useState<'idle' | 'generating' | 'code_ready' | 'connected' | 'failed'>('idle');
  const [waPairingCode, setWaPairingCode] = useState<string | null>(null);
  const [waUser, setWaUser] = useState<any>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [copied, setCopied] = useState(false);

  const [leadType, setLeadType] = useState('Real Estate');
  const [location, setLocation] = useState('New York');
  const [targetCount, setTargetCount] = useState(10);

  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [target, setTarget] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // --- Auth & Session Management ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Database Memory: Load Campaign Settings ---
  useEffect(() => {
    if (!user) return;
    const loadCampaign = async () => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('user_id', user.id)
        .single();
      
      if (data) {
        if (data.lead_type) setLeadType(data.lead_type);
        if (data.location) setLocation(data.location);
        if (data.target_count) setTargetCount(data.target_count);
      }
    };
    loadCampaign();
  }, [user]);

  // --- Database Memory: Auto-Save Campaign Settings ---
  useEffect(() => {
    if (!user) return;
    const saveCampaign = async () => {
      await supabase.from('campaigns').upsert({
        user_id: user.id,
        lead_type: leadType,
        location: location,
        target_count: targetCount,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    };

    const timeout = setTimeout(saveCampaign, 1000); // Debounce auto-save
    return () => clearTimeout(timeout);
  }, [leadType, location, targetCount, user]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    if (!campaignId) return;

    const eventSource = new EventSource(`/api/campaign/stream?id=${campaignId}`);
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLogs(prev => [...prev, data.log]);
      setProgress(data.progress);
      setTarget(data.target);
      
      if (data.progress === data.target && data.target > 0) {
        setIsRunning(false);
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsRunning(false);
    };

    return () => eventSource.close();
  }, [campaignId]);

  useEffect(() => {
    const eventSource = new EventSource('/api/whatsapp/stream');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setWaStatus(data.status);
        setWaPairingCode(data.code);
        setWaUser(data.user);
      } catch (e) {}
    };
    return () => eventSource.close();
  }, []);

  const generateCode = async () => {
    if (!phoneNumber) return alert('Please enter a phone number');
    setWaStatus('generating');
    try {
      await fetch('/api/whatsapp/start', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber })
      });
    } catch (e) {
      setWaStatus('failed');
    }
  };

  const refreshCode = async () => {
    if (!phoneNumber) return alert('Please enter a phone number');
    setWaStatus('generating');
    try {
      await fetch('/api/whatsapp/refresh', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber })
      });
    } catch (e) {
      setWaStatus('failed');
    }
  };

  const logoutWa = async () => {
    await fetch('/api/whatsapp/logout', { method: 'POST' });
    setWaStatus('idle');
    setWaPairingCode(null);
    setWaUser(null);
  };

  const copyCode = () => {
    if (waPairingCode) {
      navigator.clipboard.writeText(waPairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startCampaign = async () => {
    if (!user) return alert('Please log in to launch a campaign.');
    if (waStatus !== 'connected') {
      alert('Please connect WhatsApp first to receive notifications.');
      return;
    }
    setIsRunning(true);
    setLogs([]);
    setProgress(0);
    setTarget(targetCount);

    try {
      const res = await fetch('/api/campaign/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadType,
          location,
          targetCount,
          userId: user.id
        })
      });
      const data = await res.json();
      setCampaignId(data.campaignId);
    } catch (e) {
      setIsRunning(false);
      alert('Failed to start campaign');
    }
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-emerald-500/30">
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        
        <header className="flex items-center justify-between border-b border-neutral-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              <Activity className="text-emerald-500" />
              LeadGen & Demo Auto
            </h1>
            <p className="text-neutral-400 mt-1">AI-powered lead discovery, outreach, and demo deployment.</p>
          </div>
          <button 
            onClick={() => supabase.auth.signOut()} 
            className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors bg-neutral-900 hover:bg-neutral-800 px-4 py-2 rounded-lg border border-neutral-800"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Controls */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* WhatsApp Connection */}
            <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                <Phone className="w-5 h-5 text-emerald-400" />
                WhatsApp Connection
              </h2>
              <div className="space-y-4">
                {waStatus === 'idle' || waStatus === 'failed' ? (
                  <div className="py-2">
                    <label className="block text-sm font-medium text-neutral-400 mb-1">Phone Number</label>
                    <input 
                      type="text" 
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors mb-4"
                      placeholder="e.g., +1234567890"
                    />
                    <button 
                      onClick={generateCode}
                      disabled={!phoneNumber}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                      Generate Pairing Code
                    </button>
                    {waStatus === 'failed' && <p className="text-red-400 mt-2 text-sm text-center">Failed to generate code. Please try again.</p>}
                  </div>
                ) : waStatus === 'generating' ? (
                  <div className="flex flex-col items-center justify-center py-8 space-y-3">
                    <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                    <p className="text-neutral-400 text-sm">Loading...</p>
                  </div>
                ) : waStatus === 'code_ready' && waPairingCode ? (
                  <div className="flex flex-col items-center justify-center py-4 space-y-4">
                    <div className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl shadow-lg w-full text-center relative group">
                      <p className="text-3xl font-mono font-bold text-emerald-400 tracking-widest">{waPairingCode}</p>
                      <button 
                        onClick={copyCode}
                        className="absolute top-2 right-2 p-2 text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg transition-colors"
                        title="Copy Code"
                      >
                        {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="text-center space-y-2 w-full">
                      <p className="text-neutral-300 text-sm font-medium">Scanning instructions:</p>
                      <ol className="text-neutral-400 text-xs text-left list-decimal list-inside space-y-1 bg-neutral-950 p-3 rounded-lg border border-neutral-800">
                        <li>Open WhatsApp on your phone</li>
                        <li>Tap Menu (⋮) or Settings (⚙️)</li>
                        <li>Select <strong>Linked Devices</strong></li>
                        <li>Tap <strong>Link a Device</strong></li>
                        <li>Select <strong>Link with phone number instead</strong></li>
                        <li>Enter the 8-character code above</li>
                      </ol>
                    </div>
                    <button 
                      onClick={refreshCode}
                      className="text-emerald-400 text-xs hover:text-emerald-300 mt-2 underline"
                    >
                      Refresh Code
                    </button>
                  </div>
                ) : waStatus === 'connected' ? (
                  <div className="flex flex-col items-center justify-center py-6 space-y-3">
                    <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-2">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                    </div>
                    <p className="text-white font-medium">Connected Successfully ✅</p>
                    <p className="text-neutral-400 text-sm">{waUser?.id?.split(':')[0] || 'Linked Device'}</p>
                    <button 
                      onClick={logoutWa}
                      className="text-red-400 text-sm hover:text-red-300 mt-2 underline"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : null}
              </div>
            </section>

            {/* Campaign Settings */}
            <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                <Settings className="w-5 h-5 text-neutral-400" />
                Campaign Parameters
              </h2>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Lead Type</label>
                  <input 
                    type="text" 
                    value={leadType}
                    onChange={(e) => setLeadType(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="e.g., Real Estate Agents"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1">Location</label>
                  <input 
                    type="text" 
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="e.g., Austin, TX"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <label className="text-sm font-medium text-neutral-400">Target Count</label>
                    <span className="text-sm font-bold text-emerald-400">{targetCount} Leads</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="500" 
                    value={targetCount}
                    onChange={(e) => setTargetCount(parseInt(e.target.value))}
                    className="w-full accent-emerald-500 h-2 bg-neutral-800 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                
                <button 
                  onClick={startCampaign}
                  disabled={isRunning || waStatus !== 'connected'}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-lg font-semibold transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Campaign Running...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-current" />
                      Launch Campaign
                    </>
                  )}
                </button>
              </div>
            </section>

          </div>

          {/* Right Column: Terminal & Progress */}
          <div className="lg:col-span-7 space-y-6 flex flex-col">
            
            {/* Progress Tracker */}
            <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl flex items-center gap-6">
              <div className="relative w-24 h-24 flex-shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle 
                    cx="50" cy="50" r="40" 
                    fill="transparent" 
                    stroke="currentColor" 
                    strokeWidth="8" 
                    className="text-neutral-800"
                  />
                  <circle 
                    cx="50" cy="50" r="40" 
                    fill="transparent" 
                    stroke="currentColor" 
                    strokeWidth="8" 
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - (target > 0 ? progress / target : 0))}`}
                    className="text-emerald-500 transition-all duration-500 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-xl font-bold text-white">{progress}</span>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider">/ {target || targetCount}</span>
                </div>
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-1">Campaign Progress</h3>
                <p className="text-neutral-400 text-sm">
                  {isRunning 
                    ? `Actively processing leads in ${location}...` 
                    : progress > 0 && progress === target 
                      ? 'Campaign completed successfully.' 
                      : 'Ready to start.'}
                </p>
              </div>
            </section>

            {/* Live Terminal */}
            <section className="bg-[#0a0a0a] border border-neutral-800 rounded-xl shadow-xl flex-grow flex flex-col overflow-hidden min-h-[400px]">
              <div className="bg-neutral-900 border-b border-neutral-800 px-4 py-3 flex items-center gap-2">
                <TerminalIcon className="w-4 h-4 text-neutral-500" />
                <span className="text-xs font-mono text-neutral-400 uppercase tracking-wider">Live Execution Logs</span>
                <div className="ml-auto flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50"></div>
                </div>
              </div>
              <div className="p-4 font-mono text-sm overflow-y-auto flex-grow space-y-1.5">
                {logs.length === 0 ? (
                  <div className="text-neutral-600 italic">Waiting for campaign to start...</div>
                ) : (
                  logs.map((log, i) => {
                    // Simple syntax highlighting for logs
                    const isError = log.includes('ERROR') || log.includes('WARNING');
                    const isSuccess = log.includes('Successfully') || log.includes('complete');
                    const isAction = log.includes('Searching') || log.includes('Analyzing') || log.includes('Triggering') || log.includes('Sending');
                    
                    return (
                      <div key={i} className={
                        isError ? 'text-red-400' : 
                        isSuccess ? 'text-emerald-400' : 
                        isAction ? 'text-blue-300' : 
                        'text-neutral-300'
                      }>
                        {log}
                      </div>
                    );
                  })
                )}
                <div ref={logsEndRef} />
              </div>
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}
