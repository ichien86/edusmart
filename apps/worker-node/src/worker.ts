import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import { Worker, type Job } from 'bullmq';
import { EssayEvaluatorService } from './eval/essay-evaluator.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/eduassess?replicaSet=rs0';
const MONGO_DB = process.env.MONGO_DB || 'eduassess';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export interface EssayEvalJobData {
  schoolId: string;
  submissionId: string;
  answerId: string;
  questionId: string;
}

async function main() {
  console.log('🚀 EduAssess Worker Node starting...');

  const mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  const db = mongoClient.db(MONGO_DB);
  console.log('✅ Connected to MongoDB Replica Set');

  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  console.log('✅ Connected to Redis');

  const essayEvaluator = new EssayEvaluatorService();

  // 1. Initialize BullMQ Worker for AI Essay Evaluation (§6.4.5 & §7 TDD)
  const essayWorker = new Worker<EssayEvalJobData>(
    'essay-evaluation',
    async (job: Job<EssayEvalJobData>) => {
      const { schoolId, submissionId, answerId, questionId } = job.data;
      console.log(`[Job ${job.id}] Evaluating essay for answer ${answerId} (sub: ${submissionId})...`);

      try {
        // Fetch answer document
        const answer = await db.collection('answers').findOne({
          _id: answerId,
          schoolId,
        } as any);

        if (!answer) {
          console.warn(`[Job ${job.id}] Answer ${answerId} not found in school ${schoolId}. Skipping.`);
          return { skipped: true, reason: 'Answer not found' };
        }

        // Fetch question to get rubric and content
        const question = await db.collection('questions').findOne({
          _id: questionId,
          schoolId,
        } as any);

        if (!question) {
          console.warn(`[Job ${job.id}] Question ${questionId} not found. Skipping.`);
          return { skipped: true, reason: 'Question not found' };
        }

        const studentAnswerText = answer.inputData?.text || '';
        const rubric = question.payload?.rubric || [
          { id: 'crit_content', aspect: 'Kesesuaian Isi dan Pemahaman', weight: 50 },
          { id: 'crit_analysis', aspect: 'Kedalaman Analisis dan Argumen', weight: 50 },
        ];
        const idealAnswerText = question.payload?.idealAnswer?.text || question.payload?.idealAnswer?.markdown;

        // Perform AI evaluation with nonce isolation and evidence substring verification
        const suggestion = await essayEvaluator.evaluate({
          questionPrompt: question.content?.text || question.content?.markdown || 'Soal Esai',
          studentAnswer: studentAnswerText,
          rubric,
          idealAnswer: idealAnswerText,
        });

        // Update answer with AI suggestion
        await db.collection('answers').updateOne(
          { _id: answerId, schoolId } as any,
          {
            $set: {
              'evaluation.method': 'ai_assisted',
              'evaluation.state': 'ai_suggested',
              'evaluation.aiSuggestion': suggestion,
              updatedAt: new Date(),
            },
          }
        );

        // Notify teachers via Redis PubSub
        const examId = answer.examId;
        if (examId) {
          const eventPayload = JSON.stringify({
            type: 'essay_evaluated',
            submissionId,
            answerId,
            studentId: answer.studentId,
            score: suggestion.score,
            reviewPriority: suggestion.reviewPriority,
            timestamp: new Date().toISOString(),
          });
          await redis.publish(`exam:${examId}:events`, eventPayload);
          await redis.publish('grading:events', eventPayload);
        }

        console.log(
          `[Job ${job.id}] Completed essay evaluation for answer ${answerId}: score=${suggestion.score}, priority=${suggestion.reviewPriority}`
        );

        return {
          success: true,
          score: suggestion.score,
          priority: suggestion.reviewPriority,
        };
      } catch (err: any) {
        console.error(`[Job ${job.id}] Error evaluating essay:`, err);
        // Mark answer as pending manual review if AI evaluation fails
        await db.collection('answers').updateOne(
          { _id: answerId, schoolId } as any,
          {
            $set: {
              'evaluation.state': 'pending_manual',
              'evaluation.aiSuggestion.flags': ['ai_evaluation_failed'],
              updatedAt: new Date(),
            },
          }
        );
        throw err;
      }
    },
    {
      connection: redis as any,
      concurrency: Number(process.env.LLM_CONCURRENCY || 5),
    }
  );

  essayWorker.on('completed', (job: Job) => {
    console.log(`✅ BullMQ Job ${job.id} completed successfully`);
  });

  essayWorker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`❌ BullMQ Job ${job?.id} failed:`, err.message);
  });

  console.log('✅ BullMQ essay-evaluation worker listening');

  // 2. Sweeper interval: checks for overdue submissions every SWEEPER_INTERVAL_S seconds (§6.4.5)
  const sweeperIntervalSeconds = Number(process.env.SWEEPER_INTERVAL_S || 30);
  const graceSeconds = Number(process.env.GRACE_SECONDS_DEFAULT || 120);

  setInterval(async () => {
    try {
      const graceMs = graceSeconds * 1000;
      const overdueThreshold = new Date(Date.now() - graceMs);

      const due = await db
        .collection('submissions')
        .find({
          status: 'in_progress',
          deadlineAt: { $lt: overdueThreshold },
        })
        .limit(500)
        .project({ _id: 1, schoolId: 1, examId: 1, deadlineAt: 1 })
        .toArray();

      if (due.length > 0) {
        console.log(`⏱️ Sweeper found ${due.length} overdue submissions to auto-submit.`);
        const dueIds = due.map((d) => d._id);

        await db.collection('submissions').updateMany(
          { _id: { $in: dueIds }, status: 'in_progress' },
          [{ $set: { status: 'auto_submitted', finishReason: 'deadline', submittedAt: '$deadlineAt' } }]
        );

        // For each auto-submitted submission, find essay answers and enqueue jobs
        for (const sub of due) {
          const essayAnswers = await db
            .collection('answers')
            .find({
              submissionId: sub._id,
              'evaluation.state': 'pending',
            })
            .toArray();

          for (const ans of essayAnswers) {
            // Check question type
            const q = await db.collection('questions').findOne({ _id: ans.questionId });
            if (q && q.type === 'essay') {
              const queueRedis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
              const { Queue } = await import('bullmq');
              const qInst = new Queue('essay-evaluation', { connection: queueRedis as any });
              await qInst.add(
                'eval',
                {
                  schoolId: sub.schoolId,
                  submissionId: sub._id,
                  answerId: ans._id,
                  questionId: ans.questionId,
                },
                { removeOnComplete: true }
              );
              await qInst.close();
              await queueRedis.quit();
            }
          }
        }
      }
    } catch (err) {
      console.error('Sweeper error:', err);
    }
  }, sweeperIntervalSeconds * 1000);

  console.log(`✅ Sweeper active (running every ${sweeperIntervalSeconds}s, grace: ${graceSeconds}s)`);
}

main().catch((err) => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
