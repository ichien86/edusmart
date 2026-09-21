import { z } from 'zod';

export const ObjectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId string');

export const RichTextSchema = z.object({
  text: z.string(),
  format: z.enum(['markdown_latex', 'plain']).default('markdown_latex'),
  dir: z.enum(['auto', 'ltr', 'rtl']).default('auto'),
  lang: z.string().default('id'),
});

export type RichText = z.infer<typeof RichTextSchema>;

export const StimulusSchema = z.object({
  id: z.string(),
  content: RichTextSchema,
});

export type Stimulus = z.infer<typeof StimulusSchema>;
