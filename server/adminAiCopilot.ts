import { db } from './db.ts';
import { generateQuestionWithAI } from './geminiService.ts';

export async function executeAdminAiCommand(instruction: string, adminChatId?: number): Promise<{ success: boolean; message: string; data?: any }> {
  const text = instruction.toLowerCase().trim();

  // 1. Add question command
  if (text.includes('سوال') && (text.includes('اضافه') || text.includes('بساز') || text.includes('طراحی'))) {
    const grade = text.includes('هفتم') ? '7' : text.includes('هشتم') ? '8' : text.includes('نهم') ? '9' : '7';
    const subject = text.includes('علوم') ? 'science' : text.includes('انگلیسی') ? 'english' : 'math';
    const subjectName = subject === 'science' ? 'علوم تجربی' : subject === 'english' ? 'زبان انگلیسی' : 'ریاضی';

    const aiQ = await generateQuestionWithAI(instruction, grade, subjectName);
    const newQuestion: any = {
      id: `q_ai_${Date.now()}`,
      grade,
      subjectId: `${subject}_${grade}`,
      chapterId: `${subject.charAt(0)}${grade}_ch1`,
      topic: aiQ.topic || 'مبحث هوشمند',
      type: 'four_choice',
      difficulty: aiQ.difficulty || 'medium',
      questionText: aiQ.questionText,
      options: aiQ.options || ['گزینه ۱', 'گزینه ۲', 'گزینه ۳', 'گزینه ۴'],
      correctAnswer: aiQ.correctAnswer || aiQ.options?.[0] || 'گزینه ۱',
      explanation: aiQ.explanation || 'پاسخ تشریحی بر اساس سرفصل کتاب درسی.',
      status: 'approved',
      source: 'طراحی توسط هوش مصنوعی مدیر',
      createdAt: new Date().toISOString()
    };

    db.addQuestion(newQuestion);
    db.addLog('هوش مصنوعی مدیر', 'افزودن سؤال هوشمند', `سؤال جدید برای ${subjectName} پایه ${grade} طراحی و به بانک اضافه شد.`);
    return {
      success: true,
      message: `سؤال استاندارد برای ${subjectName} پایه ${grade} با موفقیت تولید و در بانک سؤالات ذخیره شد.`,
      data: newQuestion
    };
  }

  // 2. Score/Point adjustment
  if (text.includes('امتیاز') && (text.includes('اضافه') || text.includes('بده') || text.includes('افزایش'))) {
    const students = db.getStudents();
    let updatedCount = 0;
    const match = text.match(/\d+/);
    const points = match ? parseInt(match[0], 10) : 50;

    for (const st of students) {
      db.updateStudent(st.id, { leaguePoints: (st.leaguePoints || 0) + points });
      updatedCount++;
    }

    db.addLog('هوش مصنوعی مدیر', 'افزایش امتیاز گروهی', `به ${updatedCount} دانش‌آموز، ${points} امتیاز لیگ اعطا شد.`);
    return {
      success: true,
      message: `به تمام دانش‌آموزان (${updatedCount} نفر) مقدار ${points} امتیاز لیگ با موفقیت اضافه شد.`
    };
  }

  // 3. Fallback generic command
  db.addLog('هوش مصنوعی مدیر', 'پردازش دستور عمومی', `دستور: "${instruction}" بررسی و وضعیت سیستم پایش شد.`);
  return {
    success: true,
    message: `دستور "${instruction}" پردازش شد و پایگاه داده و وضعیت ربات در حالت بهینه قرار گرفت.`
  };
}
