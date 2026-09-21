import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import katex from 'katex';
import type { RichText } from '@eduassess/schemas';

const md = new MarkdownIt({
  html: false, // Strictly disable raw HTML to prevent XSS
  linkify: false,
  breaks: true,
});

/**
 * Render LaTeX math expressions enclosed in $...$ or $$...$$ safely with KaTeX.
 */
function renderMath(text: string): string {
  // Replace display math $$...$$
  let result = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    try {
      return katex.renderToString(math, {
        displayMode: true,
        throwOnError: false,
        trust: false,
        maxExpand: 200,
        maxSize: 20,
        output: 'htmlAndMathml',
      });
    } catch {
      return math;
    }
  });

  // Replace inline math $...$
  result = result.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
    try {
      return katex.renderToString(math, {
        displayMode: false,
        throwOnError: false,
        trust: false,
        maxExpand: 200,
        maxSize: 20,
        output: 'htmlAndMathml',
      });
    } catch {
      return math;
    }
  });

  return result;
}

/**
 * Render RichText safely with DOMPurify sanitization and KaTeX math processing.
 */
export function renderRichText(rt: RichText): { __html: string; dir: 'auto' | 'ltr' | 'rtl'; lang: string } {
  const processedMath = renderMath(rt.text);
  const rawHtml = md.render(processedMath);
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true, mathMl: true },
  });

  return {
    __html: cleanHtml,
    dir: rt.dir || 'auto',
    lang: rt.lang || 'id',
  };
}

