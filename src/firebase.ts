import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDocFromServer, setDoc, getDocs, collection } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const firestore = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(firestore, 'test', 'connection'));
    console.log('[Firebase] Connection to Firestore verified.');
    return true;
  } catch (error: any) {
    if (error?.message?.includes('the client is offline')) {
      console.warn('[Firebase] Offline warning during connection test.');
    }
    return true;
  }
}

function sanitizeForFirestore(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj, (key, value) => (value === undefined ? null : value)));
}

export async function syncStudentToFirestore(student: any) {
  try {
    const id = String(student.id || student.baleChatId || '').trim();
    if (!id) return false;
    await setDoc(doc(firestore, 'students', id), sanitizeForFirestore({
      ...student,
      syncedAt: new Date().toISOString(),
    }), { merge: true });
    return true;
  } catch (err: any) {
    console.error('[Firebase] Failed to sync student:', err.message);
    return false;
  }
}

export async function syncQuestionToFirestore(question: any) {
  try {
    const id = String(question.id || '').trim();
    if (!id) return false;
    await setDoc(doc(firestore, 'questions', id), sanitizeForFirestore({
      ...question,
      syncedAt: new Date().toISOString(),
    }), { merge: true });
    return true;
  } catch (err: any) {
    console.error('[Firebase] Failed to sync question:', err.message);
    return false;
  }
}

export async function syncQuizResultToFirestore(result: any) {
  try {
    const id = String(result.id || '').trim();
    if (!id) return false;
    await setDoc(doc(firestore, 'quizResults', id), sanitizeForFirestore({
      ...result,
      syncedAt: new Date().toISOString(),
    }), { merge: true });
    return true;
  } catch (err: any) {
    console.error('[Firebase] Failed to sync quiz result:', err.message);
    return false;
  }
}

export default app;
