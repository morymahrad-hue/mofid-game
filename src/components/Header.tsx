import React from 'react';
import {
  Activity,
  Bot,
  Download,
  Gamepad2,
  GraduationCap,
  Layers,
  MessageSquareCode,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users
} from 'lucide-react';
import { PollingStatus } from '../types/index.ts';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  status: PollingStatus | null;
  hasToken: boolean;
  onTogglePolling: () => void;
  isToggling: boolean;
  onRefresh: () => void;
  onOpenCopilot: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  status,
  hasToken,
  onTogglePolling,
  isToggling,
  onRefresh,
  onOpenCopilot,
}) => {
  const isPollingOnline = status?.isActive;

  const tabs = [
    { id: 'dashboard', label: 'داشبورد', icon: Activity },
    { id: 'admins', label: '👑 پنل مدیریت و سرور', icon: ShieldCheck },
    { id: 'bale', label: 'ربات بله و سرور اختصاصی', icon: Bot },
    { id: 'simulator', label: 'شبیه‌ساز زنده بله', icon: MessageSquareCode },
    { id: 'games', label: '۱۲ بازی آموزشی و لیگ', icon: Gamepad2 },
    { id: 'curriculum', label: 'بانک دروس و سؤالات', icon: Layers },
    { id: 'students', label: 'مدیریت دانش‌آموزان', icon: Users },
    { id: 'resources', label: 'منابع رسمی و تنظیمات', icon: GraduationCap },
  ];

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        {/* Top Brand Bar */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-amber-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-black text-xl">
              MG
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-white tracking-tight">
                  مفیدگیم <span className="text-emerald-400 text-sm font-semibold">| مدرسه مفید یادگار امام</span>
                </h1>
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  ۱۴۰۵–۱۴۰۶
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">
                «بازی کن، یاد بگیر، مسلط شو!» • ربات هوشمند پیام‌رسان بله (متوسطه اول: هفتم، هشتم، نهم)
              </p>
            </div>
          </div>

          {/* Quick Status Pill & Actions */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {/* Polling Status Button */}
            <button
              onClick={onTogglePolling}
              disabled={isToggling || !hasToken}
              title={hasToken ? 'کلیک برای تغییر وضعیت سرویس پولینگ بله' : 'ابتدا توکن بله را در تنظیمات وارد کنید'}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                isPollingOnline
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/50 shadow-sm shadow-emerald-900/30'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-300 hover:bg-rose-900/50'
              } ${!hasToken ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span className="relative flex h-2.5 w-2.5">
                {isPollingOnline && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isPollingOnline ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
              ></span>
            </span>
            <span>
              {isPollingOnline
                ? status?.timeWindow247?.enabled
                  ? '۲۴ ساعته فعال (لحظه‌به‌لحظه)'
                  : status?.lastPollTimestamp?.includes('وب‌هوک')
                  ? 'وب‌هوک متصل است'
                  : 'دریافت پیام‌ها فعال'
                : 'بات متوقف'}
            </span>
            <Radio className="w-3.5 h-3.5 opacity-70" />
            </button>

            {status?.timeWindow247?.enabled && (
              <div
                title="حالت آماده‌باش لحظه‌به‌لحظه در بازه ۰۰:۰۰ تا ۲۴:۰۰ به مدت ۱ سال فعال است"
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-bold"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>بازه ۰۰:۰۰ تا ۲۴:۰۰ (۱ ساله)</span>
              </div>
            )}

            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              title="بروزرسانی داده‌ها"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {/* Admin AI Copilot Trigger */}
            <button
              onClick={onOpenCopilot}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-purple-500/20 transition cursor-pointer"
              title="دستیار هوش مصنوعی مدیر ارشد برای اجرای دستورات در بات و پایگاه داده"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>دستیار هوشمند مدیر</span>
            </button>

            {/* Export Project ZIP */}
            <a
              href="/api/download/project-export"
              download="mofidgame-project-export.zip"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer"
              title="دانلود کل فایل‌های پروژه و سورس کد به صورت ZIP"
            >
              <Download className="w-3.5 h-3.5" />
              <span>خروجی ZIP پروژه</span>
            </a>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex items-center gap-1 mt-4 overflow-x-auto pb-1 scrollbar-none border-t border-slate-800/80 pt-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
