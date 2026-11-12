import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { execSync, fork } from 'child_process';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { db } from './server/db.ts';
import { baleBot } from './server/baleBot.ts';
import { generateQuestionWithAI, evaluateLittleTeacherExplanation, explainEducationalQuestionWithAI } from './server/geminiService.ts';
import { executeAdminAiCommand } from './server/adminAiCopilot.ts';
import { getFirebaseBackendStatus, syncEntireDatabaseToFirebase } from './server/firebaseSync.ts';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Global Status Endpoint
  app.get('/api/status', (req, res) => {
    const config = db.getConfig();
    const students = db.getStudents();
    const questions = db.getQuestions();
    const pollingStatus = baleBot.getStatus();

    res.json({
      ok: true,
      serverTime: new Date().toISOString(),
      polling: pollingStatus,
      geminiKeyConfigured: !!process.env.GEMINI_API_KEY,
      counts: {
        students: students.length,
        approvedStudents: students.filter((s) => s.isApproved).length,
        questions: questions.length,
        resources: db.getResources().length,
      },
      environment: {
        appUrl: process.env.APP_URL || '',
        uptimeRobotUrl: (process.env.APP_URL || '') ? `${process.env.APP_URL}/api/status` : '',
      },
      baleConfig: {
        hasToken: !!config.token,
        tokenMasked: config.token ? `${config.token.substring(0, 4)}...${config.token.slice(-4)}` : '',
        botUsername: config.botUsername,
        adminChatId: config.adminChatId,
        isPollingActive: config.isPollingActive,
        useWebhook: config.useWebhook,
        schoolInviteCode: config.schoolInviteCode,
      },
    });
  });

  // Keep-Alive & Health Endpoints
  app.get('/api/keep-alive', (req, res) => {
    baleBot.recordKeepalivePing();
    res.json({ ok: true, timestamp: new Date().toISOString(), uptime: process.uptime() });
  });

  app.get('/api/health', (req, res) => {
    baleBot.recordKeepalivePing();
    const status = baleBot.getStatus();
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      pollingActive: status.isActive,
      watchdogTicks: status.watchdogHeartbeatCount,
      autoRecoveries: status.autoRecoveryCount,
      keepalivePings: status.keepalivePings,
      memory: process.memoryUsage(),
    });
  });

  // Zero-Downtime Force-Active Endpoint
  app.post('/api/bale/ensure-active', (req, res) => {
    baleBot.recordKeepalivePing();
    const revived = baleBot.ensureRunning();
    const status = baleBot.getStatus();
    res.json({
      ok: true,
      message: 'سپر پایداری فعال است و ربات در حال اجرا می‌باشد.',
      revived,
      status,
    });
  });

  // Admins CRUD
  app.get('/api/admins', (req, res) => {
    res.json(db.getAdmins());
  });

  app.post('/api/admins', (req, res) => {
    const { chatId, fullName, role, permissions } = req.body;
    if (!chatId || !fullName) {
      return res.status(400).json({ ok: false, message: 'شناسه عددی بله و نام مدیر الزامی است' });
    }
    const newAdmin = {
      id: `adm_${Date.now()}`,
      chatId: Number(chatId),
      fullName: fullName.trim(),
      role: role || 'teacher',
      addedAt: new Date().toLocaleDateString('fa-IR'),
      permissions: permissions || {
        canManageQuestions: true,
        canManageStudents: true,
        canBroadcast: true,
        canUseAiCopilot: true,
        canManageAdmins: false,
      },
    };
    db.addAdmin(newAdmin);
    db.addLog('مدیر ارشد', 'افزودن مدیر جدید', `مدیر ${newAdmin.fullName} (شناسه ${newAdmin.chatId}) ثبت شد.`);
    res.json({ ok: true, admin: newAdmin });
  });

  app.delete('/api/admins/:id', (req, res) => {
    const success = db.deleteAdmin(req.params.id);
    if (success) {
      db.addLog('مدیر ارشد', 'حذف مدیر', `دسترسی مدیر شناسه ${req.params.id} لغو شد.`);
    }
    res.json({ ok: success });
  });

  // Config Update & Bale Token
  app.post('/api/config', async (req, res) => {
    const { token, adminChatId, schoolInviteCode, pollingIntervalMs } = req.body;
    const patch: any = {};
    if (token !== undefined) patch.token = token.trim();
    if (adminChatId !== undefined) patch.adminChatId = parseInt(adminChatId, 10);
    if (schoolInviteCode !== undefined) patch.schoolInviteCode = schoolInviteCode.trim();
    if (pollingIntervalMs !== undefined) patch.pollingIntervalMs = parseInt(pollingIntervalMs, 10);

    db.updateConfig(patch);
    db.addLog('مدیر سامانه', 'ویرایش تنظیمات', 'تنظیمات ربات بله و شناسه مدیر ذخیره شد.');
    res.json({ ok: true, message: 'تنظیمات با موفقیت ذخیره شدند.' });
  });

  // Polling Controls
  app.post(['/api/bale/start-polling', '/api/bale/polling/start'], async (req, res) => {
    const result = await baleBot.startPolling();
    res.json(result);
  });

  app.post(['/api/bale/stop-polling', '/api/bale/polling/stop'], (req, res) => {
    const result = baleBot.stopPolling();
    res.json(result);
  });

  // 24/7 Time Window (00:00 to 24:00 - 1-Year Moment-to-Moment Mode)
  app.get('/api/bale/time-window', (req, res) => {
    const tw = db.getTimeWindow247();
    const isActive = baleBot.isTimeWindowActive();
    res.json({
      ok: true,
      timeWindow: tw,
      isMomentToMomentActive: isActive,
      pollingStatus: baleBot.getStatus(),
    });
  });

  app.post('/api/bale/time-window', async (req, res) => {
    const { enabled, startTime, endTime, durationDays } = req.body;
    const patch: any = {};
    if (enabled !== undefined) patch.enabled = !!enabled;
    if (startTime !== undefined) patch.startTime = startTime;
    if (endTime !== undefined) patch.endTime = endTime;
    if (durationDays !== undefined) patch.durationDays = Number(durationDays);

    const updated = db.updateTimeWindow247(patch);
    if (updated.enabled) {
      await baleBot.startPolling();
    }
    const isNowActive = baleBot.isTimeWindowActive();
    res.json({
      ok: true,
      timeWindow: updated,
      isMomentToMomentActive: isNowActive,
      pollingStatus: baleBot.getStatus(),
      message: updated.enabled
        ? `حالت آماده‌باش لحظه‌به‌لحظه (بازه ${updated.startTime} تا ${updated.endTime} به مدت ۱ سال) با موفقیت فعال شد.`
        : 'حالت بازه زمانی ۱ ساله غیرفعال گردید.'
    });
  });

  // --- BALE WEBHOOK RECEIVER & MANAGEMENT (VPS / CLOUD) ---
  app.post(['/api/bale/webhook', '/webhook'], async (req, res) => {
    try {
      const payload = req.body;
      const updates = Array.isArray(payload) ? payload : [payload];

      for (const update of updates) {
        if (!update) continue;
        if (update.update_id !== undefined || update.message || update.callback_query) {
          baleBot.recordWebhookUpdate(update);
          baleBot.handleIncomingUpdate(update).catch((err: any) => {
            console.error('[Bale Webhook] Error processing update:', err?.message || err);
          });
        }
      }
      return res.status(200).json({ ok: true });
    } catch (err: any) {
      console.error('[Bale Webhook] Exception:', err?.message || err);
      return res.status(200).json({ ok: true });
    }
  });

  app.get('/api/bale/webhook/info', async (req, res) => {
    try {
      const config = db.getConfig();
      if (!config.token) {
        return res.status(400).json({ ok: false, message: 'توکن ربات بله موجود نیست.' });
      }
      const resp = await fetch(`https://tapi.bale.ai/bot${config.token}/getWebhookInfo`);
      const data = await resp.json();
      return res.json({
        ok: true,
        webhookInfo: data.result || data,
        currentConfigUrl: config.webhookUrl || '',
        useWebhook: config.useWebhook,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/bale/webhook/set', async (req, res) => {
    try {
      const config = db.getConfig();
      if (!config.token) {
        return res.status(400).json({ ok: false, message: 'توکن ربات بله تنظیم نشده است.' });
      }
      let targetUrl = req.body.url;
      if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
        const publicAppUrl = process.env.APP_URL || 'https://ais-dev-ri2dxsoe6cd3fathvntdgk-126315802530.europe-west3.run.app';
        targetUrl = `${publicAppUrl.replace(/\/$/, '')}/api/bale/webhook`;
      }
      targetUrl = targetUrl.trim();

      const resp = await fetch(`https://tapi.bale.ai/bot${config.token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data = await resp.json();
      if (data && data.ok) {
        baleBot.stopPolling();
        db.updateConfig({ useWebhook: true, webhookUrl: targetUrl, isPollingActive: false });
        db.addLog('مدیر سامانه', 'تنظیم وبهوک روی سرور', `وبهوک با موفقیت روی نشانی ${targetUrl} ثبت و فعال شد.`);
        return res.json({
          ok: true,
          message: `وب‌هوک با موفقیت روی نشانی ${targetUrl} ثبت گردید و حالت پولینگ متوقف شد.`,
          result: data.result,
        });
      } else {
        return res.status(400).json({
          ok: false,
          description: data.description || 'پاسخ ناموفق از سرور بله',
          details: data,
        });
      }
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/bale/webhook/delete', async (req, res) => {
    try {
      const config = db.getConfig();
      if (!config.token) {
        return res.status(400).json({ ok: false, message: 'توکن ربات بله تنظیم نشده است.' });
      }
      const resp = await fetch(`https://tapi.bale.ai/bot${config.token}/deleteWebhook`, {
        method: 'POST',
      });
      const data = await resp.json();
      db.updateConfig({ useWebhook: false, webhookUrl: '' });
      db.addLog('مدیر سامانه', 'حذف وبهوک', 'وبهوک ربات بله حذف شد و ربات به حالت پولینگ برگشت.');
      if (req.body.resumePolling !== false) {
        await baleBot.startPolling();
      }
      return res.json({
        ok: true,
        message: 'وب‌هوک با موفقیت حذف شد و سامانه به حالت پولینگ خودکار ۲۴/۷ بازگشت.',
        result: data,
      });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/bale/test-connection', async (req, res) => {
    const testToken = req.body.token || db.getConfig().token;
    if (!testToken) {
      return res.status(400).json({ ok: false, message: 'توکنی برای آزمایش ارسال نشده است.' });
    }

    try {
      const resp = await fetch(`https://tapi.bale.ai/bot${testToken}/getMe`);
      const data = await resp.json();
      if (data && data.ok) {
        db.updateConfig({ botUsername: data.result.username || 'mofidgamebot' });
        return res.json({ ok: true, result: data.result, message: 'اتصال به پیام‌رسان بله با موفقیت برقرار شد!' });
      } else {
        return res.status(400).json({ ok: false, description: data.description || 'توکن نامعتبر است' });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, message: `عدم دسترسی به سرور بله: ${err.message}` });
    }
  });

  // Simulator
  app.post('/api/bale/simulate', async (req, res) => {
    const { chatId, text, callbackData } = req.body;
    const cid = parseInt(chatId || '1000001', 10);

    const update: any = { update_id: Math.floor(Math.random() * 1000000) };
    if (callbackData) {
      update.callback_query = {
        id: `cq_${Date.now()}`,
        data: callbackData,
        message: { chat: { id: cid } },
      };
    } else {
      update.message = {
        message_id: Math.floor(Math.random() * 1000000),
        chat: { id: cid },
        from: { id: cid, username: 'test_student' },
        text: text || '',
        photo: req.body.photo,
        imageBase64: req.body.imageBase64,
        mimeType: req.body.mimeType,
      };
    }

    const responses = await baleBot.simulateUpdate(update);
    res.json({ ok: true, responses });
  });

  // Students CRUD
  app.get('/api/students', (req, res) => {
    res.json(db.getStudents());
  });

  app.post('/api/students', (req, res) => {
    const { fullName, grade, className, baleChatId } = req.body;
    if (!fullName || !grade || !baleChatId) {
      return res.status(400).json({ ok: false, message: 'نام، پایه و شناسه بله الزامی است.' });
    }
    const student = {
      id: `st_${Date.now()}`,
      baleChatId: Number(baleChatId),
      fullName: fullName.trim(),
      grade: grade as any,
      className: className?.trim() || 'کلاس عمومی',
      isApproved: true,
      joinedAt: new Date().toLocaleDateString('fa-IR'),
      lastActiveAt: 'امروز',
      leaguePoints: 100,
      tier: 'برنزی' as any,
      stats: { totalAnswered: 0, correctAnswers: 0, accuracyPercentage: 0, streakDays: 1, duelsPlayed: 0, duelsWon: 0 }
    };
    db.saveStudent(student);
    res.json({ ok: true, student });
  });

  app.patch('/api/students/:id', (req, res) => {
    const updated = db.updateStudent(req.params.id, req.body);
    res.json({ ok: !!updated, student: updated });
  });

  app.delete('/api/students/:id', (req, res) => {
    const ok = db.deleteStudent(req.params.id);
    res.json({ ok });
  });

  // --- DUELS, MISTAKES, MISSIONS, STUDY PLANS & TUTORING API ---
  app.get('/api/mistakes', (req, res) => {
    const studentId = req.query.studentId as string;
    if (!studentId) return res.status(400).json({ ok: false, message: 'studentId الزامی است' });
    res.json({ ok: true, mistakes: db.getMistakes(studentId) });
  });

  app.post('/api/mistakes/resolve', (req, res) => {
    const { studentId, questionId } = req.body;
    if (!studentId || !questionId) return res.status(400).json({ ok: false, message: 'شناسه‌ها الزامی هستند' });
    const success = db.resolveMistake(studentId, questionId);
    res.json({ ok: success });
  });

  app.get('/api/duels', (req, res) => {
    const studentId = req.query.studentId as string;
    if (studentId) {
      res.json({ ok: true, duels: db.getDuelsForStudent(studentId) });
    } else {
      res.json({ ok: true, duels: db.getRawData().duels || [] });
    }
  });

  app.post('/api/duels/create', (req, res) => {
    const { studentId, grade, subject } = req.body;
    const student = db.getStudentById(studentId);
    if (!student) return res.status(404).json({ ok: false, message: 'دانش‌آموز یافت نشد' });
    const duel = db.createDuel(student, grade || student.grade, subject || 'ریاضی و علوم');
    res.json({ ok: true, duel });
  });

  app.post('/api/duels/join', (req, res) => {
    const { code, studentId } = req.body;
    const student = db.getStudentById(studentId);
    if (!student) return res.status(404).json({ ok: false, message: 'دانش‌آموز یافت نشد' });
    const duel = db.getDuel(code);
    if (!duel) return res.status(404).json({ ok: false, message: 'کد دوئل نامعتبر است' });
    const joined = db.joinDuel(duel.id, student);
    res.json({ ok: !!joined, duel: joined });
  });

  app.post('/api/duels/score', (req, res) => {
    const { duelId, studentId, score } = req.body;
    const updated = db.submitDuelScore(duelId, studentId, Number(score));
    res.json({ ok: !!updated, duel: updated });
  });

  app.get('/api/daily-missions', (req, res) => {
    const studentId = req.query.studentId as string;
    if (!studentId) return res.status(400).json({ ok: false, message: 'studentId الزامی است' });
    const progress = db.getDailyProgress(studentId);
    res.json({ ok: true, progress });
  });

  app.post('/api/daily-missions/claim', (req, res) => {
    const { studentId, missionId } = req.body;
    if (!studentId || !missionId) return res.status(400).json({ ok: false, message: 'اطلاعات ناقص است' });
    const result = db.claimDailyMission(studentId, missionId);
    res.json({ ok: result.success, ...result });
  });

  app.get('/api/study-plans', (req, res) => {
    const grade = req.query.grade as any;
    const day = req.query.day as string;
    res.json({ ok: true, studyPlans: db.getStudyPlans(grade, day) });
  });

  app.post('/api/tutoring/ask', async (req, res) => {
    const { questionText, grade } = req.body;
    if (!questionText) return res.status(400).json({ ok: false, message: 'متن سؤال الزامی است' });
    const explanation = await explainEducationalQuestionWithAI(questionText, grade || '7');
    res.json({ ok: true, explanation });
  });

  // Curriculum & Questions CRUD

  app.get('/api/curriculum/subjects', (req, res) => {
    const { grade } = req.query;
    res.json(db.getSubjects(grade as string));
  });

  app.get('/api/curriculum/chapters', (req, res) => {
    const { subjectId } = req.query;
    res.json(db.getChapters(subjectId as string));
  });

  app.get('/api/questions', (req, res) => {
    const { grade, subjectId, difficulty, status } = req.query;
    res.json(db.getQuestions({ grade: grade as string, subjectId: subjectId as string, difficulty: difficulty as string, status: status as string }));
  });

  app.post('/api/questions', (req, res) => {
    const q = req.body;
    q.id = q.id || `q_${Date.now()}`;
    q.createdAt = new Date().toISOString();
    const saved = db.addQuestion(q);
    res.json({ ok: true, question: saved });
  });

  app.patch('/api/questions/:id', (req, res) => {
    const updated = db.updateQuestion(req.params.id, req.body);
    res.json({ ok: !!updated, question: updated });
  });

  app.delete('/api/questions/:id', (req, res) => {
    const ok = db.deleteQuestion(req.params.id);
    res.json({ ok });
  });


  // Official Resources
  app.get('/api/resources', (req, res) => {
    res.json(db.getResources());
  });

  // AI Generation & Copilot
  app.post('/api/ai/generate-question', async (req, res) => {
    const { prompt, grade, subject } = req.body;
    const q = await generateQuestionWithAI(prompt, grade, subject);
    res.json({ ok: true, question: q });
  });

  app.post('/api/ai/copilot-command', async (req, res) => {
    const { command } = req.body;
    const result = await executeAdminAiCommand(command);
    res.json(result);
  });

  // Firebase Status & Sync
  app.get('/api/firebase/status', (req, res) => {
    res.json({
      ok: true,
      ...getFirebaseBackendStatus(),
      counts: {
        students: db.getStudents().length,
        questions: db.getQuestions().length,
        quizResults: db.getQuizResults().length,
      }
    });
  });

  app.post('/api/firebase/sync', async (req, res) => {
    try {
      const data = db.getRawData();
      const result = await syncEntireDatabaseToFirebase(data);
      res.json({
        ok: result.success,
        syncedCount: result.count,
        message: result.success
          ? `تعداد ${result.count} رکورد با موفقیت در پایگاه داده ابری Firebase Firestore ذخیره و همگام شد.`
          : result.error,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });


  // Project Full Source Code ZIP Export
  app.get(['/api/download/project-export', '/api/export-project', '/api/download/source-zip'], (req, res) => {
    const zipPath = path.join(process.cwd(), 'mofidgame-project-export.zip');
    try {
      db.save();
      // Generate/update zip archive via python zipfile if missing or requested
      if (!fs.existsSync(zipPath) || req.query.fresh === 'true') {
        execSync(`python3 -c "
import os, zipfile
EXCLUDE_DIRS = {'node_modules', '.git', '.aistudio', 'dist', '__pycache__'}
EXCLUDE_FILES = {'mofidgame-project-export.zip', '.DS_Store'}
zip_filename = 'mofidgame-project-export.zip'
root_dir = '.'
with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith('.')]
        for file in files:
            if file in EXCLUDE_FILES or file.endswith('.pyc'):
                continue
            full_path = os.path.join(root, file)
            arcname = os.path.relpath(full_path, root_dir)
            zipf.write(full_path, arcname)
"`, { stdio: 'ignore' });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="mofidgame-project-export.zip"');
      return res.download(zipPath, 'mofidgame-project-export.zip');
    } catch (err: any) {
      if (fs.existsSync(zipPath)) {
        return res.download(zipPath, 'mofidgame-project-export.zip');
      }
      return res.status(500).json({ ok: false, message: `خطا در ایجاد فایل زیپ: ${err.message}` });
    }
  });

  // GitHub Status & Automated One-Click Push
  app.get('/api/github/status', (req, res) => {
    try {
      execSync('git config --global --add safe.directory /app/applet', { stdio: 'ignore' });
      const hasGit = fs.existsSync(path.join(process.cwd(), '.git'));
      let lastCommit = '';
      let branch = 'main';
      let remoteUrl = '';

      if (hasGit) {
        try {
          lastCommit = execSync('git log -1 --pretty=format:"%h - %s (%cr)"', { encoding: 'utf-8' }).trim();
          branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
          remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
        } catch {}
      }

      res.json({
        ok: true,
        isGitInitialized: hasGit,
        currentBranch: branch,
        lastCommit,
        remoteOrigin: remoteUrl ? remoteUrl.replace(/:[^@]+@/, ':***@') : null,
      });
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/github/push', async (req, res) => {
    const { repoUrl, token, branch = 'main', commitMessage } = req.body;
    if (!repoUrl || !repoUrl.trim()) {
      return res.status(400).json({ ok: false, message: 'لطفاً نشانی مخزن گیت‌هاب (GitHub Repository URL) را وارد فرمایید.' });
    }

    try {
      execSync('git config --global --add safe.directory /app/applet', { stdio: 'ignore' });
      execSync('git config --global user.name "MofidGame AutoDeploy"', { stdio: 'ignore' });
      execSync('git config --global user.email "bot@mofidgame.local"', { stdio: 'ignore' });

      if (!fs.existsSync(path.join(process.cwd(), '.git'))) {
        execSync('git init', { encoding: 'utf-8' });
      }

      try {
        execSync(`git checkout -b ${branch}`, { stdio: 'ignore' });
      } catch {
        try {
          execSync(`git checkout ${branch}`, { stdio: 'ignore' });
        } catch {}
      }

      db.save();
      execSync('git add -A', { encoding: 'utf-8' });

      const msg = commitMessage || `Automated deployment for GitHub Pages & 24/7 Bale Bot - ${new Date().toLocaleDateString('fa-IR')}`;
      try {
        execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' });
      } catch {
        // Nothing changed is fine
      }

      let cleanUrl = repoUrl.trim();
      let targetRemote = cleanUrl;
      if (token && token.trim()) {
        const cleanToken = token.trim();
        if (cleanUrl.startsWith('https://')) {
          targetRemote = cleanUrl.replace(/^https:\/\/(.*@)?github\.com\//, `https://${cleanToken}@github.com/`);
        } else if (cleanUrl.startsWith('git@github.com:')) {
          const repoPath = cleanUrl.replace('git@github.com:', '');
          targetRemote = `https://${cleanToken}@github.com/${repoPath}`;
        }
      }

      try {
        execSync('git remote remove origin', { stdio: 'ignore' });
      } catch {}
      execSync(`git remote add origin "${targetRemote}"`, { encoding: 'utf-8' });

      const pushOutput = execSync(`git push -u origin ${branch} --force`, { encoding: 'utf-8', timeout: 45000 });

      // Automatically deploy dist to gh-pages branch for instant GitHub Pages activation
      let ghPagesOutput = '';
      try {
        execSync('npm run build', { encoding: 'utf-8' });
        const distGitCmd = `cd dist && rm -rf .git && git init && git config user.name "MofidGame AutoDeploy" && git config user.email "bot@mofidgame.local" && git checkout -b gh-pages && git add -A && git commit -m "Deploy production build to GitHub Pages" && git remote add origin "${targetRemote}" && git push -u origin gh-pages --force && rm -rf .git`;
        ghPagesOutput = execSync(distGitCmd, { encoding: 'utf-8', timeout: 45000 });
      } catch (ghErr: any) {
        console.warn('[GitHub Pages Push Note]:', ghErr?.message || ghErr);
      }

      // Extract GitHub username and repo name for direct live URL
      let ghPagesUrl = '';
      const match = cleanUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (match) {
        ghPagesUrl = `https://${match[1]}.github.io/${match[2]}/`;
      }

      const maskedOrigin = targetRemote.replace(/:[^@]+@/, ':***@');
      db.addLog('استقرار خودکار', 'پوش به گیت‌هاب', `پروژه با موفقیت به مخزن گیت‌هاب (${maskedOrigin}) و GitHub Pages ارسال شد.`);

      res.json({
        ok: true,
        message: '✅ پروژه با موفقیت به مخزن گیت‌هاب ارسال شد و روی GitHub Pages مستقر گردید!',
        remote: maskedOrigin,
        branch,
        pagesUrl: ghPagesUrl,
        output: pushOutput + '\n' + ghPagesOutput,
      });
    } catch (err: any) {
      console.error('[GitHub Push Error]:', err?.message || err);
      const cleanErr = (err.message || String(err)).replace(/:[^@]+@/, ':***@');
      res.status(500).json({
        ok: false,
        message: `خطا در ارسال به گیت‌هاب: ${cleanErr}`,
        details: cleanErr,
      });
    }
  });

  // Database Backup Download
  app.get('/api/database/backup', (req, res) => {
    const data = db.getRawData();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="mofidgame_db_backup.json"');
    res.send(JSON.stringify(data, null, 2));
  });


  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [MofidGame Server] Running at http://localhost:${PORT}`);

    // Immediately start Fast Real-Time Polling for Bale bot
    baleBot.startPolling().catch((err: any) => {
      console.warn('[Bale Bot] Auto-start note:', err?.message || err);
    });


    // --- 1-Year Non-Stop Continuous Keep-Alive Self-Ping & Sentinel Shield ---
    setInterval(async () => {
      try {
        baleBot.recordKeepalivePing();
        // Sentinel check: Guarantee bot never stays inactive
        baleBot.ensureRunning();
        await fetch(`http://127.0.0.1:${PORT}/api/health`).catch(() => {});
      } catch {}
    }, 10000);

    // Auto-backup every 24h
    setInterval(() => {
      try {
        db.backup();
      } catch {}
    }, 86400000);

    // --- Continuous Forever Firebase Cloud Sync (Initial & Every 60s) ---
    syncEntireDatabaseToFirebase(db.getRawData())
      .then((res) => {
        console.log(`[Firebase Forever Sync] Initial boot sync: ${res.count} records synced.`);
      })
      .catch((err) => {
        console.warn('[Firebase Forever Sync] Initial boot sync note:', err?.message || err);
      });

    setInterval(async () => {
      try {
        await syncEntireDatabaseToFirebase(db.getRawData());
      } catch (err: any) {
        console.warn('[Firebase Forever Sync] Background tick note:', err?.message || err);
      }
    }, 60000);
  });
}

process.on('uncaughtException', (err: any) => {
  console.error('[MofidGame Shield] Prevented uncaught exception crash:', err?.message || err);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[MofidGame Shield] Prevented unhandled rejection crash:', reason?.message || reason);
});

startServer().catch((err) => {
  console.error('[Server Startup Failure]:', err);
});
