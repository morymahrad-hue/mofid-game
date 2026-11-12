export type GradeLevel = '7' | '8' | '9';

export interface Subject {
  id: string;
  name: string;
  icon: string;
  grade: GradeLevel;
  chaptersCount: number;
  description: string;
}

export interface Chapter {
  id: string;
  subjectId: string;
  grade: GradeLevel;
  title: string;
  number: number;
  learningObjectives: string[];
  prerequisites: string[];
}

export type QuestionType =
  | 'four_choice'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer'
  | 'multi_step'
  | 'conceptual';

export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

export type QuestionStatus = 'approved' | 'draft' | 'needs_review' | 'rejected';

export interface Question {
  id: string;
  grade: GradeLevel;
  subjectId: string;
  chapterId: string;
  topic: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  questionText: string;
  options?: string[]; // For four_choice
  correctAnswer: string;
  explanation: string;
  commonMistakes?: string[];
  status: QuestionStatus;
  source: string; // e.g. "کتاب درسی رسمی ۱۴۰۵", "آزمون هماهنگ", "طراحی معلم"
  learningObjective?: string;
  createdAt: string;
}

export interface Student {
  id: string;
  baleChatId: number;
  username?: string;
  fullName: string;
  grade: GradeLevel;
  className: string;
  isApproved: boolean;
  schoolInviteCodeUsed?: string;
  joinedAt: string;
  lastActiveAt: string;
  leaguePoints: number;
  tier: 'برنزی' | 'نقره‌ای' | 'طلایی' | 'الماس';
  stats: {
    totalAnswered: number;
    correctAnswers: number;
    accuracyPercentage: number;
    streakDays: number;
    duelsPlayed: number;
    duelsWon: number;
  };
}

export interface LeitnerItem {
  id: string;
  studentId: string;
  questionId: string;
  boxLevel: number; // 1 to 5
  nextReviewDate: string;
  consecutiveSuccess: number;
  lastReviewedDate?: string;
}

export interface QuizResult {
  id: string;
  studentId: string;
  studentName?: string;
  subjectId: string;
  chapterId?: string;
  grade: GradeLevel;
  score: number;
  totalQuestions: number;
  correctAnswers: number;
  durationSeconds: number;
  date: string;
  details?: {
    questionId: string;
    studentAnswer: string;
    isCorrect: boolean;
  }[];
}

export interface OfficialResource {
  id: string;
  title: string;
  grade: GradeLevel;
  subjectId: string;
  type: 'textbook_pdf' | 'teacher_guide' | 'curriculum_doc' | 'lesson_plan' | 'question_bank';
  officialSource: 'roshd.ir' | 'chap.sch.ir' | 'school_department';
  downloadUrl: string;
  description: string;
  status: 'synced' | 'pending' | 'outdated';
  lastCheckedDate: string;
  fileSizeMb?: number;
}

export interface AdminUser {
  id: string;
  chatId: number;
  fullName: string;
  role: 'super_admin' | 'principal' | 'teacher' | 'content_manager';
  addedAt: string;
  permissions: {
    canManageQuestions: boolean;
    canManageStudents: boolean;
    canBroadcast: boolean;
    canUseAiCopilot: boolean;
    canManageAdmins: boolean;
  };
}

export interface TimeWindowConfig {
  enabled: boolean;
  startTime: string; // "00:00"
  endTime: string; // "24:00"
  durationDays: number; // 365
  activatedAt?: string;
  expiresAt?: string;
  isMomentToMomentActive?: boolean;
}

export interface BaleConfig {
  token: string;
  botUsername: string;
  adminChatId: number;
  adminChatIds?: number[];
  admins?: AdminUser[];
  isPollingActive: boolean;
  useWebhook: boolean;
  webhookUrl: string;
  schoolInviteCode: string;
  pollingIntervalMs: number;
  geminiApiKey?: string;
  serverLocation?: 'iran' | 'cloud';
  timeWindow247?: TimeWindowConfig;
  iranNodeStats?: {
    publicIp?: string;
    baleLatencyMs?: number;
    lastPing?: string;
    isOnline?: boolean;
    updatesProcessed?: number;
    locationName?: string;
  };
}

export interface PollingStatus {
  isActive: boolean;
  uptimeSeconds: number;
  lastUpdateId: number;
  lastPollTimestamp: string;
  lastError: string | null;
  totalUpdatesProcessed: number;
  watchdogHeartbeatCount?: number;
  autoRecoveryCount?: number;
  keepalivePings?: number;
  continuousUptimeDays?: number;
  isOneYearModeEnabled?: boolean;
  timeWindow247?: TimeWindowConfig;
  isMomentToMomentActive?: boolean;
  daysRemaining?: number;
  antiCrashShieldActive?: boolean;
  resilienceScore?: number;
  botInfo: {
    id?: number;
    username?: string;
    first_name?: string;
  } | null;
}

export interface LeagueStanding {
  rank: number;
  studentId: string;
  fullName: string;
  grade: GradeLevel;
  leaguePoints: number;
  tier: 'برنزی' | 'نقره‌ای' | 'طلایی' | 'الماس';
  avatar?: string;
}

export interface StudentMistake {
  id: string;
  studentId: string;
  questionId: string;
  questionText: string;
  subjectId: string;
  grade: GradeLevel;
  incorrectAnswer: string;
  correctAnswer: string;
  explanation: string;
  resolved: boolean;
  createdAt: string;
}

export interface DuelMatch {
  id: string;
  code: string;
  grade: GradeLevel;
  subject: string;
  challengerId: string;
  challengerName: string;
  challengerScore: number;
  opponentId?: string;
  opponentName?: string;
  opponentScore?: number;
  status: 'waiting' | 'in_progress' | 'completed';
  winnerName?: string;
  questionIds: string[];
  createdAt: string;
}

export interface DailyMission {
  id: string;
  title: string;
  description: string;
  target: number;
  rewardPoints: number;
  type: 'practice_quiz' | 'duel' | 'lesson_review' | 'mistakes_review';
}

export interface StudentDailyProgress {
  studentId: string;
  date: string;
  practiceQuizCount: number;
  duelsCount: number;
  lessonsReadCount: number;
  mistakesReviewedCount: number;
  claimedMissionIds: string[];
}

export interface StudyPlanItem {
  id: string;
  grade: GradeLevel;
  dayOfWeek: string;
  subject: string;
  topic: string;
  durationMinutes: number;
  tips: string;
}

