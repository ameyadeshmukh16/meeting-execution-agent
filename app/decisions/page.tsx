"use client";

import React, { useEffect, useState } from "react";
import { fmtDate } from "@/lib/dates";

// Shape returned by GET /api/decisions (see lib/conflicts.ts: DecisionView, MeetingChange).
interface DecisionView {
  id: string;
  meeting: string;
  date: string;
  decision: string;
  rationale: string;
  topic?: string;
  evidence?: { quote: string; speaker?: string };
  source: "seed" | "learned";
  state: "active" | "replaced" | "under_review";
  replacedBy?: string; // id of the decision that replaced this one
  supersedes?: string; // id of the decision this one replaced
  resolution?: "replace" | "keep_both" | "needs_clarification";
  relatedTo?: string; // id of the decision it conflicted with
}

interface MeetingChange {
  meeting: string;
  date: string;
  items: {
    id: string;
    decision: string;
    kind: "new" | "replaced" | "kept_both" | "needs_clarification";
    relatedDecision?: string;
  }[];
}

const KIND_LABEL: Record<MeetingChange["items"][number]["kind"], string> = {
  new: "New decision",
  replaced: "Replaced an earlier decision",
  kept_both: "Kept alongside an earlier decision",
  needs_clarification: "Needs clarification (earlier decision still in force)",
};

export default function DecisionsPage() {
  const [decisions, setDecisions] = useState<DecisionView[]>([]);
  const [lastMeeting, setLastMeeting] = useState<MeetingChange | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/decisions")
      .then((res) => res.json())
      .then((data) => {
        setDecisions(data.decisions || []);
        setLastMeeting(data.lastMeeting || null);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const byId = new Map(decisions.map((d) => [d.id, d]));
  const counts = {
    active: decisions.filter((d) => d.state === "active").length,
    replaced: decisions.filter((d) => d.state === "replaced").length,
    review: decisions.filter((d) => d.state === "under_review").length,
  };

  const getStatusPill = (state: DecisionView["state"]) => {
    if (state === "replaced") return <span className="pill pill-neutral">Replaced</span>;
    if (state === "under_review") return <span className="pill pill-warning">Under review</span>;
    return <span className="pill pill-success">Active</span>;
  };

  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          Organizational Decision Memory
        </h1>
        <p style={{ color: "var(--text-tertiary)", marginTop: "0.25rem" }}>
          Chronological record of decisions, continuity links, and superseded strategies.
        </p>
        {!isLoading && decisions.length > 0 && (
          <p style={{ color: "var(--text-tertiary)", marginTop: "0.5rem", fontSize: "0.875rem" }}>
            {decisions.length} decisions · {counts.active} in force · {counts.replaced} replaced · {counts.review} under review
          </p>
        )}
      </div>

      {lastMeeting && (
        <div className="ui-card" style={{ borderLeft: "4px solid var(--brand-primary)" }}>
          <span className="pill pill-info" style={{ marginBottom: "0.25rem" }}>
            Latest Intelligence
          </span>
          <h2 className="ui-card-title">What changed in the last meeting</h2>
          <p style={{ color: "var(--text-secondary)", marginTop: "0.25rem", fontSize: "0.9375rem" }}>
            <strong>{lastMeeting.meeting}</strong> · {fmtDate(lastMeeting.date)}
          </p>
          <ul className="consequences-list" style={{ marginTop: "0.75rem" }}>
            {lastMeeting.items.map((c) => (
              <li key={c.id}>
                <strong>{KIND_LABEL[c.kind]}:</strong> {c.decision}
                {c.relatedDecision && (
                  <div style={{ color: "var(--text-tertiary)", fontSize: "0.8125rem" }}>
                    Related earlier decision: {c.relatedDecision}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--text-tertiary)" }}>
          Loading decision memory…
        </div>
      ) : decisions.length === 0 ? (
        <div className="ui-card" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
          <p style={{ color: "var(--text-tertiary)" }}>
            No decisions recorded yet. Ingest your first meeting to populate the continuity log.
          </p>
        </div>
      ) : (
        <div className="timeline-list">
          {decisions.map((item) => {
            const isReplaced = item.state === "replaced";
            const replacedBy = item.replacedBy ? byId.get(item.replacedBy) : undefined;
            const supersedes = item.supersedes ? byId.get(item.supersedes) : undefined;
            const related = item.relatedTo ? byId.get(item.relatedTo) : undefined;
            const quote = item.evidence?.quote
              ? `“${item.evidence.quote}”${item.evidence.speaker ? ` — ${item.evidence.speaker}` : ""}`
              : item.rationale;

            return (
              <div key={item.id} className={`timeline-card ${isReplaced ? "replaced" : ""}`}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                  {getStatusPill(item.state)}
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-tertiary)" }}>
                    {item.meeting} · {fmtDate(item.date)}
                  </span>
                  {item.topic && <span className="pill pill-neutral">{item.topic}</span>}
                </div>

                <p className={`panel-text ${isReplaced ? "decision-struck" : ""}`} style={{ margin: "0.5rem 0" }}>
                  {item.decision}
                </p>

                {quote && (
                  <div className="evidence-quote" style={{ marginTop: "0.5rem" }}>
                    {quote}
                  </div>
                )}

                {(replacedBy || supersedes || (related && item.resolution)) && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      paddingTop: "0.5rem",
                      borderTop: "1px dashed var(--border-default)",
                      fontSize: "0.75rem",
                      display: "flex",
                      gap: "0.75rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {replacedBy && (
                      <span style={{ color: "var(--danger-primary)" }}>
                        Replaced by: <strong>{replacedBy.decision}</strong> ({replacedBy.meeting})
                      </span>
                    )}
                    {supersedes && (
                      <span style={{ color: "var(--brand-primary)" }}>
                        Replaces: <strong>{supersedes.decision}</strong>
                      </span>
                    )}
                    {related && item.resolution === "keep_both" && (
                      <span style={{ color: "var(--text-secondary)" }}>
                        Kept alongside: <strong>{related.decision}</strong>
                      </span>
                    )}
                    {related && item.resolution === "needs_clarification" && (
                      <span style={{ color: "var(--warning-text)" }}>
                        Conflicts with: <strong>{related.decision}</strong> (awaiting clarification)
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
