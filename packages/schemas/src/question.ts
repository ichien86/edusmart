import { z } from 'zod';
import { ObjectIdString, RichTextSchema } from './common.js';

export const QuestionTypeEnum = z.enum([
  'single_choice',
  'multiple_choice',
  'true_false',
  'matching',
  'short_answer',
  'essay',
]);

export type QuestionType = z.infer<typeof QuestionTypeEnum>;

// Options for Choice Questions
export const ChoiceOptionSchema = z.object({
  id: z.string(),
  content: RichTextSchema,
});
export type ChoiceOption = z.infer<typeof ChoiceOptionSchema>;

// Single Choice Payload
export const SingleChoicePayloadSchema = z.object({
  options: z.array(ChoiceOptionSchema).min(2),
  key: z.string(),
  shuffleOptions: z.boolean().default(true),
});
export type SingleChoicePayload = z.infer<typeof SingleChoicePayloadSchema>;

// Multiple Choice Payload
export const MultipleChoicePayloadSchema = z.object({
  options: z.array(ChoiceOptionSchema).min(2),
  keys: z.array(z.string()).min(1),
  scoringMode: z.enum(['all_or_nothing', 'partial']).default('partial'),
  shuffleOptions: z.boolean().default(true),
});
export type MultipleChoicePayload = z.infer<typeof MultipleChoicePayloadSchema>;

// True/False Payload
export const TrueFalseStatementSchema = z.object({
  id: z.string(),
  content: RichTextSchema,
  key: z.boolean(),
});
export const TrueFalsePayloadSchema = z.object({
  statements: z.array(TrueFalseStatementSchema).min(1),
  scoringMode: z.enum(['all_or_nothing', 'partial']).default('partial'),
});
export type TrueFalsePayload = z.infer<typeof TrueFalsePayloadSchema>;

// Matching Payload
export const MatchingItemSchema = z.object({
  id: z.string(),
  content: RichTextSchema,
});
export const MatchingPairSchema = z.object({
  premiseId: z.string(),
  responseId: z.string(),
});
export const MatchingPayloadSchema = z.object({
  premises: z.array(MatchingItemSchema).min(2),
  responses: z.array(MatchingItemSchema).min(2),
  pairs: z.array(MatchingPairSchema).min(2),
  scoringMode: z.enum(['all_or_nothing', 'partial']).default('partial'),
});
export type MatchingPayload = z.infer<typeof MatchingPayloadSchema>;

// Short Answer Payload
export const ShortAnswerKindEnum = z.enum(['text', 'numeric', 'algebraic', 'arabic']);
export const ShortAnswerPayloadSchema = z.object({
  answerKind: ShortAnswerKindEnum,
  acceptedAnswers: z.array(z.string()).min(1),
  tolerance: z.object({
    abs: z.number().optional(),
    rel: z.number().optional(),
  }).optional(),
  unit: z.string().nullable().optional(),
  requireUnit: z.boolean().default(false),
  arabicOpts: z.object({
    mode: z.enum(['ignore_harakat', 'strict']).default('ignore_harakat'),
    unifyAlif: z.boolean().default(true),
    unifyYa: z.boolean().default(true),
    unifyTaMarbuta: z.boolean().default(true),
  }).optional(),
});
export type ShortAnswerPayload = z.infer<typeof ShortAnswerPayloadSchema>;

// Essay Rubric & Payload
export const RubricCriterionSchema = z.object({
  id: z.string(),
  aspect: z.string(),
  weight: z.number().min(1).max(100),
});
export const EssayPayloadSchema = z.object({
  rubric: z.array(RubricCriterionSchema).min(1),
  idealAnswer: RichTextSchema.optional(),
  discussion: RichTextSchema.optional(),
});
export type EssayPayload = z.infer<typeof EssayPayloadSchema>;

// Full Question Schema (Stored in DB)
export const QuestionSchema = z.object({
  _id: ObjectIdString,
  schoolId: ObjectIdString,
  questionKey: z.string(),
  version: z.number().int().min(1),
  status: z.enum(['active', 'archived']).default('active'),
  type: QuestionTypeEnum,
  subject: z.string(),
  topic: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  stimulusId: ObjectIdString.nullable().optional(),
  content: RichTextSchema,
  payload: z.union([
    SingleChoicePayloadSchema,
    MultipleChoicePayloadSchema,
    TrueFalsePayloadSchema,
    MatchingPayloadSchema,
    ShortAnswerPayloadSchema,
    EssayPayloadSchema,
  ]),
  createdAt: z.date().or(z.string()),
  updatedAt: z.date().or(z.string()),
});
export type Question = z.infer<typeof QuestionSchema>;

// Whitelist Projected Student Question (Never leaks keys/rubrics/idealAnswer)
export const StudentQuestionSchema = z.object({
  questionId: ObjectIdString,
  order: z.number().int(),
  points: z.number().positive(),
  type: QuestionTypeEnum,
  stimulusId: ObjectIdString.nullable().optional(),
  content: RichTextSchema,
  // Polymorphic student payload
  options: z.array(z.object({ id: z.string(), content: RichTextSchema })).optional(),
  statements: z.array(z.object({ id: z.string(), content: RichTextSchema })).optional(),
  premises: z.array(z.object({ id: z.string(), content: RichTextSchema })).optional(),
  responses: z.array(z.object({ id: z.string(), content: RichTextSchema })).optional(),
  answerKind: ShortAnswerKindEnum.optional(),
  unit: z.string().nullable().optional(),
});
export type StudentQuestion = z.infer<typeof StudentQuestionSchema>;
