import React, { useState, useEffect, useRef } from 'react';
import { localDb } from './db.js';
import { flushSync } from './sync-engine.js';
import { onServerTimeSync, getRemainingMs, formatCountdown } from './timer.js';
import { renderRichText } from './rich-render.js';
import type { StudentQuestion, AnswerInputData } from '@eduassess/schemas';

interface ExamSessionState {
  submissionId: string;
  examTitle: string;
  deadlineAt: string;
  questions: StudentQuestion[];
}

export const App: React.FC = () => {
  // Navigation & Authentication
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // First-time Password Change Modal
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Active Exam Session
  const [session, setSession] = useState<ExamSessionState | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerInputData>>({});
  const [syncStatus, setSyncStatus] = useState<'synced' | 'saving' | 'offline'>('synced');
  const [remainingTime, setRemainingTime] = useState<string>('--:--:--');
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const clientSeqRef = useRef<Record<string, number>>({});

  // 1. Monotonic Timer Tick
  useEffect(() => {
    if (!session || isSubmitted) return;

    const interval = setInterval(() => {
      const ms = getRemainingMs();
      setRemainingTime(formatCountdown(ms));
      if (ms <= 0) {
        handleAutoSubmit();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [session, isSubmitted]);

  // 2. Connectivity Listeners
  useEffect(() => {
    const handleOnline = () => setSyncStatus('synced');
    const handleOffline = () => setSyncStatus('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 3. Login Handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoginLoading(true);
    setAuthError(null);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schoolId: 'school_1',
          username,
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Login gagal.');
      }

      setToken(data.accessToken);
      localStorage.setItem('token', data.accessToken);

      if (data.requiresPasswordChange) {
        setNeedsPasswordChange(true);
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsLoginLoading(false);
    }
  };

  // 4. Change Password Handler
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setAuthError('Konfirmasi sandi tidak cocok.');
      return;
    }

    try {
      const res = await fetch('/api/v1/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          oldPassword: password,
          newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);

      setToken(data.accessToken);
      localStorage.setItem('token', data.accessToken);
      setNeedsPasswordChange(false);
      setAuthError(null);
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  // 5. Start Exam Simulator / Launcher
  const handleStartExam = async (examId: string) => {
    try {
      const t0 = performance.now();
      const res = await fetch(`/api/v1/student/exams/${examId}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ deviceId: 'browser_pwa_1' }),
      });

      const t1 = performance.now();
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);

      // Synchronize authoritative monotonic timer
      onServerTimeSync(data.remainingMs, t0, t1);

      const allQuestions = data.groups.flatMap((g: any) => g.questions);

      setSession({
        submissionId: data.submissionId,
        examTitle: data.exam.title,
        deadlineAt: data.exam.deadlineAt,
        questions: allQuestions,
      });

      // Save session in Dexie
      await localDb.session.put({
        id: data.submissionId,
        examToken: data.examToken,
        deadlineAt: data.exam.deadlineAt,
        remainingMs: data.remainingMs,
        serverTimeOffsetMs: 0,
        status: 'in_progress',
      });
    } catch (err: any) {
      alert(`Gagal memulai ujian: ${err.message}`);
    }
  };

  // 6. Answer Update Handler (Triggers Offline Save & Debounced Sync)
  const handleAnswerChange = async (questionId: string, inputData: AnswerInputData) => {
    if (!session || isSubmitted) return;

    // Increment clientSeq monotonically
    const nextSeq = (clientSeqRef.current[questionId] || 0) + 1;
    clientSeqRef.current[questionId] = nextSeq;

    setAnswers((prev) => ({
      ...prev,
      [questionId]: inputData,
    }));

    setSyncStatus('saving');

    // 1. Persist to Dexie IndexedDB (Offline-first durability)
    await localDb.answers.put({
      submissionId: session.submissionId,
      questionId,
      clientSeq: nextSeq,
      inputData,
      dirty: 1,
      updatedAt: new Date().toISOString(),
    });

    // 2. Debounced background flush
    flushSync(session.submissionId, async (sid, payload) => {
      const res = await fetch(`/api/v1/student/submissions/${sid}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setSyncStatus('synced');
      return data;
    }).catch(() => {
      setSyncStatus('offline');
    });
  };

  // 7. Submit Exam Handler
  const handleSubmitExam = async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/v1/student/submissions/${session.submissionId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);

      setIsSubmitted(true);
      setShowSubmitModal(false);
      await localDb.session.update(session.submissionId, { status: 'submitted' });
    } catch (err: any) {
      alert(`Gagal mengumpulkan ujian: ${err.message}`);
    }
  };

  const handleAutoSubmit = async () => {
    setIsSubmitted(true);
    await handleSubmitExam();
  };

  // --- RENDER 1: Login Form ---
  if (!token) {
    return (
      <div style={styles.centerContainer}>
        <div style={styles.card}>
          <h2 style={{ textAlign: 'center', color: '#1e3a8a', marginBottom: 24 }}>EduAssess AI</h2>
          <p style={{ textAlign: 'center', color: '#64748b', marginBottom: 24 }}>
            Platform Ujian Siswa Mobile-First & Terintegrasi
          </p>

          {authError && <div style={styles.errorAlert}>{authError}</div>}

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={styles.label}>Nomor Induk Siswa (NIS)</label>
              <input
                type="text"
                style={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Contoh: 2026101"
                required
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={styles.label}>Kata Sandi</label>
              <input
                type="password"
                style={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan sandi..."
                required
              />
            </div>
            <button type="submit" style={styles.primaryButton} disabled={isLoginLoading}>
              {isLoginLoading ? 'Masuk...' : 'Masuk Ujian'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- RENDER 2: First-time Password Change Modal ---
  if (needsPasswordChange) {
    return (
      <div style={styles.centerContainer}>
        <div style={styles.card}>
          <h3 style={{ color: '#b91c1c', marginBottom: 12 }}>Ganti Sandi Pertama Kali</h3>
          <p style={{ color: '#475569', fontSize: 14, marginBottom: 20 }}>
            Demi keamanan, Anda diwajibkan mengganti sandi awal sebelum dapat mengikuti ujian.
          </p>
          {authError && <div style={styles.errorAlert}>{authError}</div>}
          <form onSubmit={handleChangePassword}>
            <div style={{ marginBottom: 16 }}>
              <label style={styles.label}>Sandi Baru (Min. 8 Karakter)</label>
              <input
                type="password"
                style={styles.input}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={styles.label}>Konfirmasi Sandi Baru</label>
              <input
                type="password"
                style={styles.input}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" style={styles.primaryButton}>Simpan Sandi & Lanjutkan</button>
          </form>
        </div>
      </div>
    );
  }

  // --- RENDER 3: Exam Submission Finished View ---
  if (isSubmitted) {
    return (
      <div style={styles.centerContainer}>
        <div style={styles.card}>
          <h2 style={{ textAlign: 'center', color: '#15803d', marginBottom: 16 }}>✅ Ujian Selesai!</h2>
          <p style={{ textAlign: 'center', color: '#334155', lineHeight: 1.6 }}>
            Jawaban Anda telah berhasil dikumpulkan ke server. Penilaian objektif diproses secara otomatis.
          </p>
          <button
            style={{ ...styles.primaryButton, marginTop: 24 }}
            onClick={() => {
              setSession(null);
              setIsSubmitted(false);
            }}
          >
            Kembali ke Beranda
          </button>
        </div>
      </div>
    );
  }

  // --- RENDER 4: Exam Selection (If no active exam) ---
  if (!session) {
    return (
      <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ color: '#0f172a' }}>Daftar Ujian Anda</h2>
          <button
            style={styles.secondaryButton}
            onClick={() => {
              localStorage.removeItem('token');
              setToken(null);
            }}
          >
            Keluar
          </button>
        </header>

        <div style={styles.examCard}>
          <div>
            <h3 style={{ color: '#1e3a8a', marginBottom: 6 }}>Penilaian Harian Fisika Terapan</h3>
            <p style={{ color: '#64748b', fontSize: 14 }}>Durasi: 60 Menit • Mode: Mandiri</p>
          </div>
          <button
            style={styles.primaryButtonSmall}
            onClick={() => handleStartExam('exam_fisika_101')}
          >
            Mulai Kerjakan
          </button>
        </div>
      </div>
    );
  }

  // --- RENDER 5: Active Exam Runtime ---
  const currentQuestion = session.questions[currentIndex]!;
  const currentAnswer = answers[currentQuestion.questionId] || {};
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = session.questions.length;

  const renderedContent = renderRichText(currentQuestion.content);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#f8fafc' }}>
      {/* Top Bar */}
      <header style={styles.examHeader}>
        <div>
          <strong style={{ fontSize: 16, color: '#0f172a' }}>{session.examTitle}</strong>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Soal {currentIndex + 1} dari {totalQuestions}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Sync Badge */}
          <span style={syncStatus === 'synced' ? styles.badgeSynced : syncStatus === 'saving' ? styles.badgeSaving : styles.badgeOffline}>
            {syncStatus === 'synced' ? '● Tersinkron' : syncStatus === 'saving' ? '● Menyimpan...' : '● Offline'}
          </span>

          {/* Monotonic Timer */}
          <div style={styles.timerBadge}>
            ⏱️ {remainingTime}
          </div>

          <button style={styles.submitTopButton} onClick={() => setShowSubmitModal(true)}>
            Kumpulkan
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ flex: 1, padding: 16, maxWidth: 800, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* Question Palette */}
        <div style={styles.paletteContainer}>
          {session.questions.map((q, idx) => {
            const isAnswered = !!answers[q.questionId];
            const isCurrent = idx === currentIndex;
            return (
              <button
                key={q.questionId}
                onClick={() => setCurrentIndex(idx)}
                style={{
                  ...styles.paletteButton,
                  borderColor: isCurrent ? '#2563eb' : '#cbd5e1',
                  background: isCurrent ? '#dbeafe' : isAnswered ? '#dcfce7' : '#ffffff',
                  fontWeight: isCurrent ? 'bold' : 'normal',
                }}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>

        {/* Question Card */}
        <div style={styles.questionCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={styles.typeBadge}>{currentQuestion.type.replace('_', ' ').toUpperCase()}</span>
            <span style={{ fontSize: 13, color: '#64748b' }}>{currentQuestion.points} Poin</span>
          </div>

          {/* Safe KaTeX RichText */}
          <div
            style={{ fontSize: 16, lineHeight: 1.7, color: '#1e293b' }}
            dir={renderedContent.dir}
            dangerouslySetInnerHTML={{ __html: renderedContent.__html }}
          />

          <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0' }} />

          {/* Answer Input Controls */}
          {currentQuestion.type === 'single_choice' && currentQuestion.options && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {currentQuestion.options.map((opt) => {
                const isSelected = currentAnswer.selected === opt.id;
                const optRich = renderRichText(opt.content);
                return (
                  <div
                    key={opt.id}
                    onClick={() => handleAnswerChange(currentQuestion.questionId, { selected: opt.id })}
                    style={{
                      ...styles.optionCard,
                      border: isSelected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                      background: isSelected ? '#eff6ff' : '#ffffff',
                    }}
                  >
                    <input
                      type="radio"
                      name={`q_${currentQuestion.questionId}`}
                      checked={isSelected}
                      readOnly
                      style={{ marginRight: 12 }}
                    />
                    <div dangerouslySetInnerHTML={{ __html: optRich.__html }} />
                  </div>
                );
              })}
            </div>
          )}

          {currentQuestion.type === 'multiple_choice' && currentQuestion.options && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {currentQuestion.options.map((opt) => {
                const selectedArr = currentAnswer.selectedOptions || [];
                const isSelected = selectedArr.includes(opt.id);
                const optRich = renderRichText(opt.content);
                return (
                  <div
                    key={opt.id}
                    onClick={() => {
                      const next = isSelected
                        ? selectedArr.filter((id) => id !== opt.id)
                        : [...selectedArr, opt.id];
                      handleAnswerChange(currentQuestion.questionId, { selectedOptions: next });
                    }}
                    style={{
                      ...styles.optionCard,
                      border: isSelected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                      background: isSelected ? '#eff6ff' : '#ffffff',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      style={{ marginRight: 12 }}
                    />
                    <div dangerouslySetInnerHTML={{ __html: optRich.__html }} />
                  </div>
                );
              })}
            </div>
          )}

          {currentQuestion.type === 'short_answer' && (
            <div>
              <label style={styles.label}>Tulis Jawaban Singkat Anda:</label>
              <input
                type="text"
                style={styles.input}
                value={currentAnswer.text || ''}
                onChange={(e) => handleAnswerChange(currentQuestion.questionId, { text: e.target.value })}
                placeholder="Ketik jawaban..."
              />
            </div>
          )}

          {currentQuestion.type === 'essay' && (
            <div>
              <label style={styles.label}>Uraian Jawaban:</label>
              <textarea
                style={{ ...styles.input, minHeight: 140, resize: 'vertical' }}
                value={currentAnswer.text || ''}
                onChange={(e) => handleAnswerChange(currentQuestion.questionId, { text: e.target.value })}
                placeholder="Tulis uraian penjelasan secara lengkap..."
              />
            </div>
          )}
        </div>

        {/* Bottom Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
          <button
            style={styles.secondaryButton}
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
          >
            ← Soal Sebelumnya
          </button>
          <button
            style={styles.primaryButtonSmall}
            disabled={currentIndex === totalQuestions - 1}
            onClick={() => setCurrentIndex((prev) => Math.min(totalQuestions - 1, prev + 1))}
          >
            Soal Selanjutnya →
          </button>
        </div>
      </main>

      {/* Submit Confirmation Modal */}
      {showSubmitModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h3 style={{ color: '#0f172a', marginBottom: 12 }}>Konfirmasi Kumpul Ujian</h3>
            <p style={{ color: '#475569', lineHeight: 1.5, marginBottom: 20 }}>
              Anda telah menjawab <strong>{answeredCount}</strong> dari total <strong>{totalQuestions}</strong> soal.
              {answeredCount < totalQuestions && (
                <span style={{ display: 'block', color: '#b91c1c', marginTop: 8 }}>
                  ⚠️ Masih ada {totalQuestions - answeredCount} soal yang belum dijawab!
                </span>
              )}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button style={styles.secondaryButton} onClick={() => setShowSubmitModal(false)}>
                Batal & Lanjut Mengerjakan
              </button>
              <button style={styles.submitTopButton} onClick={handleSubmitExam}>
                Ya, Kumpulkan Sekarang
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Inline Responsive Styles
const styles: Record<string, React.CSSProperties> = {
  centerContainer: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f1f5f9',
    padding: 16,
  },
  card: {
    background: '#ffffff',
    padding: 32,
    borderRadius: 12,
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
    width: '100%',
    maxWidth: 420,
  },
  examCard: {
    background: '#ffffff',
    padding: 20,
    borderRadius: 10,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    border: '1px solid #e2e8f0',
  },
  label: {
    display: 'block',
    fontSize: 14,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    fontSize: 15,
    boxSizing: 'border-box',
  },
  primaryButton: {
    width: '100%',
    padding: '12px 16px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  primaryButtonSmall: {
    padding: '8px 16px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '8px 16px',
    background: '#ffffff',
    color: '#475569',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    fontSize: 14,
    cursor: 'pointer',
  },
  errorAlert: {
    background: '#fee2e2',
    color: '#b91c1c',
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 14,
    marginBottom: 16,
  },
  examHeader: {
    background: '#ffffff',
    borderBottom: '1px solid #e2e8f0',
    padding: '12px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timerBadge: {
    background: '#fef3c7',
    color: '#92400e',
    padding: '6px 12px',
    borderRadius: 6,
    fontWeight: 'bold',
    fontSize: 14,
  },
  badgeSynced: {
    color: '#16a34a',
    fontSize: 13,
    fontWeight: 500,
  },
  badgeSaving: {
    color: '#ca8a04',
    fontSize: 13,
    fontWeight: 500,
  },
  badgeOffline: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: 500,
  },
  submitTopButton: {
    background: '#15803d',
    color: '#ffffff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 6,
    fontWeight: 600,
    cursor: 'pointer',
  },
  paletteContainer: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  paletteButton: {
    width: 38,
    height: 38,
    borderRadius: 6,
    borderWidth: 2,
    borderStyle: 'solid',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionCard: {
    background: '#ffffff',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    border: '1px solid #e2e8f0',
  },
  typeBadge: {
    background: '#f1f5f9',
    color: '#475569',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 600,
  },
  optionCard: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    zIndex: 1000,
  },
  modalContent: {
    background: '#ffffff',
    borderRadius: 12,
    padding: 24,
    maxWidth: 480,
    width: '100%',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
  },
};

export default App;
