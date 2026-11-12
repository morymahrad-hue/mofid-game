import fs from 'fs';
import path from 'path';
import {
  saveStudentToFirebase,
  saveQuestionToFirebase,
  saveQuizResultToFirebase,
  initFirebaseBackend
} from './firebaseSync.ts';
import {
  AdminUser,
  BaleConfig,
  Chapter,
  DailyMission,
  DuelMatch,
  GradeLevel,
  LeitnerItem,
  OfficialResource,
  Question,
  QuizResult,
  Student,
  StudentDailyProgress,
  StudentMistake,
  StudyPlanItem,
  Subject,
  TimeWindowConfig
} from '../src/types/index.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'mofidgame_db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export interface DatabaseSchema {
  config: BaleConfig;
  admins: AdminUser[];
  subjects: Subject[];
  chapters: Chapter[];
  questions: Question[];
  students: Student[];
  leitnerItems: LeitnerItem[];
  quizResults: QuizResult[];
  resources: OfficialResource[];
  mistakes: StudentMistake[];
  duels: DuelMatch[];
  dailyMissions: StudentDailyProgress[];
  studyPlans: StudyPlanItem[];
  auditLogs: {
    id: string;
    timestamp: string;
    actor: string;
    action: string;
    details: string;
  }[];
}


const defaultSubjects: Subject[] = [
  { id: 'math_7', name: 'ریاضی هفتم', icon: '📐', grade: '7', chaptersCount: 9, description: 'اعداد صحیح، هندسه، جبر و معادله، توان، آمار و احتمال' },
  { id: 'science_7', name: 'علوم تجربی هفتم', icon: '🔬', grade: '7', chaptersCount: 15, description: 'ماده و تغییرات، اتم‌ها، زیست‌شناسی، فیزیک حرکت و انرژی' },
  { id: 'persian_7', name: 'ادبیات فارسی هفتم', icon: '📖', grade: '7', chaptersCount: 6, description: 'دستور زبان، آرایه‌های ادبی، درک مطلب، نگارش' },
  { id: 'english_7', name: 'زبان انگلیسی هفتم', icon: '🌍', grade: '7', chaptersCount: 8, description: 'مکالمه، واژگان روزمره و درک شنیداری' },

  { id: 'math_8', name: 'ریاضی هشتم', icon: '📐', grade: '8', chaptersCount: 9, description: 'عددهای گویا، حساب اعداد طبیعی، چندضلعی‌ها، بردار، توان و جذر' },
  { id: 'science_8', name: 'علوم تجربی هشتم', icon: '🔬', grade: '8', chaptersCount: 15, description: 'تغییرات شیمیایی، تنظیم عصبی، حس و حرکت، الکتریسیته' },
  { id: 'persian_8', name: 'ادبیات فارسی هشتم', icon: '📖', grade: '8', chaptersCount: 6, description: 'نقش‌های دستوری، جناس، تشبیه، استعاره' },

  { id: 'math_9', name: 'ریاضی نهم', icon: '📐', grade: '9', chaptersCount: 8, description: 'مجموعه‌ها، عددهای حقیقی، استدلال و اثبات در هندسه، خط' },
  { id: 'science_9', name: 'علوم تجربی نهم', icon: '🔬', grade: '9', chaptersCount: 15, description: 'مواد و نقش آنها، ماشین‌ها، فشار و آثار آن، زمین‌ساخت ورقی' },
  { id: 'persian_9', name: 'ادبیات فارسی نهم', icon: '📖', grade: '9', chaptersCount: 6, description: 'وزن شعر، قرابت معنایی، آرایه‌های ترکیبی' }
];

const defaultChapters: Chapter[] = [
  { id: 'm7_ch1', subjectId: 'math_7', grade: '7', number: 1, title: 'راهبردهای حل مسئله', learningObjectives: ['رسم شکل', 'الگوسازی', 'حذف حالت‌های نامطلوب'], prerequisites: ['ریاضی ششم'] },
  { id: 'm7_ch2', subjectId: 'math_7', grade: '7', number: 2, title: 'عددهای صحیح', learningObjectives: ['محور اعداد صحیح', 'جمع و تفریق عدد صحیح'], prerequisites: ['اعداد منفی پایه'] },
  { id: 'm7_ch3', subjectId: 'math_7', grade: '7', number: 3, title: 'جبر و معادله', learningObjectives: ['الگوهای عددی', 'عبارت‌های جبری', 'معادله'], prerequisites: ['عددهای صحیح'] },
  { id: 's7_ch1', subjectId: 'science_7', grade: '7', number: 1, title: 'تجربه و تفکر', learningObjectives: ['روش علمی', 'اندازه‌گیری و ابزارها'], prerequisites: ['علوم ششم'] },
  { id: 'm8_ch1', subjectId: 'math_8', grade: '8', number: 1, title: 'عددهای صحیح و گویا', learningObjectives: ['یادآوری عددهای صحیح', 'معرفی عددهای گویا'], prerequisites: ['ریاضی هفتم'] },
  { id: 's8_ch1', subjectId: 'science_8', grade: '8', number: 1, title: 'مخلوط و جداسازی مواد', learningObjectives: ['مخلوط‌های همگن و ناهمگن'], prerequisites: ['علوم هفتم'] },
  { id: 'm9_ch1', subjectId: 'math_9', grade: '9', number: 1, title: 'مجموعه‌ها', learningObjectives: ['معرفی مجموعه', 'مجموعه‌های برابر و زیرمجموعه', 'تفاضل و اشتراک'], prerequisites: ['ریاضی هشتم'] },
  { id: 's9_ch1', subjectId: 'science_9', grade: '9', number: 1, title: 'مواد و نقش آنها در زندگی', learningObjectives: ['عناصر نافلز و فلز', 'بسپارها'], prerequisites: ['علوم هشتم'] }
];

const defaultQuestions: Question[] = [
  {
    id: 'q_m7_01',
    grade: '7',
    subjectId: 'math_7',
    chapterId: 'm7_ch2',
    topic: 'جمع و تفریق اعداد صحیح',
    type: 'four_choice',
    difficulty: 'easy',
    questionText: 'حاصل عبارت (-۱۵) + (+۲۳) - (-۷) کدام است؟',
    options: ['+۱۵', '+۲۵', '+۳۱', '+۱'],
    correctAnswer: '+۱۵',
    explanation: 'ابتدا منفی در منفی مثبت می‌شود: (-۱۵) + ۲۳ + ۷ = ۸ + ۷ = ۱۵.',
    status: 'approved',
    source: 'کتاب ریاضی هفتم، فصل ۲',
    createdAt: new Date().toISOString()
  },
  {
    id: 'q_m7_02',
    grade: '7',
    subjectId: 'math_7',
    chapterId: 'm7_ch3',
    topic: 'معادله جبری',
    type: 'four_choice',
    difficulty: 'medium',
    questionText: 'در معادله ۳x - ۵ = ۱۰، مقدار x کدام است؟',
    options: ['۳', '۵', '۴', '۶'],
    correctAnswer: '۵',
    explanation: '۳x = ۱۰ + ۵ => ۳x = ۱۵ => x = ۵.',
    status: 'approved',
    source: 'کتاب ریاضی هفتم، فصل ۳',
    createdAt: new Date().toISOString()
  },
  {
    id: 'q_s7_01',
    grade: '7',
    subjectId: 'science_7',
    chapterId: 's7_ch1',
    topic: 'اندازه‌گیری در علوم',
    type: 'four_choice',
    difficulty: 'easy',
    questionText: 'یکای استاندارد بین‌المللی (SI) برای اندازه‌گیری جرم کدام است؟',
    options: ['گرم', 'کیلوگرم', 'نیوتون', 'تن'],
    correctAnswer: 'کیلوگرم',
    explanation: 'یکای استاندارد جرم در سیستم SI کیلوگرم (kg) است.',
    status: 'approved',
    source: 'کتاب علوم هفتم، فصل ۱',
    createdAt: new Date().toISOString()
  },
  {
    id: 'q_m8_01',
    grade: '8',
    subjectId: 'math_8',
    chapterId: 'm8_ch1',
    topic: 'عددهای گویا',
    type: 'four_choice',
    difficulty: 'medium',
    questionText: 'معکوس قرینه کسر -۳/۵ کدام است؟',
    options: ['+۵/۳', '-۵/۳', '+۳/۵', '-۳/۵'],
    correctAnswer: '+۵/۳',
    explanation: 'قرینه -۳/۵ برابر +۳/۵ است و معکوس آن +۵/۳ است.',
    status: 'approved',
    source: 'کتاب ریاضی هشتم، فصل ۱',
    createdAt: new Date().toISOString()
  },
  {
    id: 'q_m9_01',
    grade: '9',
    subjectId: 'math_9',
    chapterId: 'm9_ch1',
    topic: 'مجموعه‌ها',
    type: 'four_choice',
    difficulty: 'medium',
    questionText: 'اگر A = {۱, ۲, ۳, ۴} و B = {۳, ۴, ۵, ۶} باشد، حاصل A - B کدام است؟',
    options: ['{۱, ۲}', '{۵, ۶}', '{۳, ۴}', '{۱, ۲, ۵, ۶}'],
    correctAnswer: '{۱, ۲}',
    explanation: 'اعضایی که در A هستند ولی در B نیستند: {۱, ۲}.',
    status: 'approved',
    source: 'کتاب ریاضی نهم، فصل ۱',
    createdAt: new Date().toISOString()
  }
];

const defaultStudents: Student[] = [
  {
    id: 'st_01',
    baleChatId: 1000001,
    username: 'ali_mofidi',
    fullName: 'علی رضایی',
    grade: '7',
    className: 'هفتم ۱ (شهید چمران)',
    isApproved: true,
    joinedAt: '۱۴۰۵/۰۷/۰۱',
    lastActiveAt: 'امروز',
    leaguePoints: 340,
    tier: 'طلایی',
    stats: { totalAnswered: 45, correctAnswers: 41, accuracyPercentage: 91, streakDays: 8, duelsPlayed: 6, duelsWon: 5 }
  },
  {
    id: 'st_02',
    baleChatId: 1000002,
    username: 'mohammad_m',
    fullName: 'محمد مهدوی',
    grade: '8',
    className: 'هشتم ۲ (شهید بهشتی)',
    isApproved: true,
    joinedAt: '۱۴۰۵/۰۷/۰۲',
    lastActiveAt: 'امروز',
    leaguePoints: 290,
    tier: 'نقره‌ای',
    stats: { totalAnswered: 38, correctAnswers: 32, accuracyPercentage: 84, streakDays: 5, duelsPlayed: 4, duelsWon: 3 }
  },
  {
    id: 'st_03',
    baleChatId: 1000003,
    username: 'hossein_k',
    fullName: 'حسین کاظمی',
    grade: '9',
    className: 'نهم ۱ (شهید مطهری)',
    isApproved: true,
    joinedAt: '۱۴۰۵/۰۷/۰۳',
    lastActiveAt: 'دیروز',
    leaguePoints: 410,
    tier: 'الماس',
    stats: { totalAnswered: 52, correctAnswers: 48, accuracyPercentage: 92, streakDays: 12, duelsPlayed: 9, duelsWon: 8 }
  }
];

const defaultAdmins: AdminUser[] = [
  {
    id: 'adm_01',
    chatId: 1434129251,
    fullName: 'مدیر ارشد مجتمع مفید',
    role: 'super_admin',
    addedAt: '۱۴۰۵/۰۱/۰۱',
    permissions: {
      canManageQuestions: true,
      canManageStudents: true,
      canBroadcast: true,
      canUseAiCopilot: true,
      canManageAdmins: true
    }
  }
];

const defaultResources: OfficialResource[] = [
  {
    id: 'res_m7',
    title: 'کتاب درسی ریاضی پایه هفتم (چاپ ۱۴۰۵)',
    grade: '7',
    subjectId: 'math_7',
    type: 'textbook_pdf',
    officialSource: 'chap.sch.ir',
    downloadUrl: 'https://chap.sch.ir',
    description: 'کتاب رسمی وزارت آموزش و پرورش',
    status: 'synced',
    lastCheckedDate: '۱۴۰۵/۰۷/۱۵'
  },
  {
    id: 'res_m8',
    title: 'کتاب درسی ریاضی پایه هشتم (چاپ ۱۴۰۵)',
    grade: '8',
    subjectId: 'math_8',
    type: 'textbook_pdf',
    officialSource: 'chap.sch.ir',
    downloadUrl: 'https://chap.sch.ir',
    description: 'کتاب رسمی وزارت آموزش و پرورش',
    status: 'synced',
    lastCheckedDate: '۱۴۰۵/۰۷/۱۵'
  },
  {
    id: 'res_m9',
    title: 'کتاب درسی ریاضی پایه نهم (چاپ ۱۴۰۵)',
    grade: '9',
    subjectId: 'math_9',
    type: 'textbook_pdf',
    officialSource: 'chap.sch.ir',
    downloadUrl: 'https://chap.sch.ir',
    description: 'کتاب رسمی وزارت آموزش و پرورش',
    status: 'synced',
    lastCheckedDate: '۱۴۰۵/۰۷/۱۵'
  }
];

const defaultStudyPlans: StudyPlanItem[] = [
  // پایه هفتم
  { id: 'sp_7_sat_1', grade: '7', dayOfWeek: 'شنبه', subject: 'ریاضی', topic: 'فصل ۳: جبر و معادله (حل تمرین)', durationMinutes: 45, tips: 'ابتدا متغیرها را به یک طرف و اعداد ثابت را به طرف دیگر ببرید.' },
  { id: 'sp_7_sat_2', grade: '7', dayOfWeek: 'شنبه', subject: 'علوم تجربی', topic: 'فصل ۴: آب‌کره و سفر آب درون زمین', durationMinutes: 30, tips: 'چرخه آب و سفره‌های آب زیرزمینی را در ذهن خود رسم کنید.' },
  { id: 'sp_7_sat_3', grade: '7', dayOfWeek: 'شنبه', subject: 'پیام‌های آسمان', topic: 'درس ۴: عبور آسان', durationMinutes: 20, tips: 'پیام آیات و احادیث متن درس را مرور فرمایید.' },
  { id: 'sp_7_sun_1', grade: '7', dayOfWeek: 'یکشنبه', subject: 'ادبیات فارسی', topic: 'درس ۵: آرایه‌های ادبی و تشبیه', durationMinutes: 40, tips: 'چهار رکن تشبیه (مشبه، مشبه‌به، ادات، وجه‌شبه) را مشخص کنید.' },
  { id: 'sp_7_sun_2', grade: '7', dayOfWeek: 'یکشنبه', subject: 'زبان انگلیسی', topic: 'Lesson 3: My Age & Numbers', durationMinutes: 30, tips: 'اعداد ۱ تا ۱۰۰ و مکالمه سن و تاریخ تولد را با صدای بلند تمرین کنید.' },
  { id: 'sp_7_sun_3', grade: '7', dayOfWeek: 'یکشنبه', subject: 'مطالعات اجتماعی', topic: 'درس ۷: تولید و توزیع', durationMinutes: 25, tips: 'عوامل تولید (منابع طبیعی، سرمایه، نیروی انسانی) را یادداشت کنید.' },
  { id: 'sp_7_mon_1', grade: '7', dayOfWeek: 'دوشنبه', subject: 'ریاضی', topic: 'فصل ۲: جمع و تفریق اعداد صحیح', durationMinutes: 45, tips: 'علامت‌ها را با محور اعداد تجسم کنید؛ منفی در منفی مثبت است.' },
  { id: 'sp_7_mon_2', grade: '7', dayOfWeek: 'دوشنبه', subject: 'عربی', topic: 'درس ۳: جملات اسمیه و کلمات پرسشی', durationMinutes: 30, tips: 'ضمایر و اسم‌های اشاره مفرد و جمع را جدول‌بندی کنید.' },
  { id: 'sp_7_tue_1', grade: '7', dayOfWeek: 'سه‌شنبه', subject: 'علوم تجربی', topic: 'فصل ۵: گوارش و جذب مواد غذایی', durationMinutes: 40, tips: 'نقش آنزیم‌ها و مسیر لوله گوارش را گام‌به‌گام بررسی نمایید.' },
  { id: 'sp_7_wed_1', grade: '7', dayOfWeek: 'چهارشنبه', subject: 'ریاضی', topic: 'حل آزمون جامع تستی و تست‌های مفیدگیم', durationMinutes: 50, tips: 'زمان‌بندی تست‌زنی را با شبیه‌ساز کوئیز رعایت فرمایید.' },
  { id: 'sp_7_thu_1', grade: '7', dayOfWeek: 'پنجشنبه', subject: 'مرور اشتباهات', topic: 'دفترچه تحلیل آزمون و رفع نقاط ضعف', durationMinutes: 45, tips: 'تست‌هایی که علامت غلط داشتند را دوباره بدون نگاه به پاسخنامه حل کنید.' },
  { id: 'sp_7_fri_1', grade: '7', dayOfWeek: 'جمعه', subject: 'جمع‌بندی و بازی', topic: 'دوئل با هم‌کلاسی‌ها و مأموریت‌های لیگ مفید', durationMinutes: 30, tips: 'با حل مأموریت‌های هفتگی سکه و امتیاز دوئل جمع‌آوری کنید.' },

  // پایه هشتم
  { id: 'sp_8_sat_1', grade: '8', dayOfWeek: 'شنبه', subject: 'ریاضی', topic: 'فصل ۳: چندضلعی‌ها و توازی خطوط', durationMinutes: 45, tips: 'فرمول مجموع زوایای داخلی: (n-2) × ۱۸۰ درجه.' },
  { id: 'sp_8_sat_2', grade: '8', dayOfWeek: 'شنبه', subject: 'علوم تجربی', topic: 'فصل ۴: تنظیم عصبی و ساختار نورون', durationMinutes: 35, tips: 'پیام عصبی حسی و حرکتی را مرور کنید.' },
  { id: 'sp_8_sun_1', grade: '8', dayOfWeek: 'یکشنبه', subject: 'ادبیات فارسی', topic: 'درس ۴: نقش‌های دستوری (نهاد، مفعول، مسند)', durationMinutes: 40, tips: 'ابتدا فعل جمله را پیدا کنید تا اجزای دیگر آشکار شوند.' },
  { id: 'sp_8_mon_1', grade: '8', dayOfWeek: 'دوشنبه', subject: 'ریاضی', topic: 'فصل ۱: عددهای گویا و محاسبات کسری', durationMinutes: 45, tips: 'اولویت پرانتز، ضرب، تقسیم و سپس جمع و تفریق.' },
  { id: 'sp_8_tue_1', grade: '8', dayOfWeek: 'سه‌شنبه', subject: 'زبان انگلیسی', topic: 'Lesson 2: My Week & Daily Activities', durationMinutes: 35, tips: 'روزهای هفته و افعال زمان حال ساده.' },
  { id: 'sp_8_wed_1', grade: '8', dayOfWeek: 'چهارشنبه', subject: 'علوم تجربی', topic: 'فصل ۲: تغییرهای شیمیایی در خدمت زندگی', durationMinutes: 40, tips: 'واکنش‌های گرماگیر و گرماده و سوختن.' },
  { id: 'sp_8_thu_1', grade: '8', dayOfWeek: 'پنجشنبه', subject: 'مرور اشتباهات', topic: 'تحلیل کوئیزها و رفع اشکال', durationMinutes: 45, tips: 'تثبیت نکات سؤالات غلط در لایتنر.' },

  // پایه نهم
  { id: 'sp_9_sat_1', grade: '9', dayOfWeek: 'شنبه', subject: 'ریاضی', topic: 'فصل ۳: استدلال و اثبات در هندسه', durationMinutes: 50, tips: 'هم‌نهشتی مثلث‌ها (ض‌زض، زض‌ز، ض‌ض‌ض) و حالت وتر.' },
  { id: 'sp_9_sat_2', grade: '9', dayOfWeek: 'شنبه', subject: 'علوم تجربی', topic: 'فصل ۴: حرکت چیست؟ تندی و سرعت', durationMinutes: 40, tips: 'تفاوت مسافت با جابه‌جایی و فرمول شتاب متوسط.' },
  { id: 'sp_9_sun_1', grade: '9', dayOfWeek: 'یکشنبه', subject: 'ادبیات فارسی', topic: 'درس ۳: قالب‌های شعری و آرایه‌های ترکیبی', durationMinutes: 45, tips: 'قصیده، غزل، مثنوی و قطعه.' },
  { id: 'sp_9_mon_1', grade: '9', dayOfWeek: 'دوشنبه', subject: 'ریاضی', topic: 'فصل ۱: مجموعه‌ها و احتمال رخ‌دادن پیشامد', durationMinutes: 50, tips: 'تعداد اعضای پیشامد بر کل حالت‌های ممکن n(S).' },
  { id: 'sp_9_tue_1', grade: '9', dayOfWeek: 'سه‌شنبه', subject: 'زبان انگلیسی', topic: 'Lesson 2: Travel & Past Continuous', durationMinutes: 35, tips: 'گذشته استمراری: was/were + verb-ing.' },
  { id: 'sp_9_wed_1', grade: '9', dayOfWeek: 'چهارشنبه', subject: 'علوم تجربی', topic: 'فصل ۱: مواد و نقش آنها در زندگی (فلزات و بسپار)', durationMinutes: 40, tips: 'واکنش‌پذیری فلزها با اکسیژن.' },
  { id: 'sp_9_thu_1', grade: '9', dayOfWeek: 'پنجشنبه', subject: 'مرور اشتباهات', topic: 'دفترچه خطاهای تستی مفیدگیم', durationMinutes: 45, tips: 'تست‌های ستاره‌دار و دام‌دار آزمون‌های آزمایشی.' }
];

class Database {
  private data: DatabaseSchema;

  constructor() {
    this.ensureDirs();
    this.data = this.load();
    try {
      initFirebaseBackend();
    } catch (e: any) {
      console.warn('[DB] Firebase initialization note:', e?.message || e);
    }
  }

  private ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  private load(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed.admins || parsed.admins.length === 0) {
          parsed.admins = defaultAdmins;
        }
        if (!parsed.config) parsed.config = {};
        if (!parsed.config.timeWindow247) {
          const now = new Date();
          parsed.config.timeWindow247 = {
            enabled: true,
            startTime: '00:00',
            endTime: '24:00',
            durationDays: 365,
            activatedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            isMomentToMomentActive: true
          };
        }
        if (!parsed.mistakes) parsed.mistakes = [];
        if (!parsed.duels) parsed.duels = [];
        if (!parsed.dailyMissions) parsed.dailyMissions = [];
        if (!parsed.studyPlans || parsed.studyPlans.length === 0) parsed.studyPlans = defaultStudyPlans;
        return parsed;
      }
    } catch (e) {
      console.error('[DB] Load error, resetting defaults:', e);
    }

    const nowTime = new Date();
    const initial: DatabaseSchema = {
      config: {
        token: process.env.BALE_BOT_TOKEN || '1137470430:evmdX1quk7mKJh4Q74TMHinOzi_ZoDplhWM',
        botUsername: 'mofidgamebot',
        adminChatId: parseInt(process.env.BALE_ADMIN_CHAT_ID || '1434129251', 10),
        adminChatIds: [1434129251],
        isPollingActive: true,
        useWebhook: false,
        webhookUrl: '',
        schoolInviteCode: 'MOFID-1405',
        pollingIntervalMs: 1500,
        timeWindow247: {
          enabled: true,
          startTime: '00:00',
          endTime: '24:00',
          durationDays: 365,
          activatedAt: nowTime.toISOString(),
          expiresAt: new Date(nowTime.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          isMomentToMomentActive: true
        }
      },
      admins: defaultAdmins,
      subjects: defaultSubjects,
      chapters: defaultChapters,
      questions: defaultQuestions,
      students: defaultStudents,
      leitnerItems: [],
      quizResults: [],
      resources: defaultResources,
      mistakes: [],
      duels: [],
      dailyMissions: [],
      studyPlans: defaultStudyPlans,
      auditLogs: [
        {
          id: 'log_01',
          timestamp: new Date().toISOString(),
          actor: 'سیستم',
          action: 'راه‌اندازی اولیه',
          details: 'پایگاه داده سامانه مفیدگیم برای پایه‌های هفتم، هشتم و نهم مقداردهی شد.'
        }
      ]
    };

    this.saveDirect(initial);
    return initial;
  }

  private saveDirect(data: DatabaseSchema) {
    try {
      this.ensureDirs();
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[DB] Failed to save database:', e);
    }
  }

  public save() {
    this.saveDirect(this.data);
  }

  public backup(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_${timestamp}.json`;
    const target = path.join(BACKUP_DIR, filename);
    fs.writeFileSync(target, JSON.stringify(this.data, null, 2), 'utf-8');
    this.addLog('مدیر سامانه', 'پشتیبان‌گیری', `فایل پشتیبان ${filename} ایجاد شد.`);
    return filename;
  }

  public restore(backupJson: string): boolean {
    try {
      const parsed = JSON.parse(backupJson);
      if (parsed.subjects && parsed.questions && parsed.students) {
        this.data = parsed;
        this.save();
        this.addLog('مدیر سامانه', 'بازیابی پایگاه داده', 'داده‌ها با موفقیت از فایل پشتیبان بازگردانده شدند.');
        return true;
      }
      return false;
    } catch (e) {
      console.error('[DB] Restore error:', e);
      return false;
    }
  }

  public addLog(actor: string, action: string, details: string) {
    const log = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      actor,
      action,
      details
    };
    this.data.auditLogs.unshift(log);
    if (this.data.auditLogs.length > 500) {
      this.data.auditLogs.pop();
    }
    this.save();
  }

  public getConfig(): BaleConfig {
    return this.data.config;
  }

  public updateConfig(patch: Partial<BaleConfig>) {
    this.data.config = { ...this.data.config, ...patch };
    this.save();
  }

  public getTimeWindow247(): TimeWindowConfig {
    if (!this.data.config.timeWindow247) {
      const now = new Date();
      this.data.config.timeWindow247 = {
        enabled: true,
        startTime: '00:00',
        endTime: '24:00',
        durationDays: 365,
        activatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        isMomentToMomentActive: true
      };
      this.save();
    }
    return this.data.config.timeWindow247;
  }

  public updateTimeWindow247(patch: Partial<TimeWindowConfig>): TimeWindowConfig {
    const current = this.getTimeWindow247();
    const updated: TimeWindowConfig = {
      ...current,
      ...patch,
      isMomentToMomentActive: patch.enabled !== undefined ? patch.enabled : current.enabled
    };
    if (patch.enabled && !current.enabled) {
      updated.activatedAt = new Date().toISOString();
      updated.expiresAt = new Date(Date.now() + (updated.durationDays || 365) * 24 * 60 * 60 * 1000).toISOString();
    }
    this.data.config.timeWindow247 = updated;
    this.save();
    this.addLog(
      'مدیر سامانه',
      'تغییر بازه زمانی کارکرد ۲۴ ساعته',
      `حالت کارکرد لحظه‌به‌لحظه بازه ${updated.startTime} تا ${updated.endTime} (۱ ساله) ${updated.enabled ? 'فعال' : 'غیرفعال'} شد.`
    );
    return updated;
  }

  public getStudents(): Student[] {
    return this.data.students;
  }

  public getStudentByBaleId(chatId: number): Student | undefined {
    return this.data.students.find((s) => s.baleChatId === chatId);
  }

  public getStudentById(id: string | number): Student | undefined {
    return this.data.students.find((s) => s.id === String(id) || s.baleChatId === Number(id));
  }

  public saveStudent(student: Student) {
    const index = this.data.students.findIndex((s) => s.id === student.id || s.baleChatId === student.baleChatId);
    if (index >= 0) {
      this.data.students[index] = student;
    } else {
      this.data.students.push(student);
    }
    this.save();
    try {
      saveStudentToFirebase(student).catch(() => {});
    } catch {}
  }

  public getAdmins(): AdminUser[] {
    return this.data.admins || defaultAdmins;
  }

  public addAdmin(admin: AdminUser): AdminUser {
    if (!this.data.admins) this.data.admins = [...defaultAdmins];
    const exists = this.data.admins.find((a) => a.chatId === admin.chatId || a.id === admin.id);
    if (!exists) {
      this.data.admins.push(admin);
    }
    if (!this.data.config.adminChatIds) this.data.config.adminChatIds = [this.data.config.adminChatId];
    if (!this.data.config.adminChatIds.includes(admin.chatId)) {
      this.data.config.adminChatIds.push(admin.chatId);
    }
    this.save();
    return admin;
  }

  public deleteAdmin(idOrChatId: string | number): boolean {
    if (!this.data.admins) return false;
    const initialLen = this.data.admins.length;
    this.data.admins = this.data.admins.filter((a) => a.id !== idOrChatId && a.chatId !== Number(idOrChatId));
    if (this.data.config.adminChatIds) {
      this.data.config.adminChatIds = this.data.config.adminChatIds.filter((cid) => cid !== Number(idOrChatId));
    }
    if (this.data.admins.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public isAdmin(chatId: number): boolean {
    if (chatId === this.data.config.adminChatId) return true;
    if (this.data.config.adminChatIds && this.data.config.adminChatIds.includes(chatId)) return true;
    if (this.data.admins && this.data.admins.some((a) => a.chatId === chatId)) return true;
    return false;
  }

  public getAdminByChatId(chatId: number): AdminUser | undefined {
    return this.data.admins?.find((a) => a.chatId === chatId);
  }

  public deleteStudent(id: string): boolean {
    const initialLen = this.data.students.length;
    this.data.students = this.data.students.filter((s) => s.id !== id && s.baleChatId !== Number(id));
    if (this.data.students.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public updateStudent(id: string, patch: Partial<Student>): Student | null {
    const index = this.data.students.findIndex((s) => s.id === id || s.baleChatId === Number(id));
    if (index === -1) return null;
    this.data.students[index] = { ...this.data.students[index], ...patch };
    this.save();
    try {
      saveStudentToFirebase(this.data.students[index]).catch(() => {});
    } catch {}
    return this.data.students[index];
  }

  public getSubjects(grade?: string): Subject[] {
    if (!grade) return this.data.subjects;
    return this.data.subjects.filter((s) => s.grade === grade);
  }

  public getChapters(subjectId?: string): Chapter[] {
    if (!subjectId) return this.data.chapters;
    return this.data.chapters.filter((c) => c.subjectId === subjectId);
  }

  public getQuestions(filters?: { grade?: string; subjectId?: string; difficulty?: string; status?: string }): Question[] {
    return this.data.questions.filter((q) => {
      if (filters?.grade && q.grade !== filters.grade) return false;
      if (filters?.subjectId && q.subjectId !== filters.subjectId) return false;
      if (filters?.difficulty && q.difficulty !== filters.difficulty) return false;
      if (filters?.status && q.status !== filters.status) return false;
      return true;
    });
  }

  public getQuestionById(id: string): Question | undefined {
    return this.data.questions.find((q) => q.id === id);
  }

  public addQuestion(question: Question): Question {
    this.data.questions.unshift(question);
    this.save();
    try {
      saveQuestionToFirebase(question).catch(() => {});
    } catch {}
    return question;
  }

  public updateQuestion(id: string, patch: Partial<Question>): Question | null {
    const index = this.data.questions.findIndex((q) => q.id === id);
    if (index === -1) return null;
    this.data.questions[index] = { ...this.data.questions[index], ...patch };
    this.save();
    try {
      saveQuestionToFirebase(this.data.questions[index]).catch(() => {});
    } catch {}
    return this.data.questions[index];
  }

  public deleteQuestion(id: string): boolean {
    const initialLen = this.data.questions.length;
    this.data.questions = this.data.questions.filter((q) => q.id !== id);
    if (this.data.questions.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public getResources(): OfficialResource[] {
    return this.data.resources;
  }

  public addResource(resource: OfficialResource): OfficialResource {
    this.data.resources.push(resource);
    this.save();
    return resource;
  }

  public updateResourceStatus(id: string, status: any): boolean {
    const res = this.data.resources.find((r) => r.id === id);
    if (res) {
      res.status = status;
      res.lastCheckedDate = new Date().toLocaleDateString('fa-IR');
      this.save();
      return true;
    }
    return false;
  }

  public deleteResource(id: string): boolean {
    const initialLen = this.data.resources.length;
    this.data.resources = this.data.resources.filter((r) => r.id !== id);
    if (this.data.resources.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  public getLeitnerItems(studentId: string): LeitnerItem[] {
    return this.data.leitnerItems.filter((i) => i.studentId === studentId);
  }

  public saveLeitnerItem(item: LeitnerItem) {
    const idx = this.data.leitnerItems.findIndex((i) => i.id === item.id || (i.studentId === item.studentId && i.questionId === item.questionId));
    if (idx >= 0) {
      this.data.leitnerItems[idx] = item;
    } else {
      this.data.leitnerItems.push(item);
    }
    this.save();
  }

  public addQuizResult(res: QuizResult) {
    this.data.quizResults.unshift(res);
    this.save();
    try {
      saveQuizResultToFirebase(res).catch(() => {});
    } catch {}
  }

  public getQuizResults(studentId?: string): QuizResult[] {
    if (!studentId) return this.data.quizResults;
    return this.data.quizResults.filter((r) => r.studentId === studentId);
  }

  public getAuditLogs() {
    return this.data.auditLogs;
  }

  // --- MISTAKES NOTEBOOK (مرور اشتباهات) ---
  public recordMistake(studentId: string, question: Question, incorrectAnswer: string): StudentMistake {
    if (!this.data.mistakes) this.data.mistakes = [];
    const existing = this.data.mistakes.find(m => m.studentId === studentId && m.questionId === question.id && !m.resolved);
    if (existing) {
      existing.incorrectAnswer = incorrectAnswer;
      this.save();
      return existing;
    }
    const newMistake: StudentMistake = {
      id: `mst_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      studentId,
      questionId: question.id,
      questionText: question.questionText,
      subjectId: question.subjectId,
      grade: question.grade,
      incorrectAnswer,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      resolved: false,
      createdAt: new Date().toLocaleDateString('fa-IR'),
    };
    this.data.mistakes.unshift(newMistake);
    this.save();
    return newMistake;
  }

  public getMistakes(studentId: string, onlyUnresolved = true): StudentMistake[] {
    if (!this.data.mistakes) this.data.mistakes = [];
    return this.data.mistakes.filter(m => m.studentId === studentId && (!onlyUnresolved || !m.resolved));
  }

  public resolveMistake(studentId: string, questionId: string): boolean {
    if (!this.data.mistakes) this.data.mistakes = [];
    const item = this.data.mistakes.find(m => m.studentId === studentId && m.questionId === questionId && !m.resolved);
    if (item) {
      item.resolved = true;
      this.save();
      this.recordDailyActivity(studentId, 'mistakes_review', 1);
      return true;
    }
    return false;
  }

  // --- DUELS (دوئل با دوستان) ---
  public createDuel(challenger: Student, grade: GradeLevel, subject: string): DuelMatch {
    if (!this.data.duels) this.data.duels = [];
    const randomCode = Math.floor(1000 + Math.random() * 9000).toString();
    const availableQuestions = this.getQuestions({ grade });
    const selectedQuestions = availableQuestions.sort(() => 0.5 - Math.random()).slice(0, 3);
    const questionIds = selectedQuestions.map(q => q.id);

    const duel: DuelMatch = {
      id: `duel_${Date.now()}_${randomCode}`,
      code: `DUEL-${randomCode}`,
      grade,
      subject: subject || 'ریاضی و علوم',
      challengerId: challenger.id,
      challengerName: challenger.fullName,
      challengerScore: 0,
      status: 'waiting',
      questionIds,
      createdAt: new Date().toLocaleDateString('fa-IR'),
    };
    this.data.duels.unshift(duel);
    this.save();
    return duel;
  }

  public getDuel(codeOrId: string): DuelMatch | undefined {
    if (!this.data.duels) this.data.duels = [];
    const cleaned = codeOrId.trim().toUpperCase();
    return this.data.duels.find(d => d.id === cleaned || d.code === cleaned || d.code === `DUEL-${cleaned}`);
  }

  public joinDuel(duelId: string, opponent: Student): DuelMatch | undefined {
    if (!this.data.duels) this.data.duels = [];
    const duel = this.data.duels.find(d => d.id === duelId || d.code === duelId);
    if (duel) {
      duel.opponentId = opponent.id;
      duel.opponentName = opponent.fullName;
      duel.status = 'in_progress';
      this.save();
      return duel;
    }
    return undefined;
  }

  public submitDuelScore(duelId: string, studentId: string, score: number): DuelMatch | undefined {
    if (!this.data.duels) this.data.duels = [];
    const duel = this.data.duels.find(d => d.id === duelId || d.code === duelId);
    if (!duel) return undefined;

    if (duel.challengerId === studentId) {
      duel.challengerScore = score;
    } else if (duel.opponentId === studentId) {
      duel.opponentScore = score;
    }

    if (duel.opponentId && duel.opponentScore !== undefined && duel.challengerScore !== undefined) {
      duel.status = 'completed';
      if (duel.challengerScore > duel.opponentScore) {
        duel.winnerName = duel.challengerName;
      } else if (duel.opponentScore > duel.challengerScore) {
        duel.winnerName = duel.opponentName;
      } else {
        duel.winnerName = 'تساوی';
      }
    }
    this.save();
    this.recordDailyActivity(studentId, 'duel', 1);
    return duel;
  }

  public getDuelsForStudent(studentId: string): DuelMatch[] {
    if (!this.data.duels) this.data.duels = [];
    return this.data.duels.filter(d => d.challengerId === studentId || d.opponentId === studentId);
  }

  // --- DAILY MISSIONS & PROGRESS (ماموریت روزانه) ---
  public getDailyProgress(studentId: string): StudentDailyProgress {
    if (!this.data.dailyMissions) this.data.dailyMissions = [];
    const today = new Date().toLocaleDateString('fa-IR');
    let progress = this.data.dailyMissions.find(p => p.studentId === studentId && p.date === today);
    if (!progress) {
      progress = {
        studentId,
        date: today,
        practiceQuizCount: 0,
        duelsCount: 0,
        lessonsReadCount: 0,
        mistakesReviewedCount: 0,
        claimedMissionIds: [],
      };
      this.data.dailyMissions.unshift(progress);
      this.save();
    }
    if (!progress.claimedMissionIds) progress.claimedMissionIds = [];
    if (progress.practiceQuizCount === undefined) progress.practiceQuizCount = 0;
    if (progress.duelsCount === undefined) progress.duelsCount = 0;
    if (progress.lessonsReadCount === undefined) progress.lessonsReadCount = 0;
    if (progress.mistakesReviewedCount === undefined) progress.mistakesReviewedCount = 0;
    return progress;
  }


  public recordDailyActivity(studentId: string, activity: 'practice_quiz' | 'duel' | 'lesson_review' | 'mistakes_review', count = 1): StudentDailyProgress {
    const progress = this.getDailyProgress(studentId);
    if (activity === 'practice_quiz') progress.practiceQuizCount += count;
    if (activity === 'duel') progress.duelsCount += count;
    if (activity === 'lesson_review') progress.lessonsReadCount += count;
    if (activity === 'mistakes_review') progress.mistakesReviewedCount += count;
    this.save();
    return progress;
  }

  public claimDailyMission(studentId: string, missionId: string): { success: boolean; reward: number; message: string } {
    const progress = this.getDailyProgress(studentId);
    if (progress.claimedMissionIds.includes(missionId)) {
      return { success: false, reward: 0, message: 'این جایزه قبلاً دریافت شده است.' };
    }

    const missionDefinitions: Record<string, { title: string; target: number; reward: number; current: number }> = {
      'mission_1': { title: 'پاسخ به ۳ سؤال در تمرین هوشمند', target: 3, reward: 20, current: progress.practiceQuizCount },
      'mission_2': { title: 'شرکت در ۱ دوئل علمی با دوستان یا هوش مصنوعی', target: 1, reward: 30, current: progress.duelsCount },
      'mission_3': { title: 'ثبت مطالعه پارت درسی یا مطالعه درسنامه', target: 1, reward: 25, current: progress.lessonsReadCount },
      'mission_4': { title: 'مرور حداقل ۱ سؤال از دفترچه اشتباهات', target: 1, reward: 25, current: progress.mistakesReviewedCount },
    };

    const targetMission = missionDefinitions[missionId];
    if (!targetMission) {
      return { success: false, reward: 0, message: 'مأموریت نامعتبر است.' };
    }

    if (targetMission.current < targetMission.target) {
      return { success: false, reward: 0, message: `مأموریت هنوز تکمیل نشده است (${targetMission.current}/${targetMission.target}).` };
    }

    progress.claimedMissionIds.push(missionId);
    const student = this.getStudentById(studentId);
    if (student) {
      this.updateStudent(studentId, {
        leaguePoints: (student.leaguePoints || 0) + targetMission.reward,
      });
    }
    this.save();
    return {
      success: true,
      reward: targetMission.reward,
      message: `🎉 آفرین! پاداش ${targetMission.reward} امتیاز لیگ برای «${targetMission.title}» دریافت شد!`
    };
  }

  // --- STUDY PLANS (برنامه مطالعه) ---
  public getStudyPlans(grade?: GradeLevel, dayOfWeek?: string): StudyPlanItem[] {
    let plans = this.data.studyPlans || defaultStudyPlans;
    if (grade) {
      plans = plans.filter(p => p.grade === grade);
    }
    if (dayOfWeek) {
      plans = plans.filter(p => p.dayOfWeek.trim() === dayOfWeek.trim());
    }
    return plans;
  }

  public getRawData(): DatabaseSchema {
    return this.data;
  }
}

export const db = new Database();
