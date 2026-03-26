import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Mail, Lock, Loader2, ArrowRight, MailCheck, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type AuthState = 'login' | 'signup' | 'forgot_password' | 'check_email';

export default function Auth() {
  const [authState, setAuthState] = useState<AuthState>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      if (authState === 'forgot_password') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) {
          if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
            throw new Error('Our servers are busy, please try again in 60 seconds.');
          }
          throw error;
        }
        setAuthState('check_email');
        setCountdown(60);
      } else if (authState === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (error.message.includes('Email not confirmed')) {
            throw new Error('Please verify your email address before logging in.');
          }
          if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
            throw new Error('Our servers are busy, please try again in 60 seconds.');
          }
          throw error;
        }
      } else if (authState === 'signup') {
        const { error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            emailRedirectTo: window.location.origin
          }
        });
        if (error) {
          if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
            throw new Error('Our servers are busy, please try again in 60 seconds.');
          }
          throw error;
        }
        setAuthState('check_email');
        setCountdown(60);
      }
    } catch (error: any) {
      console.error("FULL_ERROR_OBJECT:", error);
      alert("FULL ERROR OBJECT:\n\n" + JSON.stringify(error, null, 2));
      setErrorMsg(error.message || error.description || JSON.stringify(error) || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: window.location.origin
        }
      });
      if (error) {
        if (error.status === 429 || error.message.toLowerCase().includes('rate limit')) {
          throw new Error('Our servers are busy, please try again in 60 seconds.');
        }
        throw error;
      }
      setCountdown(60);
    } catch (error: any) {
      console.error("FULL_ERROR_OBJECT:", error);
      alert("FULL ERROR OBJECT:\n\n" + JSON.stringify(error, null, 2));
      setErrorMsg(error.message || error.description || JSON.stringify(error) || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      // Note: We don't set isGoogleLoading to false here because the page will redirect to Google
    } catch (error: any) {
      console.error("FULL_ERROR_OBJECT:", error);
      alert("FULL ERROR OBJECT:\n\n" + JSON.stringify(error, null, 2));
      setErrorMsg(error.message || error.description || JSON.stringify(error) || 'An error occurred.');
      setIsGoogleLoading(false);
    }
  };

  const variants = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
    exit: { opacity: 0, y: -20, scale: 0.95, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background Effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-900/20 rounded-full blur-3xl -z-10" />

      <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl relative">
        <AnimatePresence mode="wait">
          {authState === 'check_email' ? (
            <motion.div
              key="check_email"
              variants={variants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="text-center"
            >
              <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-500/20">
                <MailCheck className="w-10 h-10 text-emerald-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">Check Your Inbox</h2>
              <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
                We've sent a magic link to <span className="text-white font-medium">{email}</span>. Please verify to continue.
              </p>

              {errorMsg && (
                <div className="flex items-start gap-3 p-3 rounded-lg mb-6 text-sm bg-red-500/10 text-red-400 border border-red-500/20 text-left">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p>{errorMsg}</p>
                </div>
              )}

              <button
                onClick={handleResend}
                disabled={countdown > 0 || loading}
                className="w-full bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-white rounded-lg py-3 font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mb-4"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : countdown > 0 ? (
                  `Resend available in ${countdown}s`
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Resend Verification Email
                  </>
                )}
              </button>

              <button
                onClick={() => setAuthState('login')}
                className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors flex items-center justify-center gap-2 mx-auto"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Sign In
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="auth_form"
              variants={variants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">
                  LeadGen <span className="text-emerald-400">Master</span>
                </h1>
                <p className="text-neutral-400 text-sm">
                  {authState === 'forgot_password'
                    ? 'Reset your password'
                    : authState === 'login'
                      ? 'Sign in to your account'
                      : 'Create a new account'}
                </p>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-3 p-3 rounded-lg mb-6 text-sm bg-red-500/10 text-red-400 border border-red-500/20 text-left">
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <p>{errorMsg}</p>
                </div>
              )}

              <form onSubmit={handleAuth} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-300 mb-1">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-black/50 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                      placeholder="you@company.com"
                    />
                  </div>
                </div>

                {authState !== 'forgot_password' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-sm font-medium text-neutral-300">Password</label>
                      {authState === 'login' && (
                        <button
                          type="button"
                          onClick={() => {
                            setAuthState('forgot_password');
                            setErrorMsg(null);
                          }}
                          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-black/50 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || isGoogleLoading}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-2.5 font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-6"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      {authState === 'forgot_password' ? 'Send Reset Link' : authState === 'login' ? 'Sign In' : 'Create Account'}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {authState !== 'forgot_password' && (
                <>
                  <div className="mt-6 relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10"></div>
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-4 bg-black text-neutral-500 rounded-full border border-white/10">Or continue with</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={loading || isGoogleLoading}
                    className="mt-6 w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg py-2.5 font-medium transition-colors flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGoogleLoading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Signing you in...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                        </svg>
                        Google
                      </>
                    )}
                  </button>
                </>
              )}

              <div className="mt-6 text-center">
                {authState === 'forgot_password' ? (
                  <button
                    onClick={() => {
                      setAuthState('login');
                      setErrorMsg(null);
                    }}
                    className="text-sm text-neutral-400 hover:text-white transition-colors flex items-center justify-center gap-2 mx-auto"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Sign In
                  </button>
                ) : (
                  <p className="text-sm text-neutral-400">
                    {authState === 'login' ? "Don't have an account? " : "Already have an account? "}
                    <button
                      onClick={() => {
                        setAuthState(authState === 'login' ? 'signup' : 'login');
                        setErrorMsg(null);
                      }}
                      className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
                    >
                      {authState === 'login' ? 'Sign Up' : 'Sign In'}
                    </button>
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
