import Dexie, { type Table } from 'dexie';
import type { AnswerInputData, StartExamResponse } from '@eduassess/schemas';

export interface LocalSession {
  id: string; // submissionId
  examToken: string;
  deadlineAt: string;
  remainingMs: number;
  serverTimeOffsetMs: number;
  status: 'in_progress' | 'submitted' | 'locked';
  locked?: number;
}

export interface LocalAnswer {
  submissionId: string;
  questionId: string;
  clientSeq: number;
  inputData: AnswerInputData;
  dirty: number; // 1 = dirty/pending sync, 0 = synced
  updatedAt: string;
}

export interface OutboxItem {
  id?: number;
  submissionId: string;
  kind: 'submit' | 'event' | 'upload';
  payload: any;
  createdAt: string;
}

export interface LocalBlob {
  id: string; // canvasStorageKey or local UUID
  submissionId: string;
  blob: Blob;
  createdAt: string;
}

export class EduAssessDexieDb extends Dexie {
  session!: Table<LocalSession, string>;
  package!: Table<StartExamResponse, string>;
  answers!: Table<LocalAnswer, [string, string]>;
  outbox!: Table<OutboxItem, number>;
  blobs!: Table<LocalBlob, string>;

  constructor() {
    super('eduassess_student_v1');
    this.version(1).stores({
      session: 'id',
      package: 'submissionId',
      answers: '[submissionId+questionId], submissionId, dirty',
      outbox: '++id, submissionId, kind, createdAt',
      blobs: 'id, submissionId',
    });
  }
}

export const localDb = new EduAssessDexieDb();

