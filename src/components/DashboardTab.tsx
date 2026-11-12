import React from 'react';
import {
  Activity,
  Bot,
  Flame,
  Gamepad2,
  GraduationCap,
  Layers,
  Radio,
  Server,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users
} from 'lucide-react';
import { AdminUser, PollingStatus, Question, Student } from '../types/index.ts';

interface DashboardTabProps {
  status: PollingStatus | null;
  students: Student[];
  questions: Question[];
  admins: AdminUser[];
  onNavigateTab: (tab: string) => void;
  onOpenCopilot: () => void;
}

export const DashboardTab: React.FC<DashboardTabProps> = ({
  status,
  students,
  questions,
  admins,
  onNavigateTab,
  onOpenCopilot,
}) => {
  const isOnline = status?.isActive;
  const topStudents = [...students].sort((a, b) => b.leaguePoints - a.leaguePoints).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Hero Welcome Card */}
      <div className="relative overflow-hidden p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-emerald-950/80 via-slate-900 to-indigo-950/80 border border-emerald-500/30 shadow-2xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold">
              <span>🛡️ سامانه رسمی دبیرستان مفید یادگار امام</span>
              <span>•</span>
              <span>سال تحصیلی ۱۴۰۵–۱۴۰۶</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              سامانه بازیمحور آموزشی و ربات پیام‌رسان بله
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              مرکز یکپارچه یادگیری، برگزاری دوئل‌های علمی، لیگ هفتگی، کوئیزهای مستمر و بانک سؤالات استاندارد وزارت آموزش و پرورش برای پایه‌های هفتم، هشتم و نهم با مدیریت دائم ۲۴ساعته ابری.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <button
              onClick={() => onNavigateTab('bale')}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/25 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Bot className="w-4 h-4" />
              <span>مدیریت ربات بله</span>
            </button>
            <button
              onClick={onOpenCopilot}
              className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-lg shadow-purple-600/25 transition cursor-pointer flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>دستیار هوشمند مدیر</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">وضعیت ربات بله</span>
            <span className={`p-1.5 rounded-lg ${isOnline ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
              <Radio className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-black text-white">{isOnline ? 'آنلاین و فعال' : 'متوقف'}</p>
          <span className="text-[11px] text-emerald-400">🟢 متصل به پیام‌رسان بله</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">دانش‌آموزان فعال</span>
            <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Users className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-black text-white">{students.length} نفر</p>
          <span className="text-[11px] text-indigo-400">پایه‌های هفتم، هشتم و نهم</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">بانک سؤالات مدرسه</span>
            <span className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
              <Layers className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-black text-white">{questions.length} سؤال</p>
          <span className="text-[11px] text-amber-400">تأییدشده توسط دبیران</span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">پایگاه داده ابری</span>
            <span className="p-1.5 rounded-lg bg-orange-500/20 text-orange-400">
              <Flame className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl font-black text-white">Firebase</p>
          <span className="text-[11px] text-emerald-400">🟢 Cloud Firestore فعال</span>
        </div>
      </div>

      {/* League Leaderboard & Quick Access */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top 5 League Students */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>برترین‌های لیگ هفتگی مفیدگیم</span>
            </h3>
            <button
              onClick={() => onNavigateTab('students')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium transition cursor-pointer"
            >
              مشاهده تمام دانش‌آموزان →
            </button>
          </div>

          <div className="divide-y divide-slate-800">
            {topStudents.map((st, idx) => (
              <div key={st.id} className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs ${
                    idx === 0 ? 'bg-amber-500 text-slate-950' : idx === 1 ? 'bg-slate-300 text-slate-950' : idx === 2 ? 'bg-amber-700 text-white' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {idx + 1}
                  </span>
                  <div>
                    <p className="text-xs font-bold text-white">{st.fullName}</p>
                    <p className="text-[10px] text-slate-400">پایه {st.grade}م • {st.className}</p>
                  </div>
                </div>
                <div className="text-left">
                  <span className="text-xs font-black text-amber-400">{st.leaguePoints}</span>
                  <span className="text-[10px] text-slate-500 block">امتیاز لیگ</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Tools */}
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Gamepad2 className="w-4 h-4 text-indigo-400" />
            <span>دسترسی سریع</span>
          </h3>
          <div className="space-y-2">
            <button
              onClick={() => onNavigateTab('games')}
              className="w-full text-right p-3 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-xs font-semibold text-slate-200 transition cursor-pointer flex items-center justify-between"
            >
              <span>🎮 ۱۲ بازی آموزشی و دوئل علمی</span>
              <span className="text-slate-500">←</span>
            </button>
            <button
              onClick={() => onNavigateTab('curriculum')}
              className="w-full text-right p-3 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-xs font-semibold text-slate-200 transition cursor-pointer flex items-center justify-between"
            >
              <span>📚 سرفصل‌ها و بانک سؤالات درسی</span>
              <span className="text-slate-500">←</span>
            </button>
            <button
              onClick={() => onNavigateTab('simulator')}
              className="w-full text-right p-3 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-xs font-semibold text-slate-200 transition cursor-pointer flex items-center justify-between"
            >
              <span>💬 شبیه‌ساز زنده ربات بله</span>
              <span className="text-slate-500">←</span>
            </button>
            <button
              onClick={() => onNavigateTab('admins')}
              className="w-full text-right p-3 rounded-xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 text-xs font-semibold text-slate-200 transition cursor-pointer flex items-center justify-between"
            >
              <span>👑 پنل مدیریت و سرور</span>
              <span className="text-slate-500">←</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
