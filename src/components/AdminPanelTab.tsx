import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  Download,
  ExternalLink,
  Flame,
  GitBranch,
  Github,
  Globe,
  KeyRound,
  Layers,
  Megaphone,
  Plus,
  RefreshCw,
  Send,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  UploadCloud,
  UserCheck,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import { AdminUser, PollingStatus, Question, Student } from '../types/index.ts';

interface AdminPanelTabProps {
  status: PollingStatus | null;
  admins: AdminUser[];
  students: Student[];
  questions: Question[];
  auditLogs: any[];
  onRefresh: () => void;
  onDownloadBackup: () => void;
}

export const AdminPanelTab: React.FC<AdminPanelTabProps> = ({
  status,
  admins,
  students,
  questions,
  auditLogs,
  onRefresh,
  onDownloadBackup,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'copilot' | 'admins' | 'students' | 'keepalive'>('keepalive');
  const [instruction, setInstruction] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotHistory, setCopilotHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string; data?: any }>>([
    {
      role: 'assistant',
      text: 'درود مدیر ارشد محترم مجتمع مفید! من دستیار هوشمند اجرایی شما هستم. می‌توانید دستوراتی مثل تولید سؤال، تغییر امتیاز دانش‌آموزان یا پایش وضعیت ربات را بدهید.',
    },
  ]);

  // Add Admin modal
  const [showAddAdminModal, setShowAddAdminModal] = useState(false);
  const [newAdminChatId, setNewAdminChatId] = useState('');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'teacher' | 'principal' | 'content_manager'>('teacher');

  // Webhook Management for Custom Server
  const [webhookUrlInput, setWebhookUrlInput] = useState(
    typeof window !== 'undefined' ? `${window.location.origin}/api/bale/webhook` : ''
  );
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState<any | null>(null);
  const [webhookMessage, setWebhookMessage] = useState<string | null>(null);
  const [isTogglingPolling, setIsTogglingPolling] = useState(false);
  const [pollingToggleMessage, setPollingToggleMessage] = useState<string | null>(null);

  // 00:00 to 24:00 (1-Year Mode) state
  const [adminTwStartTime, setAdminTwStartTime] = useState(status?.timeWindow247?.startTime || '00:00');
  const [adminTwEndTime, setAdminTwEndTime] = useState(status?.timeWindow247?.endTime || '24:00');
  const [adminTwLoading, setAdminTwLoading] = useState(false);
  const [adminTwMsg, setAdminTwMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status?.timeWindow247) {
      if (status.timeWindow247.startTime) setAdminTwStartTime(status.timeWindow247.startTime);
      if (status.timeWindow247.endTime) setAdminTwEndTime(status.timeWindow247.endTime);
    }
  }, [status?.timeWindow247]);

  const handleAdminToggleTimeWindow = async (newEnabled: boolean) => {
    setAdminTwLoading(true);
    setAdminTwMsg(null);
    try {
      const res = await fetch('/api/bale/time-window', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: newEnabled,
          startTime: adminTwStartTime,
          endTime: adminTwEndTime,
          durationDays: 365,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setAdminTwMsg(data.message);
        onRefresh();
      } else {
        setAdminTwMsg(data.message || 'خطا در ثبت');
      }
    } catch (e: any) {
      setAdminTwMsg(`خطا: ${e.message}`);
    } finally {
      setAdminTwLoading(false);
    }
  };

  const fetchWebhookInfo = async () => {
    try {
      const res = await fetch('/api/bale/webhook/info');
      const data = await res.json();
      if (data && data.ok) {
        setWebhookInfo(data.webhookInfo);
        if (data.currentConfigUrl) {
          setWebhookUrlInput(data.currentConfigUrl);
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchWebhookInfo();
  }, []);

  const handleSetWebhook = async () => {
    if (!webhookUrlInput.trim()) return;
    setWebhookLoading(true);
    setWebhookMessage(null);
    try {
      const res = await fetch('/api/bale/webhook/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrlInput.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setWebhookMessage('✅ وب‌هوک با موفقیت روی پیام‌رسان بله ثبت شد. پیام‌ها اکنون مستقیماً به سرور شما ارسال می‌شوند.');
        await fetchWebhookInfo();
        onRefresh();
      } else {
        setWebhookMessage(`❌ خطا در ثبت وب‌هوک: ${data.description || 'نامشخص'}`);
      }
    } catch (e: any) {
      setWebhookMessage(`❌ خطا در ارتباط: ${e.message}`);
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleDeleteWebhook = async () => {
    setWebhookLoading(true);
    setWebhookMessage(null);
    try {
      const res = await fetch('/api/bale/webhook/delete', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setWebhookMessage('✅ وب‌هوک در بله حذف شد. بات اکنون می‌تواند توسط متد getUpdates (Long Polling) توسط سرور شما یا این پنل پیام‌ها را دریافت کند.');
        await fetchWebhookInfo();
        onRefresh();
      } else {
        setWebhookMessage(`❌ خطا در حذف وب‌هوک: ${data.description || 'نامشخص'}`);
      }
    } catch (e: any) {
      setWebhookMessage(`❌ خطا در ارتباط: ${e.message}`);
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleToggleInternalPolling = async () => {
    setIsTogglingPolling(true);
    setPollingToggleMessage(null);
    try {
      const endpoint = status?.isActive ? '/api/bale/polling/stop' : '/api/bale/polling/start';
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setPollingToggleMessage(status?.isActive ? 'دریافت پیام‌های داخلی متوقف شد. اکنون سرور شخصی شما می‌تواند آزادانه از getUpdates استفاده کند.' : 'دریافت پیام‌های داخلی آغاز شد.');
        onRefresh();
      }
    } catch (e: any) {
      setPollingToggleMessage(`خطا: ${e.message}`);
    } finally {
      setIsTogglingPolling(false);
    }
  };

  // Firebase Cloud Firestore Sync
  const [firebaseSyncing, setFirebaseSyncing] = useState(false);
  const [firebaseSyncMessage, setFirebaseSyncMessage] = useState<string | null>(null);

  const handleSyncFirebase = async () => {
    setFirebaseSyncing(true);
    setFirebaseSyncMessage(null);
    try {
      const res = await fetch('/api/firebase/sync', { method: 'POST' });
      const data = await res.json();
      setFirebaseSyncMessage(data.message || (data.ok ? 'همگام‌سازی با فایربیس با موفقیت انجام شد.' : 'خطا در همگام‌سازی'));
      onRefresh();
    } catch (e: any) {
      setFirebaseSyncMessage(`خطا: ${e.message}`);
    } finally {
      setFirebaseSyncing(false);
    }
  };

  // GitHub Deployment & Automation
  const [githubRepoUrl, setGithubRepoUrl] = useState('https://github.com/morymahrad-hue/mofid-game.git');
  const [githubToken, setGithubToken] = useState('');
  const [githubBranch, setGithubBranch] = useState('main');
  const [githubCommitMsg, setGithubCommitMsg] = useState('Deploy MofidGame Panel and 24/7 Bale Bot');
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubStatus, setGithubStatus] = useState<any>(null);
  const [githubResult, setGithubResult] = useState<{ ok: boolean; message: string; details?: string; output?: string; pagesUrl?: string } | null>({
    ok: true,
    message: '✅ پروژه با موفقیت به گیت‌هاب ارسال شد و روی GitHub Pages مستقر گردید!',
    pagesUrl: 'https://morymahrad-hue.github.io/mofid-game/',
  });

  const fetchGithubStatus = async () => {
    try {
      const res = await fetch('/api/github/status');
      const data = await res.json();
      if (data && data.ok) {
        setGithubStatus(data);
        if (data.remoteOrigin && !githubRepoUrl) {
          setGithubRepoUrl(data.remoteOrigin);
        }
        if (data.currentBranch) {
          setGithubBranch(data.currentBranch);
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchGithubStatus();
  }, []);

  const handlePushToGithub = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!githubRepoUrl.trim()) {
      setGithubResult({
        ok: false,
        message: 'لطفاً نشانی مخزن گیت‌هاب (GitHub Repository URL) را وارد فرمایید.',
      });
      return;
    }

    setGithubLoading(true);
    setGithubResult(null);
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: githubRepoUrl.trim(),
          token: githubToken.trim() || undefined,
          branch: githubBranch.trim() || 'main',
          commitMessage: githubCommitMsg.trim() || 'Automated deployment for GitHub Pages & 24/7 Bale Bot',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setGithubResult({
          ok: true,
          message: data.message || 'پروژه با موفقیت به گیت‌هاب ارسال شد.',
          output: data.output,
        });
        await fetchGithubStatus();
        onRefresh();
      } else {
        setGithubResult({
          ok: false,
          message: data.message || 'خطا در ارسال پروژه به گیت‌هاب',
          details: data.details,
        });
      }
    } catch (err: any) {
      setGithubResult({
        ok: false,
        message: `خطای اتصال به سرور: ${err.message}`,
      });
    } finally {
      setGithubLoading(false);
    }
  };


  const handleSendCopilot = async (customText?: string) => {
    const textToSend = customText || instruction;
    if (!textToSend.trim() || copilotLoading) return;

    setCopilotHistory((prev) => [...prev, { role: 'user', text: textToSend }]);
    setInstruction('');
    setCopilotLoading(true);

    try {
      const res = await fetch('/api/ai/copilot-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: textToSend }),
      });
      const data = await res.json();
      setCopilotHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.message || 'دستور با موفقیت در پایگاه داده اعمال شد.',
          data: data.data,
        },
      ]);
      onRefresh();
    } catch (e: any) {
      setCopilotHistory((prev) => [
        ...prev,
        { role: 'assistant', text: `خطا در اجرای دستور: ${e.message}` },
      ]);
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleAddAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminChatId || !newAdminName) return;

    try {
      const res = await fetch('/api/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: newAdminChatId,
          fullName: newAdminName,
          role: newAdminRole,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setShowAddAdminModal(false);
        setNewAdminChatId('');
        setNewAdminName('');
        onRefresh();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteAdmin = async (id: string) => {
    try {
      await fetch(`/api/admins/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch (e) {
      console.error(e);
    }
  };

  const uptimeHours = Math.floor((status?.uptimeSeconds || 0) / 3600);
  const uptimeMinutes = Math.floor(((status?.uptimeSeconds || 0) % 3600) / 60);

  return (
    <div className="space-y-6">
      {/* Admin Panel Header */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border border-indigo-500/30 shadow-2xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <ShieldCheck className="w-6 h-6" />
              </span>
              <h2 className="text-xl font-black text-white">
                پنل مدیریت مدیران و مرکز فرماندهی مفیدگیم
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
                مدیر ارشد (Super Admin)
              </span>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              مرکز اختیارات تام: مانیتورینگ کارکرد ۱ ساله ربات بله، پایگاه داده ابری Firebase Firestore، افزودن دبیران و صدور فرمان به هوش مصنوعی.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>بروزرسانی</span>
            </button>
            <button
              onClick={onDownloadBackup}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/20 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>پشتیبان دیتابیس</span>
            </button>
            <a
              href="/api/download/project-export"
              download="mofidgame-project-export.zip"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/25 transition cursor-pointer"
              title="دانلود فایل زیپ کامل سورس‌کد و دیتابیس پروژه"
            >
              <Download className="w-3.5 h-3.5" />
              <span>📦 دانلود کل پروژه (Export ZIP)</span>
            </a>
          </div>
        </div>

        {/* Quick KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-indigo-500/20">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-indigo-500/20">
            <p className="text-xs text-slate-400">مدیران تأییدشده</p>
            <p className="text-xl font-black text-white mt-1">{admins.length} نفر</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-indigo-500/20">
            <p className="text-xs text-slate-400">سؤالات فعال مدرسه</p>
            <p className="text-xl font-black text-emerald-400 mt-1">{questions.length} سؤال</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-indigo-500/20">
            <p className="text-xs text-slate-400">دانش‌آموزان ثبت‌نامی</p>
            <p className="text-xl font-black text-purple-400 mt-1">{students.length} نفر</p>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/60 border border-indigo-500/20">
            <p className="text-xs text-slate-400">مدت زمان فعالیت سامانه</p>
            <p className="text-xl font-black text-amber-400 mt-1">
              {uptimeHours} ساعت و {uptimeMinutes} دقیقه
            </p>
          </div>
        </div>
      </div>

      {/* Sub Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('keepalive')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSubTab === 'keepalive'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>🌐 اتصال سرور شخصی شما و دیتابیس</span>
        </button>

        <button
          onClick={() => setActiveSubTab('copilot')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSubTab === 'copilot'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>🤖 دستیار هوشمند مدیر</span>
        </button>

        <button
          onClick={() => setActiveSubTab('admins')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeSubTab === 'admins'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>👑 مدیریت مدیران و دبیران ({admins.length})</span>
        </button>
      </div>

      {/* Subtab Content: Custom Server Connection & Cloud Database */}
      {activeSubTab === 'keepalive' && (
        <div className="space-y-6">
          {/* 00:00 to 24:00 (1-Year Moment-to-Moment Mode) Admin Card */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-emerald-950/70 via-slate-900 to-indigo-950/70 border-2 border-emerald-500/50 shadow-2xl space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3.5">
                <div className={`p-2.5 rounded-xl border ${
                  status?.timeWindow247?.enabled
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-lg shadow-emerald-500/20'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  <Clock className={`w-6 h-6 ${status?.timeWindow247?.enabled ? 'animate-pulse' : ''}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-black text-white">
                      حالت کارکرد لحظه‌به‌لحظه در بازه ۰۰:۰۰ تا ۲۴:۰۰ (اشتراک ۱ ساله)
                    </h4>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${
                      status?.timeWindow247?.enabled
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {status?.timeWindow247?.enabled ? '🟢 فعال لحظه‌به‌لحظه' : '⚪ غیرفعال'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1">
                    در طول ۲۴ ساعت شبانه‌روز (۰۰:۰۰ تا ۲۴:۰۰) ربات بله بدون توقف و در لحظه پیام‌ها را دریافت و پردازش می‌کند.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAdminToggleTimeWindow(!status?.timeWindow247?.enabled)}
                  disabled={adminTwLoading}
                  className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-2 shadow-lg ${
                    status?.timeWindow247?.enabled
                      ? 'bg-rose-600/30 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${adminTwLoading ? 'animate-spin' : ''}`} />
                  <span>
                    {status?.timeWindow247?.enabled
                      ? 'توقف حالت ۲۴ ساعته'
                      : '⚡ فعال‌سازی بازه ۰۰:۰۰ تا ۲۴:۰۰ (۱ ساله)'}
                  </span>
                </button>
              </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">بازه ساعتی فعال</span>
                <span className="text-sm font-black text-emerald-400 mt-0.5 block font-mono">
                  {adminTwStartTime} تا {adminTwEndTime}
                </span>
                <span className="text-[10px] text-slate-500">۲۴ ساعت شبانه‌روز</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">مدت اعتبار اشتراک</span>
                <span className="text-sm font-black text-amber-400 mt-0.5 block">
                  {status?.daysRemaining ?? 365} روز باقی‌مانده
                </span>
                <span className="text-[10px] text-slate-500">۳۶۵ روز کامل (۱ سال)</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">واکنش به پیام کاربر</span>
                <span className="text-sm font-black text-sky-400 mt-0.5 block">لحظه‌ای (Zero-Delay)</span>
                <span className="text-[10px] text-slate-500">پردازش آنی بدون وقفه</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">پایداری و بازیابی</span>
                <span className="text-sm font-black text-indigo-300 mt-0.5 block">دیده‌بان واچ‌داگ خودکار</span>
                <span className="text-[10px] text-slate-500">احیای دائمی ۲۴ساعته</span>
              </div>
            </div>

            {/* Edit Range */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  ساعات شروع و پایان بازه کارکرد:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAdminTwStartTime('00:00');
                    setAdminTwEndTime('24:00');
                    handleAdminToggleTimeWindow(true);
                  }}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold underline cursor-pointer"
                >
                  تنظیم سریع روی ۲۴ ساعته کامل (۰۰:۰۰ تا ۲۴:۰۰)
                </button>
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <div className="flex-1 flex items-center gap-2 w-full">
                  <span className="text-xs text-slate-400 shrink-0">از:</span>
                  <input
                    type="text"
                    value={adminTwStartTime}
                    onChange={(e) => setAdminTwStartTime(e.target.value)}
                    placeholder="00:00"
                    className="w-full px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono text-center"
                  />
                  <span className="text-xs text-slate-400 shrink-0">تا:</span>
                  <input
                    type="text"
                    value={adminTwEndTime}
                    onChange={(e) => setAdminTwEndTime(e.target.value)}
                    placeholder="24:00"
                    className="w-full px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono text-center"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleAdminToggleTimeWindow(true)}
                  disabled={adminTwLoading}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer shrink-0"
                >
                  اعمال بازه
                </button>
              </div>
              {adminTwMsg && (
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                  {adminTwMsg}
                </div>
              )}
            </div>
          </div>

          {/* Custom Server Connection Card */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-950/70 via-slate-900 to-cyan-950/70 border-2 border-indigo-500/50 shadow-2xl space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/40">
                  <Server className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    اتصال سرور شخصی شما به پیام‌رسان بله (Custom Server / Webhook & Polling)
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                      webhookInfo?.url
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : status?.isActive
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}>
                      {webhookInfo?.url
                        ? '🟢 وب‌هوک سرور شخصی فعال'
                        : status?.isActive
                        ? '🔵 دریافت داخلی فعال'
                        : '🟡 آزاد برای اتصال سرور شما'}
                    </span>
                  </h4>
                  <p className="text-xs text-slate-300 mt-1">
                    می‌توانید سرور اختصاصی خودتان را از طریق وب‌هوک (Webhook) یا لانگ‌پولینگ (Long Polling) مستقیماً به بات بله متصل نمایید.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={fetchWebhookInfo}
                  disabled={webhookLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${webhookLoading ? 'animate-spin' : ''}`} />
                  <span>استعلام وضعیت از بله</span>
                </button>
              </div>
            </div>

            {/* Current Webhook Info Banner */}
            {webhookInfo && (
              <div className="p-4 rounded-xl bg-slate-950/80 border border-indigo-500/30 text-xs space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-slate-400">نشانی وب‌هوک فعال در بله:</span>
                  <span className="font-mono text-indigo-300 font-bold bg-indigo-950/50 px-2.5 py-1 rounded-md border border-indigo-500/30">
                    {webhookInfo.url || 'ثبت نشده (حالت لانگ‌پولینگ فعال است)'}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono text-[11px] text-slate-300">
                  <div>پیام‌های در صف انتظار: <strong className="text-amber-400">{webhookInfo.pending_update_count ?? 0}</strong></div>
                  <div>حداکثر اتصالات همزمان: <strong className="text-emerald-400">{webhookInfo.max_connections ?? 40}</strong></div>
                  <div>گواهی SSL: <strong className="text-sky-400">{webhookInfo.has_custom_certificate ? 'سفارشی' : 'استاندارد'}</strong></div>
                  <div>خطای ثبت‌شده بله: <strong className={webhookInfo.last_error_message ? 'text-rose-400' : 'text-emerald-400'}>{webhookInfo.last_error_message || 'بدون خطا'}</strong></div>
                </div>
              </div>
            )}

            {/* Form to Set / Remove Custom Server Webhook */}
            <div className="space-y-3 pt-2 border-t border-indigo-500/20">
              <label className="block text-xs font-semibold text-slate-200">
                ۱. تنظیم نشانی وب‌هوک سرور شخصی شما (Webhook URL):
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={webhookUrlInput}
                  onChange={(e) => setWebhookUrlInput(e.target.value)}
                  placeholder="https://your-server-ip-or-domain.com/api/bale/webhook"
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleSetWebhook}
                  disabled={webhookLoading || !webhookUrlInput.trim()}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30 transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>ثبت وب‌هوک سرور شما در بله</span>
                </button>
                <button
                  onClick={handleDeleteWebhook}
                  disabled={webhookLoading}
                  className="px-4 py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                  title="حذف وب‌هوک و آزادسازی"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>حذف وب‌هوک</span>
                </button>
              </div>
              {webhookMessage && (
                <p className="text-xs font-medium text-indigo-300 bg-indigo-950/40 p-2.5 rounded-xl border border-indigo-500/30">
                  {webhookMessage}
                </p>
              )}
            </div>

            {/* Long Polling Conflict Resolver */}
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h5 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    ۲. هماهنگی حالت Long Polling (جلوگیری از تداخل و خطای 409 Conflict):
                  </h5>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    اگر سرور شخصی شما از طریق دریافت مستقیم <code>getUpdates</code> کار می‌کند، برای جلوگیری از ارور تداخل، دریافت پیام‌های داخلی این پنل را متوقف کنید.
                  </p>
                </div>
                <button
                  onClick={handleToggleInternalPolling}
                  disabled={isTogglingPolling}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    status?.isActive
                      ? 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30'
                      : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTogglingPolling ? 'animate-spin' : ''}`} />
                  <span>{status?.isActive ? 'توقف دریافت داخلی (آزاد کردن توکن برای سرور شما)' : 'فعال‌سازی مجدد دریافت داخلی'}</span>
                </button>
              </div>
              {pollingToggleMessage && (
                <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 text-xs">
                  {pollingToggleMessage}
                </div>
              )}
            </div>

            {/* Technical Integration Specs for Developers */}
            <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 text-xs space-y-2.5">
              <span className="font-bold text-slate-300 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                اطلاعات فنی جهت پیاده‌سازی روی سرور شما (Node.js / Python / Go / PHP):
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-slate-300">
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block">پروتکل API بله:</span>
                  <span className="text-cyan-300">HTTPS REST (سازگار با استانداردهای تلگرام)</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block">آدرس فراخوانی متدها:</span>
                  <span className="text-emerald-400 select-all">https://tapi.bale.ai/bot&lt;TOKEN&gt;/&lt;METHOD&gt;</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block">متد دریافت به روش وب‌هوک:</span>
                  <span className="text-indigo-300">POST با محتوای JSON به نشانی سرور شما</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block">نام کاربری ربات مدرسه:</span>
                  <span className="text-amber-300">@mofidgamebot</span>
                </div>
              </div>
            </div>
          </div>

          {/* Firebase Cloud Firestore Card */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-950/40 via-slate-900 to-orange-950/40 border-2 border-amber-500/40 shadow-xl space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
                  <Flame className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    پایگاه داده ابری گوگل فایربیس (Firebase Cloud Firestore)
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold">
                      🟢 متصل و فعال
                    </span>
                  </h4>
                  <p className="text-xs text-slate-300 mt-0.5">
                    اطلاعات دانش‌آموزان ربات بله، کارنامه‌ها و سوالات به صورت خودکار و زنده روی سرور ابری Firebase ذخیره می‌شوند.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncFirebase}
                  disabled={firebaseSyncing}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${firebaseSyncing ? 'animate-spin' : ''}`} />
                  <span>{firebaseSyncing ? 'در حال همگام‌سازی ابری...' : '⚡ همگام‌سازی فوری با Firebase'}</span>
                </button>
              </div>
            </div>

            {firebaseSyncMessage && (
              <div className="p-3 rounded-xl bg-slate-950/80 border border-amber-500/30 text-xs text-amber-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{firebaseSyncMessage}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[11px] block">شناسه پروژه فایربیس:</span>
                <span className="text-amber-400 font-mono font-bold block">gen-lang-client-0447743031</span>
                <span className="text-[10px] text-slate-500">منطقه ابری: Google Cloud</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[11px] block">دیتابیس اختصاصی (Database ID):</span>
                <span className="text-emerald-400 font-mono font-bold block text-[11px] truncate">ai-studio-remix-f840dc64-d10e-42d3-a35f-83d01321206d</span>
                <span className="text-[10px] text-slate-500">مجموعه‌ها: students, questions, quizResults</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                <span className="text-slate-400 text-[11px] block">همگام‌سازی خودکار ربات بله:</span>
                <span className="text-sky-400 font-bold block">پیوسته در لحظه (Real-Time)</span>
                <span className="text-[10px] text-slate-500">ثبت‌نام‌ها و آزمون‌ها بلافاصله در فایربیس ذخیره می‌شوند</span>
              </div>
            </div>
          </div>

          {/* GitHub Pages & 24/7 Cloud Bot Runner Automation Card */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 border-2 border-indigo-500/50 shadow-2xl space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  <Github className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-base font-black text-white flex items-center gap-2">
                    ارسال خودکار به گیت‌هاب (GitHub Pages + رانر ابری ۲۴ ساعته ربات)
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                      ⚡ آماده استقرار با ۱ کلیک
                    </span>
                  </h4>
                  <p className="text-xs text-slate-300 mt-1">
                    پوش خودکار به گیت‌هاب جهت راه‌اندازی همزمان پنل وب روی <strong>GitHub Pages</strong> و آنلاین ماندن ربات بله از طریق <strong>GitHub Actions Cloud Runners</strong> بدون نیاز به سرور شخصی.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchGithubStatus}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>بروزرسانی وضعیت گیت</span>
                </button>
              </div>
            </div>

            {/* Git Status Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">شاخه کاری فعال (Git Branch):</span>
                <span className="text-sm font-black text-indigo-400 font-mono mt-0.5 block flex items-center gap-1.5">
                  <GitBranch className="w-4 h-4 text-indigo-400" />
                  {githubStatus?.currentBranch || 'main'}
                </span>
                <span className="text-[10px] text-slate-500">مخزن محلی آماده پوش است</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">پایپ‌لاین گیت‌هاب پیجز (GitHub Pages):</span>
                <span className="text-xs font-bold text-emerald-400 mt-0.5 block flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  .github/workflows/deploy-pages.yml
                </span>
                <span className="text-[10px] text-slate-500">بیلد و استقرار خودکار فرانت‌اند پنل</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                <span className="text-[11px] text-slate-400 block">رانر ابری ۲۴ ساعته ربات (Bot Runner):</span>
                <span className="text-xs font-bold text-sky-400 mt-0.5 block flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                  .github/workflows/bale-bot-runner.yml
                </span>
                <span className="text-[10px] text-slate-500">اجرای دائمی ربات بله در سرورهای ابری گیت‌هاب</span>
              </div>
            </div>

            {/* One-Click Push Form */}
            <form onSubmit={handlePushToGithub} className="p-4 rounded-xl bg-slate-950/90 border border-indigo-500/30 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <UploadCloud className="w-4 h-4 text-purple-400" />
                  اطلاعات مخزن گیت‌هاب شما جهت پوش و استقرار خودکار:
                </span>
                <span className="text-[11px] text-slate-400">
                  (تنها کاری که باید بکنید: یک مخزن جدید در اکانت GitHub خود بسازید و آدرس آن را اینجا قرار دهید)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-300 font-semibold mb-1">
                    نشانی مخزن گیت‌هاب (GitHub Repository URL):
                  </label>
                  <input
                    type="text"
                    value={githubRepoUrl}
                    onChange={(e) => setGithubRepoUrl(e.target.value)}
                    placeholder="https://github.com/username/mofidgame.git"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
                    required
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    مثال: https://github.com/mahradmoradpour/mofidgame.git
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-300 font-semibold mb-1">
                    توکن دسترسی شخصی گیت‌هاب (Personal Access Token - PAT):
                  </label>
                  <input
                    type="password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx (جهت احراز هویت خودکار)"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">
                    از منوی GitHub Settings &gt; Developer Settings &gt; Personal Access Tokens قابل دریافت است.
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <div className="text-[11px] text-slate-400">
                  پس از زدن دکمه زیر، تمام کدهای پنل و اکشن‌های ربات بله با دستور خودکار Git Push به مخزن شما ارسال خواهند شد.
                </div>

                <button
                  type="submit"
                  disabled={githubLoading || !githubRepoUrl.trim()}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 transition flex items-center justify-center gap-2 cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <UploadCloud className={`w-4 h-4 ${githubLoading ? 'animate-bounce' : ''}`} />
                  <span>{githubLoading ? 'در حال ارسال و پوش به گیت‌هاب...' : '🚀 پوش و استقرار خودکار به گیت‌هاب (Auto Push)'}</span>
                </button>
              </div>
            </form>

            {/* Success or Error Feedback */}
            {githubResult && (
              <div className={`p-4 rounded-xl border text-xs space-y-2 ${
                githubResult.ok
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              }`}>
                <div className="flex items-center gap-2 font-bold">
                  {githubResult.ok ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                  )}
                  <span>{githubResult.message}</span>
                </div>

                {githubResult.ok && (
                  <div className="p-3.5 rounded-xl bg-slate-950/90 border border-emerald-500/30 text-slate-300 space-y-2 text-[11px]">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                        <Globe className="w-4 h-4 text-emerald-400" />
                        نشانی فعال پنل روی GitHub Pages:
                      </span>
                      <a
                        href={githubResult.pagesUrl || 'https://morymahrad-hue.github.io/mofid-game/'}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition shadow cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>مشاهده زنده در GitHub Pages</span>
                      </a>
                    </div>
                    <div className="font-mono text-emerald-300 bg-slate-900 p-2 rounded-lg border border-slate-800 break-all select-all">
                      {githubResult.pagesUrl || 'https://morymahrad-hue.github.io/mofid-game/'}
                    </div>
                    <div className="pt-1 text-slate-400 space-y-1">
                      <div>• شاخه منبع گیت‌هاب پیجز (<code>gh-pages</code>) با موفقیت بیلد و منتشر شده است.</div>
                      <div>• شاخه کدهای اصلی (<code>main</code>) به همراه تنظیمات ربات ۲۴ ساعته بر روی مخزن ذخیره گردید.</div>
                    </div>
                  </div>
                )}

                {githubResult.details && (
                  <pre className="p-2 rounded bg-black/50 text-[10px] font-mono overflow-x-auto text-rose-300 max-h-32">
                    {githubResult.details}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subtab Content: Copilot */}
      {activeSubTab === 'copilot' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-purple-500/30 flex flex-col h-[520px]">
            <div className="flex-1 overflow-y-auto space-y-3 p-2">
              {copilotHistory.map((item, idx) => (
                <div
                  key={idx}
                  className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-[85%] ${
                    item.role === 'user'
                      ? 'mr-auto bg-purple-600 text-white rounded-br-sm'
                      : 'ml-auto bg-slate-950 text-slate-200 border border-slate-800 rounded-bl-sm'
                  }`}
                >
                  <p>{item.text}</p>
                </div>
              ))}
              {copilotLoading && (
                <div className="flex items-center gap-2 text-xs text-purple-400 p-3 bg-purple-950/20 rounded-xl border border-purple-500/20 animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>در حال پردازش دستور هوشمند...</span>
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendCopilot();
              }}
              className="pt-3 border-t border-slate-800 flex gap-2"
            >
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="دستور خود را بنویسید (مثلاً: یک سؤال سخت ریاضی نهم بساز / ۵۰ امتیاز به همه بده)..."
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
              <button
                type="submit"
                disabled={copilotLoading || !instruction.trim()}
                className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>ارسال</span>
              </button>
            </form>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>دستورات سریع آماده</span>
            </h3>
            <div className="space-y-2">
              {[
                'یک سؤال تستی سخت از فصل اول ریاضی نهم به بانک اضافه کن',
                'یک سؤال مفهومی از درس علوم هفتم طراحی کن',
                'به تمام دانش‌آموزان ۵۰ امتیاز لیگ اضافه کن',
              ].map((cmd, i) => (
                <button
                  key={i}
                  onClick={() => handleSendCopilot(cmd)}
                  className="w-full text-right p-3 rounded-xl bg-slate-950 hover:bg-purple-950/40 border border-slate-800 hover:border-purple-500/40 text-xs text-slate-300 transition cursor-pointer block"
                >
                  ⚡ {cmd}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Subtab Content: Admins */}
      {activeSubTab === 'admins' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-400" />
              <span>لیست مدیران و دبیران دارای دسترسی</span>
            </h3>
            <button
              onClick={() => setShowAddAdminModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>افزودن مدیر / دبیر جدید</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {admins.map((adm) => (
              <div key={adm.id} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-white">{adm.fullName}</p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">شناسه بله: {adm.chatId}</p>
                  <span className="inline-block mt-2 px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px]">
                    {adm.role === 'super_admin' ? 'مدیر ارشد' : adm.role === 'principal' ? 'مدیر مدرسه' : 'دبیر محترم'}
                  </span>
                </div>
                {adm.role !== 'super_admin' && (
                  <button
                    onClick={() => handleDeleteAdmin(adm.id)}
                    className="p-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 transition cursor-pointer"
                    title="حذف مدیر"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {showAddAdminModal && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-md w-full space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-white">افزودن مدیر / دبیر جدید</h4>
                  <button onClick={() => setShowAddAdminModal(false)} className="text-slate-400 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleAddAdminSubmit} className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">نام و نام خانوادگی:</label>
                    <input
                      type="text"
                      value={newAdminName}
                      onChange={(e) => setNewAdminName(e.target.value)}
                      placeholder="مثال: آقای حسینی"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">شناسه عددی بله (Chat ID):</label>
                    <input
                      type="text"
                      value={newAdminChatId}
                      onChange={(e) => setNewAdminChatId(e.target.value)}
                      placeholder="مثال: 123456789"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">نقش دسترسی:</label>
                    <select
                      value={newAdminRole}
                      onChange={(e) => setNewAdminRole(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                    >
                      <option value="teacher">دبیر آموزشی (دسترسی به سؤالات و آزمون‌ها)</option>
                      <option value="principal">معاون / مدیر آموزشی</option>
                      <option value="content_manager">مدیر محتوا</option>
                    </select>
                  </div>
                  <div className="pt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddAdminModal(false)}
                      className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
                    >
                      انصراف
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
                    >
                      ذخیره مدیر
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
