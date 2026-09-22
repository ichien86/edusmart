import { MongoClient } from 'mongodb';
import crypto from 'node:crypto';

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt$16384$8$1$${salt.toString('hex')}$${derivedKey.toString('hex')}`);
    });
  });
}

const MONGO_URI =
  process.env.MONGO_URI ||
  (process.env.NODE_ENV === 'production'
    ? 'mongodb://mongo:27017/eduassess?replicaSet=rs0'
    : 'mongodb://localhost:27018/eduassess?directConnection=true');

const MONGO_DB = process.env.MONGO_DB || 'eduassess';

async function seed() {
  console.log(`🌱 Menjalankan Database Seeder EduAssess AI di ${MONGO_URI}...`);
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(MONGO_DB);

  // 1. Schools Collection
  console.log('🏫 Membuat data sekolah (multi-tenant)...');
  await db.collection('schools').deleteMany({});
  await db.collection('schools').insertMany([
    {
      _id: 'SCH-001',
      name: 'SMK Negeri 1 Jakarta',
      code: 'SMKN1JKT',
      address: 'Jl. Budi Utomo No. 7, Sawah Besar, Jakarta Pusat',
      status: 'active',
      createdAt: new Date(),
    },
    {
      _id: 'SCH-002',
      name: 'SMA Negeri 3 Surabaya',
      code: 'SMAN3SBY',
      address: 'Jl. Praban No. 3, Genteng, Surabaya',
      status: 'active',
      createdAt: new Date(),
    },
  ]);

  // 2. Users Collection (Staf, Guru, Pengawas, & Siswa)
  console.log('👤 Membuat akun pengguna dan meng-generate scrypt password hash...');
  await db.collection('users').deleteMany({});

  const defaultAdminPassHash = await hashPassword('admin1234');
  const defaultGuruPassHash = await hashPassword('guru1234');
  const defaultPengawasPassHash = await hashPassword('pengawas1234');
  const studentPassHash = await hashPassword('siswa1234');
  const studentInitialPassHash = await hashPassword('default1234'); // Untuk tes alur wajib ganti sandi

  const usersList = [
    // Staf & Guru (Portal Web Staff: http://localhost/staff/)
    {
      _id: 'USR-ADMIN-01',
      schoolId: 'SCH-001',
      username: 'admin',
      name: 'Administrator EduSmart',
      email: 'admin@smkn1jakarta.sch.id',
      roles: ['admin', 'teacher', 'proctor'],
      passwordHash: defaultAdminPassHash,
      isPasswordChanged: true,
      createdAt: new Date(),
    },
    {
      _id: 'USR-GURU-01',
      schoolId: 'SCH-001',
      username: 'guru1',
      name: 'Drs. Hendro Wibowo, M.Pd',
      email: 'hendro.w@smkn1jakarta.sch.id',
      roles: ['teacher'],
      passwordHash: defaultGuruPassHash,
      isPasswordChanged: true,
      createdAt: new Date(),
    },
    {
      _id: 'USR-PROCTOR-01',
      schoolId: 'SCH-001',
      username: 'pengawas1',
      name: 'Siti Rahmawati, S.Kom',
      email: 'siti.r@smkn1jakarta.sch.id',
      roles: ['proctor', 'teacher'],
      passwordHash: defaultPengawasPassHash,
      isPasswordChanged: true,
      createdAt: new Date(),
    },

    // Siswa (Aplikasi PWA Siswa: http://localhost/)
    {
      _id: 'STU-001',
      schoolId: 'SCH-001',
      username: 'siswa1',
      name: 'Ahmad Fauzi',
      nis: '202601',
      roles: ['student'],
      passwordHash: studentPassHash,
      isPasswordChanged: true,
      createdAt: new Date(),
    },
    {
      _id: 'STU-002',
      schoolId: 'SCH-001',
      username: 'siswa2',
      name: 'Budi Santoso',
      nis: '202602',
      roles: ['student'],
      passwordHash: studentPassHash,
      isPasswordChanged: true,
      createdAt: new Date(),
    },
    {
      _id: 'STU-003',
      schoolId: 'SCH-001',
      username: 'siswa3',
      name: 'Citra Dewi',
      nis: '202603',
      roles: ['student'],
      passwordHash: studentPassHash,
      isPasswordChanged: true,
      createdAt: new Date(),
    },
    {
      _id: 'STU-004',
      schoolId: 'SCH-001',
      username: 'siswa4',
      name: 'Dimas Pratama',
      nis: '202604',
      roles: ['student'],
      passwordHash: studentPassHash,
      isPasswordChanged: true,
      createdAt: new Date(),
    },
    {
      _id: 'STU-005',
      schoolId: 'SCH-001',
      username: 'siswa5_baru',
      name: 'Eka Rahmawati (Akun Baru)',
      nis: '202605',
      roles: ['student'],
      passwordHash: studentInitialPassHash,
      isPasswordChanged: false, // Mengetes alur login pertama kali -> wajib ubah kata sandi
      createdAt: new Date(),
    },
  ];

  await db.collection('users').insertMany(usersList);

  // 3. Question Bank Collection (6 Tipe Soal Lengkap Sesuai DDT)
  console.log('📚 Membuat bank soal 6 tipe (PG, PGK, Benar-Salah, Menjodohkan, Isian, Esai)...');
  await db.collection('questions').deleteMany({});

  const questionsList = [
    // 1. Single Choice (Pilihan Ganda Biasa)
    {
      _id: 'Q-MAT-001',
      schoolId: 'SCH-001',
      questionKey: 'MAT-X-001',
      version: 1,
      status: 'active',
      type: 'single_choice',
      subject: 'Matematika',
      topic: 'Persamaan Linier',
      difficulty: 'easy',
      content: {
        text: 'Nilai dari $x$ pada persamaan linier satu variabel $2x + 6 = 14$ adalah...',
        format: 'markdown_latex',
        dir: 'ltr',
        lang: 'id',
      },
      payload: {
        options: [
          { id: 'opt_a', content: { text: '3', format: 'plain', dir: 'ltr', lang: 'id' } },
          { id: 'opt_b', content: { text: '4', format: 'plain', dir: 'ltr', lang: 'id' } },
          { id: 'opt_c', content: { text: '5', format: 'plain', dir: 'ltr', lang: 'id' } },
          { id: 'opt_d', content: { text: '6', format: 'plain', dir: 'ltr', lang: 'id' } },
        ],
        key: 'opt_b',
        shuffleOptions: true,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },

    // 2. Multiple Choice (Pilihan Ganda Kompleks / Multi-Select)
    {
      _id: 'Q-MAT-002',
      schoolId: 'SCH-001',
      questionKey: 'MAT-X-002',
      version: 1,
      status: 'active',
      type: 'multiple_choice',
      subject: 'Matematika',
      topic: 'Bilangan Prima',
      difficulty: 'medium',
      content: {
        text: 'Pilihlah semua bilangan di bawah ini yang merupakan bilangan prima ganjil!',
        format: 'markdown_latex',
        dir: 'ltr',
        lang: 'id',
      },
      payload: {
        options: [
          { id: 'opt_1', content: { text: '2', format: 'plain', dir: 'ltr', lang: 'id' } },
          { id: 'opt_2', content: { text: '3', format: 'plain', dir: 'ltr', lang: 'id' } },
          { id: 'opt_3', content: { text: '7', format: 'plain', dir: 'ltr', lang: 'id' } },
          { id: 'opt_4', content: { text: '9', format: 'plain', dir: 'ltr', lang: 'id' } },
          { id: 'opt_5', content: { text: '11', format: 'plain', dir: 'ltr', lang: 'id' } },
        ],
        keys: ['opt_2', 'opt_3', 'opt_5'],
        scoringMode: 'partial',
        shuffleOptions: true,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },

    // 3. True / False (Benar - Salah Majemuk)
    {
      _id: 'Q-MAT-003',
      schoolId: 'SCH-001',
      questionKey: 'MAT-X-003',
      version: 1,
      status: 'active',
      type: 'true_false',
      subject: 'Matematika',
      topic: 'Geometri',
      difficulty: 'medium',
      content: {
        text: 'Tentukan kebenaran dari setiap pernyataan geometri berikut!',
        format: 'markdown_latex',
        dir: 'ltr',
        lang: 'id',
      },
      payload: {
        statements: [
          {
            id: 'stmt_1',
            content: { text: 'Jumlah sudut dalam segitiga selalu 180 derajat.', format: 'plain', dir: 'ltr', lang: 'id' },
            key: true,
          },
          {
            id: 'stmt_2',
            content: { text: 'Segitiga siku-siku selalu memiliki dua sudut siku-siku.', format: 'plain', dir: 'ltr', lang: 'id' },
            key: false,
          },
          {
            id: 'stmt_3',
            content: { text: 'Semua persegi adalah persegi panjang.', format: 'plain', dir: 'ltr', lang: 'id' },
            key: true,
          },
        ],
        scoringMode: 'partial',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },

    // 4. Matching (Menjodohkan)
    {
      _id: 'Q-MAT-004',
      schoolId: 'SCH-001',
      questionKey: 'MAT-X-004',
      version: 1,
      status: 'active',
      type: 'matching',
      subject: 'Matematika',
      topic: 'Bangun Datar',
      difficulty: 'medium',
      content: {
        text: 'Jodohkan bangun datar berikut dengan rumus keliling yang tepat!',
        format: 'markdown_latex',
        dir: 'ltr',
        lang: 'id',
      },
      payload: {
        premises: [
          { id: 'prem_1', content: { text: 'Persegi (sisi $s$)', format: 'markdown_latex', dir: 'ltr', lang: 'id' } },
          { id: 'prem_2', content: { text: 'Persegi Panjang (panjang $p$, lebar $l$)', format: 'markdown_latex', dir: 'ltr', lang: 'id' } },
          { id: 'prem_3', content: { text: 'Lingkaran (jari-jari $r$)', format: 'markdown_latex', dir: 'ltr', lang: 'id' } },
        ],
        responses: [
          { id: 'resp_a', content: { text: '$4s$', format: 'markdown_latex', dir: 'ltr', lang: 'id' } },
          { id: 'resp_b', content: { text: '$2(p + l)$', format: 'markdown_latex', dir: 'ltr', lang: 'id' } },
          { id: 'resp_c', content: { text: '$2\\pi r$', format: 'markdown_latex', dir: 'ltr', lang: 'id' } },
        ],
        pairs: [
          { premiseId: 'prem_1', responseId: 'resp_a' },
          { premiseId: 'prem_2', responseId: 'resp_b' },
          { premiseId: 'prem_3', responseId: 'resp_c' },
        ],
        scoringMode: 'partial',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },

    // 5. Short Answer (Isian Singkat Ber-toleransi)
    {
      _id: 'Q-MAT-005',
      schoolId: 'SCH-001',
      questionKey: 'MAT-X-005',
      version: 1,
      status: 'active',
      type: 'short_answer',
      subject: 'Fisika / Matematika',
      topic: 'Konstanta Fisika',
      difficulty: 'easy',
      content: {
        text: 'Berapakah percepatan gravitasi bumi rata-rata di permukaan dalam $m/s^2$? (Tuliskan dalam angka desimal)',
        format: 'markdown_latex',
        dir: 'ltr',
        lang: 'id',
      },
      payload: {
        answerKind: 'numeric',
        acceptedAnswers: ['9.8', '9,8', '10'],
        tolerance: 0.1,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },

    // 6. Essay dengan Rubrik Lengkap (AI-Assisted Evaluation)
    {
      _id: 'Q-MAT-006',
      schoolId: 'SCH-001',
      questionKey: 'FIS-X-006',
      version: 1,
      status: 'active',
      type: 'essay',
      subject: 'Fisika Rekayasa',
      topic: 'Dinamika Newton',
      difficulty: 'hard',
      content: {
        text: 'Jelaskan bagaimana prinsip Hukum III Newton diterapkan pada sistem propulsi roket modern dan analisis faktor gaya dorongnya!',
        format: 'markdown_latex',
        dir: 'ltr',
        lang: 'id',
      },
      payload: {
        rubric: [
          { id: 'crit_concept', aspect: 'Penjelasan Konsep Gaya Aksi-Reaksi', weight: 40 },
          { id: 'crit_application', aspect: 'Penerapan pada Nosel Propulsi Roket', weight: 35 },
          { id: 'crit_factors', aspect: 'Analisis Faktor Laju Alir Massa dan Gaya Dorong', weight: 25 },
        ],
        idealAnswer: {
          text: 'Pada sistem propulsi roket, Hukum III Newton berlaku ketika gas hasil pembakaran disemburkan keluar melalui nosel dengan kecepatan tinggi ke arah bawah sebagai gaya aksi. Sebagai reaksinya, roket akan terdorong ke atas dengan besar gaya yang sama namun berlawanan arah. Gaya dorong dipengaruhi oleh laju alir massa gas pembakaran dan kecepatan buang relatif gas tersebut.',
          format: 'plain',
          dir: 'ltr',
          lang: 'id',
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  await db.collection('questions').insertMany(questionsList);

  // 4. Exams Collection (Ujian Terbit Siap Diikuti)
  console.log('📝 Membuat paket ujian terbit (EXAM-MATH-01)...');
  await db.collection('exams').deleteMany({});

  const sampleExam = {
    _id: 'EXAM-MATH-01',
    schoolId: 'SCH-001',
    ownerId: 'USR-GURU-01',
    title: 'PTS Matematika Terpadu & Sains Kelas X',
    description: 'Penilaian Tengah Semester Ganjil TA 2026/2027. Kerjakan secara mandiri dan jujur.',
    status: 'published',
    scheduling: {
      mode: 'self_paced',
      durationMinutes: 90,
      windowStart: new Date(Date.now() - 3600000), // 1 jam lalu
      windowEnd: new Date(Date.now() + 86400000), // 24 jam ke depan
      gracePeriodSeconds: 120,
    },
    questionRefs: [
      { questionId: 'Q-MAT-001', order: 1, points: 15, status: 'active', allCredit: false },
      { questionId: 'Q-MAT-002', order: 2, points: 15, status: 'active', allCredit: false },
      { questionId: 'Q-MAT-003', order: 3, points: 15, status: 'active', allCredit: false },
      { questionId: 'Q-MAT-004', order: 4, points: 15, status: 'active', allCredit: false },
      { questionId: 'Q-MAT-005', order: 5, points: 15, status: 'active', allCredit: false },
      { questionId: 'Q-MAT-006', order: 6, points: 25, status: 'active', allCredit: false },
    ],
    settings: {
      aiGrading: {
        enabled: true,
        shadowMode: false,
        doubleEval: false,
        budgetTokens: 200000,
      },
      resultReleaseMode: 'after_teacher_review',
      allowRubricView: false,
      appealPolicy: {
        enabled: true,
        windowHours: 48,
        maxItems: 3,
        teacherSlaDays: 3,
      },
    },
    assignedClassIds: ['X-RPL-1', 'X-TKJ-1'],
    assignedStudentIds: ['STU-001', 'STU-002', 'STU-003', 'STU-004', 'STU-005'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.collection('exams').insertOne(sampleExam);

  console.log('✅ Berhasil menginisialisasi database EduAssess AI!');
  console.log('========================================================================');
  console.log('🔑 KREDENSIAL LOGIN LENGKAP:');
  console.log('------------------------------------------------------------------------');
  console.log('🏫 KODE SEKOLAH: SCH-001 (SMK Negeri 1 Jakarta)');
  console.log('');
  console.log('👨‍🏫 PORTAL WEB GURU / PENGAWAS (http://localhost/staff/):');
  console.log('   1. Admin     : Username: admin     | Sandi: admin1234');
  console.log('   2. Guru      : Username: guru1     | Sandi: guru1234');
  console.log('   3. Pengawas  : Username: pengawas1 | Sandi: pengawas1234');
  console.log('');
  console.log('📱 PWA SISWA (http://localhost/):');
  console.log('   1. Siswa 1   : Username: siswa1       | Sandi: siswa1234 (Ahmad Fauzi)');
  console.log('   2. Siswa 2   : Username: siswa2       | Sandi: siswa1234 (Budi Santoso)');
  console.log('   3. Siswa 3   : Username: siswa3       | Sandi: siswa1234 (Citra Dewi)');
  console.log('   4. Siswa 4   : Username: siswa4       | Sandi: siswa1234 (Dimas Pratama)');
  console.log('   5. Akun Baru : Username: siswa5_baru  | Sandi: default1234 (Eka Rahmawati)');
  console.log('      *(Catatan: Akun siswa5_baru akan otomatis diminta ganti sandi awal)*');
  console.log('');
  console.log('📝 UJIAN TERSEDIA:');
  console.log('   ID: EXAM-MATH-01 ("PTS Matematika Terpadu & Sains Kelas X")');
  console.log('========================================================================');

  await client.close();
}

seed().catch((err) => {
  console.error('❌ Gagal menjalankan seeder:', err);
  process.exit(1);
});
