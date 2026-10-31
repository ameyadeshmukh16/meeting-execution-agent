"use client";

import { useEffect, useState } from "react";
import { fmtDate } from "@/lib/dates";

type View = {
  id: string;
  meeting: string;
  date: string;
  decision: string;
  rationale: string;
  topic?: string;
  evidence?: { quote: string; speaker?: string };
  source: "seed" | "learned";
  state: "active" | "replaced" | "under_review";
  replacedBy?: string;
  supersedes?: string;
  resolution?: "replace" | "keep_both" | "needs_clarification";
  relatedTo?: string;
};
type Change = {
  meeting: string;
  date: string;
  items: { id: string; decision: string; kind: "new" | "replaced" | "kept_both" | "needs_clarification"; relatedDecision?: string }[];
};

const STATE_LABEL = { active: "Active", replaced: "Replaced", under_review: "Under review" };
const KIND_LABEL = {
  new: "New decision",
  replaced: "Replaced an earlier decision",
  kept_both: "Kept alongside an earlier decision",
  needs_clarification: "Needs clarification (earlier decision still in force)",
};

export default function DecisionsPage() {
  const [data, setData] = useState<{ decisions: View[]; lastMeeting: Change | null } | null>(null);

  useEffect(() => {
    fetch("/api/decisions")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <p className="muted">Loading…</p>;
  const byId = new Map(data.decisions.map((d) => [d.id, d]));
  const active = data.decisions.filter((d) => d.state === "active").length;

  return (
    <>
      <p className="muted">
        {data.decisions.length} decisions · {active} in force · {data.decisions.filter((d) => d.state === "replaced").length} replaced ·{" "}
        {data.decisions.filter((d) => d.state === "under_review").length} under review
      </p>

      {data.lastMeeting && (
        <section className="card">
          <h2>
            What changed in the last meeting · {data.lastMeeting.meeting} · {fmtDate(data.lastMeeting.date)}
          </h2>
          <ul>
            {data.lastMeeting.items.map((c) => (
              <li key={c.id}>
                <strong>{KIND_LABEL[c.kind]}:</strong> {c.decision}
                {c.relatedDecision && <div className="muted">Related earlier decision: {c.relatedDecision}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="timeline">
        {data.decisions.map((d) => (
          <section key={d.id} className={`card tl ${d.state}`}>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className={`pill ${d.state === "replaced" ? "" : d.state === "under_review" ? "soon" : "ok"}`}>{STATE_LABEL[d.state]}</span>
              <small className="muted">
                {fmtDate(d.date)} · {d.meeting}
                {d.topic ? ` · ${d.topic}` : ""}
              </small>
            </div>
            <p className={d.state === "replaced" ? "struck" : ""}>{d.decision}</p>
            {d.evidence?.quote ? (
              <div className="evidence">
                “{d.evidence.quote}”{d.evidence.speaker ? ` — ${d.evidence.speaker}` : ""}
              </div>
            ) : (
              <div className="evidence">{d.rationale}</div>
            )}
            {d.replacedBy && byId.get(d.replacedBy) && (
              <div className="rel">
                Replaced by “{byId.get(d.replacedBy)!.decision}” in {byId.get(d.replacedBy)!.meeting}
              </div>
            )}
            {d.supersedes && byId.get(d.supersedes) && <div className="rel">Replaces “{byId.get(d.supersedes)!.decision}”</div>}
            {d.resolution === "keep_both" && d.relatedTo && byId.get(d.relatedTo) && (
              <div className="rel">Kept alongside “{byId.get(d.relatedTo)!.decision}”</div>
            )}
            {d.resolution === "needs_clarification" && d.relatedTo && byId.get(d.relatedTo) && (
              <div className="rel">Conflicts with “{byId.get(d.relatedTo)!.decision}”; awaiting clarification</div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
