const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export const FEED_EXCERPT_LENGTH = 320;
export const TELEGRAM_EXCERPT_LENGTH = 500;

/** Turns HTML entities (including &nbsp;) and Unicode NBSP into regular text. */
export function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass++) {
    const next = decoded.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
      const key = name.toLowerCase();
      if (key.startsWith("#x")) return fromCodePoint(Number.parseInt(key.slice(2), 16), entity);
      if (key.startsWith("#")) return fromCodePoint(Number.parseInt(key.slice(1), 10), entity);
      return NAMED_ENTITIES[key] ?? entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.replace(/\u00A0/g, " ");
}

export function normalizeText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\u00A0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanHtml(value: string): string {
  const withoutChrome = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  const withBreaks = withoutChrome
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return normalizeText(withBreaks);
}

export function excerpt(value: string, maxLength = FEED_EXCERPT_LENGTH): string {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;

  const slice = text.slice(0, maxLength);
  const sentenceBreak = slice.lastIndexOf(". ");
  const wordBreak = slice.lastIndexOf(" ");
  const breakAt = sentenceBreak >= maxLength * 0.45
    ? sentenceBreak + 1
    : wordBreak >= maxLength * 0.45
      ? wordBreak
      : maxLength;
  return `${slice.slice(0, breakAt).trim()}…`;
}

export function paragraphs(value: string): string[] {
  const parts = normalizeText(value).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [];
}

function fromCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code)) return fallback;
  if (code === 160) return " ";
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}
