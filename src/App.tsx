import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { DashboardTab } from './components/DashboardTab.tsx';
import { AdminPanelTab } from './components/AdminPanelTab.tsx';
import {
  AdminUser,
  BaleConfig,
  GradeLevel,
  OfficialResource,
  PollingStatus,
  Question,
  Student
} from './types/index.ts';
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
  Flame,
  Gamepad2,
  Github,
  GraduationCap,
  HelpCircle,
  Layers,
  MessageSquare,
  MessageSquareCode,
  Play,
  Plus,
  RefreshCw,
  Send,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Trophy,
  Upload,
  UploadCloud,
  UserCheck,
  Users,
  X
} from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [status, setStatus] = useState<PollingStatus | null>(null);
  const [baleConfig, setBaleConfig] = useState<Partial<BaleConfig>>({});
  const [students, setStudents] = useState<Student[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [resources, setResources] = useState<OfficialResource[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isTogglingPolling, setIsTogglingPolling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCopilotModal, setShowCopilotModal] = useState(false);

  // Bale Bot Tab state
  const [botTokenInput, setBotTokenInput] = useState('');
  const [adminChatIdInput, setAdminChatIdInput] = useState('');
  const [schoolCodeInput, setSchoolCodeInput] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configSaveMsg, setConfigSaveMsg] = useState<string | null>(null);

  // Webhook VPS state
  const [baleWebhookUrl, setBaleWebhookUrl] = useState(
    typeof window !== 'undefined' ? `${window.location.origin}/api/bale/webhook` : ''
  );
  const [baleWebhookMsg, setBaleWebhookMsg] = useState<string | null>(null);
  const [baleWebhookLoading, setBaleWebhookLoading] = useState(false);
  const [baleWebhookInfo, setBaleWebhookInfo] = useState<any | null>(null);

  // 00:00 to 24:00 (1-Year Moment-to-Moment Mode) State
  const [twStartTime, setTwStartTime] = useState('00:00');
  const [twEndTime, setTwEndTime] = useState('24:00');
  const [twDurationDays, setTwDurationDays] = useState(365);
  const [isTogglingTimeWindow, setIsTogglingTimeWindow] = useState(false);
  const [twMessage, setTwMessage] = useState<string | null>(null);
  const [isEnsuringActive, setIsEnsuringActive] = useState(false);
  const [ensureActiveMsg, setEnsureActiveMsg] = useState<string | null>(null);

  const handleEnsureActive = async () => {
    setIsEnsuringActive(true);
    setEnsureActiveMsg(null);
    try {
      const res = await fetch('/api/bale/ensure-active', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setEnsureActiveMsg('✅ سپر پایداری فعال است و اتصال ربات به سرور بله بدون وقفه پایدار گردید.');
        await loadData();
      } else {
        setEnsureActiveMsg(`خطا: ${data.message || 'مشکل در برقراری ارتباط'}`);
      }
    } catch (err: any) {
      setEnsureActiveMsg(`خطا در ارتباط: ${err.message}`);
    } finally {
      setIsEnsuringActive(false);
    }
  };

  const handleToggleTimeWindow = async (newEnabled: boolean) => {
    setIsTogglingTimeWindow(true);
    setTwMessage(null);
    try {
      const res = await fetch('/api/bale/time-window', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: newEnabled,
          startTime: twStartTime,
          endTime: twEndTime,
          durationDays: twDurationDays
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setTwMessage(data.message);
        await loadData();
      } else {
        setTwMessage(data.message || 'خطا در اعمال تنظیمات بازه زمانی');
      }
    } catch (err: any) {
      setTwMessage(`خطا: ${err.message}`);
    } finally {
      setIsTogglingTimeWindow(false);
    }
  };

  const fetchBaleWebhookInfo = async () => {
    try {
      const res = await fetch('/api/bale/webhook/info');
      const data = await res.json();
      if (data && data.ok) {
        setBaleWebhookInfo(data.webhookInfo);
        if (data.currentConfigUrl) {
          setBaleWebhookUrl(data.currentConfigUrl);
        }
      }
    } catch {}
  };

  const handleSetBaleWebhook = async () => {
    if (!baleWebhookUrl.trim()) return;
    setBaleWebhookLoading(true);
    setBaleWebhookMsg(null);
    try {
      const res = await fetch('/api/bale/webhook/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: baleWebhookUrl.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setBaleWebhookMsg('✅ وب‌هوک با موفقیت روی سرور ثبت و فعال گردید.');
        await fetchBaleWebhookInfo();
        await loadData();
      } else {
        setBaleWebhookMsg(`❌ خطا: ${data.description || 'نامشخص'}`);
      }
    } catch (e: any) {
      setBaleWebhookMsg(`❌ خطا: ${e.message}`);
    } finally {
      setBaleWebhookLoading(false);
    }
  };

  const handleDeleteBaleWebhook = async () => {
    setBaleWebhookLoading(true);
    setBaleWebhookMsg(null);
    try {
      const res = await fetch('/api/bale/webhook/delete', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setBaleWebhookMsg('✅ وب‌هوک حذف شد و سیستم به پولینگ ۲۴/۷ بازگشت.');
        await fetchBaleWebhookInfo();
        await loadData();
      } else {
        setBaleWebhookMsg(`❌ خطا: ${data.description || 'نامشخص'}`);
      }
    } catch (e: any) {
      setBaleWebhookMsg(`❌ خطا: ${e.message}`);
    } finally {
      setBaleWebhookLoading(false);
    }
  };

  // Simulator Tab state
  const [simulatorInput, setSimulatorInput] = useState('');
  const [simulatorChatId, setSimulatorChatId] = useState('1000001');
  const [simulatorMessages, setSimulatorMessages] = useState<Array<{ sender: 'user' | 'bot'; text: string; buttons?: string[] }>>([
    {
      sender: 'bot',
      text: 'سلام به ربات مفیدگیم خوش آمدید! برای شروع گزینه /start را ارسال کنید.',
      buttons: ['/start', '🎮 بازی جدید', '🏆 رتبه‌بندی لیگ', '📚 آزمون جامع']
    }
  ]);
  const [simLoading, setSimLoading] = useState(false);

  // Curriculum filters & Add question modal
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [filterSubject, setFilterSubject] = useState<string>('all');
  const [showAddQuestionModal, setShowAddQuestionModal] = useState(false);
  const [newQGrade, setNewQGrade] = useState<GradeLevel>('7');
  const [newQSubject, setNewQSubject] = useState('math_7');
  const [newQTopic, setNewQTopic] = useState('');
  const [newQText, setNewQText] = useState('');
  const [newQOpt1, setNewQOpt1] = useState('');
  const [newQOpt2, setNewQOpt2] = useState('');
  const [newQOpt3, setNewQOpt3] = useState('');
  const [newQOpt4, setNewQOpt4] = useState('');
  const [newQCorrect, setNewQCorrect] = useState('');
  const [newQExplanation, setNewQExplanation] = useState('');


  // Add Student modal
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [newStName, setNewStName] = useState('');
  const [newStGrade, setNewStGrade] = useState<GradeLevel>('7');
  const [newStClass, setNewStClass] = useState('هفتم ۱');
  const [newStChatId, setNewStChatId] = useState('');

  // Fetch all initial data
  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const [statusRes, studentsRes, questionsRes, adminsRes, resourcesRes] = await Promise.all([
        fetch('/api/status').then((r) => r.json()).catch(() => null),
        fetch('/api/students').then((r) => r.json()).catch(() => []),
        fetch('/api/questions').then((r) => r.json()).catch(() => []),
        fetch('/api/admins').then((r) => r.json()).catch(() => []),
        fetch('/api/resources').then((r) => r.json()).catch(() => []),
      ]);

      if (statusRes?.ok) {
        setStatus(statusRes.polling);
        setBaleConfig(statusRes.baleConfig || {});
        if (statusRes.baleConfig?.adminChatId) {
          setAdminChatIdInput(String(statusRes.baleConfig.adminChatId));
        }
        if (statusRes.baleConfig?.schoolInviteCode) {
          setSchoolCodeInput(statusRes.baleConfig.schoolInviteCode);
        }
        if (statusRes.polling?.timeWindow247) {
          const tw = statusRes.polling.timeWindow247;
          if (tw.startTime) setTwStartTime(tw.startTime);
          if (tw.endTime) setTwEndTime(tw.endTime);
          if (tw.durationDays) setTwDurationDays(tw.durationDays);
        }
      }

      if (Array.isArray(studentsRes)) setStudents(studentsRes);
      if (Array.isArray(questionsRes)) setQuestions(questionsRes);
      if (Array.isArray(adminsRes)) setAdmins(adminsRes);
      if (Array.isArray(resourcesRes)) setResources(resourcesRes);
      fetchBaleWebhookInfo();
    } catch (e) {
      console.error('[MofidGame] Failed to load data:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 20000);
    return () => clearInterval(interval);
  }, []);

  const handleTogglePolling = async () => {
    setIsTogglingPolling(true);
    try {
      if (status?.isActive) {
        await fetch('/api/bale/stop-polling', { method: 'POST' });
      } else {
        await fetch('/api/bale/start-polling', { method: 'POST' });
      }
      await loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setIsTogglingPolling(false);
    }
  };

  const handleSaveBaleConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigSaveMsg(null);
    try {
      const payload: any = {
        adminChatId: parseInt(adminChatIdInput || '1434129251', 10),
        schoolInviteCode: schoolCodeInput || 'MOFID-1405',
      };
      if (botTokenInput.trim()) {
        payload.token = botTokenInput.trim();
      }
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setConfigSaveMsg(data.message || 'تنظیمات با موفقیت ذخیره شدند.');
      setBotTokenInput('');
      await loadData();
    } catch (err: any) {
      setConfigSaveMsg(`خطا: ${err.message}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleSendSimulatorMessage = async (customText?: string) => {
    const textToSend = customText || simulatorInput;
    if (!textToSend.trim() || simLoading) return;

    setSimulatorMessages((prev) => [...prev, { sender: 'user', text: textToSend }]);
    setSimulatorInput('');
    setSimLoading(true);

    try {
      const res = await fetch('/api/bale/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: simulatorChatId,
          text: textToSend,
        }),
      });
      const data = await res.json();
      if (data?.responses && Array.isArray(data.responses)) {
        for (const resp of data.responses) {
          const btns: string[] = [];
          if (resp.reply_markup?.keyboard) {
            for (const row of resp.reply_markup.keyboard) {
              for (const b of row) {
                btns.push(typeof b === 'string' ? b : b.text);
              }
            }
          } else if (resp.reply_markup?.inline_keyboard) {
            for (const row of resp.reply_markup.inline_keyboard) {
              for (const b of row) {
                btns.push(b.text);
              }
            }
          }
          setSimulatorMessages((prev) => [
            ...prev,
            { sender: 'bot', text: resp.text || 'پاسخ دریافت شد.', buttons: btns.length ? btns : undefined }
          ]);
        }
      }
    } catch (e: any) {
      setSimulatorMessages((prev) => [
        ...prev,
        { sender: 'bot', text: `خطا در شبیه‌ساز: ${e.message}` }
      ]);
    } finally {
      setSimLoading(false);
    }
  };

  const handleAddQuestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newQText.trim() || !newQOpt1.trim()) return;
    try {
      const payload: Partial<Question> = {
        grade: newQGrade,
        subjectId: newQSubject,
        chapterId: `${newQSubject}_ch1`,
        topic: newQTopic.trim() || 'مبحث استاندارد',
        type: 'four_choice',
        difficulty: 'medium',
        questionText: newQText.trim(),
        options: [newQOpt1.trim(), newQOpt2.trim(), newQOpt3.trim(), newQOpt4.trim()].filter(Boolean),
        correctAnswer: newQCorrect.trim() || newQOpt1.trim(),
        explanation: newQExplanation.trim() || 'پاسخ با توجه به متن کتاب درسی.',
        status: 'approved',
        source: 'طراحی دبیرستان مفید',
      };
      await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setShowAddQuestionModal(false);
      setNewQText('');
      setNewQOpt1('');
      setNewQOpt2('');
      setNewQOpt3('');
      setNewQOpt4('');
      setNewQCorrect('');
      setNewQExplanation('');
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };


  const handleAddStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStName.trim() || !newStChatId.trim()) return;
    try {
      await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: newStName.trim(),
          grade: newStGrade,
          className: newStClass.trim(),
          baleChatId: newStChatId.trim(),
        }),
      });
      setShowAddStudentModal(false);
      setNewStName('');
      setNewStChatId('');
      await loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const filteredQuestions = questions.filter((q) => {
    if (filterGrade !== 'all' && q.grade !== filterGrade) return false;
    if (filterSubject !== 'all' && q.subjectId !== filterSubject) return false;
    return true;
  });

  const gamesList = [
    { id: 'duel', title: 'دوئل علمی همزمان', icon: '⚔️', desc: 'رقابت زنده دو نفره دانش‌آموزان در ۵ سؤال سرعتی و امتیازی' },
    { id: 'rapid', title: 'کوئیز سرعتی برق‌آسا', icon: '⚡', desc: '۱۰ سؤال ۴گزینه‌ای با تایمر ۲۰ ثانیه‌ای برای هر سؤال' },
    { id: 'leitner', title: 'جعبه لایتنر هوشمند', icon: '📦', desc: 'مرور فواصل منظم طبق منحنی فراموشی ابینگهاوس' },
    { id: 'league', title: 'لیگ هفتگی قهرمانان', icon: '🏆', desc: 'جدول رتبه‌بندی کلاسی و پایه‌ای با جوایز درون‌مدرسه‌ای' },
    { id: 'little_teacher', title: 'چالش معلم کوچک', icon: '🧑‍🏫', desc: 'ارسال صوت یا متن توضیح مبحث توسط دانش‌آموز و تحلیل هوش مصنوعی' },
    { id: 'formula_master', title: 'استاد فرمول‌ها', icon: '📐', desc: 'آزمون تخصصی فرمول‌های ریاضی و فیزیک علوم هفتم تا نهم' },
    { id: 'vocab_battle', title: 'نبرد واژگان انگلیسی و ادبیات', icon: '📖', desc: 'معنی لغات، املای کلمات و آرایه‌های ادبی' },
    { id: 'puzzle', title: 'معماهای تحلیلی هوش', icon: '🧩', desc: 'توسعه تفکر منطقی و مهارت‌های حل مسئله المپیادی' },
    { id: 'mock_exam', title: 'شبیه‌ساز آزمون جامع نوبت اول و دوم', icon: '📝', desc: 'سؤالات هماهنگ استانی و کشوری با کارنامه فوری' },
    { id: 'streak_run', title: 'ماراتن زنجیره استریک روزانه', icon: '🔥', desc: 'حفظ استریک روزانه و کسب نشان‌های افتخار برنزی تا الماس' },
    { id: 'escape_room', title: 'اتاق فرار آموزشی', icon: '🚪', desc: 'گشودن قفل مراحل با حل درست سؤالات مفهومی درس' },
    { id: 'class_clash', title: 'مسابقه کلاسی پایه‌ها', icon: '🏫', desc: 'رقابت میان کلاس‌های هفتم ۱، هفتم ۲ و پایه‌های هشتم و نهم' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        status={status}
        hasToken={!!baleConfig.token || !!(baleConfig as any)?.hasToken}
        onTogglePolling={handleTogglePolling}
        isToggling={isTogglingPolling}
        onRefresh={loadData}
        onOpenCopilot={() => setShowCopilotModal(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <DashboardTab
            status={status}
            students={students}
            questions={questions}
            admins={admins}
            onNavigateTab={setActiveTab}
            onOpenCopilot={() => setShowCopilotModal(true)}
          />
        )}

        {/* ADMINS TAB */}
        {activeTab === 'admins' && (
          <AdminPanelTab
            status={status}
            admins={admins}
            students={students}
            questions={questions}
            auditLogs={auditLogs}
            onRefresh={loadData}
            onDownloadBackup={() => {
              window.open('/api/database/backup', '_blank');
            }}
          />
        )}

        {/* BALE BOT TAB */}
        {activeTab === 'bale' && (
          <div className="space-y-6">
            <div className="p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border border-indigo-500/30">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                      <Bot className="w-6 h-6" />
                    </span>
                    <h2 className="text-xl font-black text-white">پیکربندی ربات بله و اتصال سرور اختصاصی شما</h2>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 max-w-xl">
                    تنظیم توکن، مدیریت وب‌هوک و هماهنگی اتصال سرور شخصی شما جهت دریافت پیام‌ها با وب‌هوک یا لانگ‌پولینگ.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                    status?.isActive ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                  }`}>
                    <span className={`w-2.5 h-2.5 rounded-full ${status?.isActive ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                    {status?.isActive
                      ? (baleConfig.useWebhook ? '🟢 وب‌هوک سرور اختصاصی متصل است' : '🟢 دریافت داخلی پیام‌ها فعال است')
                      : 'دریافت داخلی پیام‌ها متوقف است'}
                  </span>
                  <button
                    onClick={handleTogglePolling}
                    disabled={isTogglingPolling}
                    className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                      status?.isActive ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {status?.isActive ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    <span>{status?.isActive ? 'توقف دریافت داخلی (آزاد شدن برای سرور شما)' : 'شروع دریافت داخلی'}</span>
                  </button>
                </div>
              </div>

              {/* Bot stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-indigo-500/20">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <p className="text-[11px] text-slate-400">نام کاربری ربات</p>
                  <p className="text-sm font-bold text-white mt-0.5">{baleConfig.botUsername ? `@${baleConfig.botUsername}` : '@mofidgamebot'}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <p className="text-[11px] text-slate-400">شناسه مدیر ارشد</p>
                  <p className="text-sm font-bold text-indigo-400 mt-0.5">{baleConfig.adminChatId || 1434129251}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <p className="text-[11px] text-slate-400">کد دعوت مدرسه</p>
                  <p className="text-sm font-bold text-amber-400 mt-0.5">{baleConfig.schoolInviteCode || 'MOFID-1405'}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <p className="text-[11px] text-slate-400">پیام‌های پردازش‌شده</p>
                  <p className="text-sm font-bold text-emerald-400 mt-0.5">{status?.totalUpdatesProcessed || 0} پیام</p>
                </div>
              </div>
            </div>

            {/* 00:00 to 24:00 (1-Year Moment-to-Moment Mode) Card */}
            <div className="p-6 rounded-3xl bg-gradient-to-br from-emerald-950/70 via-slate-900 to-indigo-950/70 border-2 border-emerald-500/50 shadow-2xl space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className={`p-3 rounded-2xl border ${
                    status?.timeWindow247?.enabled
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-lg shadow-emerald-500/20'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    <Clock className={`w-7 h-7 ${status?.timeWindow247?.enabled ? 'animate-pulse' : ''}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-black text-white">
                        فعالیت لحظه‌به‌لحظه در بازه ۰۰:۰۰ تا ۲۴:۰۰ (اشتراک ۱ ساله)
                      </h3>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black border ${
                        status?.timeWindow247?.enabled
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {status?.timeWindow247?.enabled ? '🟢 فعال لحظه‌به‌لحظه (۳۶۵ روز)' : '⚪ غیرفعال'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
                      با فعال‌سازی این حالت، ربات بله در کل بازه ۲۴ ساعته (۰۰:۰۰ تا ۲۴:۰۰) بدون وقفه، لحظه‌به‌لحظه فعال بوده و پیام‌ها را پردازش می‌کند.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleTimeWindow(!status?.timeWindow247?.enabled)}
                    disabled={isTogglingTimeWindow}
                    className={`px-5 py-2.5 rounded-xl font-black text-xs transition cursor-pointer flex items-center gap-2 shadow-lg ${
                      status?.timeWindow247?.enabled
                        ? 'bg-rose-600/30 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                    }`}
                  >
                    <RefreshCw className={`w-4 h-4 ${isTogglingTimeWindow ? 'animate-spin' : ''}`} />
                    <span>
                      {status?.timeWindow247?.enabled
                        ? 'توقف موقت حالت ۲۴ ساعته'
                        : '⚡ فعال‌سازی حالت ۲۴ ساعته (۰۰:۰۰ تا ۲۴:۰۰ به مدت ۱ سال)'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Status & Stats Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">بازه زمانی فعال</span>
                  <span className="text-sm font-black text-emerald-400 mt-0.5 block font-mono">
                    {twStartTime} تا {twEndTime}
                  </span>
                  <span className="text-[10px] text-slate-500">۲۴ ساعت شبانه‌روز</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">مدت زمان اعتبار</span>
                  <span className="text-sm font-black text-amber-400 mt-0.5 block">
                    {status?.daysRemaining ?? twDurationDays} روز باقی‌مانده
                  </span>
                  <span className="text-[10px] text-slate-500">دوره ۱ ساله (۳۶۵ روز کامل)</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">سرعت واکنش ربات</span>
                  <span className="text-sm font-black text-sky-400 mt-0.5 block">
                    لحظه‌به‌لحظه (Zero-Delay)
                  </span>
                  <span className="text-[10px] text-slate-500">پاسخ سریع به پیام‌های بله</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">دیده‌بان احیا (Watchdog)</span>
                  <span className="text-sm font-black text-indigo-300 mt-0.5 block">
                    پیوسته فعال
                  </span>
                  <span className="text-[10px] text-slate-500">جلوگیری خودکار از قطعی</span>
                </div>
              </div>

              {/* Time Range Customizer Form */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    تنظیم ساعات بازه فعال بودن ربات:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTwStartTime('00:00');
                      setTwEndTime('24:00');
                      handleToggleTimeWindow(true);
                    }}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold underline cursor-pointer"
                  >
                    تنظیم سریع روی ۲۴ ساعته کامل (۰۰:۰۰ تا ۲۴:۰۰)
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">ساعت شروع بازه:</label>
                    <input
                      type="text"
                      value={twStartTime}
                      onChange={(e) => setTwStartTime(e.target.value)}
                      placeholder="00:00"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">ساعت پایان بازه:</label>
                    <input
                      type="text"
                      value={twEndTime}
                      onChange={(e) => setTwEndTime(e.target.value)}
                      placeholder="24:00"
                      className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono text-center"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => handleToggleTimeWindow(true)}
                      disabled={isTogglingTimeWindow}
                      className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition cursor-pointer"
                    >
                      ذخیره و اعمال بازه
                    </button>
                  </div>
                </div>
                {twMessage && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                    {twMessage}
                  </div>
                )}
              </div>
            </div>

            {/* Zero-Stoppage & Unbreakable Server Shield Card */}
            <div className="p-6 rounded-3xl bg-slate-900/90 border border-indigo-500/40 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-white flex items-center gap-2">
                      سپر پایداری و عملکرد دائم بدون توقف در سرور
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        ۱۰۰٪ بدون قطعی (Zero-Downtime)
                      </span>
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      موتور Long Polling به همراه سگ نگهبان ۱.۵ ثانیه‌ای، بازیابی سوکت‌های معلق و جلوگیری از هرگونه توقف یا خواب سرور
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleEnsureActive}
                  disabled={isEnsuringActive}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition flex items-center gap-2 shadow-lg shadow-indigo-600/20 cursor-pointer shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isEnsuringActive ? 'animate-spin' : ''}`} />
                  <span>{isEnsuringActive ? 'در حال بررسی...' : 'بررسی و تثبیت پایداری اتصال'}</span>
                </button>
              </div>

              {ensureActiveMsg && (
                <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{ensureActiveMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">ضد قطعی (Anti-Crash)</span>
                  <span className="text-xs font-bold text-emerald-400 mt-0.5 block flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block"></span>
                    فعال و محافظت‌شده
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">تعداد پالس نگهدارنده (Heartbeat)</span>
                  <span className="text-xs font-bold text-sky-400 mt-0.5 block font-mono">
                    {status?.watchdogHeartbeatCount || 0} پالس
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">بازیابی‌های خودکار (Auto-Revives)</span>
                  <span className="text-xs font-bold text-amber-400 mt-0.5 block font-mono">
                    {status?.autoRecoveryCount || 0} مورد
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">پینگ‌های هوشیاری (Keep-Alive)</span>
                  <span className="text-xs font-bold text-indigo-300 mt-0.5 block font-mono">
                    {status?.keepalivePings || 0} پینگ
                  </span>
                </div>
              </div>
            </div>

            {/* Token Form */}
            <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                تنظیمات اتصال و توکن BotFather بله
              </h3>
              <form onSubmit={handleSaveBaleConfig} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3">
                  <label className="block text-xs text-slate-300 mb-1">توکن ربات بله (از BotFather@):</label>
                  <input
                    type="password"
                    value={botTokenInput}
                    onChange={(e) => setBotTokenInput(e.target.value)}
                    placeholder={baleConfig.token || (baleConfig as any)?.hasToken ? '•••••••••••••••••••••••• (توکن فعال ذخیره است)' : 'مثال: 1137470430:evmdX1quk7mKJh4Q74TMHinOzi_ZoDplhWM'}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">شناسه عددی چت مدیر (Chat ID):</label>
                  <input
                    type="text"
                    value={adminChatIdInput}
                    onChange={(e) => setAdminChatIdInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">کد اختصاصی مدرسه مفید:</label>
                  <input
                    type="text"
                    value={schoolCodeInput}
                    onChange={(e) => setSchoolCodeInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={isSavingConfig}
                    className="w-full px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition"
                  >
                    {isSavingConfig ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
                  </button>
                </div>
              </form>
              {configSaveMsg && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                  {configSaveMsg}
                </div>
              )}
            </div>

            {/* Custom Server Webhook Setup Card */}
            <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-indigo-400" />
                    اتصال وب‌هوک (Webhook) به سرور شخصی شما
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      baleWebhookInfo?.url
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    }`}>
                      {baleWebhookInfo?.url ? '🟢 وب‌هوک سرور شما فعال' : '🟡 وب‌هوک تنظیم نشده'}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    نشانی سرور شخصی خودتان را در کادر زیر وارد کنید تا بله تمام پیام‌های بات را به سرور شما ارسال کند.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchBaleWebhookInfo}
                  disabled={baleWebhookLoading}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${baleWebhookLoading ? 'animate-spin' : ''}`} />
                  <span>استعلام وضعیت از بله</span>
                </button>
              </div>

              {baleWebhookInfo && (
                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono space-y-1.5 text-slate-300">
                  <div className="flex items-center justify-between flex-wrap">
                    <span className="text-slate-400">آدرس وب‌هوک فعلی در بله:</span>
                    <span className="text-indigo-300 font-bold">{baleWebhookInfo.url || 'ثبت نشده (وب‌هوک غیرفعال است)'}</span>
                  </div>
                  {baleWebhookInfo.pending_update_count !== undefined && (
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>پیام‌های در صف: {baleWebhookInfo.pending_update_count}</span>
                      <span>خطای اخیر بله: {baleWebhookInfo.last_error_message || 'ندارد'}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <label className="block text-xs text-slate-300">
                  نشانی وب‌هوک سرور شخصی شما (Webhook URL):
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={baleWebhookUrl}
                    onChange={(e) => setBaleWebhookUrl(e.target.value)}
                    placeholder="https://your-server.com/api/bale/webhook"
                    className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleSetBaleWebhook}
                    disabled={baleWebhookLoading || !baleWebhookUrl.trim()}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer"
                  >
                    ثبت وب‌هوک سرور شما
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteBaleWebhook}
                    disabled={baleWebhookLoading}
                    className="px-4 py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-bold text-xs transition cursor-pointer"
                  >
                    حذف وب‌هوک
                  </button>
                </div>
                {baleWebhookMsg && (
                  <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs">
                    {baleWebhookMsg}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SIMULATOR TAB */}
        {activeTab === 'simulator' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 p-6 rounded-3xl bg-slate-900 border border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <MessageSquareCode className="w-4 h-4 text-emerald-400" />
                کنترل پنل شبیه‌ساز دانش‌آموز
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                شبیه‌سازی ارتباط دانش‌آموز با ربات بدون نیاز به باز کردن پیام‌رسان بله روی گوشی.
              </p>
              <div>
                <label className="block text-xs text-slate-400 mb-1">شناسه چت آزمایشی (Chat ID):</label>
                <input
                  type="text"
                  value={simulatorChatId}
                  onChange={(e) => setSimulatorChatId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono"
                />
              </div>
              <div className="pt-2">
                <p className="text-xs font-semibold text-slate-300 mb-2">دستورات سریع:</p>
                <div className="flex flex-wrap gap-1.5">
                  {['/start', '🎮 بازی جدید', '🏆 رتبه‌بندی لیگ', '📚 آزمون هفتم', '📦 جعبه لایتنر', '📊 کارنامه من'].map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => handleSendSimulatorMessage(cmd)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 transition"
                    >
                      {cmd}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="md:col-span-2 p-6 rounded-3xl bg-slate-900 border border-slate-800 flex flex-col h-[560px]">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-white">صفحه چت شبیه‌ساز زنده بله</span>
                </div>
                <button
                  onClick={() => setSimulatorMessages([])}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  پاک کردن گفتگو
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4 space-y-3">
                {simulatorMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-emerald-600 text-white rounded-br-none shadow-md'
                          : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-none shadow-sm whitespace-pre-wrap'
                      }`}
                    >
                      {msg.text}
                    </div>
                    {msg.buttons && (
                      <div className="flex flex-wrap gap-1.5 mt-2 max-w-[85%]">
                        {msg.buttons.map((btn, bIdx) => (
                          <button
                            key={bIdx}
                            onClick={() => handleSendSimulatorMessage(btn)}
                            className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-emerald-600 text-[11px] text-emerald-300 hover:text-white border border-slate-700 transition"
                          >
                            {btn}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  value={simulatorInput}
                  onChange={(e) => setSimulatorInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendSimulatorMessage()}
                  placeholder="پیام یا دستور خود را بنویسید (مثلاً: /start یا /rank)..."
                  className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                />
                <button
                  onClick={() => handleSendSimulatorMessage()}
                  disabled={simLoading}
                  className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* GAMES TAB */}
        {activeTab === 'games' && (
          <div className="space-y-6">
            <div className="p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 border border-indigo-500/30">
              <div className="flex items-center gap-3">
                <span className="p-3 rounded-2xl bg-amber-500/20 text-amber-400">
                  <Gamepad2 className="w-7 h-7" />
                </span>
                <div>
                  <h2 className="text-xl font-black text-white">۱۲ بازی و رویداد یادگیری بازیمحور مفیدگیم</h2>
                  <p className="text-xs text-slate-300 mt-0.5">
                    طراحی‌شده بر پایه نظریه گیمیفیکیشن آموزشی، ارتقای درگیری ذهنی و تقویت مهارت‌های تحصیلی
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {gamesList.map((g) => (
                <div
                  key={g.id}
                  className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-amber-500/40 transition space-y-2 group"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl p-2 rounded-xl bg-slate-800 group-hover:bg-amber-500/20 transition">
                      {g.icon}
                    </span>
                    <h3 className="text-sm font-bold text-white">{g.title}</h3>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{g.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CURRICULUM & QUESTIONS TAB */}
        {activeTab === 'curriculum' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-900 border border-slate-800">
              <div>
                <h2 className="text-lg font-black text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-indigo-400" />
                  بانک سؤالات و سرفصل‌های درسی (هفتم، هشتم، نهم)
                </h2>
                <p className="text-xs text-slate-300 mt-1">
                  مجموع {questions.length} سؤال تاییدشده منطبق بر کتب درسی سال تحصیلی ۱۴۰۵–۱۴۰۶
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={filterGrade}
                  onChange={(e) => setFilterGrade(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                >
                  <option value="all">همه پایه‌ها</option>
                  <option value="7">پایه هفتم</option>
                  <option value="8">پایه هشتم</option>
                  <option value="9">پایه نهم</option>
                </select>
                <button
                  onClick={() => setShowAddQuestionModal(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>طراحی سؤال دستی</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredQuestions.map((q) => (
                <div key={q.id} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300 text-[11px] font-bold">
                        پایه {q.grade}
                      </span>
                      <span className="text-xs text-slate-400">{q.topic}</span>
                    </div>
                    <span className="text-[11px] text-emerald-400 font-semibold">{q.difficulty === 'easy' ? 'آسان' : q.difficulty === 'hard' ? 'دشوار' : 'متوسط'}</span>
                  </div>
                  <p className="text-xs sm:text-sm font-semibold text-white leading-relaxed">{q.questionText}</p>
                  {q.options && (
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      {q.options.map((opt, oIdx) => (
                        <div
                          key={oIdx}
                          className={`p-2 rounded-xl text-xs border ${
                            opt === q.correctAnswer
                              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300 font-bold'
                              : 'bg-slate-950 border-slate-800 text-slate-400'
                          }`}
                        >
                          {opt}
                        </div>
                      ))}
                    </div>
                  )}
                  {q.explanation && (
                    <p className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                      💡 پاسخ تشریحی: {q.explanation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STUDENTS TAB */}
        {activeTab === 'students' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-slate-900 border border-slate-800">
              <div>
                <h2 className="text-lg font-black text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-400" />
                  مدیریت و لیست دانش‌آموزان دبیرستان مفید
                </h2>
                <p className="text-xs text-slate-300 mt-1">
                  تعداد {students.length} دانش‌آموز در پایه‌های هفتم، هشتم و نهم
                </p>
              </div>
              <button
                onClick={() => setShowAddStudentModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition"
              >
                <Plus className="w-4 h-4" />
                <span>افزودن دانش‌آموز</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
              <table className="w-full text-right text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-3.5">نام دانش‌آموز</th>
                    <th className="p-3.5">پایه و کلاس</th>
                    <th className="p-3.5">شناسه بله (Chat ID)</th>
                    <th className="p-3.5">امتیاز لیگ</th>
                    <th className="p-3.5">سطح و مدال</th>
                    <th className="p-3.5">وضعیت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {students.map((st) => (
                    <tr key={st.id} className="hover:bg-slate-850 transition">
                      <td className="p-3.5 font-bold text-white">{st.fullName}</td>
                      <td className="p-3.5">پایه {st.grade} ({st.className})</td>
                      <td className="p-3.5 font-mono text-indigo-300">{st.baleChatId}</td>
                      <td className="p-3.5 font-bold text-amber-400">{st.leaguePoints} امتیاز</td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                          {st.tier}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                          فعال و تاییدشده
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* RESOURCES & EXPORT TAB */}
        {activeTab === 'resources' && (
          <div className="space-y-6">
            <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-black text-white flex items-center gap-2">
                    <GraduationCap className="w-5 h-5 text-emerald-400" />
                    منابع رسمی، صادرات سورس و پشتیبان‌گیری
                  </h2>
                  <p className="text-xs text-slate-300 mt-1 max-w-xl">
                    دانلود کامل سورس‌کد پروژه در قالب فایل زیپ (ZIP)، پشتیبان کامل دیتابیس JSON و پیوند کتب درسی رسمی آموزش و پرورش.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href="/api/download/project-export"
                    download="mofidgame-project-export.zip"
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 transition"
                  >
                    <Download className="w-4 h-4" />
                    <span>📦 دانلود فایل زیپ کل پروژه (Export ZIP)</span>
                  </a>
                  <a
                    href="/api/database/backup"
                    download="mofidgame_db_backup.json"
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition"
                  >
                    <Download className="w-4 h-4" />
                    <span>دانلود بک‌آپ دیتابیس</span>
                  </a>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {resources.map((res) => (
                <div key={res.id} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-[11px] font-bold">
                      پایه {res.grade}
                    </span>
                    <span className="text-[10px] text-slate-400">{res.officialSource}</span>
                  </div>
                  <h3 className="text-sm font-bold text-white">{res.title}</h3>
                  <p className="text-xs text-slate-400">{res.description}</p>
                  <a
                    href={res.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-bold"
                  >
                    <span>مشاهده منبع رسمی در chap.sch.ir</span>
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>


      {/* Add Question Modal */}
      {showAddQuestionModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">طراحی و افزودن سؤال ۴گزینه‌ای جدید</h4>
              <button onClick={() => setShowAddQuestionModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddQuestionSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">پایه تحصیلی:</label>
                  <select
                    value={newQGrade}
                    onChange={(e) => {
                      setNewQGrade(e.target.value as GradeLevel);
                      setNewQSubject(`math_${e.target.value}`);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  >
                    <option value="7">پایه هفتم</option>
                    <option value="8">پایه هشتم</option>
                    <option value="9">پایه نهم</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">درس:</label>
                  <select
                    value={newQSubject}
                    onChange={(e) => setNewQSubject(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  >
                    <option value={`math_${newQGrade}`}>ریاضی پایه {newQGrade}</option>
                    <option value={`science_${newQGrade}`}>علوم تجربی پایه {newQGrade}</option>
                    <option value={`persian_${newQGrade}`}>ادبیات فارسی پایه {newQGrade}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">مبحث / فصل:</label>
                <input
                  type="text"
                  value={newQTopic}
                  onChange={(e) => setNewQTopic(e.target.value)}
                  placeholder="مثال: هندسه و استدلال"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">متن صورت سؤال:</label>
                <textarea
                  value={newQText}
                  onChange={(e) => setNewQText(e.target.value)}
                  placeholder="صورت دقیق سؤال را وارد کنید..."
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newQOpt1}
                  onChange={(e) => setNewQOpt1(e.target.value)}
                  placeholder="گزینه ۱ (پاسخ صحیح)"
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-emerald-500/40 text-xs text-white"
                  required
                />
                <input
                  type="text"
                  value={newQOpt2}
                  onChange={(e) => setNewQOpt2(e.target.value)}
                  placeholder="گزینه ۲"
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  required
                />
                <input
                  type="text"
                  value={newQOpt3}
                  onChange={(e) => setNewQOpt3(e.target.value)}
                  placeholder="گزینه ۳"
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  required
                />
                <input
                  type="text"
                  value={newQOpt4}
                  onChange={(e) => setNewQOpt4(e.target.value)}
                  placeholder="گزینه ۴"
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">پاسخ تشریحی (راهنما):</label>
                <input
                  type="text"
                  value={newQExplanation}
                  onChange={(e) => setNewQExplanation(e.target.value)}
                  placeholder="توضیح کوتاه چرایی درستی گزینه..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddQuestionModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                >
                  ذخیره سؤال در بانک
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-6 max-w-md w-full space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">افزودن دانش‌آموز جدید</h4>
              <button onClick={() => setShowAddStudentModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddStudentSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">نام و نام خانوادگی:</label>
                <input
                  type="text"
                  value={newStName}
                  onChange={(e) => setNewStName(e.target.value)}
                  placeholder="مثال: پارسا صادقی"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">پایه:</label>
                  <select
                    value={newStGrade}
                    onChange={(e) => setNewStGrade(e.target.value as GradeLevel)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  >
                    <option value="7">هفتم</option>
                    <option value="8">هشتم</option>
                    <option value="9">نهم</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">کلاس:</label>
                  <input
                    type="text"
                    value={newStClass}
                    onChange={(e) => setNewStClass(e.target.value)}
                    placeholder="مثال: هفتم ۲"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">شناسه عددی بله (Chat ID):</label>
                <input
                  type="text"
                  value={newStChatId}
                  onChange={(e) => setNewStChatId(e.target.value)}
                  placeholder="مثال: 123456789"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white font-mono"
                  required
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold"
                >
                  ثبت دانش‌آموز
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
