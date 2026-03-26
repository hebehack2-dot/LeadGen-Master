import React, { useState, useEffect, useRef } from 'react';
import { Play, Settings, Terminal as TerminalIcon, Loader2, Activity, LogOut, CheckCircle2, Search, BrainCircuit, Mail, ExternalLink, Eye, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'motion/react';

interface LogEntry {
  id: string;
  message: string;
  phase: string;
  timestamp: Date;
}

interface Lead {
  id: string;
  business_name: string;
  website: string;
  email: string;
  status: string;
  pitch?: string;
  created_at: string;
}

export default function Dashboard({ user }: { user: any }) {
  const [leadType, setLeadType] = useState('Real Estate');
  const [location, setLocation] = useState('New York');
  const [targetCount, setTargetCount] = useState(10);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [target, setTarget] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedPitch, setSelectedPitch] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // --- Database Memory: Load Campaign Settings ---
  useEffect(() => {
    if (!user) return;
    const loadSettings = async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      
      if (data) {
        if (data.lead_type) setLeadType(data.lead_type);
        if (data.location) setLocation(data.location);
        if (data.target_count) setTargetCount(data.target_count);
      } else {
        const { data: campData } = await supabase
          .from('campaigns')
          .select('*')
          .eq('user_id', user.id)
          .single();
        if (campData) {
          if (campData.lead_type) setLeadType(campData.lead_type);
          if (campData.location) setLocation(campData.location);
          if (campData.target_count) setTargetCount(campData.target_count);
        }
      }
    };
    loadSettings();
  }, [user]);

  // --- Database Memory: Auto-Save Campaign Settings ---
  useEffect(() => {
    if (!user) return;
    const saveSettings = async () => {
      const { error } = await supabase.from('user_settings').upsert({
        user_id: user.id,
        lead_type: leadType,
        location: location,
        target_count: targetCount,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

      if (error && error.code === '42P01') {
        await supabase.from('campaigns').upsert({
          user_id: user.id,
          lead_type: leadType,
          location: location,
          target_count: targetCount,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      }
    };

    const timeout = setTimeout(saveSettings, 1000);
    return () => clearTimeout(timeout);
  }, [leadType, location, targetCount, user]);

  // --- Real-time Leads Fetching ---
  useEffect(() => {
    if (!user) return;

    const fetchLeads = async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (data) setLeads(data);
    };

    fetchLeads();

    const channel = supabase.channel('custom-all-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leads', filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setLeads(prev => [payload.new as Lead, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setLeads(prev => prev.map(l => l.id === payload.new.id ? payload.new as Lead : l));
          } else if (payload.eventType === 'DELETE') {
            setLeads(prev => prev.filter(l => l.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const startCampaign = async () => {
    if (!user) return alert('Please log in to launch a campaign.');
    
    setIsRunning(true);
    setLogs([]);
    setProgress(0);
    setTarget(targetCount);

    try {
      const res = await fetch('/api/campaign/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadType, location, targetCount, userId: user.id })
      });
      
      const data = await res.json();
      if (data.campaignId) {
        const es = new EventSource(`/api/campaign/stream?id=${data.campaignId}`);
        setEventSource(es);

        es.onmessage = (event) => {
          const parsed = JSON.parse(event.data);
          if (parsed.log) {
            setLogs(prev => [...prev, { ...parsed.log, timestamp: new Date(parsed.log.timestamp) }]);
          }
          if (parsed.progress !== undefined) setProgress(parsed.progress);
          if (parsed.target !== undefined) setTarget(parsed.target);

          if (parsed.log && parsed.log.message.includes('Campaign complete!')) {
            setIsRunning(false);
            es.close();
          }
        };

        es.onerror = () => {
          setIsRunning(false);
          es.close();
        };
      }
    } catch (e) {
      setIsRunning(false);
      alert('Failed to start campaign');
    }
  };

  const stopCampaign = () => {
    if (eventSource) {
      eventSource.close();
      setEventSource(null);
    }
    setIsRunning(false);
  };

  const getPhaseIcon = (phase: string) => {
    switch (phase) {
      case 'search': return <Search className="w-4 h-4 text-blue-400" />;
      case 'analyze': return <BrainCircuit className="w-4 h-4 text-purple-400" />;
      case 'email': return <Mail className="w-4 h-4 text-emerald-400" />;
      case 'done': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'error': return <X className="w-4 h-4 text-red-400" />;
      default: return <TerminalIcon className="w-4 h-4 text-neutral-400" />;
    }
  };

  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';

  return (
    <div className="min-h-screen bg-[#050505] text-neutral-200 font-sans selection:bg-emerald-500/30 relative overflow-hidden pb-12">
      {/* Premium Background Effects */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto p-6 space-y-8 relative z-10">
        
        {/* Header & Welcome System */}
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
              <Activity className="text-emerald-500" />
              LeadGen <span className="text-emerald-500">Master</span>
            </h1>
            <p className="text-neutral-400 mt-2 text-lg">
              Welcome back, <span className="text-white font-medium">{userName}</span>! Ready to hunt some leads today?
            </p>
          </motion.div>
          
          <motion.button 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            onClick={() => supabase.auth.signOut()} 
            className="flex items-center gap-2 text-xs text-neutral-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-md"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </motion.button>
        </header>

        {/* Bento Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Controls & Progress */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lg:col-span-4 space-y-6 flex flex-col"
          >
            {/* Campaign Settings */}
            <section className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl flex-grow">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-6">
                <Settings className="w-5 h-5 text-emerald-400" />
                Campaign Parameters
              </h2>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1.5">Lead Type</label>
                  <input 
                    type="text" 
                    value={leadType}
                    onChange={(e) => setLeadType(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-neutral-600"
                    placeholder="e.g., Real Estate Agents"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-400 mb-1.5">Location</label>
                  <input 
                    type="text" 
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-neutral-600"
                    placeholder="e.g., Austin, TX"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium text-neutral-400">Target Count</label>
                    <span className="text-sm font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">{targetCount} Leads</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="100" 
                    value={targetCount}
                    onChange={(e) => setTargetCount(parseInt(e.target.value))}
                    className="w-full accent-emerald-500 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                
                {isRunning ? (
                  <button 
                    onClick={stopCampaign}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/50 text-red-400 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 mt-6"
                  >
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Stop Campaign
                  </button>
                ) : (
                  <button 
                    onClick={startCampaign}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-black py-3 rounded-xl font-bold transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] flex items-center justify-center gap-2 mt-6"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    Launch Campaign
                  </button>
                )}
              </div>
            </section>

            {/* Progress Tracker */}
            <section className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl flex items-center gap-6">
              <div className="relative w-20 h-20 flex-shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle 
                    cx="50" cy="50" r="40" 
                    fill="transparent" 
                    stroke="currentColor" 
                    strokeWidth="6" 
                    className="text-white/5"
                  />
                  <circle 
                    cx="50" cy="50" r="40" 
                    fill="transparent" 
                    stroke="currentColor" 
                    strokeWidth="6" 
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - (target > 0 ? progress / target : 0))}`}
                    className="text-emerald-500 transition-all duration-500 ease-out drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-xl font-bold text-white">{progress}</span>
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider">/ {target || targetCount}</span>
                </div>
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-1">Progress</h3>
                <p className="text-neutral-400 text-sm leading-tight">
                  {isRunning 
                    ? `Processing leads...` 
                    : progress > 0 && progress === target 
                      ? 'Campaign completed.' 
                      : 'Ready to launch.'}
                </p>
              </div>
            </section>
          </motion.div>

          {/* Right Column: Terminal */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="lg:col-span-8 flex flex-col"
          >
            <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl flex-grow flex flex-col overflow-hidden min-h-[450px]">
              <div className="bg-white/5 border-b border-white/10 px-6 py-4 flex items-center gap-2">
                <TerminalIcon className="w-4 h-4 text-neutral-500" />
                <span className="text-xs font-mono text-neutral-400 uppercase tracking-wider">Execution Engine Logs</span>
                <div className="ml-auto flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50"></div>
                  <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                </div>
              </div>
              <div className="p-6 font-mono text-sm overflow-y-auto flex-grow space-y-4">
                {logs.length === 0 ? (
                  <div className="text-neutral-600 italic flex items-center justify-center h-full">
                    Awaiting campaign launch...
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {logs.map((log) => (
                      <motion.div 
                        key={log.id} 
                        initial={{ opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        className="flex items-start gap-3"
                      >
                        <div className="mt-0.5 flex-shrink-0">
                          {getPhaseIcon(log.phase)}
                        </div>
                        <div className="flex-grow">
                          <span className="text-neutral-500 text-xs mr-3">
                            [{log.timestamp.toLocaleTimeString()}]
                          </span>
                          <span className={
                            log.phase === 'error' ? 'text-red-400' : 
                            log.phase === 'done' ? 'text-emerald-400 font-medium' : 
                            log.phase === 'search' ? 'text-blue-300' : 
                            log.phase === 'analyze' ? 'text-purple-300' : 
                            log.phase === 'email' ? 'text-emerald-300' : 
                            'text-neutral-300'
                          }>
                            {log.message}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
                <div ref={logsEndRef} />
              </div>
            </section>
          </motion.div>
        </div>

        {/* Generated Leads Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <section className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden mt-6">
            <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                Generated Leads
              </h2>
              <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                {leads.length} Total
              </span>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-black/20 border-b border-white/10 text-xs uppercase tracking-wider text-neutral-400">
                    <th className="px-6 py-4 font-medium">Business Name</th>
                    <th className="px-6 py-4 font-medium">Website</th>
                    <th className="px-6 py-4 font-medium">Status</th>
                    <th className="px-6 py-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {leads.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-neutral-500 italic">
                        No leads generated yet. Launch a campaign to see results here.
                      </td>
                    </tr>
                  ) : (
                    leads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-white/5 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="font-medium text-white">{lead.business_name}</div>
                          <div className="text-xs text-neutral-500 mt-0.5">{lead.email}</div>
                        </td>
                        <td className="px-6 py-4">
                          {lead.website ? (
                            <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 flex items-center gap-1.5 text-sm transition-colors">
                              {new URL(lead.website).hostname.replace('www.', '')}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-neutral-500 text-sm">N/A</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                            lead.status === 'Email Sent' 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                              : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                          }`}>
                            {lead.status === 'Email Sent' && <CheckCircle2 className="w-3 h-3" />}
                            {lead.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => setSelectedPitch(lead.pitch || 'No pitch available.')}
                            disabled={!lead.pitch}
                            className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Eye className="w-4 h-4" />
                            View Pitch
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </motion.div>
      </div>

      {/* Pitch Modal */}
      <AnimatePresence>
        {selectedPitch && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedPitch(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Mail className="w-5 h-5 text-emerald-400" />
                  Generated Pitch
                </h3>
                <button 
                  onClick={() => setSelectedPitch(null)}
                  className="text-neutral-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6">
                <div className="bg-black/50 border border-white/5 rounded-xl p-4 text-sm text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed">
                  {selectedPitch}
                </div>
              </div>
              <div className="px-6 py-4 border-t border-white/10 bg-white/5 flex justify-end">
                <button 
                  onClick={() => setSelectedPitch(null)}
                  className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
