import { useState, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  useCourses,
  useAllCourses,
  useCourseDetail,
  useEnrollment,
  useLessonProgress,
  useQuizAttempts,
  useCertificates,
  useIssueCertificate,
  useMyEnrollments,
  saveCourse,
  deleteCourse,
  saveModule,
  deleteModule,
  saveLesson,
  deleteLesson,
} from '@/hooks/useLearning';
import type { Course, Lesson, Module } from '@/hooks/useLearning';
import {
  BookOpen,
  GraduationCap,
  Award,
  ChevronRight,
  ChevronLeft,
  Clock,
  BarChart3,
  Users,
  Shield,
  TrendingUp,
  Briefcase,
  Target,
  CheckCircle,
  Circle,
  Play,
  FileText,
  HelpCircle,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  ArrowLeft,
  LogIn,
  ExternalLink,
  Printer,
} from 'lucide-react';

// ---- Constants ----

const CATEGORIES = [
  { key: 'all', label: 'All Courses', icon: BookOpen },
  { key: 'basics', label: 'Market Basics', icon: BarChart3 },
  { key: 'technical', label: 'Technical Analysis', icon: TrendingUp },
  { key: 'fundamental', label: 'Fundamental Analysis', icon: Target },
  { key: 'risk', label: 'Risk Management', icon: Shield },
  { key: 'wealth', label: 'Wealth Management', icon: Briefcase },
  { key: 'career', label: 'Career in Finance', icon: Users },
];

const LEVELS: Record<string, { label: string; color: string }> = {
  beginner: { label: 'Beginner', color: 'bg-emerald-100 text-emerald-700' },
  intermediate: { label: 'Intermediate', color: 'bg-blue-100 text-blue-700' },
  advanced: { label: 'Advanced', color: 'bg-purple-100 text-purple-700' },
};

type View = 'catalog' | 'course' | 'lesson' | 'my-courses' | 'certificates' | 'admin';

// ---- Main Page ----

export function LearningCenterPage() {
  const { user } = useAuth();
  const isAdmin = user?.user_metadata?.role === 'admin';
  const [view, setView] = useState<View>('catalog');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);

  const navigateToCourse = useCallback((courseId: string) => {
    setSelectedCourseId(courseId);
    setSelectedLessonId(null);
    setView('course');
  }, []);

  const navigateToLesson = useCallback((courseId: string, lessonId: string, moduleId: string) => {
    setSelectedCourseId(courseId);
    setSelectedLessonId(lessonId);
    setSelectedModuleId(moduleId);
    setView('lesson');
  }, []);

  const goBack = useCallback(() => {
    if (view === 'lesson') setView('course');
    else { setView('catalog'); setSelectedCourseId(null); }
  }, [view]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => { setView('catalog'); setSelectedCourseId(null); }}>
              <GraduationCap className="text-blue-600" size={28} />
              <div>
                <h1 className="text-lg font-bold text-slate-900">UCB Stock Learning</h1>
                <p className="text-xs text-slate-500 -mt-0.5">Financial Education Platform</p>
              </div>
            </div>

            <nav className="flex items-center gap-1">
              <NavBtn active={view === 'catalog'} onClick={() => { setView('catalog'); setSelectedCourseId(null); }}>Courses</NavBtn>
              {user && <NavBtn active={view === 'my-courses'} onClick={() => setView('my-courses')}>My Learning</NavBtn>}
              {user && <NavBtn active={view === 'certificates'} onClick={() => setView('certificates')}>Certificates</NavBtn>}
              {isAdmin && <NavBtn active={view === 'admin'} onClick={() => setView('admin')}>Admin</NavBtn>}
              {user ? (
                <a href="/" className="ml-3 px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 flex items-center gap-1.5">
                  Dashboard <ExternalLink size={14} />
                </a>
              ) : (
                <a href="/login" className="ml-3 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5">
                  <LogIn size={14} /> Sign In
                </a>
              )}
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {view === 'catalog' && <CatalogView onSelectCourse={navigateToCourse} />}
        {view === 'course' && <CourseDetailView courseId={selectedCourseId} onBack={goBack} onSelectLesson={navigateToLesson} />}
        {view === 'lesson' && <LessonView courseId={selectedCourseId} lessonId={selectedLessonId} moduleId={selectedModuleId} onBack={goBack} onSelectLesson={navigateToLesson} />}
        {view === 'my-courses' && <MyCoursesView onSelectCourse={navigateToCourse} />}
        {view === 'certificates' && <CertificatesView />}
        {view === 'admin' && isAdmin && <AdminView />}
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-white font-semibold mb-3">UCB Stock Learning</h3>
              <p className="text-sm">Free financial education platform by UCB Stock Brokerage Limited. Learn to invest, earn certificates, and build your career in finance.</p>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-3">Quick Links</h3>
              <ul className="text-sm space-y-2">
                <li><button onClick={() => { setView('catalog'); setSelectedCourseId(null); }} className="hover:text-white transition">Browse Courses</button></li>
                <li><a href="/login" className="hover:text-white transition">Sign In / Register</a></li>
              </ul>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-3">Start Your Investment Journey</h3>
              <p className="text-sm mb-3">Ready to invest in the Bangladesh stock market? Open your trading account with UCB Stock Brokerage today.</p>
              <a href="mailto:info@ucbstock.com" className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition">
                Contact Us
              </a>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-8 pt-6 text-center text-xs">
            UCB Stock Brokerage Limited. Licensed by BSEC.
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---- NavBtn ----

function NavBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-lg transition ${
        active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

// ---- Catalog View ----

function CatalogView({ onSelectCourse }: { onSelectCourse: (id: string) => void }) {
  const [category, setCategory] = useState('all');
  const { courses, loading } = useCourses(category);

  return (
    <>
      {/* Hero */}
      <div className="text-center mb-12">
        <h2 className="text-4xl font-bold text-slate-900 mb-4">Learn. Invest. Grow.</h2>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Free courses on stock market investing, wealth management, and financial careers.
          Earn certificates recognized by UCB Stock Brokerage.
        </p>
        <div className="flex items-center justify-center gap-8 mt-6 text-sm text-slate-500">
          <span className="flex items-center gap-1.5"><BookOpen size={16} /> 6 Courses</span>
          <span className="flex items-center gap-1.5"><Clock size={16} /> 48+ Hours</span>
          <span className="flex items-center gap-1.5"><Award size={16} /> Free Certificates</span>
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-2 mb-8 justify-center">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm transition ${
                category === cat.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              <Icon size={15} />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Course Grid */}
      {loading ? (
        <div className="text-center text-slate-500 py-12">Loading courses...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courses.map(course => (
            <CourseCard key={course.id} course={course} onClick={() => onSelectCourse(course.id)} />
          ))}
          {courses.length === 0 && (
            <div className="col-span-3 text-center text-slate-500 py-12">No courses found in this category.</div>
          )}
        </div>
      )}

      {/* CTA Banner */}
      <div className="mt-16 bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-8 md:p-12 text-white text-center">
        <h3 className="text-2xl font-bold mb-3">Ready to Start Investing?</h3>
        <p className="text-blue-100 max-w-xl mx-auto mb-6">
          Open a trading account with UCB Stock Brokerage and put your knowledge into practice.
          Our expert Relationship Managers will guide you every step of the way.
        </p>
        <a href="mailto:info@ucbstock.com" className="inline-block px-6 py-3 bg-white text-blue-700 font-semibold rounded-lg hover:bg-blue-50 transition">
          Open an Account
        </a>
      </div>
    </>
  );
}

// ---- Course Card ----

function CourseCard({ course, onClick }: { course: Course; onClick: () => void }) {
  const level = LEVELS[course.level] || LEVELS.beginner;
  const catInfo = CATEGORIES.find(c => c.key === course.category);
  const CatIcon = catInfo?.icon || BookOpen;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer overflow-hidden group"
    >
      {/* Thumbnail area */}
      <div className="h-40 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center relative">
        <CatIcon className="text-white/30" size={80} />
        <div className="absolute top-3 left-3">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${level.color}`}>
            {level.label}
          </span>
        </div>
      </div>
      <div className="p-5">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
          <CatIcon size={13} />
          {catInfo?.label || course.category}
        </div>
        <h3 className="font-semibold text-slate-900 mb-2 group-hover:text-blue-600 transition">{course.title}</h3>
        <p className="text-sm text-slate-500 line-clamp-2 mb-4">{course.description}</p>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1"><Clock size={13} /> {course.duration_hours} hours</span>
          <span className="flex items-center gap-1 text-blue-600 font-medium group-hover:underline">
            Start Learning <ChevronRight size={14} />
          </span>
        </div>
      </div>
    </div>
  );
}

// ---- Course Detail View ----

function CourseDetailView({ courseId, onBack, onSelectLesson }: {
  courseId: string | null;
  onBack: () => void;
  onSelectLesson: (courseId: string, lessonId: string, moduleId: string) => void;
}) {
  const { user } = useAuth();
  const { course, loading } = useCourseDetail(courseId);
  const { enrollment, enroll } = useEnrollment(courseId);
  const { progress } = useLessonProgress(courseId);

  if (loading) return <div className="text-center text-slate-500 py-12">Loading...</div>;
  if (!course) return <div className="text-center text-slate-500 py-12">Course not found.</div>;

  const allLessons = course.modules.flatMap(m => m.lessons);
  const completedCount = allLessons.filter(l => progress[l.id]).length;
  const totalLessons = allLessons.length;
  const progressPct = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;
  const level = LEVELS[course.level] || LEVELS.beginner;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600 mb-6">
        <ArrowLeft size={16} /> Back to Courses
      </button>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-8 text-white">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium bg-white/20 text-white`}>{level.label}</span>
          <h2 className="text-3xl font-bold mt-3 mb-2">{course.title}</h2>
          <p className="text-blue-100 max-w-2xl">{course.description}</p>
          <div className="flex items-center gap-6 mt-4 text-sm text-blue-100">
            <span className="flex items-center gap-1.5"><Clock size={15} /> {course.duration_hours} hours</span>
            <span className="flex items-center gap-1.5"><BookOpen size={15} /> {course.modules.length} modules</span>
            <span className="flex items-center gap-1.5"><FileText size={15} /> {totalLessons} lessons</span>
          </div>
        </div>

        {/* Enrollment + Progress */}
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          {user ? (
            enrollment ? (
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">Your Progress</span>
                  <span className="text-sm text-slate-500">{completedCount}/{totalLessons} lessons ({progressPct}%)</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5">
                  <div className="bg-blue-600 h-2.5 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            ) : (
              <button
                onClick={enroll}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
              >
                Enroll for Free
              </button>
            )
          ) : (
            <div className="flex items-center gap-3">
              <a href="/login" className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition flex items-center gap-2">
                <LogIn size={16} /> Sign In to Enroll
              </a>
              <span className="text-sm text-slate-500">Free enrollment</span>
            </div>
          )}
        </div>

        {/* Modules & Lessons */}
        <div className="p-6">
          {course.modules.map((mod, mi) => (
            <div key={mod.id} className="mb-6 last:mb-0">
              <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <span className="w-7 h-7 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold">{mi + 1}</span>
                {mod.title}
              </h3>
              <div className="ml-9 space-y-1">
                {mod.lessons.map(lesson => {
                  const completed = progress[lesson.id];
                  const LessonIcon = lesson.type === 'quiz' ? HelpCircle : lesson.type === 'video' ? Play : FileText;
                  return (
                    <button
                      key={lesson.id}
                      onClick={() => onSelectLesson(course.id, lesson.id, mod.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-slate-50 transition group"
                    >
                      {completed ? (
                        <CheckCircle size={18} className="text-emerald-500 shrink-0" />
                      ) : (
                        <Circle size={18} className="text-slate-300 shrink-0" />
                      )}
                      <LessonIcon size={15} className="text-slate-400 shrink-0" />
                      <span className={`text-sm flex-1 ${completed ? 'text-slate-500' : 'text-slate-700'}`}>{lesson.title}</span>
                      <span className="text-xs text-slate-400">{lesson.duration_minutes} min</span>
                      <ChevronRight size={14} className="text-slate-300 group-hover:text-blue-500" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Lesson View ----

function LessonView({ courseId, lessonId, moduleId, onBack, onSelectLesson }: {
  courseId: string | null;
  lessonId: string | null;
  moduleId: string | null;
  onBack: () => void;
  onSelectLesson: (courseId: string, lessonId: string, moduleId: string) => void;
}) {
  const { user } = useAuth();
  const { course } = useCourseDetail(courseId);
  const { enrollment } = useEnrollment(courseId);
  const { progress, markComplete, refetch: refetchProgress } = useLessonProgress(courseId);
  const issueCertificate = useIssueCertificate();
  const [certIssued, setCertIssued] = useState(false);

  if (!course || !lessonId) return null;

  const allLessons = course.modules.flatMap(m => m.lessons.map(l => ({ ...l, moduleId: m.id })));
  const currentIdx = allLessons.findIndex(l => l.id === lessonId);
  const lesson = allLessons[currentIdx];
  if (!lesson) return null;

  const prevLesson = currentIdx > 0 ? allLessons[currentIdx - 1] : null;
  const nextLesson = currentIdx < allLessons.length - 1 ? allLessons[currentIdx + 1] : null;
  const isLastLesson = currentIdx === allLessons.length - 1;
  const allComplete = allLessons.every(l => progress[l.id] || l.id === lessonId);

  const handleMarkComplete = async () => {
    if (!user || !enrollment) return;
    await markComplete(lessonId);
    if (isLastLesson && allComplete) {
      const cert = await issueCertificate(courseId!);
      if (cert) setCertIssued(true);
    }
  };

  const handleQuizComplete = async (passed: boolean) => {
    if (passed && user && enrollment) {
      await markComplete(lessonId);
      refetchProgress();
      if (isLastLesson && allComplete) {
        const cert = await issueCertificate(courseId!);
        if (cert) setCertIssued(true);
      }
    }
  };

  const currentModule = course.modules.find(m => m.id === moduleId);

  return (
    <div className="flex gap-6">
      {/* Sidebar - lesson list */}
      <div className="hidden lg:block w-72 shrink-0">
        <div className="bg-white rounded-xl border border-slate-200 sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
          <div className="p-4 border-b border-slate-200">
            <button onClick={onBack} className="text-sm text-slate-500 hover:text-blue-600 flex items-center gap-1">
              <ArrowLeft size={14} /> {course.title}
            </button>
          </div>
          <div className="p-3">
            {course.modules.map((mod) => (
              <div key={mod.id} className="mb-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2 mb-1">{mod.title}</p>
                {mod.lessons.map(l => (
                  <button
                    key={l.id}
                    onClick={() => onSelectLesson(course.id, l.id, mod.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition ${
                      l.id === lessonId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {progress[l.id] ? <CheckCircle size={13} className="text-emerald-500 shrink-0" /> : <Circle size={13} className="text-slate-300 shrink-0" />}
                    <span className="truncate">{l.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-4 flex-wrap">
          <button onClick={onBack} className="hover:text-blue-600">{course.title}</button>
          <ChevronRight size={14} />
          <span>{currentModule?.title}</span>
          <ChevronRight size={14} />
          <span className="text-slate-900 font-medium">{lesson.title}</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">{lesson.title}</h2>

          {lesson.type === 'quiz' ? (
            <QuizComponent lesson={lesson} onComplete={handleQuizComplete} />
          ) : lesson.type === 'video' ? (
            <VideoLesson lesson={lesson} />
          ) : (
            <TextLesson lesson={lesson} />
          )}

          {/* Completion + nav */}
          {certIssued && (
            <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
              <Award className="mx-auto text-emerald-600 mb-2" size={32} />
              <p className="font-semibold text-emerald-800">Congratulations! Certificate Earned!</p>
              <p className="text-sm text-emerald-600">You have completed all lessons. Check the Certificates tab to view and download.</p>
            </div>
          )}

          <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
            {prevLesson ? (
              <button onClick={() => onSelectLesson(course.id, prevLesson.id, prevLesson.moduleId)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-blue-600">
                <ChevronLeft size={16} /> {prevLesson.title}
              </button>
            ) : <div />}

            {lesson.type !== 'quiz' && user && enrollment && !progress[lessonId] && (
              <button onClick={handleMarkComplete} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition flex items-center gap-1.5">
                <CheckCircle size={16} /> Mark Complete
              </button>
            )}

            {nextLesson ? (
              <button onClick={() => onSelectLesson(course.id, nextLesson.id, nextLesson.moduleId)} className="flex items-center gap-1.5 text-sm text-blue-600 font-medium hover:underline">
                {nextLesson.title} <ChevronRight size={16} />
              </button>
            ) : <div />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Text Lesson Renderer ----

function TextLesson({ lesson }: { lesson: Lesson }) {
  const body = (lesson.content as { body?: string }).body || '';
  return <div className="prose max-w-none">{renderContent(body)}</div>;
}

function renderContent(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let currentParagraph: string[] = [];
  let inList = false;
  let listItems: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const text = currentParagraph.join(' ');
      if (text.trim()) {
        elements.push(<p key={key++} className="text-slate-700 leading-relaxed mb-4">{renderInline(text)}</p>);
      }
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++} className="list-disc list-inside mb-4 space-y-1.5 text-slate-700">
          {listItems.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      flushList();
      elements.push(<h2 key={key++} className="text-xl font-bold text-slate-900 mt-6 mb-3">{trimmed.slice(3)}</h2>);
    } else if (trimmed.startsWith('### ')) {
      flushParagraph();
      flushList();
      elements.push(<h3 key={key++} className="text-lg font-semibold text-slate-800 mt-4 mb-2">{trimmed.slice(4)}</h3>);
    } else if (trimmed.startsWith('- ')) {
      flushParagraph();
      if (!inList) inList = true;
      listItems.push(trimmed.slice(2));
    } else if (trimmed === '') {
      flushParagraph();
      flushList();
    } else {
      if (inList) flushList();
      currentParagraph.push(trimmed);
    }
  }
  flushParagraph();
  flushList();

  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  // Handle **bold** and ''italic'' (single quotes used in SQL-escaped content)
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

// ---- Video Lesson ----

function VideoLesson({ lesson }: { lesson: Lesson }) {
  const content = lesson.content as { video_url?: string; body?: string };
  return (
    <div>
      {content.video_url && (
        <div className="aspect-video bg-slate-900 rounded-lg mb-6 overflow-hidden">
          <iframe src={content.video_url} className="w-full h-full" allowFullScreen title={lesson.title} />
        </div>
      )}
      {content.body && <div className="prose max-w-none">{renderContent(content.body)}</div>}
    </div>
  );
}

// ---- Quiz Component ----

interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct: number;
  explanation?: string;
}

function QuizComponent({ lesson, onComplete }: { lesson: Lesson; onComplete: (passed: boolean) => void }) {
  const { user } = useAuth();
  const content = lesson.content as { questions?: QuizQuestion[]; passing_score?: number };
  const questions = content.questions || [];
  const passingScore = content.passing_score || 70;
  const { attempts, submitQuiz } = useQuizAttempts(lesson.id);

  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [passed, setPassed] = useState(false);

  // If already passed, show result
  const alreadyPassed = attempts.some(a => a.passed);

  const handleSelect = (qId: number, optIdx: number) => {
    if (submitted) return;
    setAnswers(prev => ({ ...prev, [qId]: optIdx }));
  };

  const handleSubmit = async () => {
    if (questions.length === 0) return;
    let correct = 0;
    questions.forEach(q => {
      if (answers[q.id] === q.correct) correct++;
    });
    const pct = Math.round((correct / questions.length) * 100);
    const didPass = pct >= passingScore;
    setScore(pct);
    setPassed(didPass);
    setSubmitted(true);

    if (user) {
      await submitQuiz(lesson.id, answers, pct, didPass);
    }
    onComplete(didPass);
  };

  const handleRetry = () => {
    setAnswers({});
    setSubmitted(false);
    setScore(0);
    setPassed(false);
  };

  if (alreadyPassed && !submitted) {
    return (
      <div className="text-center py-8">
        <CheckCircle className="mx-auto text-emerald-500 mb-3" size={48} />
        <p className="text-lg font-semibold text-emerald-700">Quiz Passed!</p>
        <p className="text-sm text-slate-500 mt-1">You have already completed this quiz.</p>
        <button onClick={() => { setSubmitted(false); }} className="mt-4 text-sm text-blue-600 hover:underline">Retake Quiz</button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
        Answer all questions. You need {passingScore}% to pass.
      </div>

      {questions.map((q, qi) => (
        <div key={q.id} className="mb-6 p-4 bg-slate-50 rounded-lg">
          <p className="font-medium text-slate-900 mb-3">{qi + 1}. {q.question}</p>
          <div className="space-y-2">
            {q.options.map((opt, oi) => {
              const selected = answers[q.id] === oi;
              const isCorrect = q.correct === oi;
              let optClass = 'border-slate-200 bg-white hover:border-blue-300';
              if (submitted) {
                if (isCorrect) optClass = 'border-emerald-400 bg-emerald-50';
                else if (selected && !isCorrect) optClass = 'border-red-400 bg-red-50';
              } else if (selected) {
                optClass = 'border-blue-500 bg-blue-50';
              }

              return (
                <button
                  key={oi}
                  onClick={() => handleSelect(q.id, oi)}
                  disabled={submitted}
                  className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition ${optClass}`}
                >
                  <span className="font-medium mr-2">{String.fromCharCode(65 + oi)}.</span>
                  {opt}
                </button>
              );
            })}
          </div>
          {submitted && q.explanation && (
            <p className="mt-2 text-sm text-slate-600 italic">{q.explanation}</p>
          )}
        </div>
      ))}

      {submitted ? (
        <div className={`p-4 rounded-lg text-center ${passed ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
          <p className={`text-lg font-semibold ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
            {passed ? 'Congratulations! You passed!' : 'Not quite. Try again!'}
          </p>
          <p className="text-sm text-slate-600 mt-1">Score: {score}% (Required: {passingScore}%)</p>
          {!passed && (
            <button onClick={handleRetry} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              Retry Quiz
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={Object.keys(answers).length < questions.length}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Submit Quiz
        </button>
      )}
    </div>
  );
}

// ---- My Courses View ----

function MyCoursesView({ onSelectCourse }: { onSelectCourse: (id: string) => void }) {
  const { user } = useAuth();
  const { enrollments, loading } = useMyEnrollments();

  if (!user) return <div className="text-center py-12 text-slate-500">Please sign in to view your courses.</div>;
  if (loading) return <div className="text-center py-12 text-slate-500">Loading...</div>;

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">My Learning</h2>
      {enrollments.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <BookOpen className="mx-auto mb-3 text-slate-300" size={48} />
          <p>You haven't enrolled in any courses yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {enrollments.map(e => (
            <div
              key={e.id}
              onClick={() => onSelectCourse(e.course_id)}
              className="bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer p-5"
            >
              <h3 className="font-semibold text-slate-900 mb-2">{e.course.title}</h3>
              <p className="text-sm text-slate-500 mb-3">Enrolled {new Date(e.enrolled_at).toLocaleDateString()}</p>
              {e.completed_at ? (
                <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">Completed</span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">In Progress</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Certificates View ----

function CertificatesView() {
  const { user } = useAuth();
  const { certificates, loading } = useCertificates();
  const [printCert, setPrintCert] = useState<typeof certificates[0] | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  if (!user) return <div className="text-center py-12 text-slate-500">Please sign in to view certificates.</div>;
  if (loading) return <div className="text-center py-12 text-slate-500">Loading...</div>;

  const handlePrint = (cert: typeof certificates[0]) => {
    setPrintCert(cert);
    setTimeout(() => window.print(), 300);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-900 mb-6">My Certificates</h2>

      {certificates.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Award className="mx-auto mb-3 text-slate-300" size={48} />
          <p>No certificates yet. Complete a course to earn one!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {certificates.map(cert => (
            <div key={cert.id} className="bg-white rounded-xl border-2 border-amber-200 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <Award className="text-amber-500 mb-2" size={32} />
                  <h3 className="font-semibold text-slate-900">{cert.course?.title || 'Course'}</h3>
                  <p className="text-sm text-slate-500 mt-1">Issued: {new Date(cert.issued_at).toLocaleDateString()}</p>
                  <p className="text-xs text-slate-400 mt-1 font-mono">{cert.certificate_number}</p>
                </div>
                <button
                  onClick={() => handlePrint(cert)}
                  className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 flex items-center gap-1.5"
                >
                  <Printer size={14} /> Print
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Printable Certificate */}
      {printCert && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center print:bg-white print:static print:block">
          <div ref={printRef} className="bg-white w-[800px] p-12 print:p-8 print:shadow-none relative" id="certificate-print">
            <button onClick={() => setPrintCert(null)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 print:hidden">
              <X size={20} />
            </button>
            <div className="border-4 border-amber-400 p-10 text-center">
              <div className="border-2 border-amber-300 p-8">
                <GraduationCap className="mx-auto text-amber-500 mb-4" size={48} />
                <h2 className="text-sm uppercase tracking-[0.3em] text-slate-500 mb-2">Certificate of Completion</h2>
                <h1 className="text-3xl font-bold text-slate-900 mb-6">{printCert.course?.title}</h1>
                <p className="text-slate-500 mb-2">This is to certify that</p>
                <p className="text-2xl font-semibold text-slate-900 mb-4">{user.user_metadata?.full_name || user.email}</p>
                <p className="text-slate-500 mb-8">
                  has successfully completed the course requirements and demonstrated proficiency
                  in the subject matter.
                </p>
                <div className="flex items-center justify-between mt-8 px-8">
                  <div className="text-center">
                    <div className="border-t-2 border-slate-300 pt-2 px-8">
                      <p className="text-sm font-medium text-slate-700">Date</p>
                      <p className="text-xs text-slate-500">{new Date(printCert.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-blue-800">UCB Stock</p>
                    <p className="text-xs text-slate-500">Brokerage Limited</p>
                  </div>
                  <div className="text-center">
                    <div className="border-t-2 border-slate-300 pt-2 px-8">
                      <p className="text-sm font-medium text-slate-700">Certificate No.</p>
                      <p className="text-xs text-slate-500 font-mono">{printCert.certificate_number}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Admin View ----

function AdminView() {
  const { courses, loading, refetch } = useAllCourses();
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [showCourseForm, setShowCourseForm] = useState(false);
  const [managingCourse, setManagingCourse] = useState<string | null>(null);

  if (loading) return <div className="text-center py-12 text-slate-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Course Management</h2>
        <button
          onClick={() => { setEditingCourse(null); setShowCourseForm(true); }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5"
        >
          <Plus size={16} /> New Course
        </button>
      </div>

      {/* Course list */}
      <div className="space-y-3">
        {courses.map(course => (
          <div key={course.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full ${course.is_published ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <div>
                  <h3 className="font-semibold text-slate-900">{course.title}</h3>
                  <p className="text-xs text-slate-500">{course.category} / {course.level} / {course.duration_hours}h</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setManagingCourse(managingCourse === course.id ? null : course.id)}
                  className="px-3 py-1.5 text-xs bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                >
                  Modules & Lessons
                </button>
                <button
                  onClick={() => { setEditingCourse(course); setShowCourseForm(true); }}
                  className="p-1.5 text-slate-400 hover:text-blue-600"
                >
                  <Edit3 size={16} />
                </button>
                <button
                  onClick={async () => { if (confirm('Delete this course?')) { await deleteCourse(course.id); refetch(); } }}
                  className="p-1.5 text-slate-400 hover:text-red-600"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {managingCourse === course.id && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <ModuleManager courseId={course.id} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Course Form Modal */}
      {showCourseForm && (
        <CourseFormModal
          course={editingCourse}
          onClose={() => setShowCourseForm(false)}
          onSave={() => { setShowCourseForm(false); refetch(); }}
        />
      )}
    </div>
  );
}

// ---- Course Form Modal ----

function CourseFormModal({ course, onClose, onSave }: { course: Course | null; onClose: () => void; onSave: () => void }) {
  const [title, setTitle] = useState(course?.title || '');
  const [description, setDescription] = useState(course?.description || '');
  const [category, setCategory] = useState(course?.category || 'basics');
  const [level, setLevel] = useState(course?.level || 'beginner');
  const [durationHours, setDurationHours] = useState(course?.duration_hours || 4);
  const [isPublished, setIsPublished] = useState(course?.is_published ?? false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await saveCourse({
      id: course?.id,
      title,
      description,
      category,
      level,
      duration_hours: durationHours,
      is_published: isPublished,
    });
    setSaving(false);
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{course ? 'Edit Course' : 'New Course'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                {CATEGORIES.filter(c => c.key !== 'all').map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Level</label>
              <select value={level} onChange={e => setLevel(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Hours</label>
              <input type="number" value={durationHours} onChange={e => setDurationHours(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublished} onChange={e => setIsPublished(e.target.checked)} className="rounded" />
            Published (visible to students)
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={!title || saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
            <Save size={14} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Module Manager ----

function ModuleManager({ courseId }: { courseId: string }) {
  const { course, loading } = useCourseDetail(courseId);
  const [showModuleForm, setShowModuleForm] = useState(false);
  const [editingModule, setEditingModule] = useState<Module | null>(null);
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  if (loading || !course) return <div className="text-sm text-slate-500">Loading modules...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-700">Modules ({course.modules.length})</h4>
        <button
          onClick={() => { setEditingModule(null); setShowModuleForm(true); }}
          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
        >
          <Plus size={13} /> Add Module
        </button>
      </div>

      <div className="space-y-2">
        {course.modules.map((mod, i) => (
          <div key={mod.id} className="border border-slate-200 rounded-lg">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-t-lg">
              <button
                onClick={() => setExpandedModule(expandedModule === mod.id ? null : mod.id)}
                className="flex items-center gap-2 text-sm font-medium text-slate-700"
              >
                <ChevronRight size={14} className={`transition ${expandedModule === mod.id ? 'rotate-90' : ''}`} />
                {i + 1}. {mod.title} ({mod.lessons.length} lessons)
              </button>
              <div className="flex items-center gap-1">
                <button onClick={() => { setEditingModule(mod); setShowModuleForm(true); }} className="p-1 text-slate-400 hover:text-blue-600">
                  <Edit3 size={13} />
                </button>
                <button
                  onClick={async () => { if (confirm('Delete module and all lessons?')) { await deleteModule(mod.id); refresh(); } }}
                  className="p-1 text-slate-400 hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            {expandedModule === mod.id && (
              <div className="p-3">
                <LessonManager moduleId={mod.id} lessons={mod.lessons} />
              </div>
            )}
          </div>
        ))}
      </div>

      {showModuleForm && (
        <ModuleFormModal
          courseId={courseId}
          module={editingModule}
          nextOrder={course.modules.length}
          onClose={() => setShowModuleForm(false)}
          onSave={() => { setShowModuleForm(false); refresh(); }}
        />
      )}
    </div>
  );
}

// ---- Module Form Modal ----

function ModuleFormModal({ courseId, module: mod, nextOrder, onClose, onSave }: {
  courseId: string; module: Module | null; nextOrder: number; onClose: () => void; onSave: () => void;
}) {
  const [title, setTitle] = useState(mod?.title || '');
  const [description, setDescription] = useState(mod?.description || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await saveModule({ id: mod?.id, course_id: courseId, title, description, order_index: mod?.order_index ?? nextOrder });
    setSaving(false);
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{mod ? 'Edit Module' : 'New Module'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={!title || saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Lesson Manager ----

function LessonManager({ moduleId, lessons }: { moduleId: string; lessons: Lesson[] }) {
  const [showForm, setShowForm] = useState(false);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [, setRefreshKey] = useState(0);

  return (
    <div>
      {lessons.map((lesson, i) => (
        <div key={lesson.id} className="flex items-center justify-between py-1.5 text-sm">
          <span className="text-slate-600">
            {i + 1}. {lesson.title}
            <span className="text-xs text-slate-400 ml-2">({lesson.type})</span>
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => { setEditingLesson(lesson); setShowForm(true); }} className="p-1 text-slate-400 hover:text-blue-600">
              <Edit3 size={12} />
            </button>
            <button
              onClick={async () => { if (confirm('Delete lesson?')) { await deleteLesson(lesson.id); setRefreshKey(k => k + 1); } }}
              className="p-1 text-slate-400 hover:text-red-600"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() => { setEditingLesson(null); setShowForm(true); }}
        className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-2"
      >
        <Plus size={12} /> Add Lesson
      </button>

      {showForm && (
        <LessonFormModal
          moduleId={moduleId}
          lesson={editingLesson}
          nextOrder={lessons.length}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); setRefreshKey(k => k + 1); }}
        />
      )}
    </div>
  );
}

// ---- Lesson Form Modal ----

function LessonFormModal({ moduleId, lesson, nextOrder, onClose, onSave }: {
  moduleId: string; lesson: Lesson | null; nextOrder: number; onClose: () => void; onSave: () => void;
}) {
  const [title, setTitle] = useState(lesson?.title || '');
  const [type, setType] = useState<'text' | 'video' | 'quiz'>(lesson?.type || 'text');
  const [duration, setDuration] = useState(lesson?.duration_minutes || 10);
  const [body, setBody] = useState((lesson?.content as { body?: string })?.body || '');
  const [videoUrl, setVideoUrl] = useState((lesson?.content as { video_url?: string })?.video_url || '');
  const [quizJson, setQuizJson] = useState(
    lesson?.type === 'quiz' ? JSON.stringify(lesson.content, null, 2) : '{"questions": [], "passing_score": 70}'
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    let content: Record<string, unknown>;
    if (type === 'quiz') {
      try {
        content = JSON.parse(quizJson);
      } catch {
        setError('Invalid JSON for quiz content');
        setSaving(false);
        return;
      }
    } else if (type === 'video') {
      content = { video_url: videoUrl, body };
    } else {
      content = { body };
    }

    await saveLesson({
      id: lesson?.id,
      module_id: moduleId,
      title,
      type,
      content,
      order_index: lesson?.order_index ?? nextOrder,
      duration_minutes: duration,
    });
    setSaving(false);
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{lesson ? 'Edit Lesson' : 'New Lesson'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Duration (min)</label>
              <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <div className="flex gap-2">
              {(['text', 'video', 'quiz'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm capitalize ${type === t ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {type === 'text' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Content (Markdown-like: ## for headings, - for lists, **bold**)</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={12} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono" />
            </div>
          )}

          {type === 'video' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Video URL (YouTube embed)</label>
                <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="https://www.youtube.com/embed/..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={6} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono" />
              </div>
            </>
          )}

          {type === 'quiz' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Quiz JSON</label>
              <textarea value={quizJson} onChange={e => setQuizJson(e.target.value)} rows={12} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono" />
              <p className="text-xs text-slate-400 mt-1">Format: {`{"questions": [{"id": 1, "question": "...", "options": ["A","B","C","D"], "correct": 0, "explanation": "..."}], "passing_score": 70}`}</p>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={!title || saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
