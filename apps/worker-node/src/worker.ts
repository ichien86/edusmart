import { MongoClient } from 'mongodb';
import Redis from 'ioredis';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/eduassess?replicaSet=rs0';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function main() {
  console.log('🚀 EduAssess Worker Node starting...');

  const mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  const db = mongoClient.db(process.env.MONGO_DB || 'eduassess');
  console.log(' Connected to MongoDB Replica Set');

  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  console.log(' Connected to Redis');

  // Sweeper interval: checks for overdue submissions every SWEEPER_INTERVAL_S seconds (§6.4.5)
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
        .project({ _id: 1, deadlineAt: 1 })
        .toArray();

      if (due.length > 0) {
        console.log(`⏱️ Sweeper found ${due.length} overdue submissions to auto-submit.`);
        const dueIds = due.map((d) => d._id);

        await db.collection('submissions').updateMany(
          { _id: { $in: dueIds }, status: 'in_progress' },
          [{ $set: { status: 'auto_submitted', finishReason: 'deadline', submittedAt: '$deadlineAt' } }]
        );
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

