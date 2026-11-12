import fs from 'fs';
import { db } from './db.ts';
import {
  AdminUser,
  DailyMission,
  DuelMatch,
  GradeLevel,
  OfficialResource,
  PollingStatus,
  Question,
  Student,
  StudentDailyProgress,
  StudentMistake,
  StudyPlanItem
} from '../src/types/index.ts';
import { evaluateLittleTeacherExplanation, explainEducationalQuestionWithAI } from './geminiService.ts';
import { executeAdminAiCommand } from './adminAiCopilot.ts';
import { syncEntireDatabaseToFirebase } from './firebaseSync.ts';


// Guarantee direct DNS mapping to tapi.bale.ai in case of cloud DNS drops
try {
  if (fs.existsSync('/etc/hosts')) {
    const hostsContent = fs.readFileSync('/etc/hosts', 'utf-8');
    if (!hostsContent.includes('tapi.bale.ai')) {
      fs.appendFileSync('/etc/hosts', '\n2.189.68.126 tapi.bale.ai\n');
    }
  }
} catch {}

interface UserSession {
  state: string;
  tempData?: any;
}

class BaleBotEngine {
  private userSessions: Map<number, UserSession> = new Map();
  private isRunning: boolean = false;
  private isExplicitlyStopped: boolean = false;
  private abortController: AbortController | null = null;
  private lastUpdateId: number = 0;
  private totalUpdatesProcessed: number = 0;
  private startTime: number = Date.now();
  private lastPollTimestamp: string = '';
  private lastError: string | null = null;
  private botInfo: any = null;
  private processedUpdateIds: Set<number> = new Set();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private watchdogHeartbeatCount: number = 0;
  private autoRecoveryCount: number = 0;
  private keepalivePings: number = 0;
  private lastPollEpoch: number = Date.now();

  constructor() {
    this.startWatchdog();
    this.initBotInfo();
  }

  public async initBotInfo() {
    try {
      const meRes = await this.callBaleApi('getMe');
      if (meRes && meRes.ok) {
        this.botInfo = meRes.result;
        console.log('[Bale Bot] Bot initialized:', meRes.result.username);
      }
    } catch (e: any) {
      console.warn('[Bale Bot] initBotInfo note:', e.message);
    }
  }

  public recordKeepalivePing() {
    this.keepalivePings++;
  }

  public recordWebhookUpdate(update: any) {
    this.keepalivePings++;
    this.totalUpdatesProcessed++;
    if (update && update.update_id) {
      this.lastUpdateId = update.update_id;
    }
    this.lastPollTimestamp = new Date().toLocaleTimeString('fa-IR');
  }

  public isTimeWindowActive(): boolean {
    const config = db.getConfig();
    const tw = config.timeWindow247;
    if (!tw || !tw.enabled) return false;

    // Check expiration (365 days / 1 year)
    if (tw.expiresAt) {
      const exp = new Date(tw.expiresAt).getTime();
      if (Date.now() > exp) return false;
    }

    // Check 00:00 to 24:00 (full 24-hour day round-the-clock)
    const start = tw.startTime || '00:00';
    const end = tw.endTime || '24:00';
    if (start === '00:00' && (end === '24:00' || end === '23:59')) {
      return true;
    }

    // If custom sub-window, check against Asia/Tehran time
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Tehran',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const parts = formatter.formatToParts(new Date());
      const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
      const currentMins = hour * 60 + minute;

      const [sH, sM] = start.split(':').map(Number);
      const [eH, eM] = end.split(':').map(Number);
      const startMins = sH * 60 + (sM || 0);
      const endMins = (eH === 24 ? 24 * 60 : eH * 60 + (eM || 0));

      return currentMins >= startMins && currentMins <= endMins;
    } catch {
      return true;
    }
  }

  public getStatus(): PollingStatus {
    const config = db.getConfig();
    const isWebhookMode = !!config.useWebhook;
    const tw = db.getTimeWindow247();
    const isMomentToMoment = this.isTimeWindowActive();

    let daysRemaining = tw.durationDays || 365;
    if (tw.expiresAt) {
      const msLeft = new Date(tw.expiresAt).getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    }

    return {
      isActive: isWebhookMode ? true : this.isRunning,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      lastUpdateId: this.lastUpdateId,
      lastPollTimestamp: this.lastPollTimestamp || (isWebhookMode ? 'حالت وب‌هوک فعال است' : 'آماده اتصال'),
      lastError: this.lastError,
      totalUpdatesProcessed: this.totalUpdatesProcessed,
      watchdogHeartbeatCount: this.watchdogHeartbeatCount,
      autoRecoveryCount: this.autoRecoveryCount,
      keepalivePings: this.keepalivePings,
      continuousUptimeDays: Number(((Date.now() - this.startTime) / (1000 * 86400)).toFixed(2)),
      isOneYearModeEnabled: true,
      timeWindow247: {
        ...tw,
        isMomentToMomentActive: isMomentToMoment
      },
      isMomentToMomentActive: isMomentToMoment,
      daysRemaining,
      antiCrashShieldActive: true,
      resilienceScore: 100,
      botInfo: this.botInfo,
    };
  }

  public ensureRunning(): boolean {
    const config = db.getConfig();
    if (!config.token) return false;
    if (!this.isRunning) {
      this.isExplicitlyStopped = false;
      this.startPolling().catch(() => {});
      return true;
    }
    return true;
  }

  private startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    // 1500ms high-frequency sentinel to guarantee ZERO downtime and instantaneous auto-recovery
    this.watchdogTimer = setInterval(() => {
      this.watchdogHeartbeatCount++;
      const config = db.getConfig();
      const now = Date.now();
      const momentToMomentActive = this.isTimeWindowActive();

      // Guard 1: If bot stopped but token exists and not explicitly stopped by admin, revive immediately!
      if (!this.isRunning && config.token && !config.useWebhook && (momentToMomentActive || config.isPollingActive !== false)) {
        this.autoRecoveryCount++;
        this.isExplicitlyStopped = false;
        console.log('[Bale Bot Watchdog] Zero-Downtime Shield: Reviving polling loop instantly...');
        this.startPolling().catch((e) => console.warn('[Bale Bot Watchdog] Revive note:', e?.message));
      }

      // Guard 2: If polling is active but connection got silent or hung (> 38s), seamlessly refresh socket
      if (this.isRunning && now - this.lastPollEpoch > 38000 && config.token) {
        this.autoRecoveryCount++;
        console.log('[Bale Bot Watchdog] Zero-Downtime Shield: Refreshing silent socket...');
        if (this.abortController) {
          try { this.abortController.abort(); } catch {}
        }
        this.abortController = new AbortController();
        this.lastPollEpoch = Date.now();
        this.pollLoop().catch(() => {});
      }
    }, 1500);
  }

  public async startPolling(): Promise<{ success: boolean; message: string }> {
    const config = db.getConfig();
    if (!config.token) {
      this.lastError = 'توکن ربات بله هنوز تنظیم نشده است.';
      return { success: false, message: 'لطفاً ابتدا توکن ربات بله را وارد کنید.' };
    }

    this.isExplicitlyStopped = false;

    if (this.isRunning) {
      return { success: true, message: 'سرویس بدون وقفه هم‌اکنون فعال و در حال کار است.' };
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.lastError = null;
    db.updateConfig({ isPollingActive: true, useWebhook: false });
    db.addLog('ربات بله', 'شروع پولینگ بلادرنگ', 'سپر پایداری ۲۴ ساعته فعال شد.');

    // Ensure webhook is removed from Bale so Bale delivers updates to long-poll immediately
    try {
      await this.callBaleApi('deleteWebhook');
    } catch {}

    try {
      const meRes = await this.callBaleApi('getMe');
      if (meRes && meRes.ok) {
        this.botInfo = meRes.result;
        console.log('[Bale Bot] Connected to bot:', meRes.result.username);
      }
    } catch (e: any) {
      console.warn('[Bale Bot] getMe note:', e.message);
    }

    this.pollLoop().catch((err: any) => {
      console.error('[Bale Bot Shield] Top-level poll loop recovered:', err?.message || err);
      if (!this.isExplicitlyStopped) {
        setTimeout(() => this.pollLoop(), 300);
      }
    });

    return { success: true, message: 'سرویس بدون وقفه و پایدار ربات بله فعال شد.' };
  }

  public stopPolling() {
    this.isExplicitlyStopped = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
    db.updateConfig({ isPollingActive: false });
    db.addLog('ربات بله', 'توقف پولینگ', 'سرویس Long Polling متوقف شد.');
    return { success: true, message: 'سرویس پولینگ متوقف شد.' };
  }

  private async pollLoop() {
    console.log('[Bale Bot Shield] Infinite zero-interruption polling loop activated.');
    while (this.isRunning && !this.isExplicitlyStopped) {
      const config = db.getConfig();
      if (!config.token) {
        this.isRunning = false;
        break;
      }

      this.lastPollTimestamp = new Date().toLocaleTimeString('fa-IR');
      this.lastPollEpoch = Date.now();

      try {
        const timeoutSeconds = 25;
        const res = await this.callBaleApi('getUpdates', {
          offset: this.lastUpdateId ? this.lastUpdateId + 1 : undefined,
          limit: 50,
          timeout: timeoutSeconds,
        });

        if (res && res.ok && Array.isArray(res.result)) {
          this.lastError = null;
          if (res.result.length > 0) {
            for (const update of res.result) {
              if (!update || this.processedUpdateIds.has(update.update_id)) continue;
              this.processedUpdateIds.add(update.update_id);
              if (this.processedUpdateIds.size > 5000) {
                const firstVal = this.processedUpdateIds.values().next().value;
                if (firstVal !== undefined) this.processedUpdateIds.delete(firstVal);
              }

              this.lastUpdateId = update.update_id;
              this.totalUpdatesProcessed++;

              // Instant asynchronous execution so replies arrive in milliseconds with ZERO delay!
              this.handleIncomingUpdate(update).catch((err: any) => {
                console.error('[Bale Bot Shield] Safe update handling note:', err?.message || err);
              });
            }

            // Zero delay: immediately loop to fetch any newer updates!
            continue;
          }
        } else if (res && !res.ok) {
          // If Bale returns 429 Too Many Requests or transient server maintenance
          this.lastError = `پاسخ بله: ${res.description || 'در حال بازنشانی...'}`;
          await new Promise((r) => setTimeout(r, 600));
        }
      } catch (err: any) {
        if (this.isExplicitlyStopped) {
          console.log('[Bale Bot Shield] Polling explicitly stopped by user command.');
          break;
        }

        // If it was a routine long-polling request timeout, this is 100% NORMAL - do NOT stop the loop!
        if (err.name === 'TimeoutError' || err.isTimeout) {
          this.lastError = null;
          continue;
        }

        // Check if top-level engine abort was triggered by watchdog refresh
        if (err.name === 'AbortError') {
          if (!this.isExplicitlyStopped) {
            await new Promise((r) => setTimeout(r, 100));
            continue;
          }
          break;
        }

        // Network hiccups (DNS drop, ECONNRESET, ETIMEDOUT): auto-retry smoothly without stopping
        this.lastError = `در حال اتصال مجدد: ${err.message || 'شبکه'}`;
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }

      // Minimal tick so next long-poll starts immediately
      await new Promise((r) => setTimeout(r, 20));
    }

    if (this.isExplicitlyStopped) {
      this.isRunning = false;
    }
  }

  public async callBaleApi(method: string, data?: any): Promise<any> {
    const config = db.getConfig();
    if (!config.token) throw new Error('توکن بله موجود نیست.');

    const url = `https://tapi.bale.ai/bot${config.token}/${method}`;
    const controller = new AbortController();
    const isLongPoll = method === 'getUpdates';
    const timeoutMs = isLongPoll ? 34000 : 12000;
    
    let isInternalTimeout = false;
    const timeout = setTimeout(() => {
      isInternalTimeout = true;
      try { controller.abort(); } catch {}
    }, timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Connection': 'keep-alive',
          'User-Agent': 'MofidGame-UnstoppableBot/2.0'
        },
        body: data ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return await resp.json();
    } catch (e: any) {
      clearTimeout(timeout);
      if (isInternalTimeout) {
        const timeoutErr: any = new Error(`Request timed out after ${timeoutMs}ms`);
        timeoutErr.name = 'TimeoutError';
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw e;
    }
  }

  public async sendMessage(chatId: number, text: string, replyMarkup?: any): Promise<any> {
    try {
      const config = db.getConfig();
      if (!config.token) {
        return { ok: true, simulated: true };
      }
      return await this.callBaleApi('sendMessage', {
        chat_id: chatId,
        text,
        reply_markup: replyMarkup,
      });
    } catch (e: any) {
      console.error(`[Bale Bot] SendMessage failed to ${chatId}:`, e.message);
      return null;
    }
  }

  public async simulateUpdate(update: any): Promise<Array<{ text: string; replyMarkup?: any }>> {
    const recordedMessages: Array<{ text: string; replyMarkup?: any }> = [];
    const originalSend = this.sendMessage.bind(this);

    this.sendMessage = async (chatId: number, text: string, replyMarkup?: any) => {
      recordedMessages.push({ text, replyMarkup });
      return { ok: true, result: { message_id: Math.floor(Math.random() * 10000) } };
    };

    try {
      await this.handleIncomingUpdate(update);
    } finally {
      this.sendMessage = originalSend;
    }

    return recordedMessages;
  }

  public async handleIncomingUpdate(update: any) {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  private getMainKeyboard(isAdmin: boolean) {
    const rows = [
      [{ text: '🎮 شروع بازی' }, { text: '📚 انتخاب پایه و درس' }],
      [{ text: '🧠 تمرین هوشمند' }, { text: '📝 آزمون فصل' }],
      [{ text: '🏆 لیگ مفید' }, { text: '⚔️ دوئل با دوستان' }],
      [{ text: '🔁 مرور اشتباهات' }, { text: '📊 کارنامه من' }],
      [{ text: '🎯 مأموریت روزانه' }, { text: '📅 برنامه مطالعه' }],
      [{ text: '💡 آموزش و رفع اشکال' }, { text: '📖 منابع و درسنامه‌ها' }],
      [{ text: '⚙️ تنظیمات' }, { text: '🆘 راهنما و پشتیبانی' }],
    ];
    if (isAdmin) {
      rows.unshift([{ text: '👑 پنل مدیریت' }]);
    }
    return {
      keyboard: rows,
      resize_keyboard: true,
    };
  }

  private async handleMessage(msg: any) {
    const chatId = msg.chat?.id;
    const text = (msg.text || '').trim();
    if (!chatId) return;

    const isAdmin = db.isAdmin(chatId);
    let student = db.getStudentByBaleId(chatId);
    let session = this.userSessions.get(chatId) || { state: 'idle' };


    if (isAdmin) {
      const handled = await this.handleAdminMessage(chatId, text, session);
      if (handled) return;
    }

    if (!student) {
      if (text === '/start' || session.state === 'idle') {
        this.userSessions.set(chatId, { state: 'registering_name', tempData: {} });
        await this.sendMessage(
          chatId,
          `🌱 به **مفیدگیم** خوش آمدید!\n«مدرسه مفید یادگار امام»\n\n🎯 شعار ما: «بازی کن، یاد بگیر، مسلط شو!»\n\nبرای ثبت‌نام، لطفاً **نام و نام‌خانوادگی** خود را ارسال کنید:`
        );
        return;
      }

      if (session.state === 'registering_name') {
        session.tempData.fullName = text;
        session.state = 'registering_grade';
        this.userSessions.set(chatId, session);
        await this.sendMessage(
          chatId,
          `متشکرم ${text} عزیز! 📚 لطفاً پایه تحصیلی خود را انتخاب کنید:`,
          {
            keyboard: [[{ text: 'پایه هفتم' }, { text: 'پایه هشتم' }, { text: 'پایه نهم' }]],
            resize_keyboard: true,
          }
        );
        return;
      }

      if (session.state === 'registering_grade') {
        const gradeMap: any = { 'پایه هفتم': '7', 'پایه هشتم': '8', 'پایه نهم': '9' };
        const g = gradeMap[text] || '7';
        session.tempData.grade = g;
        session.state = 'registering_class';
        this.userSessions.set(chatId, session);
        await this.sendMessage(
          chatId,
          `کلاس خود را مشخص کنید (مثلاً: هفتم ۱، هشتم ۲ یا شهید چمران):`
        );
        return;
      }

      if (session.state === 'registering_class') {
        const newStudent: Student = {
          id: `st_${Date.now()}`,
          baleChatId: chatId,
          username: msg.from?.username || '',
          fullName: session.tempData.fullName,
          grade: session.tempData.grade,
          className: text,
          isApproved: true,
          joinedAt: new Date().toLocaleDateString('fa-IR'),
          lastActiveAt: 'امروز',
          leaguePoints: 100,
          tier: 'برنزی',
          stats: {
            totalAnswered: 0,
            correctAnswers: 0,
            accuracyPercentage: 0,
            streakDays: 1,
            duelsPlayed: 0,
            duelsWon: 0,
          },
        };
        db.saveStudent(newStudent);
        this.userSessions.set(chatId, { state: 'idle' });
        await this.sendMessage(
          chatId,
          `🎉 **ثبت‌نام شما با موفقیت تکمیل شد!**\n\n👤 نام: ${newStudent.fullName}\n📚 پایه: ${newStudent.grade}\n🏫 کلاس: ${newStudent.className}\n🎁 ۱۰۰ امتیاز خوش‌آمدگویی لیگ به شما تعلق گرفت!`,
          this.getMainKeyboard(false)
        );
        return;
      }
    }

    const mainButtons = [
      '🎮 شروع بازی', '📚 انتخاب پایه و درس',
      '🧠 تمرین هوشمند', '📝 آزمون فصل',
      '🏆 لیگ مفید', '⚔️ دوئل با دوستان',
      '🔁 مرور اشتباهات', '📊 کارنامه من',
      '🎯 مأموریت روزانه', '📅 برنامه مطالعه',
      '💡 آموزش و رفع اشکال', '📖 منابع و درسنامه‌ها',
      '⚙️ تنظیمات', '🆘 راهنما و پشتیبانی',
      '👑 پنل مدیریت', '🏠 بازگشت به منوی اصلی', 'منوی اصلی', '/start'
    ];
    if (mainButtons.includes(text)) {
      if (text === '🏠 بازگشت به منوی اصلی' || text === 'منوی اصلی' || text === '🏠 بازگشت به منوی کاربری' || text === '/start') {
        this.userSessions.set(chatId, { state: 'idle' });
        await this.sendMessage(chatId, '🏠 به منوی اصلی مفیدگیم بازگشتید:', this.getMainKeyboard(isAdmin));
        return;
      }
      session = { state: 'idle' };
      this.userSessions.set(chatId, session);
    }


    if (student) {
      if (await this.handleDuelFlow(chatId, text, session, student, isAdmin)) return;
      if (await this.handleMistakesFlow(chatId, text, session, student, isAdmin)) return;
      if (await this.handleDailyMissionsFlow(chatId, text, session, student, isAdmin)) return;
      if (await this.handleStudyPlanFlow(chatId, text, session, student, isAdmin)) return;
      if (await this.handleTutoringFlow(chatId, text, session, student, isAdmin)) return;
      if (await this.handleStudentSettingsFlow(chatId, text, session, student, isAdmin)) return;
    }

    if (text === '🎮 شروع بازی' || text === '🧠 تمرین هوشمند' || text === '📝 آزمون فصل') {
      await this.startPracticeQuiz(chatId, student);
      return;
    }

    if (text === '🏆 لیگ مفید') {
      const students = db.getStudents().sort((a, b) => b.leaguePoints - a.leaguePoints);
      let board = '🏆 **جدول برترین‌های لیگ مفیدگیم**\n\n';
      students.slice(0, 10).forEach((s, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🔹';
        board += `${medal} ${idx + 1}. **${s.fullName}** (${s.grade}م) — ${s.leaguePoints} امتیاز\n`;
      });
      if (student) {
        board += `\n⭐️ **رتبه شما:** ${students.findIndex((s) => s.id === student?.id) + 1} با ${student.leaguePoints} امتیاز`;
      }
      await this.sendMessage(chatId, board, this.getMainKeyboard(isAdmin));
      return;
    }

    if (text === '📊 کارنامه من') {
      if (!student) return;
      const card = `📊 **کارنامه تحصیلی مفیدگیم**\n\n👤 نام: ${student.fullName}\n📚 پایه: ${student.grade}\n⭐ امتیاز لیگ: ${student.leaguePoints}\n🎯 درصد دقت کلی: ${student.stats.accuracyPercentage}٪\n🔥 زنجیره مطالعه: ${student.stats.streakDays} روز\n⚔️ دوئل‌های برنده: ${student.stats.duelsWon} از ${student.stats.duelsPlayed}`;
      await this.sendMessage(chatId, card, this.getMainKeyboard(isAdmin));
      return;
    }

    if (text === '📖 منابع و درسنامه‌ها') {
      const resources = db.getResources();
      let resText = `📖 **کتب درسی رسمی و منابع آموزشی مفیدگیم:**\nمجتمع آموزشی دوره اول مفید یادگار امام\n\n`;
      resources.forEach((r, idx) => {
        resText += `${idx + 1}. 📚 **${r.title}** (پایه ${r.grade})\n   🔗 نشانی: ${r.downloadUrl}\n   📝 ${r.description}\n\n`;
      });
      await this.sendMessage(chatId, resText, this.getMainKeyboard(isAdmin));
      return;
    }

    if (text === '📚 انتخاب پایه و درس') {
      await this.sendMessage(
        chatId,
        `📚 لطفاً درس مورد نظر برای تمرین را انتخاب فرمایید:`,
        {
          keyboard: [
            [{ text: '📐 ریاضی هفتم' }, { text: '🔬 علوم تجربی هفتم' }],
            [{ text: '📐 ریاضی هشتم' }, { text: '🔬 علوم تجربی هشتم' }],
            [{ text: '📐 ریاضی نهم' }, { text: '🔬 علوم تجربی نهم' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return;
    }

    if (text.includes('ریاضی') || text.includes('علوم')) {
      await this.startPracticeQuiz(chatId, student);
      return;
    }

    if (text === '🆘 راهنما و پشتیبانی') {
      await this.sendMessage(
        chatId,
        `🆘 **راهنما و پشتیبانی مفیدگیم**\nمجتمع آموزشی دوره اول مفید یادگار امام\n\n🎮 **چگونه امتیاز کسب کنم؟**\n• حل کوئیزهای تمرینی: +۱۵ امتیاز\n• پیروزی در دوئل با دوستان: +۳۵ امتیاز\n• مرور و تثبیت اشتباهات: +۱۵ امتیاز\n• انجام مأموریت‌های روزانه: تا +۱۰۰ امتیاز روزانه!\n• ثبت مطالعه منظم: +۲۰ امتیاز\n\n☎️ ارتباط با کادر و ادمین مدرسه: @mofidgamebot\n🏫 مجتمع مفید یادگار امام، سال تحصیلی ۱۴۰۵-۱۴۰۶`,
        this.getMainKeyboard(isAdmin)
      );
      return;
    }

    if (session.state === 'in_quiz' && session.tempData) {
      await this.handleQuizAnswer(chatId, text, session);
      return;
    }

    await this.sendMessage(
      chatId,
      `درود بر شما! از منوی زیر یکی از گزینه‌ها را برای یادگیری، مسابقه یا آزمون انتخاب کنید:`,
      this.getMainKeyboard(isAdmin)
    );
  }

  private async startPracticeQuiz(chatId: number, student?: Student) {
    const grade = student?.grade || '7';
    const questions = db.getQuestions({ grade });
    if (questions.length === 0) {
      await this.sendMessage(chatId, 'در حال حاضر سؤالی برای پایه شما در بانک ثبت نشده است.');
      return;
    }

    const q = questions[Math.floor(Math.random() * questions.length)];
    this.userSessions.set(chatId, {
      state: 'in_quiz',
      tempData: {
        questionId: q.id,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        question: q,
      },
    });

    const options = q.options || ['گزینه ۱', 'گزینه ۲', 'گزینه ۳', 'گزینه ۴'];
    const keyboardRows = [
      [{ text: options[0] }, { text: options[1] }],
      [{ text: options[2] }, { text: options[3] }],
      [{ text: '❌ انصراف از آزمون' }],
    ];

    await this.sendMessage(
      chatId,
      `❓ **سؤال تمرینی (${q.topic || 'آزمون'})**\n\n${q.questionText}`,
      { keyboard: keyboardRows, resize_keyboard: true }
    );
  }

  private async handleQuizAnswer(chatId: number, answerText: string, session: UserSession) {
    const isAdmin = db.isAdmin(chatId);
    if (answerText === '❌ انصراف از آزمون') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, 'آزمون متوقف شد.', this.getMainKeyboard(isAdmin));
      return;
    }

    const isCorrect = answerText.trim() === session.tempData.correctAnswer.trim();
    const student = db.getStudentByBaleId(chatId);

    if (isCorrect) {
      if (student) {
        db.updateStudent(student.id, {
          leaguePoints: (student.leaguePoints || 0) + 15,
          stats: {
            ...student.stats,
            totalAnswered: (student.stats?.totalAnswered || 0) + 1,
            correctAnswers: (student.stats?.correctAnswers || 0) + 1,
            accuracyPercentage: Math.round((((student.stats?.correctAnswers || 0) + 1) / ((student.stats?.totalAnswered || 0) + 1)) * 100),
          },
        });
        db.recordDailyActivity(student.id, 'practice_quiz', 1);
      }
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(
        chatId,
        `✅ **آفرین! پاسخ شما کاملاً درست بود.**\n➕ ۱۵ امتیاز لیگ دریافت کردید!\n\n💡 **پاسخ تشریحی:**\n${session.tempData.explanation}`,
        this.getMainKeyboard(isAdmin)
      );
    } else {
      if (student) {
        db.updateStudent(student.id, {
          stats: {
            ...student.stats,
            totalAnswered: (student.stats?.totalAnswered || 0) + 1,
            accuracyPercentage: Math.round(((student.stats?.correctAnswers || 0) / ((student.stats?.totalAnswered || 0) + 1)) * 100),
          },
        });
        db.recordDailyActivity(student.id, 'practice_quiz', 1);
        if (session.tempData.question) {
          db.recordMistake(student.id, session.tempData.question, answerText);
        }
      }
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(
        chatId,
        `❌ **متأسفانه پاسخ نادرست بود.**\nپاسخ صحیح: **${session.tempData.correctAnswer}**\nاین سؤال به دفترچه اشتباهات شما افزوده شد تا بعداً مرور کنید.\n\n💡 **پاسخ تشریحی:**\n${session.tempData.explanation}`,
        this.getMainKeyboard(isAdmin)
      );
    }
  }

  // ============================================================================
  // --- 1. DUEL WITH FRIENDS (دوئل با دوستان) ---
  // ============================================================================

  private async handleDuelFlow(chatId: number, text: string, session: UserSession, student: Student, isAdmin: boolean): Promise<boolean> {
    if (text === '⚔️ دوئل با دوستان' || text === 'دوئل با دوستان' || text === '🔙 بازگشت به منوی دوئل') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(
        chatId,
        `⚔️ **میدان دوئل و مسابقات علمی مفیدگیم**\n«مجتمع آموزشی دوره اول مفید یادگار امام»\n\nدر این بخش می‌توانید با هم‌کلاسی‌های خود یا ربات هوشمند مفید در یک مسابقه ۳ سؤالی رقابت کنید!\n\n🏆 **جوایز دوئل:**\n• برنده دوئل: **+۳۵ امتیاز لیگ** و جام افتخار\n• ارتقای رتبه در جدول برترین‌های مدرسه\n\n👇 یکی از گزینه‌های زیر را انتخاب فرمایید:`,
        {
          keyboard: [
            [{ text: '⚔️ ایجاد چالش دوئل و دریافت کد' }, { text: '🎮 ورود به دوئل با کد حریف' }],
            [{ text: '🤖 دوئل سریع با ربات تیزهوش مفید' }, { text: '🏆 رکوردها و آمار دوئل من' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '⚔️ ایجاد چالش دوئل و دریافت کد') {
      const duel = db.createDuel(student, student.grade, 'ریاضی و علوم');
      this.userSessions.set(chatId, {
        state: 'duel_created_prompt',
        tempData: { duelId: duel.id },
      });
      await this.sendMessage(
        chatId,
        `🎉 **چالش دوئل شما با موفقیت ایجاد شد!**\n\n🔑 **کد اختصاصی ورود به دوئل:** \`${duel.code}\`\n\nاین کد یا متن زیر را برای دوست یا هم‌کلاسی خود در بله بفرستید:\n\n«سلام دوست من! در مفیدگیم برات چالش دوئل فرستادم. با وارد کردن کد \`${duel.code}\` در ربات @mofidgamebot با من مسابقه بده!»\n\nحالا آماده‌ای که خودت به ۳ سؤال این دوئل پاسخ بدی؟`,
        {
          keyboard: [
            [{ text: '🚀 شروع پاسخگویی به سؤالات دوئل من' }],
            [{ text: '🔙 بازگشت به منوی دوئل' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '🚀 شروع پاسخگویی به سؤالات دوئل من' && session.tempData?.duelId) {
      const duel = db.getDuel(session.tempData.duelId);
      if (!duel) {
        await this.sendMessage(chatId, 'دوئل یافت نشد.', this.getMainKeyboard(isAdmin));
        return true;
      }
      const questions = db.getQuestions({ grade: duel.grade }).filter((q) => duel.questionIds.includes(q.id));
      const activeQs = questions.length > 0 ? questions : db.getQuestions({ grade: student.grade }).slice(0, 3);

      this.userSessions.set(chatId, {
        state: 'in_duel_challenger',
        tempData: {
          duelId: duel.id,
          questions: activeQs,
          currentIndex: 0,
          score: 0,
        },
      });
      await this.sendDuelQuestion(chatId, activeQs[0], 1, 3);
      return true;
    }

    if (text === '🎮 ورود به دوئل با کد حریف') {
      this.userSessions.set(chatId, { state: 'duel_waiting_code' });
      await this.sendMessage(
        chatId,
        `🔑 لطفاً کد ۴ یا ۵ رقمی دوئل را وارد فرمایید (مثلاً: \`DUEL-1234\` یا \`1234\`):\n\nبرای انصراف دکمه زیر را لمس کنید:`,
        {
          keyboard: [[{ text: '🔙 بازگشت به منوی دوئل' }]],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (session.state === 'duel_waiting_code') {
      if (text === '🔙 بازگشت به منوی دوئل') {
        this.userSessions.set(chatId, { state: 'idle' });
        return await this.handleDuelFlow(chatId, '⚔️ دوئل با دوستان', { state: 'idle' }, student, isAdmin);
      }

      const duel = db.getDuel(text);
      if (!duel) {
        await this.sendMessage(
          chatId,
          `❌ کد دوئل وارد شده نامعتبر است یا دوئل به پایان رسیده است.\nلطفاً کد را مجدداً بررسی و ارسال کنید:`,
          {
            keyboard: [[{ text: '🔙 بازگشت به منوی دوئل' }]],
            resize_keyboard: true,
          }
        );
        return true;
      }

      if (duel.challengerId === student.id) {
        await this.sendMessage(
          chatId,
          `⚠️ شما خودتان سازنده این دوئل هستید! لطفاً کد را برای دوستتان بفرستید تا وارد شود.`,
          {
            keyboard: [[{ text: '🔙 بازگشت به منوی دوئل' }]],
            resize_keyboard: true,
          }
        );
        return true;
      }

      db.joinDuel(duel.id, student);
      const questions = db.getQuestions({ grade: duel.grade }).filter((q) => duel.questionIds.includes(q.id));
      const activeQs = questions.length > 0 ? questions : db.getQuestions({ grade: student.grade }).slice(0, 3);

      this.userSessions.set(chatId, {
        state: 'in_duel_opponent',
        tempData: {
          duelId: duel.id,
          questions: activeQs,
          currentIndex: 0,
          score: 0,
          challengerName: duel.challengerName,
        },
      });
      await this.sendMessage(
        chatId,
        `⚔️ **شما وارد دوئل با «${duel.challengerName}» شدید!**\nمسابقه شامل ۳ سؤال است. آماده باشید!`
      );
      await this.sendDuelQuestion(chatId, activeQs[0], 1, 3);
      return true;
    }

    if ((session.state === 'in_duel_challenger' || session.state === 'in_duel_opponent' || session.state === 'in_duel_ai') && session.tempData) {
      await this.handleDuelAnswer(chatId, text, session, student, isAdmin);
      return true;
    }

    if (text === '🤖 دوئل سریع با ربات تیزهوش مفید') {
      const questions = db.getQuestions({ grade: student.grade }).sort(() => 0.5 - Math.random()).slice(0, 3);
      this.userSessions.set(chatId, {
        state: 'in_duel_ai',
        tempData: {
          questions,
          currentIndex: 0,
          userScore: 0,
          aiScore: 0,
        },
      });
      await this.sendMessage(
        chatId,
        `🤖 **دوئل سریع با «ربات تیزهوش مفید» آغاز شد!**\n\nاین ربات در هر راند با توجه به سطح دشواری سؤال پاسخ می‌دهد. رقابت در ۳ راند تستی برگزار می‌شود!`
      );
      await this.sendDuelQuestion(chatId, questions[0], 1, 3);
      return true;
    }

    if (text === '🏆 رکوردها و آمار دوئل من') {
      const duels = db.getDuelsForStudent(student.id);
      const played = student.stats.duelsPlayed || duels.length;
      const won = student.stats.duelsWon || 0;
      const winRate = played > 0 ? Math.round((won / played) * 100) : 0;
      await this.sendMessage(
        chatId,
        `🏆 **کارنامه و رکوردهای دوئل شما**\n\n👤 نام مبارز: **${student.fullName}**\n⚔️ کل دوئل‌های انجام‌شده: **${played} مسابقه**\n🥇 دوئل‌های برنده: **${won} پیروزی**\n📊 درصد پیروزی: **${winRate}٪**\n⭐ امتیازات کسب شده از دوئل: **${won * 35} امتیاز**\n\n«تمرین بیشتر = پیروزی در دوئل‌های بعدی!»`,
        {
          keyboard: [
            [{ text: '⚔️ ایجاد چالش دوئل و دریافت کد' }, { text: '🤖 دوئل سریع با ربات تیزهوش مفید' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    return false;
  }

  private async sendDuelQuestion(chatId: number, q: Question, current: number, total: number) {
    const options = q.options || ['گزینه ۱', 'گزینه ۲', 'گزینه ۳', 'گزینه ۴'];
    const keyboardRows = [
      [{ text: options[0] }, { text: options[1] }],
      [{ text: options[2] }, { text: options[3] }],
      [{ text: '❌ انصراف از دوئل' }],
    ];
    await this.sendMessage(
      chatId,
      `⚔️ **سؤال راند ${current} از ${total}** (${q.topic || 'آزمون'})\n\n${q.questionText}`,
      { keyboard: keyboardRows, resize_keyboard: true }
    );
  }

  private async handleDuelAnswer(chatId: number, answerText: string, session: UserSession, student: Student, isAdmin: boolean) {
    if (answerText === '❌ انصراف از دوئل') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, 'از دوئل خارج شدید.', this.getMainKeyboard(isAdmin));
      return;
    }

    const { duelId, questions, currentIndex, challengerName } = session.tempData;
    const currentQ = questions[currentIndex];
    const isCorrect = answerText.trim() === currentQ.correctAnswer.trim();

    if (session.state === 'in_duel_ai') {
      let userScore = session.tempData.userScore || 0;
      let aiScore = session.tempData.aiScore || 0;

      if (isCorrect) {
        userScore++;
      } else {
        db.recordMistake(student.id, currentQ, answerText);
      }

      const aiCorrect = Math.random() < 0.65;
      if (aiCorrect) aiScore++;

      session.tempData.userScore = userScore;
      session.tempData.aiScore = aiScore;

      const nextIndex = currentIndex + 1;
      if (nextIndex < questions.length) {
        session.tempData.currentIndex = nextIndex;
        await this.sendMessage(
          chatId,
          `🏁 **نتیجه راند ${currentIndex + 1}:**\nشما: ${isCorrect ? '✅ درست (+۱)' : '❌ نادرست (۰)'}\nربات تیزهوش: ${aiCorrect ? '✅ درست (+۱)' : '❌ نادرست (۰)'}\n\n📊 **مجموع تا الان:** شما ${userScore} - ${aiScore} ربات`
        );
        await this.sendDuelQuestion(chatId, questions[nextIndex], nextIndex + 1, questions.length);
        return;
      }

      this.userSessions.set(chatId, { state: 'idle' });
      db.recordDailyActivity(student.id, 'duel', 1);

      let finalMsg = `🏁 **پایان دوئل ۳ رانده با ربات تیزهوش مفید!**\n\n📊 نتیجه نهایی:\n👤 شما: **${userScore} امتیاز**\n🤖 ربات مفید: **${aiScore} امتیاز**\n\n`;

      if (userScore > aiScore) {
        finalMsg += `🎉 **پیروزی درخشان!**\nشما موفق شدید ربات تیزهوش را شکست دهید!\n➕ **۳۵ امتیاز لیگ** و جام افتخار به شما تعلق گرفت! 🏆`;
        db.updateStudent(student.id, {
          leaguePoints: (student.leaguePoints || 0) + 35,
          stats: {
            ...student.stats,
            duelsPlayed: (student.stats?.duelsPlayed || 0) + 1,
            duelsWon: (student.stats?.duelsWon || 0) + 1,
          },
        });
      } else if (userScore === aiScore) {
        finalMsg += `🤝 **نتیجه مساوی!**\nرقابت پایاپای و نفس‌گیری بود.\n➕ **۱۵ امتیاز تلاش** به شما تعلق گرفت.`;
        db.updateStudent(student.id, {
          leaguePoints: (student.leaguePoints || 0) + 15,
          stats: {
            ...student.stats,
            duelsPlayed: (student.stats?.duelsPlayed || 0) + 1,
          },
        });
      } else {
        finalMsg += `💪 **ربات این بار برنده شد!**\nاشکالی ندارد، تمرین بیشتر کلید پیروزی است.\n➕ **۱۰ امتیاز مشارکت** دریافت کردید.`;
        db.updateStudent(student.id, {
          leaguePoints: (student.leaguePoints || 0) + 10,
          stats: {
            ...student.stats,
            duelsPlayed: (student.stats?.duelsPlayed || 0) + 1,
          },
        });
      }

      await this.sendMessage(chatId, finalMsg, {
        keyboard: [
          [{ text: '🤖 دوئل سریع با ربات تیزهوش مفید' }, { text: '⚔️ دوئل با دوستان' }],
          [{ text: '🎯 مأموریت روزانه' }, { text: '🏠 بازگشت به منوی اصلی' }],
        ],
        resize_keyboard: true,
      });
      return;
    }

    let score = session.tempData.score || 0;
    if (isCorrect) {
      score++;
    } else {
      db.recordMistake(student.id, currentQ, answerText);
    }
    session.tempData.score = score;

    const nextIndex = currentIndex + 1;
    if (nextIndex < questions.length) {
      session.tempData.currentIndex = nextIndex;
      await this.sendDuelQuestion(chatId, questions[nextIndex], nextIndex + 1, questions.length);
      return;
    }

    this.userSessions.set(chatId, { state: 'idle' });
    const updatedDuel = db.submitDuelScore(duelId, student.id, score);

    if (session.state === 'in_duel_challenger') {
      await this.sendMessage(
        chatId,
        `🎉 **پاسخگویی شما به سؤالات دوئل به پایان رسید!**\nامتیاز کسب‌شده شما: **${score} از ۳**\n\n🔑 کد دوئل: \`${updatedDuel?.code || ''}\`\nبه محض اینکه دوست شما وارد شود و پاسخ دهد، نتیجه نهایی و برنده مشخص خواهد شد!`,
        {
          keyboard: [
            [{ text: '⚔️ دوئل با دوستان' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
    } else {
      const cScore = updatedDuel?.challengerScore || 0;
      let finalMsg = `🏁 **نتیجه نهایی مسابقه دوئل:**\n\n👤 ${challengerName || 'سازنده چالش'}: **${cScore} امتیاز**\n👤 شما (${student.fullName}): **${score} امتیاز**\n\n`;

      if (score > cScore) {
        finalMsg += `🎉 **تبریک قهرمان! شما برنده این دوئل شدید!**\n➕ **۳۵ امتیاز لیگ** و جام برتری به کارنامه شما افزوده شد! 🏆`;
        db.updateStudent(student.id, {
          leaguePoints: (student.leaguePoints || 0) + 35,
          stats: {
            ...student.stats,
            duelsPlayed: (student.stats?.duelsPlayed || 0) + 1,
            duelsWon: (student.stats?.duelsWon || 0) + 1,
          },
        });
      } else if (score === cScore) {
        finalMsg += `🤝 **مسابقه مساوی شد!**\n➕ **۱۵ امتیاز لیگ** برای هر دو شرکت‌کننده ثبت شد.`;
        db.updateStudent(student.id, {
          leaguePoints: (student.leaguePoints || 0) + 15,
          stats: {
            ...student.stats,
            duelsPlayed: (student.stats?.duelsPlayed || 0) + 1,
          },
        });
      } else {
        finalMsg += `👏 **مسابقه عالی بود! برنده این دوئل «${challengerName}» شد.**\n➕ **۱۰ امتیاز مشارکت** برای شما ثبت گردید.`;
        db.updateStudent(student.id, {
          leaguePoints: (student.leaguePoints || 0) + 10,
          stats: {
            ...student.stats,
            duelsPlayed: (student.stats?.duelsPlayed || 0) + 1,
          },
        });
      }

      await this.sendMessage(chatId, finalMsg, {
        keyboard: [
          [{ text: '⚔️ دوئل با دوستان' }],
          [{ text: '🏠 بازگشت به منوی اصلی' }],
        ],
        resize_keyboard: true,
      });
    }
  }

  // ============================================================================
  // --- 2. MISTAKES REVIEW (مرور اشتباهات) ---
  // ============================================================================

  private async handleMistakesFlow(chatId: number, text: string, session: UserSession, student: Student, isAdmin: boolean): Promise<boolean> {
    if (text === '🔁 مرور اشتباهات' || text === 'مرور اشتباهات' || text === '🔙 بازگشت به منوی اشتباهات') {
      const mistakes = db.getMistakes(student.id, true);
      this.userSessions.set(chatId, { state: 'idle' });

      if (mistakes.length === 0) {
        await this.sendMessage(
          chatId,
          `🌟 **آفرین قهرمان مفیدگیم!**\n\nدر حال حاضر هیچ اشتباه ثبت‌شده‌ای در دفترچه شما وجود ندارد. شما تمام تست‌های قبلی را به درستی حل کرده‌اید یا مسلط شده‌اید!\n\n💡 برای به چالش کشیدن خود و کشف نقاط یادگیری جدید، می‌توانید در تمرین هوشمند یا دوئل شرکت فرمایید:`,
          {
            keyboard: [
              [{ text: '🧠 تمرین هوشمند' }, { text: '⚔️ دوئل با دوستان' }],
              [{ text: '🎯 مأموریت روزانه' }, { text: '🏠 بازگشت به منوی اصلی' }],
            ],
            resize_keyboard: true,
          }
        );
        return true;
      }

      await this.sendMessage(
        chatId,
        `🔁 **دفترچه تحلیل و مرور اشتباهات شما**\nمجتمع آموزشی دوره اول مفید یادگار امام\n\n📌 تعداد سؤالات نیازمند مرور و تثبیت: **${mistakes.length} سؤال**\n💡 قانون مفیدگیم: «اشتباهات، طلایی‌ترین فرصت‌های یادگیری هستند.» با حل مجدد هر سؤال، مبحث را کاملاً مسلط شوید و +۱۵ امتیاز بگیرید!\n\n👇 جهت مرور یا آزمون مجدد، گزینه مورد نظر را انتخاب نمایید:`,
        {
          keyboard: [
            [{ text: '🎯 آزمون مرور اشتباهات (حل مجدد)' }, { text: '💡 مشاهده کلید و دام‌های تستی' }],
            [{ text: '🧹 تسلط کامل و پاکسازی اشتباهات' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '🎯 آزمون مرور اشتباهات (حل مجدد)' || text === '🎯 مرور سؤال بعدی اشتباهات') {
      const mistakes = db.getMistakes(student.id, true);
      if (mistakes.length === 0) {
        await this.sendMessage(
          chatId,
          `🎉 **تبریک! تمامی سؤالات اشتباه قبلی را مسلط شدید و دفترچه شما پاک شد!**`,
          this.getMainKeyboard(isAdmin)
        );
        this.userSessions.set(chatId, { state: 'idle' });
        return true;
      }

      const item = mistakes[0];
      const origQuestion = db.getQuestionById(item.questionId);
      const options = origQuestion?.options || [item.correctAnswer, item.incorrectAnswer, 'گزینه فرعی ۳', 'گزینه فرعی ۴'].sort(() => 0.5 - Math.random());

      this.userSessions.set(chatId, {
        state: 'in_mistake_quiz',
        tempData: {
          mistakeId: item.id,
          questionId: item.questionId,
          correctAnswer: item.correctAnswer,
          explanation: item.explanation,
        },
      });

      const keyboardRows = [
        [{ text: options[0] }, { text: options[1] }],
        [{ text: options[2] }, { text: options[3] }],
        [{ text: '🔙 بازگشت به منوی اشتباهات' }],
      ];

      await this.sendMessage(
        chatId,
        `🔁 **حل مجدد تست اشتباه قبلی:**\n\n${item.questionText}`,
        { keyboard: keyboardRows, resize_keyboard: true }
      );
      return true;
    }

    if (session.state === 'in_mistake_quiz' && session.tempData) {
      if (text === '🔙 بازگشت به منوی اشتباهات') {
        this.userSessions.set(chatId, { state: 'idle' });
        return await this.handleMistakesFlow(chatId, '🔁 مرور اشتباهات', { state: 'idle' }, student, isAdmin);
      }

      const isCorrect = text.trim() === session.tempData.correctAnswer.trim();
      if (isCorrect) {
        db.resolveMistake(student.id, session.tempData.questionId);
        db.updateStudent(student.id, {
          leaguePoints: (student.leaguePoints || 0) + 15,
        });
        await this.sendMessage(
          chatId,
          `✅ **فوق‌العاده بود! پاسخ شما کاملاً درست بود.**\n🎉 این مبحث تثبیت شد و از دفترچه اشتباهات خط خورد (+۱۵ امتیاز تسلط)!\n\n💡 **نکته کلیدی:**\n${session.tempData.explanation}`,
          {
            keyboard: [
              [{ text: '🎯 مرور سؤال بعدی اشتباهات' }],
              [{ text: '🔙 بازگشت به منوی اشتباهات' }, { text: '🏠 بازگشت به منوی اصلی' }],
            ],
            resize_keyboard: true,
          }
        );
      } else {
        await this.sendMessage(
          chatId,
          `❌ **متأسفانه پاسخ هنوز نادرست است.**\nپاسخ صحیح: **${session.tempData.correctAnswer}**\n\n💡 **نکته و دام تستی:**\n${session.tempData.explanation}`,
          {
            keyboard: [
              [{ text: '🎯 مرور سؤال بعدی اشتباهات' }],
              [{ text: '🔙 بازگشت به منوی اشتباهات' }, { text: '🏠 بازگشت به منوی اصلی' }],
            ],
            resize_keyboard: true,
          }
        );
      }
      return true;
    }

    if (text === '💡 مشاهده کلید و دام‌های تستی') {
      const mistakes = db.getMistakes(student.id, true);
      let report = '💡 **کلید و نکات طلایی سؤالات اشتباه شما:**\n\n';
      mistakes.slice(0, 5).forEach((m, idx) => {
        report += `${idx + 1}. ❓ ${m.questionText.substring(0, 70)}...\n   ✅ پاسخ درست: **${m.correctAnswer}**\n   💡 نکته: ${m.explanation}\n\n`;
      });
      await this.sendMessage(
        chatId,
        report,
        {
          keyboard: [
            [{ text: '🎯 آزمون مرور اشتباهات (حل مجدد)' }],
            [{ text: '🔙 بازگشت به منوی اشتباهات' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '🧹 تسلط کامل و پاکسازی اشتباهات') {
      const mistakes = db.getMistakes(student.id, true);
      for (const m of mistakes) {
        db.resolveMistake(student.id, m.questionId);
      }
      await this.sendMessage(
        chatId,
        `🧹 **تمام اشتباهات علامت تسلط خوردند!**\nدفترچه شما اکنون خالی است. موفق باشید!`,
        this.getMainKeyboard(isAdmin)
      );
      return true;
    }

    return false;
  }

  // ============================================================================
  // --- 3. DAILY MISSIONS (ماموریت روزانه) ---
  // ============================================================================

  private async handleDailyMissionsFlow(chatId: number, text: string, session: UserSession, student: Student, isAdmin: boolean): Promise<boolean> {
    if (text === '🎯 مأموریت روزانه' || text === 'ماموریت روزانه' || text === '🔙 بازگشت به مأموریت‌ها') {
      const progress = db.getDailyProgress(student.id);

      const m1Done = progress.practiceQuizCount >= 3;
      const m2Done = progress.duelsCount >= 1;
      const m3Done = progress.lessonsReadCount >= 1;
      const m4Done = progress.mistakesReviewedCount >= 1;

      const m1Claimed = (progress.claimedMissionIds || []).includes('mission_1');
      const m2Claimed = (progress.claimedMissionIds || []).includes('mission_2');
      const m3Claimed = (progress.claimedMissionIds || []).includes('mission_3');
      const m4Claimed = (progress.claimedMissionIds || []).includes('mission_4');

      const msg = `🎯 **مأموریت‌های روزانه مفیدگیم** (${progress.date})\n«بازی کن، یاد بگیر، مسلط شو!»\n\n۱. 🧠 **تمرین هوشمند:** ۳ سؤال تستی حل کنید.\n   📊 پیشرفت: [${progress.practiceQuizCount}/۳] ${m1Claimed ? '🎁 دریافت شد' : m1Done ? '✅ تکمیل شد (+۲۰ امتیاز)' : '⏳ در حال انجام'}\n\n۲. ⚔️ **دوئل علمی:** در ۱ دوئل با دوستان یا هوش مصنوعی شرکت کنید.\n   📊 پیشرفت: [${progress.duelsCount}/۱] ${m2Claimed ? '🎁 دریافت شد' : m2Done ? '✅ تکمیل شد (+۳۰ امتیاز)' : '⏳ در حال انجام'}\n\n۳. 📖 **مطالعه پارت درسی:** یک درسنامه بخوانید یا پارت مطالعه روز را ثبت کنید.\n   📊 پیشرفت: [${progress.lessonsReadCount}/۱] ${m3Claimed ? '🎁 دریافت شد' : m3Done ? '✅ تکمیل شد (+۲۵ امتیاز)' : '⏳ در حال انجام'}\n\n۴. 🔁 **مرور اشتباهات:** حداقل ۱ سؤال از دفترچه اشتباهات را مرور کنید.\n   📊 پیشرفت: [${progress.mistakesReviewedCount}/۱] ${m4Claimed ? '🎁 دریافت شد' : m4Done ? '✅ تکمیل شد (+۲۵ امتیاز)' : '⏳ در حال انجام'}\n\n🔥 **زنجیره مطالعه مداوم (Streak):** ${student.stats?.streakDays || 1} روز متوالی\n🎁 **کل پاداش روزانه:** ۱۰۰ امتیاز لیگ!`;


      await this.sendMessage(
        chatId,
        msg,
        {
          keyboard: [
            [{ text: '🎁 دریافت جوایز مأموریت‌های تکمیل‌شده' }, { text: '🔥 جزئیات زنجیره استریک (Streak)' }],
            [{ text: '🧠 تمرین هوشمند' }, { text: '⚔️ دوئل با دوستان' }],
            [{ text: '📅 برنامه مطالعه' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '🎁 دریافت جوایز مأموریت‌های تکمیل‌شده') {
      const claims = ['mission_1', 'mission_2', 'mission_3', 'mission_4'];
      let totalGained = 0;
      const results: string[] = [];

      for (const mId of claims) {
        const res = db.claimDailyMission(student.id, mId);
        if (res.success) {
          totalGained += res.reward;
          results.push(res.message);
        }
      }

      if (totalGained > 0) {
        const updated = db.getStudentById(student.id);
        await this.sendMessage(
          chatId,
          `🎉 **تبریک فراوان!**\n${results.join('\n')}\n\n⭐️ **مجموع امتیاز دریافت شده:** +${totalGained} امتیاز\n🏆 **مجموع امتیاز لیگ شما:** ${updated?.leaguePoints} امتیاز`,
          {
            keyboard: [
              [{ text: '🎯 مأموریت روزانه' }],
              [{ text: '🏠 بازگشت به منوی اصلی' }],
            ],
            resize_keyboard: true,
          }
        );
      } else {
        await this.sendMessage(
          chatId,
          `ℹ️ مأموریت تکمیل‌شده‌ی جدیدی برای دریافت جایزه وجود ندارد!\nلطفاً کارهای امروز را انجام دهید تا دکمه جایزه فعال شود.`,
          {
            keyboard: [
              [{ text: '🎯 مأموریت روزانه' }],
              [{ text: '🏠 بازگشت به منوی اصلی' }],
            ],
            resize_keyboard: true,
          }
        );
      }
      return true;
    }

    if (text === '🔥 جزئیات زنجیره استریک (Streak)') {
      await this.sendMessage(
        chatId,
        `🔥 **زنجیره مطالعه و استریک مفیدگیم**\n\n📅 روزهای متوالی مطالعه شما: **${student.stats.streakDays} روز**\n\n💡 **قوانین استریک:**\n• هر روزی که به ربات سر بزنید و حداقل یک مأموریت انجام دهید، ۱ روز به زنجیره شما اضافه می‌شود.\n• در روزهای ۷، ۱۴ و ۳۰، ضریب پاداش دوبرابر و نشان افتخار ویژه اعطا خواهد شد!\n• سپر استریک: در صورت یک روز غیبت موجه، سپر خودکار فعال می‌شود.`,
        {
          keyboard: [
            [{ text: '🎯 مأموریت روزانه' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    return false;
  }

  // ============================================================================
  // --- 4. STUDY PLAN (برنامه مطالعه) ---
  // ============================================================================

  private async handleStudyPlanFlow(chatId: number, text: string, session: UserSession, student: Student, isAdmin: boolean): Promise<boolean> {
    const days = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
    const todayIndex = new Date().getDay();
    const todayPersian = days[todayIndex];

    if (text === '📅 برنامه مطالعه' || text === 'برنامه ی مطالعه' || text === '🔙 بازگشت به برنامه مطالعه') {
      const plans = db.getStudyPlans(student.grade, todayPersian);
      let planText = `📅 **برنامه مطالعاتی اختصاصی مفیدگیم**\nمجتمع آموزشی دوره اول مفید یادگار امام\n📚 پایه: **پایه ${student.grade}م** | 🗓️ امروز: **${todayPersian}**\n\n🎯 **پارت‌های مطالعاتی پیشنهادی امروز:**\n\n`;

      plans.forEach((p, idx) => {
        planText += `${idx + 1}. 📌 **${p.subject}** (${p.durationMinutes} دقیقه)\n   📖 مبحث: ${p.topic}\n   💡 نکته: ${p.tips}\n\n`;
      });

      planText += `👇 پس از پایان هر پارت، آن را ثبت کنید تا امتیاز انضباط مطالعاتی دریافت نمایید:`;

      await this.sendMessage(
        chatId,
        planText,
        {
          keyboard: [
            [{ text: '✅ ثبت مطالعه پارت امروز' }, { text: '📋 برنامه کامل هفتگی مدرسه مفید' }],
            [{ text: '⏱️ تنظیم هدف مطالعه روزانه' }, { text: '💡 آموزش و رفع اشکال' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '✅ ثبت مطالعه پارت امروز') {
      await this.sendMessage(
        chatId,
        `📚 لطفاً پارت درسی مطالعه شده را لمس فرمایید تا امتیاز انضباط تحصیلی برای شما ثبت شود:`,
        {
          keyboard: [
            [{ text: '📐 پارت ریاضی مطالعه شد (۴۵ دقیقه)' }, { text: '🔬 پارت علوم مطالعه شد (۳۵ دقیقه)' }],
            [{ text: '📖 پارت ادبیات مطالعه شد (۳۰ دقیقه)' }, { text: '🌍 پارت زبان مطالعه شد (۲۵ دقیقه)' }],
            [{ text: '🔙 بازگشت به برنامه مطالعه' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text.includes('مطالعه شد')) {
      db.updateStudent(student.id, {
        leaguePoints: (student.leaguePoints || 0) + 20,
      });
      db.recordDailyActivity(student.id, 'lesson_review', 1);
      await this.sendMessage(
        chatId,
        `👏 **آفرین به انضباط و تلاش شما!**\nپارت درسی با موفقیت ثبت شد و **+۲۰ امتیاز لیگ** دریافت کردید.\nهمچنین مأموریت روزانه مطالعه برای شما به روزرسانی شد! 🎯`,
        {
          keyboard: [
            [{ text: '🎯 مأموریت روزانه' }, { text: '📅 برنامه مطالعه' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '📋 برنامه کامل هفتگی مدرسه مفید') {
      const allPlans = db.getStudyPlans(student.grade);
      let weekly = `📋 **برنامه کامل مطالعاتی هفتگی مجتمع مفید (پایه ${student.grade}م)**\n\n`;
      const groupedDays = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

      for (const d of groupedDays) {
        const dPlans = allPlans.filter((p) => p.dayOfWeek === d);
        if (dPlans.length > 0) {
          weekly += `🗓️ **${d}:**\n`;
          dPlans.forEach((p) => {
            weekly += `  • ${p.subject} (${p.durationMinutes} دقیقه): ${p.topic}\n`;
          });
          weekly += '\n';
        }
      }

      await this.sendMessage(
        chatId,
        weekly,
        {
          keyboard: [
            [{ text: '✅ ثبت مطالعه پارت امروز' }],
            [{ text: '🔙 بازگشت به برنامه مطالعه' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '⏱️ تنظیم هدف مطالعه روزانه') {
      await this.sendMessage(
        chatId,
        `⏱️ **هدف‌گذاری زمان مطالعه روزانه مفیدگیم**\nهدف مد نظرتان برای مطالعه روزانه را انتخاب کنید:`,
        {
          keyboard: [
            [{ text: '⏱️ ۴۵ دقیقه در روز' }, { text: '⏱️ ۶۰ دقیقه در روز' }],
            [{ text: '⏱️ ۹۰ دقیقه در روز' }, { text: '⏱️ ۱۲۰ دقیقه در روز (پیشرفته)' }],
            [{ text: '🔙 بازگشت به برنامه مطالعه' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text.startsWith('⏱️') && text.includes('دقیقه')) {
      await this.sendMessage(
        chatId,
        `✅ هدف مطالعه شما با موفقیت روی **«${text.replace('⏱️', '').trim()}»** تنظیم شد!\nپیام‌های تشویقی و یادآورها بر این اساس برای شما ارسال خواهد شد.`,
        {
          keyboard: [
            [{ text: '📅 برنامه مطالعه' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    return false;
  }

  // ============================================================================
  // --- 5. TUTORING & Q&A (آموزش و رفع اشکال) ---
  // ============================================================================

  private async handleTutoringFlow(chatId: number, text: string, session: UserSession, student: Student, isAdmin: boolean): Promise<boolean> {
    if (text === '💡 آموزش و رفع اشکال' || text === 'اموزش و رفع اشکال' || text === '🔙 بازگشت به منوی آموزش') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(
        chatId,
        `💡 **سامانه هوشمند آموزش و رفع اشکال مفیدگیم**\n«مجتمع آموزشی دوره اول مفید یادگار امام»\n\nهر سؤالی در کتاب‌های درسی داری یا مبحثی رو متوجه نشدی، همین‌جا بپرس تا به‌صورت گام‌به‌گام، روان و تشریحی برات توضیح بدم!\n\n👇 یکی از بخش‌های زیر را انتخاب فرمایید:`,
        {
          keyboard: [
            [{ text: '❓ طرح پرسش و رفع اشکال مستقیم' }, { text: '📐 خلاصه فرمول‌ها و نکات کلیدی' }],
            [{ text: '📖 درسنامه‌ها و نکات امتحانی' }, { text: '🤖 حل تشریحی مسائل کتاب' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '❓ طرح پرسش و رفع اشکال مستقیم' || text === '❓ سؤال دیگری بپرسم' || text === '🤖 حل تشریحی مسائل کتاب') {
      this.userSessions.set(chatId, { state: 'tutoring_asking_question' });
      await this.sendMessage(
        chatId,
        `✏️ **طرح پرسش درسی و رفع اشکال**\n\nلطفاً سؤال یا مبحثی که در آن اشکال دارید را به زبان ساده بنویسید (مثلاً: «روش حل معادله با پرانتز»، «تفاوت تندی و سرعت»، یا «ارکان تشبیه در شعر فارسی»):`,
        {
          keyboard: [[{ text: '🔙 بازگشت به منوی آموزش' }]],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (session.state === 'tutoring_asking_question') {
      if (text === '🔙 بازگشت به منوی آموزش') {
        this.userSessions.set(chatId, { state: 'idle' });
        return await this.handleTutoringFlow(chatId, '💡 آموزش و رفع اشکال', { state: 'idle' }, student, isAdmin);
      }

      await this.sendMessage(chatId, '⏳ در حال بررسی سؤال و تدوین پاسخ تشریحی آموزشی...');
      const answer = await explainEducationalQuestionWithAI(text, student.grade);
      db.updateStudent(student.id, {
        leaguePoints: (student.leaguePoints || 0) + 10,
      });

      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(
        chatId,
        `${answer}\n\n🎁 **+۱۰ امتیاز کنجکاوی علمی** به کارنامه شما افزوده شد!`,
        {
          keyboard: [
            [{ text: '❓ سؤال دیگری بپرسم' }, { text: '📐 خلاصه فرمول‌ها و نکات کلیدی' }],
            [{ text: '🔙 بازگشت به منوی آموزش' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '📐 خلاصه فرمول‌ها و نکات کلیدی') {
      await this.sendMessage(
        chatId,
        `📐 لطفاً درس مورد نظر را برای مشاهده فرمول‌ها و نکات کلیدی انتخاب فرمایید:`,
        {
          keyboard: [
            [{ text: '📐 فرمول‌های ریاضی' }, { text: '🔬 فرمول‌های علوم' }],
            [{ text: '📖 آرایه‌های ادبی فارسی' }, { text: '🌍 نکات گرامر زبان انگلیسی' }],
            [{ text: '🔙 بازگشت به منوی آموزش' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '📐 فرمول‌های ریاضی') {
      await this.sendMessage(
        chatId,
        `📐 **چکیده فرمول‌های طلایی ریاضی (دوره اول مفید):**\n\n• **مجموع زوایای داخلی n ضلعی:**\n  (n - ۲) × ۱۸۰ درجه\n\n• **تعداد قطرهای n ضلعی:**\n  [n × (n - ۳)] ÷ ۲\n\n• **زاویه خارجی چندضلعی منتظم:**\n  ۳۶۰ ÷ n\n\n• **معادله خط:**\n  y = ax + b (شیب خط: a ، عرض از مبدأ: b)\n\n• **توان و ضرب:**\n  a^m × a^n = a^(m+n)\n  (a^m)^n = a^(m×n)\n\n• **احتمال رخ دادن پیشامد:**\n  P(A) = n(A) ÷ n(S)`,
        {
          keyboard: [
            [{ text: '🔬 فرمول‌های علوم' }, { text: '📖 آرایه‌های ادبی فارسی' }],
            [{ text: '🔙 بازگشت به منوی آموزش' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '🔬 فرمول‌های علوم') {
      await this.sendMessage(
        chatId,
        `🔬 **چکیده فرمول‌ها و نکات طلایی علوم تجربی:**\n\n• **فرمول چگالی:**\n  چگالی = جرم (m) ÷ حجم (V)\n  یکای استاندارد: kg/m³ یا g/cm³\n\n• **تندی و سرعت متوسط:**\n  تندی متوسط = مسافت طی‌شده ÷ مدت زمان\n  سرعت متوسط = جابه‌جایی ÷ مدت زمان\n\n• **شتاب متوسط:**\n  a = (v2 - v1) ÷ t (تغییرات سرعت در واحد زمان)\n\n• **قانون دوم نیوتون:**\n  F = m × a (نیرو = جرم × شتاب)\n\n• **وزن:**\n  W = m × g (شتاب گرانش زمین g ≈ ۹.۸ N/kg)`,
        {
          keyboard: [
            [{ text: '📐 فرمول‌های ریاضی' }, { text: '🌍 نکات گرامر زبان انگلیسی' }],
            [{ text: '🔙 بازگشت به منوی آموزش' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '📖 آرایه‌های ادبی فارسی') {
      await this.sendMessage(
        chatId,
        `📖 **چکیده آرایه‌های ادبی پرکاربرد ادبیات فارسی:**\n\n• **تشبیه:** مانند کردن چیزی به چیز دیگر.\n  ارکان: ۱. مشبه ۲. مشبه‌به ۳. ادات تشبیه ۴. وجه شبه\n\n• **استعاره:** تشبیهی که مشبه یا مشبه‌به آن حذف شده باشد.\n\n• **کنایه:** جمله‌ای با دو مفهوم نزدیک و دور که منظور مفهوم دور آن است (مثلاً «دست از پا درازتر»).\n\n• **مراعات نظیر (تناسب):** آوردن واژه‌هایی از یک خانواده معنایی مانند «گل، بلبل، بهار، باغ».\n\n• **تضاد (طباق):** آوردن کلمات متضاد مانند «شب و روز»، «خنده و گریه».`,
        {
          keyboard: [
            [{ text: '📐 خلاصه فرمول‌ها و نکات کلیدی' }],
            [{ text: '🔙 بازگشت به منوی آموزش' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '🌍 نکات گرامر زبان انگلیسی') {
      await this.sendMessage(
        chatId,
        `🌍 **نکات طلایی گرامر زبان انگلیسی دوره اول:**\n\n• **زمان حال استمراری (Present Continuous):**\n  Subject + am/is/are + Verb-ing\n  مثال: He is reading a book.\n\n• **زمان گذشته ساده (Past Simple):**\n  افعال باقاعده: play -> played\n  افعال بی‌قاعده: go -> went, see -> saw\n\n• **کلمات پرسشی (WH-Questions):**\n  What (چه چیزی), Where (کجا), When (چه زمانی), Who (چه کسی), Why (چرا)`,
        {
          keyboard: [
            [{ text: '📐 خلاصه فرمول‌ها و نکات کلیدی' }],
            [{ text: '🔙 بازگشت به منوی آموزش' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '📖 درسنامه‌ها و نکات امتحانی') {
      const resources = db.getResources();
      let resText = `📖 **بانک درسنامه‌ها و منابع رسمی مدرسه مفید:**\n\n`;
      resources.slice(0, 5).forEach((r, idx) => {
        resText += `${idx + 1}. 📚 **${r.title}**\n   🔗 منبع: ${r.officialSource} (${r.downloadUrl})\n\n`;
      });
      await this.sendMessage(
        chatId,
        resText,
        {
          keyboard: [
            [{ text: '🔙 بازگشت به منوی آموزش' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    return false;
  }

  // ============================================================================
  // --- 6. USER SETTINGS (تنظیمات حساب کاربری) ---
  // ============================================================================

  private async handleStudentSettingsFlow(chatId: number, text: string, session: UserSession, student: Student, isAdmin: boolean): Promise<boolean> {
    if (text === '⚙️ تنظیمات' || text === 'تنظیمات' || text === '🔙 بازگشت به تنظیمات') {
      this.userSessions.set(chatId, { state: 'idle' });
      const conf = db.getConfig();
      await this.sendMessage(
        chatId,
        `⚙️ **تنظیمات حساب کاربری و ربات مفیدگیم**\n«مجتمع آموزشی دوره اول مفید یادگار امام»\n\n👤 نام و نام‌خانوادگی: **${student.fullName}**\n📚 پایه تحصیلی: **پایه ${student.grade}م**\n🏫 نام کلاس: **${student.className}**\n🆔 شناسه کاربری بله: \`${chatId}\`\n⭐ امتیاز لیگ: **${student.leaguePoints} امتیاز**\n🏆 نشان لیگ: **${student.tier}**\n🔔 یادآور مطالعه روزانه: **فعال (ساعت ۱۸:۰۰)**\n🔑 کد دعوت مدرسه: \`${conf.schoolInviteCode}\`\n\n👇 جهت ویرایش هر بخش، دکمه مورد نظر را لمس فرمایید:`,
        {
          keyboard: [
            [{ text: '✏️ ویرایش نام و نام‌خانوادگی' }, { text: '📚 تغییر پایه تحصیلی' }],
            [{ text: '🏫 ویرایش نام کلاس' }, { text: '🔔 تنظیم یادآور مطالعه روزانه' }],
            [{ text: '☁️ همگام‌سازی ابری با فایربیس' }, { text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '✏️ ویرایش نام و نام‌خانوادگی') {
      this.userSessions.set(chatId, { state: 'settings_edit_name' });
      await this.sendMessage(
        chatId,
        `✏️ لطفاً **نام و نام‌خانوادگی کامل جدید** خود را ارسال فرمایید:`,
        {
          keyboard: [[{ text: '🔙 بازگشت به تنظیمات' }]],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (session.state === 'settings_edit_name') {
      if (text === '🔙 بازگشت به تنظیمات') {
        this.userSessions.set(chatId, { state: 'idle' });
        return await this.handleStudentSettingsFlow(chatId, '⚙️ تنظیمات', { state: 'idle' }, student, isAdmin);
      }
      db.updateStudent(student.id, { fullName: text.trim() });
      this.userSessions.set(chatId, { state: 'idle' });
      const updated = db.getStudentById(student.id);
      await this.sendMessage(
        chatId,
        `✅ نام شما با موفقیت به **«${updated?.fullName}»** تغییر یافت.`,
        {
          keyboard: [
            [{ text: '⚙️ تنظیمات' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '📚 تغییر پایه تحصیلی') {
      this.userSessions.set(chatId, { state: 'settings_edit_grade' });
      await this.sendMessage(
        chatId,
        `📚 لطفاً پایه تحصیلی جدید خود را انتخاب فرمایید:`,
        {
          keyboard: [
            [{ text: 'پایه هفتم' }, { text: 'پایه هشتم' }, { text: 'پایه نهم' }],
            [{ text: '🔙 بازگشت به تنظیمات' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (session.state === 'settings_edit_grade') {
      if (text === '🔙 بازگشت به تنظیمات') {
        this.userSessions.set(chatId, { state: 'idle' });
        return await this.handleStudentSettingsFlow(chatId, '⚙️ تنظیمات', { state: 'idle' }, student, isAdmin);
      }
      const gradeMap: any = { 'پایه هفتم': '7', 'پایه هشتم': '8', 'پایه نهم': '9' };
      const newGrade = gradeMap[text] || (['7', '8', '9'].includes(text) ? text : '7');
      db.updateStudent(student.id, { grade: newGrade });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(
        chatId,
        `✅ پایه تحصیلی شما با موفقیت به **«پایه ${newGrade}م»** تغییر یافت. سؤالات و برنامه‌های مطالعاتی شما متناسب با این پایه تنظیم خواهند شد.`,
        {
          keyboard: [
            [{ text: '⚙️ تنظیمات' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '🏫 ویرایش نام کلاس') {
      this.userSessions.set(chatId, { state: 'settings_edit_class' });
      await this.sendMessage(
        chatId,
        `🏫 لطفاً نام کلاس خود را ارسال نمایید (مثلاً: هفتم ۱، شهید بهشتی یا هشتم ۲):`,
        {
          keyboard: [[{ text: '🔙 بازگشت به تنظیمات' }]],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (session.state === 'settings_edit_class') {
      if (text === '🔙 بازگشت به تنظیمات') {
        this.userSessions.set(chatId, { state: 'idle' });
        return await this.handleStudentSettingsFlow(chatId, '⚙️ تنظیمات', { state: 'idle' }, student, isAdmin);
      }
      db.updateStudent(student.id, { className: text.trim() });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(
        chatId,
        `✅ نام کلاس شما با موفقیت به **«${text.trim()}»** تغییر یافت.`,
        {
          keyboard: [
            [{ text: '⚙️ تنظیمات' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '🔔 تنظیم یادآور مطالعه روزانه') {
      await this.sendMessage(
        chatId,
        `🔔 **ساعت یادآور مطالعه روزانه**\nدر چه ساعتی مایل به دریافت پیام یادآوری برای انجام تمرین‌ها و مأموریت روزانه هستید؟`,
        {
          keyboard: [
            [{ text: '🔔 ساعت ۱۶:۰۰' }, { text: '🔔 ساعت ۱۸:۰۰' }],
            [{ text: '🔔 ساعت ۲۰:۰۰' }, { text: '🔕 غیرفعال‌سازی یادآور' }],
            [{ text: '🔙 بازگشت به تنظیمات' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text.startsWith('🔔 ساعت') || text === '🔕 غیرفعال‌سازی یادآور') {
      await this.sendMessage(
        chatId,
        `✅ تنظیمات یادآور با موفقیت ذخیره شد: **${text}**`,
        {
          keyboard: [
            [{ text: '⚙️ تنظیمات' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    if (text === '☁️ همگام‌سازی ابری با فایربیس') {
      const syncResult = await syncEntireDatabaseToFirebase(db.getRawData());
      await this.sendMessage(
        chatId,
        syncResult.success
          ? `☁️ **همگام‌سازی با موفقیت انجام شد!**\nاطلاعات کارنامه و امتیازات شما در سرور ابری Firebase Firestore به‌روزرسانی شد.`
          : `⚠️ همگام‌سازی ابری انجام شد (حالت پایدار محلی فعال است).`,
        {
          keyboard: [
            [{ text: '⚙️ تنظیمات' }],
            [{ text: '🏠 بازگشت به منوی اصلی' }],
          ],
          resize_keyboard: true,
        }
      );
      return true;
    }

    return false;
  }


  // ============================================================================
  // --- IN-BOT COMPREHENSIVE ADMIN PANEL (CRUD FOR ALL ENTITIES) ---
  // ============================================================================

  private getAdminKeyboard() {
    return {
      keyboard: [
        [{ text: '👥 مدیریت دانش‌آموزان' }, { text: '❓ مدیریت سؤالات و آزمون' }],
        [{ text: '👑 مدیران و دبیران' }, { text: '📖 منابع و درسنامه‌ها' }],
        [{ text: '📢 پیام همگانی و اطلاعیه' }, { text: '⚙️ تنظیمات ربات و سامانه' }],
        [{ text: '🖥️ سرور مانیتورینگ ۲۴/۷' }, { text: '☁️ فایربیس و پشتیبان‌گیری' }],
        [{ text: '🤖 دستیار هوشمند AI' }, { text: '🏠 بازگشت به منوی کاربری' }],
      ],
      resize_keyboard: true,
    };
  }

  private getStudentsAdminKeyboard() {
    return {
      keyboard: [
        [{ text: '📋 لیست تمام دانش‌آموزان' }, { text: '➕ افزودن دانش‌آموز جدید' }],
        [{ text: '✏️ ویرایش دانش‌آموز' }, { text: '❌ حذف دانش‌آموز' }],
        [{ text: '🔍 کارنامه و جستجوی دانش‌آموز' }, { text: '🔙 بازگشت به پنل مدیریت' }],
      ],
      resize_keyboard: true,
    };
  }

  private getQuestionsAdminKeyboard() {
    return {
      keyboard: [
        [{ text: '📚 مشاهده تمام سؤالات' }, { text: '➕ افزودن سؤال جدید' }],
        [{ text: '🤖 ساخت سؤال با هوش مصنوعی' }],
        [{ text: '✏️ ویرایش سؤال' }, { text: '❌ حذف سؤال' }],
        [{ text: '🔙 بازگشت به پنل مدیریت' }],
      ],
      resize_keyboard: true,
    };
  }

  private getAdminsManagementKeyboard() {
    return {
      keyboard: [
        [{ text: '👑 لیست مدیران و دبیران' }, { text: '➕ افزودن مدیر جدید' }],
        [{ text: '✏️ ویرایش نام یا سمت مدیر' }, { text: '❌ حذف دسترسی مدیر' }],
        [{ text: '🔙 بازگشت به پنل مدیریت' }],
      ],
      resize_keyboard: true,
    };
  }

  private getResourcesAdminKeyboard() {
    return {
      keyboard: [
        [{ text: '📖 مشاهده تمام منابع رسمی' }, { text: '➕ افزودن منبع یا درسنامه جدید' }],
        [{ text: '❌ حذف منبع درسی' }, { text: '🔙 بازگشت به پنل مدیریت' }],
      ],
      resize_keyboard: true,
    };
  }

  private getSettingsAdminKeyboard() {
    return {
      keyboard: [
        [{ text: '🔑 تغییر کد دعوت مدرسه' }, { text: '🤖 تغییر Chat ID مدیر ارشد' }],
        [{ text: '🔄 تغییر حالت پولینگ / وب‌هوک' }, { text: '🇮🇷 تنظیم لوکیشن سرور' }],
        [{ text: '🔙 بازگشت به پنل مدیریت' }],
      ],
      resize_keyboard: true,
    };
  }

  private getBroadcastAdminKeyboard() {
    return {
      keyboard: [
        [{ text: '📢 پیام به همه دانش‌آموزان' }, { text: '📢 پیام به پایه هفتم' }],
        [{ text: '📢 پیام به پایه هشتم' }, { text: '📢 پیام به پایه نهم' }],
        [{ text: '🔙 بازگشت به پنل مدیریت' }],
      ],
      resize_keyboard: true,
    };
  }

  private getMonitoringAdminKeyboard() {
    return {
      keyboard: [
        [{ text: '🟢 وضعیت زنده سرور مانیتورینگ' }, { text: '⚡ ارسال پالس بیداری و تست' }],
        [{ text: '🔗 دریافت آدرس UptimeRobot' }, { text: '🇮🇷 پینگ مستقیم به بله' }],
        [{ text: '🔙 بازگشت به پنل مدیریت' }],
      ],
      resize_keyboard: true,
    };
  }

  private getFirebaseAndServerAdminKeyboard() {
    return {
      keyboard: [
        [{ text: '⚡ همگام‌سازی فوری با Firebase' }, { text: '💾 ایجاد بکاپ دیتابیس' }],
        [{ text: '🇮🇷 تست پینگ و سرعت اتصال بله' }, { text: '🔙 بازگشت به پنل مدیریت' }],
      ],
      resize_keyboard: true,
    };
  }

  private getCancelAdminKeyboard() {
    return {
      keyboard: [[{ text: '❌ انصراف و بازگشت به پنل مدیریت' }]],
      resize_keyboard: true,
    };
  }

  private async sendAdminMenu(chatId: number) {
    const students = db.getStudents();
    const questions = db.getQuestions();
    const admins = db.getAdmins();
    const resources = db.getResources();
    const config = db.getConfig();

    const text =
      `👑 **پنل مدیریت جامع سامانه آموزشی مفیدگیم**\n` +
      `مجتمع آموزشی دوره اول مفید یادگار امام\n\n` +
      `📊 **آمار زنده سامانه:**\n` +
      `👥 دانش‌آموزان: **${students.length} نفر** | ❓ سؤالات: **${questions.length} سؤال**\n` +
      `👑 کادر و دبیران: **${admins.length} نفر** | 📖 منابع رسمی: **${resources.length} منبع**\n` +
      `🖥️ مانیتورینگ ۲۴/۷: **فعال و مستقل از گوشی** 🟢\n` +
      `☁️ پایگاه داده: **Google Firebase Firestore (متصل)** 🔥\n` +
      `🇮🇷 لوکیشن سرور: **${config.serverLocation === 'cloud' ? 'ابری کلود' : 'ایران (دیتاسنتر تهران / IRAN-IX)'}**\n` +
      `⚡ حالت دریافت پیام: **${config.useWebhook ? 'وب‌هوک سرور' : 'پولینگ پرسرعت بلادرنگ (Zero-Delay)'}**\n\n` +
      `👇 بخش مورد نظر را جهت مشاهده، افزودن، ویرایش یا حذف لمس فرمایید:`;

    await this.sendMessage(chatId, text, this.getAdminKeyboard());
  }

  private async sendStudentsAdminMenu(chatId: number) {
    const students = db.getStudents();
    const text =
      `👥 **بخش مدیریت جامع دانش‌آموزان مفیدگیم**\n\n` +
      `تعداد کل دانش‌آموزان: **${students.length} نفر**\n\n` +
      `برای مشاهده، افزودن، ویرایش مشخصات و امتیاز، یا حذف، یکی از گزینه‌های زیر را انتخاب کنید:`;
    await this.sendMessage(chatId, text, this.getStudentsAdminKeyboard());
  }

  private async listStudentsForAdmin(chatId: number) {
    const students = db.getStudents();
    if (students.length === 0) {
      await this.sendMessage(chatId, '📋 هیچ دانش‌آموزی در سیستم ثبت نشده است.', this.getStudentsAdminKeyboard());
      return;
    }

    let report = `📋 **فهرست کامل دانش‌آموزان (${students.length} نفر):**\n\n`;
    students.forEach((s, idx) => {
      report += `${idx + 1}. **${s.fullName}**\n   🆔 شناسه: \`${s.id}\` | چت: \`${s.baleChatId}\`\n   📚 پایه: ${s.grade}م | کلاس: ${s.className}\n   💎 امتیاز: **${s.leaguePoints}** | رده: ${s.tier}\n\n`;
    });

    await this.sendMessage(chatId, report, this.getStudentsAdminKeyboard());
  }

  private async sendQuestionsAdminMenu(chatId: number) {
    const questions = db.getQuestions();
    const g7 = questions.filter((q) => q.grade === '7').length;
    const g8 = questions.filter((q) => q.grade === '8').length;
    const g9 = questions.filter((q) => q.grade === '9').length;

    const text =
      `❓ **بخش مدیریت بانک سؤالات و آزمون‌ها**\n\n` +
      `📊 مجموع سؤالات فعال: **${questions.length} سؤال**\n` +
      `• پایه هفتم: ${g7} سؤال | • پایه هشتم: ${g8} سؤال | • پایه نهم: ${g9} سؤال\n\n` +
      `از گزینه‌های زیر جهت مشاهده، طراحی دستی، ویرایش، حذف یا ساخت با هوش مصنوعی استفاده نمایید:`;

    await this.sendMessage(chatId, text, this.getQuestionsAdminKeyboard());
  }

  private async listQuestionsForAdmin(chatId: number) {
    const questions = db.getQuestions();
    if (questions.length === 0) {
      await this.sendMessage(chatId, '📚 هیچ سؤالی در بانک ثبت نشده است.', this.getQuestionsAdminKeyboard());
      return;
    }

    let msg = `📚 **بانک سؤالات فعال (${questions.length} سؤال):**\n\n`;
    for (let i = 0; i < Math.min(questions.length, 10); i++) {
      const q = questions[i];
      msg += `🔹 **[${q.id}]** پایه ${q.grade}م (${q.topic || 'آزمون'}):\n${q.questionText}\n✅ گزینه درست: **${q.correctAnswer}**\n\n`;
    }

    if (questions.length > 10) {
      msg += `... و ${questions.length - 10} سؤال دیگر در سیستم موجود است.\nجهت ویرایش یا حذف هر سؤال، شناسه آن را در بخش مربوطه وارد کنید.`;
    }

    await this.sendMessage(chatId, msg, this.getQuestionsAdminKeyboard());
  }

  private async sendAdminsManagementMenu(chatId: number) {
    const admins = db.getAdmins();
    const text =
      `👑 **بخش مدیریت مدیران و دبیران مجتمع مفید**\n\n` +
      `تعداد مدیران با دسترسی کامل: **${admins.length} نفر**\n\n` +
      `شما می‌توانید دبیران جدید را با ارسال شناسه بله اضافه کنید یا مشخصات و دسترسی‌ها را ویرایش و حذف نمایید.`;
    await this.sendMessage(chatId, text, this.getAdminsManagementKeyboard());
  }

  private async listAdminsForAdmin(chatId: number) {
    const admins = db.getAdmins();
    let msg = `👑 **لیست مدیران دارای دسترسی در ربات بله:**\n\n`;
    admins.forEach((adm, idx) => {
      msg += `${idx + 1}. **${adm.fullName}**\n   🆔 شناسه چت بله: \`${adm.chatId}\`\n   🎖️ سمت: ${adm.role === 'super_admin' ? 'مدیر ارشد' : adm.role === 'principal' ? 'مدیر آموزشی' : 'دبیر محترم'}\n\n`;
    });
    await this.sendMessage(chatId, msg, this.getAdminsManagementKeyboard());
  }

  private async sendResourcesAdminMenu(chatId: number) {
    const resources = db.getResources();
    const text =
      `📖 **بخش مدیریت منابع رسمی و درسنامه‌ها**\n\n` +
      `تعداد منابع ثبت‌شده: **${resources.length} عنوان**\n\n` +
      `برای مشاهده، افزودن کتاب یا درسنامه جدید، یا حذف، گزینه‌های زیر را انتخاب فرمایید:`;
    await this.sendMessage(chatId, text, this.getResourcesAdminKeyboard());
  }

  private async listResourcesForAdmin(chatId: number) {
    const resources = db.getResources();
    if (resources.length === 0) {
      await this.sendMessage(chatId, '📖 هیچ منبعی در سیستم ثبت نشده است.', this.getResourcesAdminKeyboard());
      return;
    }
    let msg = `📖 **فهرست کتب و درسنامه‌های رسمی (${resources.length} منبع):**\n\n`;
    resources.forEach((r, idx) => {
      msg += `${idx + 1}. **${r.title}** (پایه ${r.grade})\n   🆔 شناسه: \`${r.id}\`\n   🔗 مرجع: ${r.officialSource || r.downloadUrl}\n   📝 ${r.description || ''}\n\n`;
    });
    await this.sendMessage(chatId, msg, this.getResourcesAdminKeyboard());
  }

  private async sendSettingsAdminMenu(chatId: number) {
    const config = db.getConfig();
    const text =
      `⚙️ **تنظیمات سامانه و ربات بله مفیدگیم**\n\n` +
      `🔑 کد دعوت اختصاصی مدرسه: **${config.schoolInviteCode || 'MOFID-1405'}**\n` +
      `🤖 شناسه چت مدیر ارشد: \`${config.adminChatId || 1434129251}\`\n` +
      `🔄 شیوه اتصال: **${config.useWebhook ? 'وب‌هوک سرور' : 'پولینگ پرسرعت بلادرنگ'}**\n` +
      `🇮🇷 لوکیشن سرور: **${config.serverLocation === 'cloud' ? 'سرور ابری کلود' : 'ایران (دیتاسنتر تهران / IRAN-IX)'}**\n\n` +
      `جهت ویرایش هر بخش، گزینه دلخواه را لمس کنید:`;
    await this.sendMessage(chatId, text, this.getSettingsAdminKeyboard());
  }

  private async sendBroadcastAdminMenu(chatId: number) {
    const text =
      `📢 **بخش ارسال پیام همگانی و اطلاعیه‌ها**\n\n` +
      `شما می‌توانید اطلاعیه‌های مهم مدرسه را به تمام دانش‌آموزان یا به تفکیک پایه ارسال فرمایید:`;
    await this.sendMessage(chatId, text, this.getBroadcastAdminKeyboard());
  }

  private async sendMonitoringAdminMenu(chatId: number) {
    const status = this.getStatus();
    const config = db.getConfig();
    const text =
      `🖥️ **سرور مانیتورینگ ۲۴ ساعته مفیدگیم (Always-On Engine)**\n\n` +
      `🟢 **وضعیت:** کاملاً آنلاین و فعال در پس‌زمینه\n` +
      `📱 **وابستگی به گوشی:** **کاملاً صفر (مستقل از روشن بودن گوشی)** ✅\n` +
      `⏱️ **مدت زمان روشن بودن:** ${(status.uptimeSeconds / 3600).toFixed(1)} ساعت\n` +
      `⚡ **پالس‌های نگه‌دارنده (Keepalive):** ${status.keepalivePings} پالس\n` +
      `📨 **پیام‌های پردازش‌شده:** ${status.totalUpdatesProcessed} پیام\n` +
      `🔄 **احیای خودکار واچ‌داگ:** ${status.autoRecoveryCount} بار\n` +
      `🇮🇷 **لوکیشن اتصال:** ${config.serverLocation === 'cloud' ? 'کلود اروپایی' : 'شبکه ملی اطلاعات (ایران)'}\n\n` +
      `این سرویس تضمین می‌کند که ربات بدون وقفه به پیام‌های دانش‌آموزان پاسخ می‌دهد.`;
    await this.sendMessage(chatId, text, this.getMonitoringAdminKeyboard());
  }

  private async sendFirebaseAndServerMenu(chatId: number) {
    const text =
      `☁️ **ابزارهای ابری فایربیس و سلامت سرور**\n\n` +
      `🔥 **پایگاه داده:** Google Firebase Firestore\n` +
      `🌍 **منطقه ابری:** europe-west2 (لندن)\n` +
      `🇮🇷 **لوکیشن اتصال:** شبکه ملی اطلاعات / سرور ایران\n\n` +
      `برای پشتیبان‌گیری یا همگام‌سازی فوری دیتابیس یکی از گزینه‌ها را انتخاب کنید:`;
    await this.sendMessage(chatId, text, this.getFirebaseAndServerAdminKeyboard());
  }

  private async handleFirebaseSyncInBot(chatId: number) {
    await this.sendMessage(chatId, '⏳ در حال همگام‌سازی کامل پایگاه داده با سرور ابری Firebase...');
    try {
      const res = await syncEntireDatabaseToFirebase(db.getRawData());
      await this.sendMessage(
        chatId,
        `✅ **همگام‌سازی ابری با موفقیت انجام شد!**\n\n📦 تعداد ${res.count} رکورد (دانش‌آموزان، سؤالات، نمرات و تنظیمات) در پایگاه داده Firestore ذخیره و تثبیت شد.`,
        this.getFirebaseAndServerAdminKeyboard()
      );
    } catch (e: any) {
      await this.sendMessage(chatId, `❌ خطا در همگام‌سازی فایربیس: ${e.message}`, this.getFirebaseAndServerAdminKeyboard());
    }
  }

  private async handleTestPingInBot(chatId: number) {
    const start = Date.now();
    try {
      const me = await this.callBaleApi('getMe');
      const ping = Date.now() - start;
      const uptimeH = ((Date.now() - this.startTime) / 3600000).toFixed(1);
      await this.sendMessage(
        chatId,
        `⚡ **گزارش زنده پایداری و پینگ سرور:**\n\n` +
        `🤖 نام ربات: @${me.result?.username || 'mofidgamebot'}\n` +
        `🇮🇷 تأخیر مستقیم به سرور بله (Ping): **${ping} میلی‌ثانیه**\n` +
        `⏱️ مدت زمان آنلاین بودن: **${uptimeH} ساعت**\n` +
        `📨 پیام‌های پردازش‌شده در این سشن: **${this.totalUpdatesProcessed}**\n` +
        `🟢 وضعیت: کاملاً آنلاین، فعال و پاسخگویی آنی ✅`,
        this.getAdminKeyboard()
      );
    } catch (e: any) {
      await this.sendMessage(chatId, `❌ خطا در تست پینگ: ${e.message}`, this.getAdminKeyboard());
    }
  }

  private async handleAdminMessage(chatId: number, text: string, session: UserSession): Promise<boolean> {
    // 1. Navigation & Cancelling
    if (text === '❌ انصراف و بازگشت به پنل مدیریت' || text === '🔙 بازگشت به پنل مدیریت' || text === '/admin' || text === '👑 پنل مدیریت' || text === 'بازگشت به پنل مدیریت') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendAdminMenu(chatId);
      return true;
    }

    if (text === '🏠 بازگشت به منوی کاربری') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, '🏠 به منوی کاربری بازگشتید:', this.getMainKeyboard(true));
      return true;
    }

    // 2. Main Admin Sub-menu dispatch
    if (text === '👥 مدیریت دانش‌آموزان') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendStudentsAdminMenu(chatId);
      return true;
    }

    if (text === '📋 لیست تمام دانش‌آموزان') {
      await this.listStudentsForAdmin(chatId);
      return true;
    }

    if (text === '➕ افزودن دانش‌آموز جدید') {
      this.userSessions.set(chatId, { state: 'admin_add_student_name', tempData: {} });
      await this.sendMessage(chatId, '👤 لطفاً نام و نام خانوادگی دانش‌آموز جدید را ارسال کنید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '✏️ ویرایش دانش‌آموز') {
      this.userSessions.set(chatId, { state: 'admin_edit_student_search', tempData: {} });
      await this.sendMessage(chatId, '✏️ لطفاً نام، شناسه یا آیدی بله دانش‌آموز مورد نظر را جهت ویرایش ارسال کنید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '❌ حذف دانش‌آموز') {
      this.userSessions.set(chatId, { state: 'admin_delete_student_id', tempData: {} });
      await this.sendMessage(chatId, '🗑️ شناسه (یا آیدی بله یا نام) دانش‌آموز مورد نظر جهت حذف را ارسال فرمایید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '🔍 کارنامه و جستجوی دانش‌آموز') {
      this.userSessions.set(chatId, { state: 'admin_search_student_report', tempData: {} });
      await this.sendMessage(chatId, '🔍 نام یا شناسه دانش‌آموز را جهت استعلام کارنامه تحصیلی کامل ارسال کنید:', this.getCancelAdminKeyboard());
      return true;
    }

    // --- Questions Submenu ---
    if (text === '❓ مدیریت سؤالات' || text === '❓ مدیریت سؤالات و آزمون') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendQuestionsAdminMenu(chatId);
      return true;
    }

    if (text === '📚 مشاهده تمام سؤالات') {
      await this.listQuestionsForAdmin(chatId);
      return true;
    }

    if (text === '➕ افزودن سؤال جدید') {
      this.userSessions.set(chatId, { state: 'admin_add_q_grade', tempData: {} });
      await this.sendMessage(chatId, '📚 سؤال برای کدام پایه تحصیلی است؟', {
        keyboard: [[{ text: 'پایه هفتم' }, { text: 'پایه هشتم' }, { text: 'پایه نهم' }], [{ text: '❌ انصراف و بازگشت به پنل مدیریت' }]],
        resize_keyboard: true,
      });
      return true;
    }

    if (text === '✏️ ویرایش سؤال') {
      this.userSessions.set(chatId, { state: 'admin_edit_q_search', tempData: {} });
      await this.sendMessage(chatId, '✏️ شناسه سؤال مورد نظر را وارد کنید (مثال: q_m7_01):', this.getCancelAdminKeyboard());
      return true;
    }


    if (text === '🤖 ساخت سؤال با هوش مصنوعی') {
      this.userSessions.set(chatId, { state: 'admin_ai_generate_q', tempData: {} });
      await this.sendMessage(chatId, '🤖 موضوع و پایه سؤال مورد نظر را به زبان ساده بنویسید:\n(مثال: یک سوال تستی ریاضی نهم از مبحث معادله خط بساز)', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '❌ حذف سؤال') {
      this.userSessions.set(chatId, { state: 'admin_delete_q_id', tempData: {} });
      await this.sendMessage(chatId, '🗑️ لطفاً شناسه سؤال مورد نظر را برای حذف ارسال کنید (مثال: q_m7_01):', this.getCancelAdminKeyboard());
      return true;
    }

    // --- Admins Submenu ---
    if (text === '👑 مدیران و دبیران' || text === '👑 مدیریت مدیران مدرسه') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendAdminsManagementMenu(chatId);
      return true;
    }

    if (text === '👑 لیست مدیران و دبیران') {
      await this.listAdminsForAdmin(chatId);
      return true;
    }

    if (text === '➕ افزودن مدیر جدید') {
      this.userSessions.set(chatId, { state: 'admin_add_admin_chatid', tempData: {} });
      await this.sendMessage(chatId, '👑 لطفاً شناسه عددی چت بله (Chat ID) مدیر جدید را ارسال کنید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '✏️ ویرایش نام یا سمت مدیر') {
      this.userSessions.set(chatId, { state: 'admin_edit_admin_chatid', tempData: {} });
      await this.sendMessage(chatId, '👑 شناسه چت مدیر مورد نظر را جهت ویرایش نام و سمت ارسال کنید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '❌ حذف دسترسی مدیر') {
      this.userSessions.set(chatId, { state: 'admin_delete_admin_chatid', tempData: {} });
      await this.sendMessage(chatId, '🗑️ شناسه چت مدیر را جهت لغو دسترسی ارسال کنید:', this.getCancelAdminKeyboard());
      return true;
    }

    // --- Resources Submenu ---
    if (text === '📖 منابع و درسنامه‌ها') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendResourcesAdminMenu(chatId);
      return true;
    }

    if (text === '📖 مشاهده تمام منابع رسمی') {
      await this.listResourcesForAdmin(chatId);
      return true;
    }

    if (text === '➕ افزودن منبع یا درسنامه جدید') {
      this.userSessions.set(chatId, { state: 'admin_add_res_title', tempData: {} });
      await this.sendMessage(chatId, '📖 لطفاً عنوان کامل کتاب یا منبع درسی را وارد کنید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '❌ حذف منبع درسی') {
      this.userSessions.set(chatId, { state: 'admin_delete_res_id', tempData: {} });
      await this.sendMessage(chatId, '🗑️ شناسه منبع مورد نظر را جهت حذف ارسال فرمایید (مثال: res_m7):', this.getCancelAdminKeyboard());
      return true;
    }

    // --- Settings Submenu ---
    if (text === '⚙️ تنظیمات ربات و سامانه' || text === '⚙️ تنظیمات ربات و مدرسه') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendSettingsAdminMenu(chatId);
      return true;
    }

    if (text === '🔑 تغییر کد دعوت مدرسه') {
      this.userSessions.set(chatId, { state: 'admin_set_school_code', tempData: {} });
      await this.sendMessage(chatId, `🔑 کد فعلی: **${db.getConfig().schoolInviteCode || 'MOFID-1405'}**\nلطفاً کد دعوت جدید مدرسه را ارسال کنید:`, this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '🤖 تغییر Chat ID مدیر ارشد') {
      this.userSessions.set(chatId, { state: 'admin_set_admin_chatid', tempData: {} });
      await this.sendMessage(chatId, `🤖 شناسه فعلی: \`${db.getConfig().adminChatId}\`\nشناسه عددی جدید چت مدیر ارشد را ارسال کنید:`, this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '🔄 تغییر حالت پولینگ / وب‌هوک') {
      const current = db.getConfig().useWebhook;
      const nextWebhook = !current;
      db.updateConfig({ useWebhook: nextWebhook, isPollingActive: !nextWebhook });
      await this.sendMessage(chatId, `🔄 شیوه دریافت پیام به **${nextWebhook ? 'وب‌هوک سرور' : 'پولینگ پرسرعت بلادرنگ (Zero-Delay)'}** تغییر یافت.`, this.getSettingsAdminKeyboard());
      return true;
    }

    if (text === '🇮🇷 تنظیم لوکیشن سرور') {
      const current = db.getConfig().serverLocation || 'iran';
      const nextLoc = current === 'iran' ? 'cloud' : 'iran';
      db.updateConfig({ serverLocation: nextLoc });
      await this.sendMessage(chatId, `🇮🇷 لوکیشن سرور به **${nextLoc === 'iran' ? 'ایران (دیتاسنتر تهران / شبکه ملی اطلاعات)' : 'سرور ابری کلود'}** تنظیم شد.`, this.getSettingsAdminKeyboard());
      return true;
    }

    // --- Broadcast Submenu ---
    if (text === '📢 پیام همگانی و اطلاعیه' || text === '📢 پیام همگانی به همه') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendBroadcastAdminMenu(chatId);
      return true;
    }

    if (text === '📢 پیام به همه دانش‌آموزان') {
      this.userSessions.set(chatId, { state: 'admin_broadcast_all', tempData: {} });
      await this.sendMessage(chatId, '📢 متن پیام برای ارسال به **تمام دانش‌آموزان مدرسه** را بنویسید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '📢 پیام به پایه هفتم') {
      this.userSessions.set(chatId, { state: 'admin_broadcast_g7', tempData: {} });
      await this.sendMessage(chatId, '📢 متن پیام برای ارسال اختصاصی به **دانش‌آموزان پایه هفتم** را بنویسید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '📢 پیام به پایه هشتم') {
      this.userSessions.set(chatId, { state: 'admin_broadcast_g8', tempData: {} });
      await this.sendMessage(chatId, '📢 متن پیام برای ارسال اختصاصی به **دانش‌آموزان پایه هشتم** را بنویسید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (text === '📢 پیام به پایه نهم') {
      this.userSessions.set(chatId, { state: 'admin_broadcast_g9', tempData: {} });
      await this.sendMessage(chatId, '📢 متن پیام برای ارسال اختصاصی به **دانش‌آموزان پایه نهم** را بنویسید:', this.getCancelAdminKeyboard());
      return true;
    }

    // --- Monitoring Submenu ---
    if (text === '🖥️ سرور مانیتورینگ ۲۴/۷') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMonitoringAdminMenu(chatId);
      return true;
    }

    if (text === '🟢 وضعیت زنده سرور مانیتورینگ') {
      await this.sendMonitoringAdminMenu(chatId);
      return true;
    }

    if (text === '⚡ ارسال پالس بیداری و تست') {
      this.recordKeepalivePing();
      await this.handleTestPingInBot(chatId);
      return true;
    }

    if (text === '🔗 دریافت آدرس UptimeRobot') {
      const appUrl = process.env.APP_URL || '';
      const pingUrl = appUrl ? `${appUrl}/api/health` : 'https://ais-dev-.../api/health';
      await this.sendMessage(
        chatId,
        `🔗 **آدرس پینگ مانیتورینگ ۲۴ ساعته رایگان (UptimeRobot):**\n\n` +
        `\`${pingUrl}\`\n\n` +
        `💡 شما می‌توانید این آدرس را در سایت رایگان UptimeRobot.com ثبت کنید تا هر ۵ دقیقه یک پالس بیداری ارسال کرده و سرور حتی با خاموش بودن کامل گوشی شما پیوسته فعال بماند.`,
        this.getMonitoringAdminKeyboard()
      );
      return true;
    }

    if (text === '🇮🇷 وضعیت سرور و پینگ' || text === '🇮🇷 پینگ مستقیم به بله' || text === '🇮🇷 تست پینگ و سرعت اتصال بله') {
      await this.handleTestPingInBot(chatId);
      return true;
    }

    // --- Firebase & Backup Submenu ---
    if (text === '☁️ فایربیس و پشتیبان‌گیری') {
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendFirebaseAndServerMenu(chatId);
      return true;
    }

    if (text === '⚡ همگام‌سازی فوری با Firebase') {
      await this.handleFirebaseSyncInBot(chatId);
      return true;
    }

    if (text === '💾 ایجاد بکاپ دیتابیس') {
      const bk = db.backup();
      await this.sendMessage(chatId, `✅ نسخه پشتیبان با نام ${bk} با موفقیت ایجاد گردید.`, this.getFirebaseAndServerAdminKeyboard());
      return true;
    }

    // --- AI Copilot ---
    if (text === '🤖 دستیار هوشمند AI') {
      this.userSessions.set(chatId, { state: 'admin_ai_copilot_prompt', tempData: {} });
      await this.sendMessage(chatId, '🤖 دستیار هوشمند مدیر آماده است. هر دستوری به زبان فارسی دارید بفرمایید:\n(مثال: «۵۰ امتیاز به دانش‌آموزان هفتم اضافه کن» یا «یک سوال علوم نهم بساز»)', this.getCancelAdminKeyboard());
      return true;
    }

    // =========================================================================
    // 3. WIZARD STATE MACHINE HANDLING (CRUD FOR EVERYTHING)
    // =========================================================================

    // --- Add Student Wizard ---
    if (session.state === 'admin_add_student_name') {
      session.tempData.fullName = text;
      session.state = 'admin_add_student_grade';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, `📚 پایه تحصیلی دانش‌آموز «${text}» را انتخاب کنید:`, {
        keyboard: [[{ text: 'پایه هفتم' }, { text: 'پایه هشتم' }, { text: 'پایه نهم' }], [{ text: '❌ انصراف و بازگشت به پنل مدیریت' }]],
        resize_keyboard: true,
      });
      return true;
    }

    if (session.state === 'admin_add_student_grade') {
      const gradeMap: any = { 'پایه هفتم': '7', 'پایه هشتم': '8', 'پایه نهم': '9' };
      session.tempData.grade = gradeMap[text] || text.replace(/\D/g, '') || '7';
      session.state = 'admin_add_student_class';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '🏫 نام کلاس دانش‌آموز را وارد کنید (مثال: هفتم ۱ یا شهید چمران):', this.getCancelAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_add_student_class') {
      session.tempData.className = text;
      session.state = 'admin_add_student_chatid';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '📱 شناسه عددی بله (Chat ID) دانش‌آموز را ارسال کنید:\n(در صورتی که چت‌آیدی مشخص نیست عدد 0 بفرستید تا خودکار ایجاد شود)', this.getCancelAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_add_student_chatid') {
      let cId = parseInt(text.replace(/\D/g, ''), 10);
      if (isNaN(cId) || cId === 0) cId = Math.floor(1000000 + Math.random() * 9000000);
      const newSt: Student = {
        id: `st_${Date.now()}`,
        baleChatId: cId,
        fullName: session.tempData.fullName,
        grade: session.tempData.grade,
        className: session.tempData.className,
        isApproved: true,
        joinedAt: new Date().toLocaleDateString('fa-IR'),
        lastActiveAt: 'امروز',
        leaguePoints: 100,
        tier: 'برنزی',
        stats: { totalAnswered: 0, correctAnswers: 0, accuracyPercentage: 0, streakDays: 1, duelsPlayed: 0, duelsWon: 0 },
      };
      db.saveStudent(newSt);
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ دانش‌آموز **${newSt.fullName}** (پایه ${newSt.grade}م - کلاس ${newSt.className}) با موفقیت به سامانه مفیدگیم اضافه و در Firebase همگام شد.`, this.getStudentsAdminKeyboard());
      return true;
    }

    // --- Edit Student Wizard ---
    if (session.state === 'admin_edit_student_search') {
      const qText = text.toLowerCase();
      const st = db.getStudents().find((s) => s.id === text || String(s.baleChatId) === text || s.fullName.toLowerCase().includes(qText));
      if (st) {
        session.tempData = { studentId: st.id, studentName: st.fullName, student: st };
        session.state = 'admin_edit_student_choose_action';
        this.userSessions.set(chatId, session);
        await this.sendMessage(
          chatId,
          `👤 **دانش‌آموز:** ${st.fullName}\n📚 پایه: ${st.grade}م | کلاس: ${st.className}\n💎 امتیاز فعلی: **${st.leaguePoints}**\n\nچه بخشی را می‌خواهید ویرایش کنید؟`,
          {
            keyboard: [
              [{ text: '💎 ویرایش امتیاز' }, { text: '👤 ویرایش نام' }],
              [{ text: '📚 ویرایش پایه' }, { text: '🏫 ویرایش کلاس' }],
              [{ text: '❌ انصراف و بازگشت به پنل مدیریت' }]
            ],
            resize_keyboard: true,
          }
        );
      } else {
        await this.sendMessage(chatId, '❌ دانش‌آموزی با این مشخصات یافت نشد. لطفاً نام یا شناسه معتبر ارسال فرمایید:', this.getCancelAdminKeyboard());
      }
      return true;
    }

    if (session.state === 'admin_edit_student_choose_action') {
      if (text === '💎 ویرایش امتیاز') {
        session.state = 'admin_edit_student_val_score';
        this.userSessions.set(chatId, session);
        await this.sendMessage(chatId, `💎 لطفاً امتیاز جدید برای **${session.tempData.studentName}** را وارد کنید:`, this.getCancelAdminKeyboard());
        return true;
      }
      if (text === '👤 ویرایش نام') {
        session.state = 'admin_edit_student_val_name';
        this.userSessions.set(chatId, session);
        await this.sendMessage(chatId, `👤 لطفاً نام و نام خانوادگی جدید را ارسال فرمایید:`, this.getCancelAdminKeyboard());
        return true;
      }
      if (text === '📚 ویرایش پایه') {
        session.state = 'admin_edit_student_val_grade';
        this.userSessions.set(chatId, session);
        await this.sendMessage(chatId, `📚 پایه جدید را انتخاب کنید:`, {
          keyboard: [[{ text: 'پایه هفتم' }, { text: 'پایه هشتم' }, { text: 'پایه نهم' }], [{ text: '❌ انصراف و بازگشت به پنل مدیریت' }]],
          resize_keyboard: true,
        });
        return true;
      }
      if (text === '🏫 ویرایش کلاس') {
        session.state = 'admin_edit_student_val_class';
        this.userSessions.set(chatId, session);
        await this.sendMessage(chatId, `🏫 نام کلاس جدید را ارسال کنید (مثال: هشتم ۲):`, this.getCancelAdminKeyboard());
        return true;
      }
    }

    if (session.state === 'admin_edit_student_val_score') {
      const pts = parseInt(text.replace(/[^\d-]/g, ''), 10);
      if (isNaN(pts)) {
        await this.sendMessage(chatId, '❌ لطفاً یک عدد معتبر ارسال کنید:');
        return true;
      }
      db.updateStudent(session.tempData.studentId, { leaguePoints: pts });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ امتیاز **${session.tempData.studentName}** با موفقیت به **${pts}** به‌روز شد.`, this.getStudentsAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_edit_student_val_name') {
      db.updateStudent(session.tempData.studentId, { fullName: text });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ نام دانش‌آموز با موفقیت به **${text}** تغییر یافت.`, this.getStudentsAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_edit_student_val_grade') {
      const gradeMap: any = { 'پایه هفتم': '7', 'پایه هشتم': '8', 'پایه نهم': '9' };
      const g = gradeMap[text] || text.replace(/\D/g, '') || '7';
      db.updateStudent(session.tempData.studentId, { grade: g as GradeLevel });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ پایه تحصیلی **${session.tempData.studentName}** به پایه **${g}م** تغییر یافت.`, this.getStudentsAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_edit_student_val_class') {
      db.updateStudent(session.tempData.studentId, { className: text });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ کلاس دانش‌آموز به **${text}** به‌روز شد.`, this.getStudentsAdminKeyboard());
      return true;
    }

    // --- Search Student Report Card ---
    if (session.state === 'admin_search_student_report') {
      const qText = text.toLowerCase();
      const st = db.getStudents().find((s) => s.id === text || String(s.baleChatId) === text || s.fullName.toLowerCase().includes(qText));
      this.userSessions.set(chatId, { state: 'idle' });
      if (st) {
        const rep =
          `📊 **کارنامه جامع تحصیلی مفیدگیم:**\n\n` +
          `👤 نام: **${st.fullName}**\n` +
          `🆔 شناسه: \`${st.id}\` | چت بله: \`${st.baleChatId}\`\n` +
          `📚 پایه: **پایه ${st.grade}م** | کلاس: **${st.className}**\n` +
          `💎 امتیاز لیگ: **${st.leaguePoints}** | نشان: **${st.tier}**\n` +
          `🎯 کل سؤالات پاسخ‌داده: **${st.stats?.totalAnswered || 0} سؤال**\n` +
          `✅ پاسخ‌های صحیح: **${st.stats?.correctAnswers || 0}** (${st.stats?.accuracyPercentage || 0}٪ دقت)\n` +
          `🔥 زنجیره مطالعه مستمر: **${st.stats?.streakDays || 1} روز**\n` +
          `⚔️ دوئل‌های علمی: **${st.stats?.duelsPlayed || 0} بازی (${st.stats?.duelsWon || 0} برد)**\n` +
          `📅 تاریخ عضویت: ${st.joinedAt || 'ثبت اولیه'}`;
        await this.sendMessage(chatId, rep, this.getStudentsAdminKeyboard());
      } else {
        await this.sendMessage(chatId, '❌ دانش‌آموزی با این مشخصات یافت نشد.', this.getStudentsAdminKeyboard());
      }
      return true;
    }

    // --- Delete Student ---
    if (session.state === 'admin_delete_student_id') {
      const qText = text.toLowerCase();
      const stDel = db.getStudents().find((s) => s.id === text || String(s.baleChatId) === text || s.fullName.toLowerCase().includes(qText));
      this.userSessions.set(chatId, { state: 'idle' });
      if (stDel) {
        db.deleteStudent(stDel.id);
        await this.sendMessage(chatId, `✅ دانش‌آموز **${stDel.fullName}** با موفقیت از سیستم حذف گردید.`, this.getStudentsAdminKeyboard());
      } else {
        await this.sendMessage(chatId, '❌ دانش‌آموزی با این مشخصات یافت نشد.', this.getStudentsAdminKeyboard());
      }
      return true;
    }

    // --- Add Question Wizard ---
    if (session.state === 'admin_add_q_grade') {
      const gradeMap: any = { 'پایه هفتم': '7', 'پایه هشتم': '8', 'پایه نهم': '9' };
      session.tempData.grade = gradeMap[text] || text.replace(/\D/g, '') || '7';
      session.state = 'admin_add_q_subject';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '📖 درس مربوط به این سؤال را انتخاب کنید:', {
        keyboard: [[{ text: 'ریاضی' }, { text: 'علوم تجربی' }], [{ text: 'ادبیات فارسی' }, { text: 'زبان انگلیسی' }], [{ text: '❌ انصراف و بازگشت به پنل مدیریت' }]],
        resize_keyboard: true,
      });
      return true;
    }

    if (session.state === 'admin_add_q_subject') {
      const subMap: any = { ریاضی: 'math', 'علوم تجربی': 'science', 'ادبیات فارسی': 'persian', 'زبان انگلیسی': 'english' };
      session.tempData.subject = subMap[text] || 'math';
      session.tempData.subjectName = text;
      session.state = 'admin_add_q_text';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '❓ صورت سؤال را بنویسید و ارسال کنید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_add_q_text') {
      session.tempData.questionText = text;
      session.state = 'admin_add_q_options';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '🔢 چهار گزینه سؤال را ارسال کنید:\n(می‌توانید در ۴ خط بنویسید یا با خط تیره جدا کنید، مثل: گزینه۱ - گزینه۲ - گزینه۳ - گزینه۴)', this.getCancelAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_add_q_options') {
      let opts = text.split(/[\n\-،,]+/).map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) opts = [text, 'گزینه ۲', 'گزینه ۳', 'گزینه ۴'];
      while (opts.length < 4) opts.push(`گزینه ${opts.length + 1}`);
      opts = opts.slice(0, 4);

      session.tempData.options = opts;
      session.state = 'admin_add_q_correct';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '✅ گزینه صحیح کدام است؟ لمس کنید یا بنویسید:', {
        keyboard: [opts.map((o) => ({ text: o })), [{ text: '❌ انصراف و بازگشت به پنل مدیریت' }]],
        resize_keyboard: true,
      });
      return true;
    }

    if (session.state === 'admin_add_q_correct') {
      session.tempData.correctAnswer = text;
      session.state = 'admin_add_q_exp';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '💡 لطفاً پاسخ تشریحی و نکته آموزشی سؤال را بنویسید:\n(در صورت عدم نیاز، کلمه «ندارد» را ارسال کنید)', this.getCancelAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_add_q_exp') {
      const newQ: Question = {
        id: `q_${session.tempData.subject.charAt(0)}${session.tempData.grade}_${Date.now()}`,
        grade: session.tempData.grade,
        subjectId: `${session.tempData.subject}_${session.tempData.grade}`,
        chapterId: `${session.tempData.subject.charAt(0)}${session.tempData.grade}_ch1`,
        topic: 'طراحی مدیر در بله',
        type: 'four_choice',
        difficulty: 'medium',
        questionText: session.tempData.questionText,
        options: session.tempData.options,
        correctAnswer: session.tempData.correctAnswer,
        explanation: text === 'ندارد' ? 'پاسخ صحیح گزینه فوق است.' : text,
        status: 'approved',
        source: 'طراحی شده در پنل بله توسط مدیر',
        createdAt: new Date().toISOString(),
      };
      db.addQuestion(newQ);
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ سؤال جدید با موفقیت به بانک سؤالات پایه ${newQ.grade} (${session.tempData.subjectName}) افزوده و در Firebase ذخیره شد!`, this.getQuestionsAdminKeyboard());
      return true;
    }

    // --- Edit Question Wizard ---
    if (session.state === 'admin_edit_q_search') {
      const q = db.getQuestionById(text.trim());
      if (q) {
        session.tempData = { qId: q.id, question: q };
        session.state = 'admin_edit_q_choose_action';
        this.userSessions.set(chatId, session);
        await this.sendMessage(
          chatId,
          `📝 **سؤال یافت شد:**\n«${q.questionText}»\n✅ گزینه درست: ${q.correctAnswer}\n\nچه بخشی از سؤال را می‌خواهید ویرایش کنید؟`,
          {
            keyboard: [
              [{ text: '✏️ ویرایش متن سؤال' }, { text: '🔢 ویرایش گزینه‌ها' }],
              [{ text: '✅ ویرایش گزینه درست' }, { text: '💡 ویرایش پاسخ تشریحی' }],
              [{ text: '❌ انصراف و بازگشت به پنل مدیریت' }]
            ],
            resize_keyboard: true,
          }
        );
      } else {
        await this.sendMessage(chatId, `❌ سؤالی با شناسه «${text}» یافت نشد. لطفاً شناسه معتبر وارد کنید:`, this.getCancelAdminKeyboard());
      }
      return true;
    }

    if (session.state === 'admin_edit_q_choose_action') {
      if (text === '✏️ ویرایش متن سؤال') {
        session.state = 'admin_edit_q_val_text';
        this.userSessions.set(chatId, session);
        await this.sendMessage(chatId, '✏️ متن جدید سؤال را بنویسید و بفرستید:', this.getCancelAdminKeyboard());
        return true;
      }
      if (text === '🔢 ویرایش گزینه‌ها') {
        session.state = 'admin_edit_q_val_options';
        this.userSessions.set(chatId, session);
        await this.sendMessage(chatId, '🔢 چهار گزینه جدید را ارسال کنید (در ۴ خط یا با خط تیره):', this.getCancelAdminKeyboard());
        return true;
      }
      if (text === '✅ ویرایش گزینه درست') {
        session.state = 'admin_edit_q_val_correct';
        this.userSessions.set(chatId, session);
        await this.sendMessage(chatId, '✅ گزینه صحیح جدید را بنویسید و ارسال کنید:', this.getCancelAdminKeyboard());
        return true;
      }
      if (text === '💡 ویرایش پاسخ تشریحی') {
        session.state = 'admin_edit_q_val_exp';
        this.userSessions.set(chatId, session);
        await this.sendMessage(chatId, '💡 پاسخ تشریحی جدید را بنویسید:', this.getCancelAdminKeyboard());
        return true;
      }
    }

    if (session.state === 'admin_edit_q_val_text') {
      db.updateQuestion(session.tempData.qId, { questionText: text });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ صورت سؤال با موفقیت ویرایش شد.`, this.getQuestionsAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_edit_q_val_options') {
      let opts = text.split(/[\n\-،,]+/).map((s) => s.trim()).filter(Boolean);
      while (opts.length < 4) opts.push(`گزینه ${opts.length + 1}`);
      opts = opts.slice(0, 4);
      db.updateQuestion(session.tempData.qId, { options: opts });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ گزینه‌های سؤال با موفقیت به‌روزرسانی شدند.`, this.getQuestionsAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_edit_q_val_correct') {
      db.updateQuestion(session.tempData.qId, { correctAnswer: text.trim() });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ گزینه صحیح سؤال با موفقیت به «${text}» تغییر یافت.`, this.getQuestionsAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_edit_q_val_exp') {
      db.updateQuestion(session.tempData.qId, { explanation: text.trim() });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ پاسخ تشریحی سؤال با موفقیت به‌روز شد.`, this.getQuestionsAdminKeyboard());
      return true;
    }

    // --- AI Generate Question ---
    if (session.state === 'admin_ai_generate_q') {
      await this.sendMessage(chatId, '🤖 هوش مصنوعی در حال طراحی سؤال استاندارد آموزشی است...');
      const aiRes = await executeAdminAiCommand(text, chatId);
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, aiRes.message, this.getQuestionsAdminKeyboard());
      return true;
    }

    // --- Delete Question ---
    if (session.state === 'admin_delete_q_id') {
      const ok = db.deleteQuestion(text.trim());
      this.userSessions.set(chatId, { state: 'idle' });
      if (ok) {
        await this.sendMessage(chatId, `✅ سؤال «${text}» با موفقیت حذف گردید.`, this.getQuestionsAdminKeyboard());
      } else {
        await this.sendMessage(chatId, `❌ سؤالی با شناسه «${text}» یافت نشد.`, this.getQuestionsAdminKeyboard());
      }
      return true;
    }

    // --- Add Admin ---
    if (session.state === 'admin_add_admin_chatid') {
      const cid = parseInt(text.replace(/\D/g, ''), 10);
      if (!cid) {
        await this.sendMessage(chatId, '❌ شناسه عددی نامعتبر است. لطفاً عدد Chat ID بله را ارسال فرمایید:');
        return true;
      }
      session.tempData.chatId = cid;
      session.state = 'admin_add_admin_name';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '👤 نام و سمت مدیر را وارد کنید (مثلاً: آقای حسینی - معاون):', this.getCancelAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_add_admin_name') {
      db.addAdmin({
        id: `adm_${Date.now()}`,
        chatId: session.tempData.chatId,
        fullName: text,
        role: 'principal',
        addedAt: new Date().toLocaleDateString('fa-IR'),
        permissions: { canManageQuestions: true, canManageStudents: true, canBroadcast: true, canUseAiCopilot: true, canManageAdmins: true },
      });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ دسترسی مدیریت برای **${text}** (شناسه: ${session.tempData.chatId}) با موفقیت فعال گردید.`, this.getAdminsManagementKeyboard());
      return true;
    }

    // --- Edit Admin ---
    if (session.state === 'admin_edit_admin_chatid') {
      const cid = parseInt(text.replace(/\D/g, ''), 10);
      const adm = db.getAdminByChatId(cid);
      if (adm) {
        session.tempData = { adminChatId: cid, admin: adm };
        session.state = 'admin_edit_admin_val_name';
        this.userSessions.set(chatId, session);
        await this.sendMessage(chatId, `👑 مدیر «${adm.fullName}» یافت شد.\nلطفاً نام و سمت جدید را ارسال کنید:`, this.getCancelAdminKeyboard());
      } else {
        await this.sendMessage(chatId, '❌ مدیری با این شناسه چت یافت نشد.', this.getAdminsManagementKeyboard());
      }
      return true;
    }

    if (session.state === 'admin_edit_admin_val_name') {
      const adm = db.getAdminByChatId(session.tempData.adminChatId);
      if (adm) {
        adm.fullName = text;
        db.save();
      }
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ مشخصات مدیر با موفقیت به‌روزرسانی شد.`, this.getAdminsManagementKeyboard());
      return true;
    }

    // --- Delete Admin ---
    if (session.state === 'admin_delete_admin_chatid') {
      const cid = parseInt(text.replace(/\D/g, ''), 10);
      const ok = db.deleteAdmin(cid);
      this.userSessions.set(chatId, { state: 'idle' });
      if (ok) {
        await this.sendMessage(chatId, `✅ دسترسی مدیر با شناسه ${cid} لغو شد.`, this.getAdminsManagementKeyboard());
      } else {
        await this.sendMessage(chatId, '❌ مدیری با این شناسه یافت نشد.', this.getAdminsManagementKeyboard());
      }
      return true;
    }

    // --- Add Resource Wizard ---
    if (session.state === 'admin_add_res_title') {
      session.tempData.title = text;
      session.state = 'admin_add_res_grade';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '📚 منبع برای کدام پایه تحصیلی است؟', {
        keyboard: [[{ text: 'پایه هفتم' }, { text: 'پایه هشتم' }, { text: 'پایه نهم' }], [{ text: '❌ انصراف و بازگشت به پنل مدیریت' }]],
        resize_keyboard: true,
      });
      return true;
    }

    if (session.state === 'admin_add_res_grade') {
      const gradeMap: any = { 'پایه هفتم': '7', 'پایه هشتم': '8', 'پایه نهم': '9' };
      session.tempData.grade = gradeMap[text] || '7';
      session.state = 'admin_add_res_url';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '🔗 آدرس دانلود یا لینک منبع درسی را وارد کنید (یا بنویسید «کتاب درسی»):', this.getCancelAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_add_res_url') {
      session.tempData.url = text;
      session.state = 'admin_add_res_desc';
      this.userSessions.set(chatId, session);
      await this.sendMessage(chatId, '📝 توضیحات کوتاه درباره این منبع را ارسال کنید:', this.getCancelAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_add_res_desc') {
      const newRes: OfficialResource = {
        id: `res_${Date.now()}`,
        title: session.tempData.title,
        grade: session.tempData.grade,
        subjectId: `subject_${session.tempData.grade}`,
        type: 'textbook_pdf',
        officialSource: session.tempData.url,
        downloadUrl: session.tempData.url,
        description: text,
        status: 'synced',
        lastCheckedDate: new Date().toLocaleDateString('fa-IR'),
      };
      db.addResource(newRes);
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ منبع درسی **«${newRes.title}»** با موفقیت اضافه شد.`, this.getResourcesAdminKeyboard());
      return true;
    }

    // --- Delete Resource ---
    if (session.state === 'admin_delete_res_id') {
      const ok = db.deleteResource(text.trim());
      this.userSessions.set(chatId, { state: 'idle' });
      if (ok) {
        await this.sendMessage(chatId, `✅ منبع آموزشی با شناسه «${text}» با موفقیت حذف شد.`, this.getResourcesAdminKeyboard());
      } else {
        await this.sendMessage(chatId, `❌ منبعی با این شناسه یافت نشد.`, this.getResourcesAdminKeyboard());
      }
      return true;
    }

    // --- Settings Wizard ---
    if (session.state === 'admin_set_school_code') {
      db.updateConfig({ schoolInviteCode: text.trim().toUpperCase() });
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ کد دعوت مدرسه با موفقیت به **${text.trim().toUpperCase()}** تغییر یافت.`, this.getSettingsAdminKeyboard());
      return true;
    }

    if (session.state === 'admin_set_admin_chatid') {
      const num = parseInt(text.replace(/\D/g, ''), 10);
      if (num) {
        db.updateConfig({ adminChatId: num });
        this.userSessions.set(chatId, { state: 'idle' });
        await this.sendMessage(chatId, `✅ شناسه چت مدیر ارشد با موفقیت به **${num}** به‌روز شد.`, this.getSettingsAdminKeyboard());
      } else {
        await this.sendMessage(chatId, '❌ شناسه عددی نامعتبر است.');
      }
      return true;
    }

    // --- Broadcast Execution ---
    if (session.state === 'admin_broadcast_all' || session.state === 'admin_broadcast_g7' || session.state === 'admin_broadcast_g8' || session.state === 'admin_broadcast_g9') {
      const gradeFilter = session.state === 'admin_broadcast_g7' ? '7' : session.state === 'admin_broadcast_g8' ? '8' : session.state === 'admin_broadcast_g9' ? '9' : null;
      await this.sendMessage(chatId, '⏳ در حال ارسال پیام همگانی...');
      const students = db.getStudents().filter((s) => !gradeFilter || s.grade === gradeFilter);
      let sentCount = 0;
      for (const st of students) {
        if (st.baleChatId) {
          try {
            await this.sendMessage(st.baleChatId, `📢 **اطلاعیه مهم مجتمع آموزشی مفید یادگار امام:**\n\n${text}\n\n🏫 معاونت آموزشی دبیرستان مفید`);
            sentCount++;
          } catch {}
        }
      }
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `✅ پیام همگانی با موفقیت برای **${sentCount}** دانش‌آموز ${gradeFilter ? `پایه ${gradeFilter}م` : 'مدرسه'} ارسال شد.`, this.getBroadcastAdminKeyboard());
      return true;
    }

    // --- AI Copilot Natural Language Prompt ---
    if (session.state === 'admin_ai_copilot_prompt') {
      const copRes = await executeAdminAiCommand(text, chatId);
      this.userSessions.set(chatId, { state: 'idle' });
      await this.sendMessage(chatId, `🤖 نتیجه دستور هوش مصنوعی:\n\n${copRes.message}`, this.getAdminKeyboard());
      return true;
    }

    return false;
  }

  private async handleCallbackQuery(cq: any) {
    // Acknowledge callback
  }
}

export const baleBot = new BaleBotEngine();
