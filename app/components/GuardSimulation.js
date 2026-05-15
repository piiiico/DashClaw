'use client';

import { useState } from 'react';
import {
  Bot, Shield, Database, ArrowRight, Play,
  CheckCircle2, XCircle, Clock, Activity,
  Terminal, ShieldCheck, ShieldAlert, Cpu
} from 'lucide-react';

export default function GuardSimulation() {
  const [step, setStep] = useState('idle'); // idle, requesting, evaluating, approval, finished
  const [decision, setDecision] = useState(null); // allowed, blocked
  const [isPending, setIsPending] = useState(false);

  // Drive the marketing-page simulation. useActionState was used here but it
  // is a React 19 API and the project is on React 18; the import was missing
  // and the component crashed with a ReferenceError on every visit.
  async function startSimulation() {
    if (isPending) return;
    setIsPending(true);
    try {
      setStep('requesting');
      await new Promise((r) => setTimeout(r, 800));
      setStep('evaluating');
      await new Promise((r) => setTimeout(r, 1200));
      setStep('approval');
    } finally {
      setIsPending(false);
    }
  }

  const handleDecision = (type) => {
    setDecision(type);
    setStep('finished');
  };

  const reset = () => {
    setStep('idle');
    setDecision(null);
  };

  return (
    <div className="w-full max-w-4xl mx-auto mt-16 group/sim">
      <div className="relative p-px rounded-3xl bg-gradient-to-b from-white/10 to-transparent shadow-2xl overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-brand/10 blur-[100px] rounded-full group-hover/sim:bg-brand/20 transition-all duration-1000"></div>
        
        <div className="relative bg-[#080808] rounded-[23px] overflow-hidden border border-white/5">
          {/* Header Bar */}
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-tertiary border border-white/5"></div>
                <div className="w-3 h-3 rounded-full bg-tertiary border border-white/5"></div>
                <div className="w-3 h-3 rounded-full bg-tertiary border border-white/5"></div>
              </div>
              <div className="h-4 w-px bg-tertiary mx-1"></div>
              <div className="flex items-center gap-2">
                <Activity size={12} className="text-brand animate-pulse" />
                <span className="text-[10px] font-mono text-tertiary uppercase tracking-widest font-bold">Runtime Interception</span>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {step === 'finished' && (
                <button 
                  onClick={reset}
                  className="text-[10px] font-bold text-tertiary hover:text-brand uppercase tracking-tight transition-colors"
                >
                  Restart Demo
                </button>
              )}
              <div className="px-2 py-0.5 rounded bg-secondary border border-zinc-800 text-[9px] font-mono text-tertiary">
                v2.1.0-stable
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row min-h-[440px]">
            {/* Left Column: The Agent Environment */}
            <div className="flex-1 p-8 flex flex-col bg-gradient-to-br from-transparent to-white/[0.01] text-left">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 rounded-xl bg-secondary border border-white/5 flex items-center justify-center shadow-inner">
                  <Cpu size={16} className="text-secondary" />
                </div>
                <div>
                  <h4 className="text-[11px] font-bold text-secondary uppercase tracking-tight">Autonomous Actor</h4>
                  <p className="text-[9px] text-tertiary font-mono">agent-moltfire-01</p>
                </div>
              </div>

              <div className="flex-1 font-mono text-[13px] leading-relaxed text-left">
                <div className="flex items-center gap-3 text-tertiary mb-4">
                  <span className="text-brand/50 font-sans">#</span>
                  <span className="italic">Attempting cross-region deployment...</span>
                </div>
                
                <div className="flex items-start gap-3 text-secondary mb-6">
                  <span className="text-disabled mt-1.5 select-none opacity-50 font-mono text-xs">&gt;</span>
                  <div className="bg-black/50 p-4 rounded-lg border border-white/5 w-full font-mono text-[12px] leading-relaxed shadow-inner text-left">
                    <div>
                      <span className="text-purple-400">const</span>
                      <span className="text-secondary"> decision = </span>
                      <span className="text-purple-400">await</span>
                      <span className="text-secondary"> claw.</span>
                      <span className="text-yellow-200">guard</span>
                      <span className="text-secondary">({'{'}</span>
                    </div>
                    <div className="pl-6">
                      <span className="text-secondary">action: </span>
                      <span className="text-success">&quot;db_migration&quot;</span>
                      <span className="text-secondary">,</span>
                    </div>
                    <div className="pl-6">
                      <span className="text-secondary">risk: </span>
                      <span className="text-cyan-400">92</span>
                    </div>
                    <div><span className="text-secondary">{'}'})</span></div>
                  </div>
                </div>

                {step !== 'idle' && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-left-4 duration-700">
                    <div className="flex items-center gap-3 text-[11px]">
                      {step === 'requesting' ? (
                        <div className="w-1.5 h-1.5 rounded-full bg-brand animate-ping"></div>
                      ) : (
                        <CheckCircle2 size={12} className="text-success" />
                      )}
                      <span className={step === 'requesting' ? "text-secondary" : "text-tertiary"}>Connecting to DashClaw Runtime...</span>
                    </div>
                    
                    {(step === 'evaluating' || step === 'approval' || step === 'finished') && (
                      <div className="flex items-center gap-3 text-[11px]">
                        {step === 'evaluating' ? (
                          <div className="w-1.5 h-1.5 rounded-full bg-brand animate-ping"></div>
                        ) : (
                          <CheckCircle2 size={12} className="text-success" />
                        )}
                        <span className={step === 'evaluating' ? "text-secondary" : "text-tertiary"}>Evaluating semantic policies...</span>
                      </div>
                    )}

                    {step === 'finished' && (
                      <div className={`mt-4 p-4 rounded-xl border ${decision === 'allowed' ? 'bg-status-success/10 border-green-500/30 text-success' : 'bg-error-subtle border-error/30 text-error'} animate-in zoom-in-95 duration-300 shadow-lg`}>
                        <div className="flex items-center gap-3 mb-2">
                          {decision === 'allowed' ? <ShieldCheck size={20} className="text-success" /> : <ShieldAlert size={20} className="text-error" />}
                          <span className={`font-black text-lg tracking-tighter uppercase ${decision === 'allowed' ? 'text-success' : 'text-error'}`}>
                            {decision === 'allowed' ? 'APPROVED' : 'BLOCKED'}
                          </span>
                        </div>
                        <p className="text-[11px] font-medium pl-8 leading-relaxed text-secondary">
                          {decision === 'allowed' 
                            ? 'Action permitted under governance. Decision evidence recorded and signed.' 
                            : 'Action blocked by policy. The agent was prevented from reaching production.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {step === 'idle' && (
                <button 
                  onClick={() => startSimulation()}
                  className="group/btn relative mt-4 overflow-hidden bg-brand text-white py-3 px-6 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg shadow-brand/20 transition-all hover:bg-brand-hover active:scale-95"
                >
                  <div className="relative z-10 flex items-center justify-center gap-2">
                    <Play size={14} fill="currentColor" /> Trigger Action
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover/btn:animate-shimmer"></div>
                </button>
              )}
            </div>

            {/* Right Column: DashClaw Guard Logic */}
            <div className="md:w-[380px] p-8 bg-secondary/30 border-l border-white/5 relative flex flex-col shadow-2xl">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center shadow-[0_0_15px_rgba(249,115,22,0.1)]">
                    <Shield size={16} className="text-brand" />
                  </div>
                  <h4 className="text-[11px] font-bold text-brand uppercase tracking-tight">Policy Firewall</h4>
                </div>
                <div className="flex gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${step !== 'idle' ? 'bg-status-success animate-pulse' : 'bg-elevated'}`}></div>
                </div>
              </div>

              <div className="flex-1 space-y-4 flex flex-col">
                {/* ── Box 1: Policy Match ── */}
                <div className={`relative p-4 rounded-2xl border transition-all duration-700 ${
                  step === 'idle' || step === 'requesting' 
                    ? 'bg-transparent border-white/[0.03] opacity-20' 
                    : 'bg-black border-white/5 shadow-xl opacity-100'
                }`}>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-[9px] text-tertiary font-bold uppercase tracking-widest text-[8px]">Active Policy Match</span>
                    {step === 'evaluating' ? (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-brand/10 border border-brand/20 text-[8px] font-bold text-brand animate-pulse">
                        SCANNING
                      </div>
                    ) : (step === 'approval' || step === 'finished') ? (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-error-subtle border border-error/20 text-[8px] font-bold text-error">
                        CRITICAL
                      </div>
                    ) : null}
                  </div>

                  <div className={`space-y-2 transition-all duration-500 ${
                    (step === 'evaluating' || step === 'approval' || step === 'finished') ? 'opacity-100 blur-0' : 'opacity-0 blur-sm'
                  }`}>
                    <div className="text-[11px] font-mono text-secondary bg-secondary/80 p-2 rounded border border-white/5 leading-relaxed relative overflow-hidden">
                      <span className="text-tertiary uppercase text-[9px]">Rule:</span> PRODUCTION_INTEGRITY<br/>
                      <span className="text-tertiary uppercase text-[9px]">Trigger:</span> RISK_SCORE &gt; 80
                      {step === 'evaluating' && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand/10 to-transparent animate-shimmer -translate-x-full"></div>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[10px] px-1">
                      <span className="text-tertiary text-[9px]">Status</span>
                      <span className={step === 'evaluating' ? "text-disabled italic" : "text-brand font-bold"}>
                        {step === 'evaluating' ? 'Analyzing...' : 'Interception Required'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ── Box 2: Authorization ── */}
                <div className="flex-1 relative overflow-hidden min-h-[220px]">
                  {/* Idle/Standby State */}
                  {(step === 'idle' || step === 'requesting' || step === 'evaluating') && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center opacity-20 transition-opacity duration-700">
                      <Radar className="text-tertiary mb-2" size={48} />
                      <p className="text-[9px] text-tertiary font-mono uppercase tracking-[0.2em]">Decisional Stream Standby</p>
                    </div>
                  )}

                  {/* Approval Prompt */}
                  <div className={`transition-all duration-700 absolute inset-0 z-40 ${
                    step === 'approval' ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 pointer-events-none'
                  }`}>
                    <div className="p-5 rounded-2xl bg-gradient-to-b from-brand/10 to-transparent border border-brand/20 shadow-2xl h-full flex flex-col">
                      <div className="flex items-center gap-2 mb-4">
                        <Clock size={14} className="text-brand animate-spin-slow" />
                        <span className="text-[10px] font-extrabold text-white uppercase tracking-widest">Awaiting Approval</span>
                      </div>
                      
                      <p className="text-[11px] text-secondary mb-5 leading-relaxed">
                        High-risk action detected. Human intervention required before execution.
                      </p>

                      <div className="mt-auto flex gap-2">
                        <button 
                          onClick={() => handleDecision('allowed')}
                          className="flex-1 py-2.5 rounded-xl bg-status-success text-white text-[10px] font-bold hover:bg-green-600 transition-all hover:scale-[1.02] active:scale-95 shadow-lg shadow-green-500/20 relative z-50 cursor-pointer"
                        >
                          ALLOW
                        </button>
                        <button 
                          onClick={() => handleDecision('blocked')}
                          className="flex-1 py-2.5 rounded-xl bg-status-error text-white text-[10px] font-bold hover:bg-red-600 transition-all hover:scale-[1.02] active:scale-95 shadow-lg shadow-red-500/20 relative z-50 cursor-pointer"
                        >
                          DENY
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Finished / Evidence Record */}
                  <div className={`transition-all duration-700 absolute inset-0 z-30 ${
                    step === 'finished' ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 pointer-events-none'
                  }`}>
                    <div className="p-4 rounded-2xl bg-black border border-white/5 text-center space-y-3 shadow-xl h-full flex flex-col justify-center">
                      <div className="inline-flex w-10 h-10 mx-auto items-center justify-center rounded-full bg-status-success/10 border border-green-500/20 text-success mb-1">
                        <ShieldCheck size={20} />
                      </div>
                      <div className="text-[11px] font-bold text-secondary uppercase tracking-widest">Evidence Recorded</div>
                      <div className="flex items-center gap-2 bg-secondary/50 p-2 rounded-lg border border-white/5">
                        <div className="text-[9px] font-mono text-tertiary flex-1 truncate text-left italic">
                          act_9283_dec_signed_v1...
                        </div>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-status-success/10 border border-green-500/20">
                          <CheckCircle2 size={10} className="text-success" />
                          <span className="text-[8px] font-bold text-success uppercase tracking-tighter">verified</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Connecting animation */}
              {step === 'requesting' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-30">
                  <div className="w-12 h-12 rounded-2xl border-2 border-brand border-t-transparent animate-spin mb-4"></div>
                  <span className="text-[10px] font-mono text-brand font-bold tracking-widest animate-pulse uppercase">Syncing State</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <style jsx global>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
        .animate-spin-slow {
          animation: spin 3s linear infinite;
        }
      `}</style>
    </div>
  );
}

function Radar({ className, size }) {
  return (
    <svg 
      className={className} 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" opacity="0.1" />
      <circle cx="12" cy="12" r="6" opacity="0.2" />
      <circle cx="12" cy="12" r="2" opacity="0.4" />
      <path d="M12 12L22 12" className="animate-spin-slow origin-center" />
      <path d="M12 12L12 2" className="animate-spin-slow origin-center opacity-50" />
    </svg>
  );
}
