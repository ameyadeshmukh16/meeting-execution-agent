// Pure module (no imports) so the offline tests can load it directly.

export type EvidenceIssue = "missing" | "not_found" | "wrong_speaker";
export type EvidenceCheck = { ok: true } | { ok: false; issue: EvidenceIssue };

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Deterministic grounding check, no model involved. A quote counts as evidence only if it appears in a
 * transcript line, and, when a speaker is claimed, in a line that speaker actually said.
 * Substring matching proves the words exist in the transcript, not that they support the claim.
 */
export function verifyEvidence(transcript: string, evidence?: { quote?: string; speaker?: string }): EvidenceCheck {
  const quote = evidence?.quote ? normalize(evidence.quote) : "";
  if (!quote) return { ok: false, issue: "missing" };
  if (quote.length < 8) return { ok: false, issue: "not_found" }; // too short to mean anything

  const lines = transcript.split(/\r?\n/).flatMap((line) => {
    const i = line.indexOf(":");
    return i > 0 ? [{ speaker: line.slice(0, i).trim().toLowerCase(), text: normalize(line.slice(i + 1)) }] : [];
  });
  const hits = lines.filter((l) => l.text.includes(quote));
  if (hits.length === 0) return { ok: false, issue: "not_found" };

  const claimed = evidence?.speaker?.trim().toLowerCase();
  if (claimed && !hits.some((h) => h.speaker === claimed)) return { ok: false, issue: "wrong_speaker" };
  return { ok: true };
}
