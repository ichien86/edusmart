import { z } from 'zod';
import { ObjectIdString } from './common.js';

export const ExamStatusEnum = z.enum(['draft', 'published', 'locked', 'archived']);
export type ExamStatus = z.infer<typeof ExamStatusEnum>;

export const QuestionRefSchema = z.object({
  questionId: ObjectIdString,
  order: z.number().int().min(1),
  points: z.number().positive(),
  status: z.enum(['active', 'dropped']).default('active'),
  allCredit: z.boolean().default(false),
  keyOverride: z.record(z.any()).optional(),
});
export type QuestionRef = z.infer<typeof QuestionRefSchema>;

export const ExamSchedulingSchema = z.object({
  mode: z.enum(['self_paced', 'concurrent']).default('self_paced'),
  durationMinutes: z.number().int().min(1),
  windowStart: z.date().or(z.string()),
  windowEnd: z.date().or(z.string()),
  gracePeriodSeconds: z.number().int().default(120),
});
export type ExamScheduling = z.infer<typeof ExamSchedulingSchema>;

export const StudentAccommodationSchema = z.object({
  studentId: ObjectIdString,
  extraMinutes: z.number().int().min(0),
});
export type StudentAccommodation = z.infer<typeof StudentAccommodationSchema>;

export const ExamSettingsSchema = z.object({
  aiGrading: z.object({
    enabled: z.boolean().default(false),
    shadowMode: z.boolean().default(true),
    doubleEval: z.boolean().default(false),
    budgetTokens: z.number().int().default(200000),
  }).default({}),
  resultReleaseMode: z.enum(['instant_objective', 'after_teacher_review', 'manual']).default('instant_objective'),
  allowRubricView: z.boolean().default(false),
  appealPolicy: z.object({
    enabled: z.boolean().default(true),
    windowHours: z.number().int().default(48),
    maxItems: z.number().int().default(3),
    teacherSlaDays: z.number().int().default(3),
  }).default({}),
});
export type ExamSettings = z.infer<typeof ExamSettingsSchema>;

export const ExamSchema = z.object({
  _id: ObjectIdString,
  schoolId: ObjectIdString,
  ownerId: ObjectIdString,
  title: z.string().min(1),
  description: z.string().optional(),
  status: ExamStatusEnum.default('draft'),
  questionRefs: z.array(QuestionRefSchema).min(1),
  scheduling: ExamSchedulingSchema,
  assignedClassIds: z.array(ObjectIdString).default([]),
  assignedStudentIds: z.array(ObjectIdString).default([]),
  accommodations: z.array(StudentAccommodationSchema).default([]),
  tokenPolicy: z.object({
    required: z.boolean().default(false),
    ttlSeconds: z.number().int().default(3600),
  }).default({}),
  settings: ExamSettingsSchema.default({}),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});
export type Exam = z.infer<typeof ExamSchema>;

