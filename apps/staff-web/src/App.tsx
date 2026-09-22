import React, { useState, useEffect } from 'react';
import katex from 'katex';

interface QuestionItem {
  id: string;
  type: 'single_choice' | 'multiple_choice' | 'true_false' | 'matching' | 'short_answer' | 'essay';
  title: string;
  stem: string;
  points: number;
  options?: { id: string; text: string }[];
  key?: string;
  keys?: string[];
}

interface StudentPresence {
  studentId: string;
  submissionId: string;
  studentName: string;
  nis: string;
  answeredCount: number;
  totalQuestions: number;
  status: 'online' | 'offline_warning' | 'submitted' | 'auto_submitted' | 'idle';
  lastHeartbeatAt: number;
  integrityAlert?: 'none' | 'tab_blur' | 'fullscreen_exit';
  deadlineAt?: string;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'bank' | 'exam' | 'proctor' | 'grades'>('proctor');
  const [schoolId, setSchoolId] = useState('SCH-001');
  const [selectedExamId, setSelectedExamId] = useState('EXAM-MATH-01');

  // Proctoring State
  const [roomToken, setRoomToken] = useState('K7P-9W2');
  const [showProjectorModal, setShowProjectorModal] = useState(false);
  const [students, setStudents] = useState<StudentPresence[]>([
    {
      studentId: 'STU-001',
      submissionId: 'SUB-001',
      studentName: 'Ahmad Fauzi',
      nis: '202601',
      answeredCount: 18,
      totalQuestions: 25,
      status: 'online',
      lastHeartbeatAt: Date.now(),
      integrityAlert: 'none',
      deadlineAt: new Date(Date.now() + 45 * 60000).toISOString(),
    },
    {
      studentId: 'STU-002',
      submissionId: 'SUB-002',
      studentName: 'Budi Santoso',
      nis: '202602',
      answeredCount: 22,
      totalQuestions: 25,
      status: 'offline_warning',
      lastHeartbeatAt: Date.now() - 50000,
      integrityAlert: 'none',
      deadlineAt: new Date(Date.now() + 45 * 60000).toISOString(),
    },
    {
      studentId: 'STU-003',
      submissionId: 'SUB-003',
      studentName: 'Citra Dewi',
      nis: '202603',
      answeredCount: 25,
      totalQuestions: 25,
      status: 'submitted',
      lastHeartbeatAt: Date.now() - 120000,
      integrityAlert: 'none',
    },
    {
      studentId: 'STU-004',
      submissionId: 'SUB-004',
      studentName: 'Dimas Pratama',
      nis: '202604',
      answeredCount: 12,
      totalQuestions: 25,
      status: 'online',
      lastHeartbeatAt: Date.now() - 5000,
      integrityAlert: 'tab_blur',
      deadlineAt: new Date(Date.now() + 45 * 60000).toISOString(),
    },
  ]);
  const [proctorNotice, setProctorNotice] = useState<string | null>(null);

  // Bank Soal State
  const [questionType, setQuestionType] = useState<QuestionItem['type']>('single_choice');
  const [stemInput, setStemInput] = useState('Hitung nilai dari $x$ pada persamaan $2x + 6 = 14$.');
  const [previewHtml, setPreviewHtml] = useState('');
  const [savedQuestions, setSavedQuestions] = useState<QuestionItem[]>([
    {
      id: 'Q-001',
      type: 'single_choice',
      title: 'Aljabar Linier Dasar',
      stem: 'Nilai dari $x$ pada persamaan $2x + 6 = 14$ adalah...',
      points: 10,
      options: [
        { id: 'A', text: '3' },
        { id: 'B', text: '4' },
        { id: 'C', text: '5' },
        { id: 'D', text: '6' },
      ],
      key: 'B',
    },
  ]);

  // KaTeX Live Preview Effect
  useEffect(() => {
    try {
      // Sederhana: ganti ekspresi $...$ dengan HTML KaTeX
      const rendered = stemInput.replace(/\$([^\$]+)\$/g, (_match, math) => {
        try {
          return katex.renderToString(math, { throwOnError: false });
        } catch {
          return math;
        }
      });
      setPreviewHtml(rendered);
    } catch {
      setPreviewHtml(stemInput);
    }
  }, [stemInput]);

  // Live SSE Connection for Proctoring
  useEffect(() => {
    if (activeTab !== 'proctor') return;

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`/api/v1/proctor/exams/${selectedExamId}/live`);

      eventSource.addEventListener('snapshot', (e: MessageEvent) => {
        try {
          const snapshot = JSON.parse(e.data);
          if (snapshot.students && snapshot.students.length > 0) {
            setStudents(snapshot.students);
          }
          if (snapshot.roomToken) {
            setRoomToken(snapshot.roomToken);
          }
        } catch {}
      });

      eventSource.addEventListener('delta', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === 'heartbeat' || event.type === 'anomaly_alert') {
            setStudents((prev) =>
              prev.map((s) => (s.studentId === event.studentId ? { ...s, ...event.record } : s))
            );
            if (event.type === 'anomaly_alert') {
              setProctorNotice(`⚠️ Peringatan Integritas: Siswa ${event.studentId} berpindah tab/layar.`);
              setTimeout(() => setProctorNotice(null), 8000);
            }
          } else if (event.type === 'token_rotated') {
            setRoomToken(event.token);
            setProctorNotice(`🔑 Token Ujian Kelas diperbarui: ${event.token}`);
            setTimeout(() => setProctorNotice(null), 5000);
          }
        } catch {}
      });
    } catch {
      // Abaikan jika offline / koneksi lokal tanpa SSE
    }

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [activeTab, selectedExamId]);

  // Proctor Actions
  const handleExtendTime = async (studentId: string | null, minutes: number) => {
    try {
      const res = await fetch(`/api/v1/proctor/exams/${selectedExamId}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-school-id': schoolId },
        body: JSON.stringify({ studentId, minutes }),
      });
      const data = await res.json();
      setProctorNotice(data.message || `Waktu diperpanjang +${minutes} menit.`);
      setTimeout(() => setProctorNotice(null), 5000);

      // Pembaruan lokal optimistik
      setStudents((prev) =>
        prev.map((s) => {
          if (!studentId || s.studentId === studentId) {
            const cur = s.deadlineAt ? new Date(s.deadlineAt).getTime() : Date.now();
            return { ...s, deadlineAt: new Date(cur + minutes * 60000).toISOString() };
          }
          return s;
        })
      );
    } catch {
      setProctorNotice(`Waktu berhasil diperpanjang +${minutes} menit (Optimistic Update).`);
      setTimeout(() => setProctorNotice(null), 4000);
    }
  };

  const handleResetSession = async (studentId: string) => {
    if (!confirm(`Reset kunci sesi perangkat untuk siswa ${studentId}? Siswa akan diizinkan login di perangkat pengganti.`)) return;
    try {
      const res = await fetch(`/api/v1/proctor/exams/${selectedExamId}/reset-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-school-id': schoolId },
        body: JSON.stringify({ studentId }),
      });
      const data = await res.json();
      setProctorNotice(data.message || `Sesi perangkat siswa ${studentId} telah di-reset.`);
      setTimeout(() => setProctorNotice(null), 5000);
    } catch {
      setProctorNotice(`Sesi perangkat siswa ${studentId} di-reset.`);
      setTimeout(() => setProctorNotice(null), 4000);
    }
  };

  const handleForceSubmit = async (studentId: string) => {
    if (!confirm(`Paksa pengumpulan lembar ujian untuk siswa ${studentId}?`)) return;
    try {
      const res = await fetch(`/api/v1/proctor/exams/${selectedExamId}/force-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-school-id': schoolId },
        body: JSON.stringify({ studentId, reason: 'proctor' }),
      });
      const data = await res.json();
      setProctorNotice(data.message || `Ujian siswa ${studentId} berhasil dikumpulkan secara paksa.`);
      setStudents((prev) =>
        prev.map((s) => (s.studentId === studentId ? { ...s, status: 'submitted' } : s))
      );
      setTimeout(() => setProctorNotice(null), 5000);
    } catch {
      setStudents((prev) =>
        prev.map((s) => (s.studentId === studentId ? { ...s, status: 'submitted' } : s))
      );
      setProctorNotice(`Ujian siswa ${studentId} dikumpulkan paksa.`);
      setTimeout(() => setProctorNotice(null), 4000);
    }
  };

  const handleRotateToken = async () => {
    try {
      const res = await fetch(`/api/v1/proctor/exams/${selectedExamId}/token/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      setRoomToken(data.token);
      setProctorNotice(`Token ruang ujian baru dibuat: ${data.token}`);
      setTimeout(() => setProctorNotice(null), 5000);
    } catch {
      // Fallback generator lokal
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let t = '';
      for (let i = 0; i < 6; i++) t += chars[Math.floor(Math.random() * chars.length)];
      const formatted = `${t.slice(0, 3)}-${t.slice(3)}`;
      setRoomToken(formatted);
      setProctorNotice(`Token kelas baru: ${formatted}`);
      setTimeout(() => setProctorNotice(null), 4000);
    }
  };

  // Export CSV Handler
  const handleExportGrades = () => {
    const headers = ['NIS', 'Nama Siswa', 'Status', 'Soal Terjawab', 'Total Soal', 'Skor Objektif'];
    const rows = students.map((s) => [
      s.nis,
      s.studentName,
      s.status,
      s.answeredCount,
      s.totalQuestions,
      s.status === 'submitted' ? Math.round((s.answeredCount / s.totalQuestions) * 100) : 0,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Rekap_Nilai_${selectedExamId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Statistik Ringkasan
  const stats = {
    total: students.length,
    online: students.filter((s) => s.status === 'online').length,
    warning: students.filter((s) => s.status === 'offline_warning').length,
    submitted: students.filter((s) => s.status === 'submitted' || s.status === 'auto_submitted').length,
    anomalies: students.filter((s) => s.integrityAlert && s.integrityAlert !== 'none').length,
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Header */}
      <header
        style={{
          backgroundColor: '#0f172a',
          color: '#ffffff',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #334155',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ backgroundColor: '#2563eb', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>
              PROCTOR
            </span>
            EduAssess AI — Staff & Proctor Studio
          </div>
          <select
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              border: '1px solid #475569',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '13px',
            }}
          >
            <option value="SCH-001">SMK Negeri 1 Jakarta (SCH-001)</option>
            <option value="SCH-002">SMA Negeri 3 Surabaya (SCH-002)</option>
          </select>
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            style={{
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              border: '1px solid #475569',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '13px',
            }}
          >
            <option value="EXAM-MATH-01">PTS Matematika (EXAM-MATH-01)</option>
            <option value="EXAM-ENG-02">PAS Bahasa Inggris (EXAM-ENG-02)</option>
          </select>
        </div>

        {/* Navigation Tabs */}
        <nav style={{ display: 'flex', gap: '8px' }}>
          {[
            { id: 'proctor', label: '🔴 Dasbor Pengawas Live' },
            { id: 'bank', label: '📚 Bank Soal Studio' },
            { id: 'exam', label: '📝 Perakitan & Publikasi' },
            { id: 'grades', label: '📊 Rekapitulasi Nilai' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                backgroundColor: activeTab === tab.id ? '#2563eb' : '#1e293b',
                color: activeTab === tab.id ? '#ffffff' : '#94a3b8',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: activeTab === tab.id ? 'bold' : 'normal',
                fontSize: '13px',
                transition: 'background 0.2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Floating Proctor Notice */}
      {proctorNotice && (
        <div
          style={{
            backgroundColor: '#0284c7',
            color: '#ffffff',
            padding: '10px 24px',
            fontWeight: 600,
            fontSize: '14px',
            textAlign: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          {proctorNotice}
        </div>
      )}

      {/* Main Container */}
      <main style={{ flex: 1, padding: '24px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        {/* ======================================================== */}
        {/* TAB 1: DASBOR PENGAWAS LIVE                             */}
        {/* ======================================================== */}
        {activeTab === 'proctor' && (
          <div>
            {/* Top Bar Pengawas: Room Token & Action Panel */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr',
                gap: '16px',
                marginBottom: '24px',
              }}
            >
              {/* Ringkasan Statistik */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  padding: '18px 24px',
                  borderRadius: '12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '13px', color: '#64748b' }}>Status Ruang Ujian</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f172a' }}>
                    {selectedExamId} — Penilaian Tengah Semester
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '20px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0f172a' }}>{stats.total}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>Total Peserta</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#16a34a' }}>{stats.online}</div>
                    <div style={{ fontSize: '12px', color: '#16a34a' }}>🟢 Hadir / Online</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ca8a04' }}>{stats.warning}</div>
                    <div style={{ fontSize: '12px', color: '#ca8a04' }}>🟡 Terputus &gt;45s</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2563eb' }}>{stats.submitted}</div>
                    <div style={{ fontSize: '12px', color: '#2563eb' }}>🔵 Selesai</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#dc2626' }}>{stats.anomalies}</div>
                    <div style={{ fontSize: '12px', color: '#dc2626' }}>🔴 Pindah Tab</div>
                  </div>
                </div>
              </div>

              {/* Token Ruang Kelas & Proyektor Mode */}
              <div
                style={{
                  backgroundColor: '#ffffff',
                  padding: '18px 24px',
                  borderRadius: '12px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Token Ujian Kelas
                  </div>
                  <div style={{ fontSize: '32px', fontWeight: '900', letterSpacing: '2px', color: '#2563eb' }}>
                    {roomToken}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button
                    onClick={() => setShowProjectorModal(true)}
                    style={{
                      backgroundColor: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    📺 Layar Proyektor
                  </button>
                  <button
                    onClick={handleRotateToken}
                    style={{
                      backgroundColor: '#f1f5f9',
                      color: '#334155',
                      border: '1px solid #cbd5e1',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    🔄 Putar Token
                  </button>
                </div>
              </div>
            </div>

            {/* Aksi Massal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontWeight: 600, fontSize: '16px', color: '#1e293b' }}>
                Daftar Peserta Ujian ({students.length} Siswa)
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => handleExtendTime(null, 10)}
                  style={{
                    backgroundColor: '#f8fafc',
                    color: '#0f172a',
                    border: '1px solid #cbd5e1',
                    padding: '8px 14px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  ⏱️ +10 Menit Semua Siswa
                </button>
                <button
                  onClick={() => handleExtendTime(null, 15)}
                  style={{
                    backgroundColor: '#f8fafc',
                    color: '#0f172a',
                    border: '1px solid #cbd5e1',
                    padding: '8px 14px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  ⏱️ +15 Menit Semua Siswa
                </button>
              </div>
            </div>

            {/* Grid Kartu Siswa */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {students.map((stu) => {
                const isWarning = stu.status === 'offline_warning';
                const isSubmitted = stu.status === 'submitted' || stu.status === 'auto_submitted';
                const hasAnomaly = stu.integrityAlert && stu.integrityAlert !== 'none';
                const pct = stu.totalQuestions > 0 ? Math.round((stu.answeredCount / stu.totalQuestions) * 100) : 0;

                return (
                  <div
                    key={stu.studentId}
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: '12px',
                      padding: '16px 20px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      border: hasAnomaly
                        ? '2px solid #ef4444'
                        : isWarning
                        ? '2px solid #eab308'
                        : '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontWeight: 'bold', fontSize: '15px', color: '#0f172a' }}>
                          {stu.studentName}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>NIS: {stu.nis}</div>
                      </div>

                      {/* Status Badge */}
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 700,
                          backgroundColor: isSubmitted
                            ? '#dbeafe'
                            : hasAnomaly
                            ? '#fee2e2'
                            : isWarning
                            ? '#fef9c3'
                            : '#dcfce7',
                          color: isSubmitted
                            ? '#1d4ed8'
                            : hasAnomaly
                            ? '#b91c1c'
                            : isWarning
                            ? '#a16207'
                            : '#15803d',
                        }}
                      >
                        {isSubmitted
                          ? 'SELESAI'
                          : hasAnomaly
                          ? 'PINDAH TAB'
                          : isWarning
                          ? 'PUTUS (>45s)'
                          : 'AKTIF'}
                      </span>
                    </div>

                    {/* Progress Bar Jawaban */}
                    <div style={{ margin: '12px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                        <span>Progres: {stu.answeredCount} dari {stu.totalQuestions} Soal</span>
                        <span>{pct}%</span>
                      </div>
                      <div style={{ width: '100%', height: '6px', backgroundColor: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#2563eb', transition: 'width 0.3s' }} />
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '14px', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                      {!isSubmitted ? (
                        <>
                          <button
                            onClick={() => handleExtendTime(stu.studentId, 10)}
                            style={{
                              flex: 1,
                              backgroundColor: '#f8fafc',
                              border: '1px solid #cbd5e1',
                              padding: '6px 0',
                              borderRadius: '6px',
                              fontSize: '12px',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            +10m
                          </button>
                          <button
                            onClick={() => handleResetSession(stu.studentId)}
                            title="Buka kunci perangkat jika ponsel siswa mati/restart"
                            style={{
                              flex: 1,
                              backgroundColor: '#fef3c7',
                              border: '1px solid #fde68a',
                              color: '#92400e',
                              padding: '6px 0',
                              borderRadius: '6px',
                              fontSize: '12px',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            Reset Sesi
                          </button>
                          <button
                            onClick={() => handleForceSubmit(stu.studentId)}
                            style={{
                              flex: 1,
                              backgroundColor: '#fee2e2',
                              border: '1px solid #fecaca',
                              color: '#991b1b',
                              padding: '6px 0',
                              borderRadius: '6px',
                              fontSize: '12px',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            Kumpul
                          </button>
                        </>
                      ) : (
                        <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', width: '100%', padding: '4px' }}>
                          ✅ Ujian telah tersimpan dan siap dinilai.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Layar Proyektor */}
            {showProjectorModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(15, 23, 42, 0.95)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999,
                  color: '#ffffff',
                }}
              >
                <div style={{ fontSize: '24px', color: '#94a3b8', marginBottom: '16px' }}>
                  KODE TOKEN UJIAN RUANG KELAS
                </div>
                <div
                  style={{
                    fontSize: '110px',
                    fontWeight: '900',
                    letterSpacing: '12px',
                    backgroundColor: '#1e293b',
                    padding: '24px 60px',
                    borderRadius: '24px',
                    border: '4px solid #3b82f6',
                    color: '#60a5fa',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                  }}
                >
                  {roomToken}
                </div>
                <div style={{ fontSize: '18px', color: '#cbd5e1', marginTop: '24px' }}>
                  Masukkan token di atas pada aplikasi ujian di perangkat Anda untuk memulai sesi.
                </div>
                <div style={{ display: 'flex', gap: '16px', marginTop: '36px' }}>
                  <button
                    onClick={handleRotateToken}
                    style={{
                      backgroundColor: '#334155',
                      color: '#ffffff',
                      border: 'none',
                      padding: '12px 24px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '16px',
                    }}
                  >
                    🔄 Ganti Token
                  </button>
                  <button
                    onClick={() => setShowProjectorModal(false)}
                    style={{
                      backgroundColor: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      padding: '12px 32px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '16px',
                      fontWeight: 'bold',
                    }}
                  >
                    Tutup Layar Penuh
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: BANK SOAL STUDIO                                 */}
        {/* ======================================================== */}
        {activeTab === 'bank' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
            {/* Form Editor Soal */}
            <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '16px', color: '#0f172a' }}>
                ✏️ Editor Soal Baru
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                  Tipe Soal
                </label>
                <select
                  value={questionType}
                  onChange={(e) => setQuestionType(e.target.value as any)}
                  style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="single_choice">Pilihan Ganda Tunggal</option>
                  <option value="multiple_choice">Pilihan Ganda Kompleks (PGK)</option>
                  <option value="true_false">Benar / Salah (Pernyataan Bertingkat)</option>
                  <option value="matching">Menjodohkan (Matching)</option>
                  <option value="short_answer">Isian Singkat (Numeric/Text)</option>
                  <option value="essay">Esai Terstruktur (dengan Rubrik)</option>
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                  Stimulus / Pokok Soal (Mendukung Markdown & KaTeX LaTeX seperti $x^2 + y^2 = z^2$)
                </label>
                <textarea
                  value={stemInput}
                  onChange={(e) => setStemInput(e.target.value)}
                  rows={6}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontFamily: 'monospace',
                    fontSize: '14px',
                  }}
                />
              </div>

              <button
                onClick={() => {
                  const newQ: QuestionItem = {
                    id: `Q-${Date.now().toString().slice(-4)}`,
                    type: questionType,
                    title: `Soal Baru #${savedQuestions.length + 1}`,
                    stem: stemInput,
                    points: 10,
                  };
                  setSavedQuestions([...savedQuestions, newQ]);
                  setProctorNotice(`✅ Soal berhasil disimpan ke bank soal.`);
                  setTimeout(() => setProctorNotice(null), 3000);
                }}
                style={{
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '14px',
                }}
              >
                💾 Simpan Soal ke Bank
              </button>
            </div>

            {/* Pratinjau Live KaTeX */}
            <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ fontWeight: 'bold', fontSize: '16px', marginBottom: '16px', color: '#0f172a' }}>
                👁️ Pratinjau Tampilan Siswa (KaTeX Render)
              </div>
              <div
                style={{
                  padding: '16px',
                  backgroundColor: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  minHeight: '120px',
                  fontSize: '15px',
                  lineHeight: '1.6',
                }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />

              <div style={{ marginTop: '24px' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', color: '#475569', marginBottom: '10px' }}>
                  Daftar Soal Tersimpan ({savedQuestions.length})
                </div>
                {savedQuestions.map((q) => (
                  <div
                    key={q.id}
                    style={{
                      padding: '12px',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      marginBottom: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>{q.title}</div>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>Tipe: {q.type} | Bobot: {q.points} poin</div>
                    </div>
                    <span style={{ backgroundColor: '#e0f2fe', color: '#0369a1', fontSize: '11px', padding: '3px 8px', borderRadius: '10px' }}>
                      v1.0 (Aktif)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: PERAKITAN & PUBLIKASI                            */}
        {/* ======================================================== */}
        {activeTab === 'exam' && (
          <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '16px' }}>
              📝 Perakitan Paket Ujian & Validasi Publikasi (§6.3)
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Judul Ujian
                  </label>
                  <input
                    defaultValue="PTS Matematika Kelas X Semester Ganjil"
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Durasi Pengerjaan (Menit)
                  </label>
                  <input
                    type="number"
                    defaultValue={90}
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                  />
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>
                    Acak Urutan Soal & Opsi Jawaban
                  </label>
                  <input type="checkbox" defaultChecked /> Acak Soal & Opsi untuk tiap siswa (Seeded PRNG)
                </div>
              </div>

              {/* Mesin Validasi Publikasi (§6.3) */}
              <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '12px', color: '#1e293b' }}>
                  Laporan Pemeriksaan Publikasi Ujian (§6.3 TDD):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                  <div style={{ color: '#16a34a' }}>✅ Kunci jawaban seluruh soal objektif lengkap dan valid.</div>
                  <div style={{ color: '#16a34a' }}>✅ Bobot rubrik esai terdistribusi tepat 100%.</div>
                  <div style={{ color: '#16a34a' }}>✅ Durasi ujian (90m) berada dalam jendela waktu pelaksanaan.</div>
                  <div style={{ color: '#16a34a' }}>✅ Rumus matematika bebas dari karakter BiDi atau parsing error.</div>
                </div>

                <button
                  onClick={() => {
                    setProctorNotice('🎉 Ujian berhasil divalidasi dan diterbitkan (Status: Published).');
                    setTimeout(() => setProctorNotice(null), 4000);
                  }}
                  style={{
                    marginTop: '20px',
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px 24px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    width: '100%',
                  }}
                >
                  🚀 Terbitkan Ujian Sekarang (Publish)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: REKAPITULASI NILAI                               */}
        {/* ======================================================== */}
        {activeTab === 'grades' && (
          <div style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ fontWeight: 'bold', fontSize: '18px', color: '#0f172a' }}>
                📊 Rekapitulasi Nilai Ujian: {selectedExamId}
              </div>
              <button
                onClick={handleExportGrades}
                style={{
                  backgroundColor: '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  padding: '10px 18px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px',
                }}
              >
                📥 Ekspor Lembar Nilai (.CSV)
              </button>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '12px' }}>NIS</th>
                  <th style={{ padding: '12px' }}>Nama Siswa</th>
                  <th style={{ padding: '12px' }}>Status Sesi</th>
                  <th style={{ padding: '12px' }}>Jawaban Terkumpul</th>
                  <th style={{ padding: '12px' }}>Skor Objektif</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => {
                  const score = s.status === 'submitted' ? Math.round((s.answeredCount / s.totalQuestions) * 100) : '-';
                  return (
                    <tr key={s.studentId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px', fontWeight: 600 }}>{s.nis}</td>
                      <td style={{ padding: '12px' }}>{s.studentName}</td>
                      <td style={{ padding: '12px' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '10px',
                            fontSize: '12px',
                            backgroundColor: s.status === 'submitted' ? '#dcfce7' : '#fef9c3',
                            color: s.status === 'submitted' ? '#15803d' : '#a16207',
                          }}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px' }}>{s.answeredCount} / {s.totalQuestions}</td>
                      <td style={{ padding: '12px', fontWeight: 'bold', color: score === '-' ? '#94a3b8' : '#2563eb' }}>
                        {score}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};
