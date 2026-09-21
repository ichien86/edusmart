import { z } from 'zod';
import { ObjectIdString, StimulusSchema } from './common.js';
import { StudentQuestionSchema } from './question.js';
import { AnswerInputDataSchema, SubmissionStatusEnum } from './submission.js';

// Sync Request & Response DTOs
export const SyncItemSchema = z.object({
  questionId: ObjectIdString,
  clientSeq: z.number().int().min(1),
  clientSavedAt: z.string(),
  inputData: AnswerInputDataSchema,
});
export type SyncItem = z.infer<typeof SyncItemSchema>;

export const SyncEventSchema = z.object({
  type: z.enum(['tab_hidden', 'window_blur', 'offline', 'reconnect', 'fullscreen_exit']),
  at: z.string(),
  durationMs: z.number().optional(),
});
export type SyncEvent = z.infer<typeof SyncEventSchema>;

export const SyncRequestSchema = z.object({
  items: z.array(SyncItemSchema).max(50).default([]),
  events: z.array(SyncEventSchema).default([]),
  ping: z.boolean().default(false),
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;

export const SyncResponseSchema = z.object({
  accepted: z.array(ObjectIdString),
  stale: z.array(ObjectIdString),
  rejected: z.array(ObjectIdString),
  late: z.boolean(),
  serverNow: z.string(),
  remainingMs: z.number(),
  status: SubmissionStatusEnum,
  integrity: z.object({
    count: z.number(),
    warn: z.boolean(),
  }),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

// Start Exam DTOs
export const StartExamResponseSchema = z.object({
  submissionId: ObjectIdString,
  examToken: z.string(),
  exam: z.object({
    title: z.string(),
    deadlineAt: z.string(),
    serverNow: z.string(),
  }),
  groups: z.array(z.object({
    groupId: z.string(),
    stimulus: StimulusSchema.nullable().optional(),
    questions: z.array(StudentQuestionSchema),
  })),
  assets: z.array(z.object({
    key: z.string(),
    url: z.string(),
    bytes: z.number(),
    sha256: z.string(),
  })).default([]),
  remainingMs: z.number(),
});
export type StartExamResponse = z.infer<typeof StartExamResponseSchema>;

