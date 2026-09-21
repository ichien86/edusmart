import { localDb } from './db.js';
import type { SyncRequest, SyncResponse, SyncEvent } from '@eduassess/schemas';

let inflight: Promise<void> | null = null;
const eventQueue: SyncEvent[] = [];

export function recordClientEvent(event: SyncEvent) {
  eventQueue.push(event);
}

function takeEvents(): SyncEvent[] {
  return eventQueue.splice(0, eventQueue.length);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (n: number) => Math.min(30_000, 1000 * 2 ** n) * (0.5 + Math.random());

export async function flushSync(
  submissionId: string,
  apiSyncFn: (sid: string, req: SyncRequest) => Promise<SyncResponse>
): Promise<void> {
  if (inflight) {
    return inflight;
  }
  inflight = doFlush(submissionId, apiSyncFn).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doFlush(
  submissionId: string,
  apiSyncFn: (sid: string, req: SyncRequest) => Promise<SyncResponse>
) {
  let attempt = 0;

  while (true) {
    // 1. Fetch dirty answers in batches of 20
    const batch = await localDb.answers
      .where('dirty')
      .equals(1)
      .filter((a) => a.submissionId === submissionId)
      .limit(20)
      .toArray();

    const events = takeEvents();

    if (batch.length === 0 && events.length === 0) {
      return;
    }

    const payload: SyncRequest = {
      items: batch.map((item) => ({
        questionId: item.questionId,
        clientSeq: item.clientSeq,
        clientSavedAt: item.updatedAt,
        inputData: item.inputData,
      })),
      events,
      ping: true,
    };

    try {
      await apiSyncFn(submissionId, payload);

      // 2. Mark answers clean ONLY if clientSeq didn't change during in-flight network call
      await localDb.transaction('rw', localDb.answers, async () => {
        for (const sent of batch) {
          const cur = await localDb.answers.get([submissionId, sent.questionId]);
          if (cur && cur.clientSeq === sent.clientSeq) {
            await localDb.answers.update([submissionId, sent.questionId], { dirty: 0 });
          }
        }
      });

      // Reset retry attempt on success
      attempt = 0;
    } catch (err: any) {
      if (err?.status === 429) {
        const retryAfterMs = err.retryAfterMs || backoff(attempt++);
        await sleep(retryAfterMs);
      } else if (!navigator.onLine || err?.status >= 500) {
        await sleep(backoff(attempt++));
        if (attempt > 6) {
          // Keep dirty in IndexedDB; will be flushed on next trigger/reconnect
          return;
        }
      } else {
        throw err;
      }
    }
  }
}

