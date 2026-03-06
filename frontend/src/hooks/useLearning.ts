import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';

// ---- Types ----

export interface Course {
  id: string;
  title: string;
  description: string;
  category: string;
  level: string;
  duration_hours: number;
  thumbnail_url: string | null;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Module {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  order_index: number;
  created_at: string;
}

export interface Lesson {
  id: string;
  module_id: string;
  title: string;
  type: 'text' | 'video' | 'quiz';
  content: Record<string, unknown>;
  order_index: number;
  duration_minutes: number | null;
  created_at: string;
}

export interface Enrollment {
  id: string;
  user_id: string;
  course_id: string;
  enrolled_at: string;
  completed_at: string | null;
}

export interface LessonProgress {
  id: string;
  user_id: string;
  lesson_id: string;
  completed: boolean;
  completed_at: string | null;
}

export interface QuizAttempt {
  id: string;
  user_id: string;
  lesson_id: string;
  answers: Record<string, unknown>;
  score: number;
  passed: boolean;
  attempted_at: string;
}

export interface Certificate {
  id: string;
  user_id: string;
  course_id: string;
  certificate_number: string;
  issued_at: string;
  course?: Course;
}

export interface CourseWithModules extends Course {
  modules: (Module & { lessons: Lesson[] })[];
}

// ---- Hooks ----

export function useCourses(category?: string) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let q = supabase.from('courses').select('*').eq('is_published', true).order('created_at');
    if (category && category !== 'all') q = q.eq('category', category);
    q.then(({ data }) => {
      setCourses(data || []);
      setLoading(false);
    });
  }, [category]);

  return { courses, loading };
}

export function useAllCourses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    setLoading(true);
    supabase.from('courses').select('*').order('created_at').then(({ data }) => {
      setCourses(data || []);
      setLoading(false);
    });
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { courses, loading, refetch };
}

export function useCourseDetail(courseId: string | null) {
  const [course, setCourse] = useState<CourseWithModules | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) { setLoading(false); return; }
    setLoading(true);

    Promise.all([
      supabase.from('courses').select('*').eq('id', courseId).single(),
      supabase.from('modules').select('*').eq('course_id', courseId).order('order_index'),
      supabase.from('lessons').select('*').order('order_index'),
    ]).then(([courseRes, modulesRes, lessonsRes]) => {
      if (!courseRes.data) { setCourse(null); setLoading(false); return; }
      const modules = (modulesRes.data || []).map(m => ({
        ...m,
        lessons: (lessonsRes.data || []).filter(l => l.module_id === m.id),
      }));
      setCourse({ ...courseRes.data, modules });
      setLoading(false);
    });
  }, [courseId]);

  return { course, loading };
}

export function useEnrollment(courseId: string | null) {
  const { user } = useAuth();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !courseId) { setLoading(false); return; }
    supabase.from('enrollments').select('*')
      .eq('user_id', user.id).eq('course_id', courseId).maybeSingle()
      .then(({ data }) => { setEnrollment(data); setLoading(false); });
  }, [user, courseId]);

  const enroll = useCallback(async () => {
    if (!user || !courseId) return;
    const { data } = await supabase.from('enrollments')
      .insert({ user_id: user.id, course_id: courseId })
      .select().single();
    if (data) setEnrollment(data);
  }, [user, courseId]);

  return { enrollment, loading, enroll };
}

export function useLessonProgress(courseId: string | null) {
  const { user } = useAuth();
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!user || !courseId) { setLoading(false); return; }
    // Get all lesson IDs for this course, then fetch progress
    supabase.from('modules').select('id').eq('course_id', courseId).then(({ data: modules }) => {
      if (!modules?.length) { setLoading(false); return; }
      const moduleIds = modules.map(m => m.id);
      supabase.from('lessons').select('id').in('module_id', moduleIds).then(({ data: lessons }) => {
        if (!lessons?.length) { setLoading(false); return; }
        const lessonIds = lessons.map(l => l.id);
        supabase.from('lesson_progress').select('lesson_id, completed')
          .eq('user_id', user.id).in('lesson_id', lessonIds).eq('completed', true)
          .then(({ data: prog }) => {
            const map: Record<string, boolean> = {};
            (prog || []).forEach(p => { map[p.lesson_id] = true; });
            setProgress(map);
            setLoading(false);
          });
      });
    });
  }, [user, courseId]);

  useEffect(() => { refetch(); }, [refetch]);

  const markComplete = useCallback(async (lessonId: string) => {
    if (!user) return;
    await supabase.from('lesson_progress').upsert({
      user_id: user.id,
      lesson_id: lessonId,
      completed: true,
      completed_at: new Date().toISOString(),
    }, { onConflict: 'user_id,lesson_id' });
    setProgress(prev => ({ ...prev, [lessonId]: true }));
  }, [user]);

  return { progress, loading, markComplete, refetch };
}

export function useQuizAttempts(lessonId: string | null) {
  const { user } = useAuth();
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);

  useEffect(() => {
    if (!user || !lessonId) return;
    supabase.from('quiz_attempts').select('*')
      .eq('user_id', user.id).eq('lesson_id', lessonId)
      .order('attempted_at', { ascending: false })
      .then(({ data }) => setAttempts(data || []));
  }, [user, lessonId]);

  const submitQuiz = useCallback(async (lessonId: string, answers: Record<string, number>, score: number, passed: boolean) => {
    if (!user) return null;
    const { data } = await supabase.from('quiz_attempts').insert({
      user_id: user.id,
      lesson_id: lessonId,
      answers,
      score,
      passed,
    }).select().single();
    if (data) setAttempts(prev => [data, ...prev]);
    return data;
  }, [user]);

  return { attempts, submitQuiz };
}

export function useCertificates() {
  const { user } = useAuth();
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!user) { setLoading(false); return; }
    supabase.from('certificates').select('*, course:courses(*)').eq('user_id', user.id)
      .order('issued_at', { ascending: false })
      .then(({ data }) => {
        setCertificates((data || []).map(c => ({ ...c, course: c.course as unknown as Course })));
        setLoading(false);
      });
  }, [user]);

  useEffect(() => { refetch(); }, [refetch]);

  return { certificates, loading, refetch };
}

export function useIssueCertificate() {
  const { user } = useAuth();

  return useCallback(async (courseId: string): Promise<Certificate | null> => {
    if (!user) return null;
    // Check if already issued
    const { data: existing } = await supabase.from('certificates')
      .select('*').eq('user_id', user.id).eq('course_id', courseId).maybeSingle();
    if (existing) return existing;

    const certNumber = `UCB-CERT-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const { data } = await supabase.from('certificates').insert({
      user_id: user.id,
      course_id: courseId,
      certificate_number: certNumber,
    }).select().single();
    return data;
  }, [user]);
}

export function useMyEnrollments() {
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<(Enrollment & { course: Course })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    supabase.from('enrollments').select('*, course:courses(*)')
      .eq('user_id', user.id).order('enrolled_at', { ascending: false })
      .then(({ data }) => {
        setEnrollments((data || []).map(e => ({ ...e, course: e.course as unknown as Course })));
        setLoading(false);
      });
  }, [user]);

  return { enrollments, loading };
}

// ---- Admin functions ----

export async function saveCourse(course: Partial<Course> & { title: string }) {
  if (course.id) {
    const { data } = await supabase.from('courses')
      .update({ ...course, updated_at: new Date().toISOString() })
      .eq('id', course.id).select().single();
    return data;
  }
  const { data } = await supabase.from('courses').insert(course).select().single();
  return data;
}

export async function deleteCourse(id: string) {
  await supabase.from('courses').delete().eq('id', id);
}

export async function saveModule(mod: Partial<Module> & { course_id: string; title: string }) {
  if (mod.id) {
    const { data } = await supabase.from('modules').update(mod).eq('id', mod.id).select().single();
    return data;
  }
  const { data } = await supabase.from('modules').insert(mod).select().single();
  return data;
}

export async function deleteModule(id: string) {
  await supabase.from('modules').delete().eq('id', id);
}

export async function saveLesson(lesson: Partial<Lesson> & { module_id: string; title: string }) {
  if (lesson.id) {
    const { data } = await supabase.from('lessons').update(lesson).eq('id', lesson.id).select().single();
    return data;
  }
  const { data } = await supabase.from('lessons').insert(lesson).select().single();
  return data;
}

export async function deleteLesson(id: string) {
  await supabase.from('lessons').delete().eq('id', id);
}
