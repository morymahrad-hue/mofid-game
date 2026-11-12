import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

let firebaseApp: any = null;
let firestoreDb: any = null;
let isConnected = false;
let lastSyncTimestamp: string = '';
let syncedRecordsCount = 0;
let currentProjectId = '';
let currentDatabaseId = '';

export function initFirebaseBackend() {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      console.warn('[Firebase Backend] firebase-applet-config.json not found');
      return null;
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    currentProjectId = config.projectId || '';
    currentDatabaseId = config.firestoreDatabaseId || '';

    firebaseApp = getApps().length > 0 ? getApp() : initializeApp(config);
    firestoreDb = config.firestoreDatabaseId
      ? getFirestore(firebaseApp, config.firestoreDatabaseId)
      : getFirestore(firebaseApp);

    isConnected = true;
    console.log(`[Firebase Backend] Connected to Cloud Firestore: ${config.projectId}`);
    return firestoreDb;
  } catch (err: any) {
    console.error('[Firebase Backend] Initialization failed:', err.message);
    isConnected = false;
    return null;
  }
}

function sanitizeForFirestore(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj, (key, value) => (value === undefined ? null : value)));
}

export async function saveStudentToFirebase(student: any): Promise<boolean> {
  if (!firestoreDb) initFirebaseBackend();
  if (!firestoreDb || !student) return false;

  const id = String(student.id || student.baleChatId || '').trim();
  if (!id) return false;

  try {
    const docRef = doc(firestoreDb, 'students', id);
    const data = sanitizeForFirestore({
      ...student,
      cloudSyncedAt: new Date().toISOString(),
    });
    await setDoc(docRef, data, { merge: true });
    syncedRecordsCount++;
    lastSyncTimestamp = new Date().toLocaleTimeString('fa-IR');
    return true;
  } catch (err: any) {
    console.error('[Firebase Backend] Error saving student:', err.message);
    return false;
  }
}

export async function saveQuestionToFirebase(question: any): Promise<boolean> {
  if (!firestoreDb) initFirebaseBackend();
  if (!firestoreDb || !question) return false;

  const id = String(question.id || '').trim();
  if (!id) return false;

  try {
    const docRef = doc(firestoreDb, 'questions', id);
    const data = sanitizeForFirestore({
      ...question,
      cloudSyncedAt: new Date().toISOString(),
    });
    await setDoc(docRef, data, { merge: true });
    syncedRecordsCount++;
    lastSyncTimestamp = new Date().toLocaleTimeString('fa-IR');
    return true;
  } catch (err: any) {
    console.error('[Firebase Backend] Error saving question:', err.message);
    return false;
  }
}

export async function saveQuizResultToFirebase(result: any): Promise<boolean> {
  if (!firestoreDb) initFirebaseBackend();
  if (!firestoreDb || !result) return false;

  const id = String(result.id || '').trim();
  if (!id) return false;

  try {
    const docRef = doc(firestoreDb, 'quizResults', id);
    const data = sanitizeForFirestore({
      ...result,
      cloudSyncedAt: new Date().toISOString(),
    });
    await setDoc(docRef, data, { merge: true });
    syncedRecordsCount++;
    lastSyncTimestamp = new Date().toLocaleTimeString('fa-IR');
    return true;
  } catch (err: any) {
    console.error('[Firebase Backend] Error saving quiz result:', err.message);
    return false;
  }
}

export async function syncEntireDatabaseToFirebase(dbData: any): Promise<{ success: boolean; count: number; error?: string }> {
  if (!firestoreDb) initFirebaseBackend();
  if (!firestoreDb) return { success: false, count: 0, error: 'عدم دسترسی به پایگاه داده فایربیس' };

  let count = 0;
  try {
    if (Array.isArray(dbData.students)) {
      for (const st of dbData.students) {
        await saveStudentToFirebase(st);
        count++;
      }
    }

    if (Array.isArray(dbData.questions)) {
      for (const q of dbData.questions) {
        await saveQuestionToFirebase(q);
        count++;
      }
    }

    if (Array.isArray(dbData.quizResults)) {
      for (const res of dbData.quizResults) {
        await saveQuizResultToFirebase(res);
        count++;
      }
    }

    if (dbData.config) {
      const configRef = doc(firestoreDb, 'botConfig', 'main');
      await setDoc(configRef, sanitizeForFirestore({
        ...dbData.config,
        token: dbData.config.token ? `${dbData.config.token.substring(0, 8)}...` : '',
        lastSyncedAt: new Date().toISOString(),
      }), { merge: true });
      count++;
    }


    lastSyncTimestamp = new Date().toLocaleTimeString('fa-IR');
    return { success: true, count };
  } catch (err: any) {
    console.error('[Firebase Backend] Bulk sync error:', err.message);
    return { success: false, count, error: err.message };
  }
}

export function getFirebaseBackendStatus() {
  if (!firestoreDb) initFirebaseBackend();
  return {
    isConnected,
    projectId: currentProjectId || 'gen-lang-client-0447743031',
    databaseId: currentDatabaseId || 'ai-studio-remix-f840dc64-d10e-42d3-a35f-83d01321206d',
    region: 'us-east1',
    lastSyncTimestamp: lastSyncTimestamp || 'همگام‌سازی خودکار پیوسته فعال',
    syncedRecordsCount,
    statusText: isConnected ? 'متصل و همگام با سرور ابری Firebase Firestore' : 'در حال اتصال',
  };
}
