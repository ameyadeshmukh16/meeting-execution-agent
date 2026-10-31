// Pure module (no imports) so the offline tests can load it directly.

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Models sometimes write our internal decision ids ("d1", "L3") into explanations meant for people,
 * even when told not to. Replace exactly the known ids, as whole words, with plain language, so the
 * text reads naturally and nothing else in it can be touched.
 */
export function stripInternalIds(text: string, ids: string[]): string {
  const known = [...new Set(ids)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!text || known.length === 0) return text;

  // "decision d1", "the earlier decision d1" and a bare "d1" all become "the earlier decision".
  const pattern = new RegExp(
    `(?:\\b(?:the\\s+)?(?:(?:past|earlier|previous)\\s+)?decisions?\\s+)?\\b(?:${known.map(escapeRegExp).join("|")})\\b`,
    "gi",
  );
  return text.replace(pattern, (match, offset: number, whole: string) => {
    const before = whole.slice(0, offset).trimEnd();
    const startsSentence = before === "" || /[.!?:]$/.test(before);
    return startsSentence ? "The earlier decision" : "the earlier decision";
  });
}
