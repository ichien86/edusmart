import { z } from 'zod';
import { ObjectIdString } from './common.js';

export const SubmissionStatusEnum = z.enum([
  'in_progress',
  'submitted',
  'auto_submitted',
  'grading',
  'pending_ai',
  'reviewed',
  'released',
  'final_locked',
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusEnum>;

export const FinishReasonEnum = z.enum(['user', 'deadline', 'proctor', 'integrity']);
export type FinishReason = z.infer<typeof FinishReasonEnum>;

export const SubmissionScoresSchema = z.object({
  objective: z.number().optional(),
  essay: z.number().optional(),
  total: z.number().optional(),
  maxPoints: z.number().optional(),
});
export type SubmissionScores = z.infer<typeof SubmissionScoresSchema>;

export const SubmissionSchema = z.object({
  _id: ObjectIdString,
  schoolId: ObjectIdString,
  examId: ObjectIdString,
  studentId: ObjectIdString,
  attemptNo: z.number().int().min(1).default(1),
  status: SubmissionStatusEnum.default('in_progress'),
  startedAt: z.date().or(z.string()),
  deadlineAt: z.date().or(z.string()),
  submittedAt: z.date().or(z.string()).optional(),
  finishReason: FinishReasonEnum.optional(),
  activeDeviceId: z.string().optional(),
  shuffleSeed: z.number().int(),
  scores: SubmissionScoresSchema.default({}),
  release: z.object({
    objectiveAt: z.date().or(z.string()).optional(),
    fullAt: z.date().or(z.string()).optional(),
  }).default({}),
  flags: z.object({
    lateSync: z.boolean().default(false),
    integrityWarn: z.boolean().default(false),
  }).default({}),
  isFinalLocked: z.boolean().default(false),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});
export type Submission = z.infer<typeof SubmissionSchema>;

// Answer Input Data Schema (Polymorphic per question type)
export const AnswerInputDataSchema = z.object({
  selected: z.string().optional(),
  selectedOptions: z.array(z.string()).optional(),
  statements: z.record(z.boolean().nullable()).optional(),
  pairs: z.record(z.string()).optional(),
  text: z.string().max(20000).optional(),
  formulaLatex: z.string().max(2000).optional(),
  canvasStorageKey: z.string().optional(),
});
export type AnswerInputData = z.infer<typeof AnswerInputDataSchema>;

export const AnswerEvaluationSchema = z.object({
  method: z.enum(['auto', 'ai_assisted', 'manual']).nullable().default(null),
  state: z.enum([
    'pending',
    'auto_done',
    'pending_ai',
    'pending_manual',
    'ai_suggested',
    'reviewed',
  ]).default('pending'),
  score: z.number().optional(),
  finalScore: z.number().optional(),
  isReviewedByTeacher: z.boolean().default(false),
  aiSuggestion: z.object({
    score: z.number().optional(),
    confidence: z.number().optional(),
    reviewPriority: z.enum(['high', 'medium', 'low']).optional(),
    evidenceValidRatio: z.number().optional(),
    inSample: z.boolean().optional(),
    reasoning: z.string().optional(),
    criteriaResults: z.array(z.any()).optional(),
    flags: z.array(z.string()).optional(),
  }).optional(),
});
export type AnswerEvaluation = z.infer<typeof AnswerEvaluationSchema>;

export const AnswerAppealSchema = z.object({
  status: z.enum(['none', 'submitted', 'under_review', 'accepted', 'rejected']).default('none'),
  reason: z.string().optional(),
  submittedAt: z.date().or(z.string()).optional(),
  decidedAt: z.date().or(z.string()).optional(),
  decisionNote: z.string().optional(),
});
export type AnswerAppeal = z.infer<typeof AnswerAppealSchema>;

export const AnswerSchema = z.object({
  _id: ObjectIdString,
  schoolId: ObjectIdString,
  submissionId: ObjectIdString,
  examId: ObjectIdString,
  studentId: ObjectIdString,
  questionId: ObjectIdString,
  clientSeq: z.number().int().min(1),
  clientSavedAt: z.date().or(z.string()),
  savedAt: z.date().or(z.string()),
  inputData: AnswerInputDataSchema,
  evaluation: AnswerEvaluationSchema.default({}),
  appeal: AnswerAppealSchema.default({}),
  late: z.object({
    clientSeq: z.number().int(),
    inputData: AnswerInputDataSchema,
    receivedAt: z.date().or(z.string()),
  }).optional(),
  isFinalLocked: z.boolean().default(false),
});
export type Answer = z.infer<typeof AnswerSchema>;
