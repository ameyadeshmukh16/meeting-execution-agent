"use client";

import { useRef, useState } from "react";
import { fmtDate, speak } from "@/lib/dates";

type Evidence = { quote: string; speaker?: string };
type ActionItem = {
  task: string;
  owner: string | null;
  deadline: string | null;
  deadlineText?: string | null;
  ownership?: "accepted" | "assigned" | "unclear";
  evidence?: Evidence;
  evidenceVerified?: boolean;
};
type Decision = { text: string; madeBy?: string; topic?: string; evidence?: Evidence; evidenceVerified?: boolean };
type PastDecision = { id: string; meeting: string; date: string; decision: string; rationale: string };
type Conflict = {
  newDecision: string;
  conflictsWith: PastDecision;
  reasoning: string;
  type?: "direct_contradiction" | "scope_conflict" | "dependency_conflict";
  suggestedResolution?: string;
};
type Resolution = "replace" | "keep_both" | "needs_clarification";
type ImpactTask = { id: string; task: string; owner: string | null; deadline: string | null; meeting?: string };
type ImpactEntry = {
  decision: string;
  affectedTasks: ImpactTask[];
  affectedSystems: string[];
  potentialConsequences: string[];
};

const RESOLUTIONS: { value: Resolution; label: string; hint: string }[] = [
  { value: "replace", label: "Replace earlier decision", hint: "The new decision supersedes the old one." },
  { value: "keep_both", label: "Keep both", hint: "They apply to different scopes; both stay in force." },
  { value: "needs_clarification", label: "Needs clarification", hint: "Keep the earlier decision; park the new one for review." },
];
const TYPE_LABEL = {
  direct_contradiction: "Direct contradiction",
  scope_conflict: "Scope conflict",
  dependency_conflict: "Dependency conflict",
};
type Phase = "input" | "review" | "done";
type ExecItem = ActionItem & { status?: "created" | "failed"; trelloUrl?: string; error?: string };
type ExecResult = { trello: boolean; total: number; created: number; failed: number; items: ExecItem[] };

const DEMOS = [
  { name: "meeting1", label: "Meeting 1 (baseline)", date: "2026-10-06", title: "Sprint Planning 12" },
  { name: "meeting2", label: "Meeting 2 (conflict)", date: "2026-10-27", title: "Sprint Planning 14" },
  { name: "meeting3", label: "Meeting 3 (reversal)", date: "2026-11-03", title: "Standup 2026-11-03" },
];


function readBack(items: ActionItem[], conflicts: Conflict[], impact: ImpactEntry[]) {
  const parts = [`I found ${items.length} action items.`];
  items.forEach((a, i) => {
    const who = !a.owner ? "No owner" : a.ownership === "unclear" ? `${a.owner}, not confirmed` : a.owner;
    parts.push(`${i + 1}. ${who}: ${a.task}, due ${fmtDate(a.deadline)}.`);
  });
  const open = items.flatMap((a, i) => (!a.owner || a.ownership === "unclear" ? [i + 1] : []));
  if (open.length) parts.push(`Before I can create tasks, tell me who owns item ${open.join(" and ")}.`);
  conflicts.forEach((c) =>
    parts.push(
      `Warning. "${c.newDecision}" conflicts with a decision from ${c.conflictsWith.meeting} on ${fmtDate(c.conflictsWith.date)}: "${c.conflictsWith.decision}". ${c.reasoning}`,
    ),
  );
  impact.forEach((im) => {
    if (im.affectedTasks.length) {
      parts.push(
        `"${im.decision}" may affect existing tasks: ${im.affectedTasks.map((t) => `${t.owner ?? "unassigned"}'s ${t.task}`).join(", ")}.`,
      );
    }
  });
  if (conflicts.length) {
    parts.push(
      `For ${conflicts.length === 1 ? "the conflict" : "each conflict"}, say replace the earlier decision, keep both, or needs clarification.`,
    );
  }
  parts.push("Say confirm to create these tasks, or tell me what to change.");
  return parts.join(" ");
}

/** The transcript line an item came from, or an honest note when it can't be verified. */
function EvidenceLine({ e, verified }: { e?: Evidence; verified?: boolean }) {
  if (!e?.quote) return <div className="evidence warn">no transcript evidence</div>;
  return (
    <div className={verified ? "evidence" : "evidence warn"}>
      “{e.quote}”{e.speaker ? ` — ${e.speaker}` : ""}
      {!verified && " (quote not found in transcript)"}
    </div>
  );
}

/** What a decision may affect among existing tasks. Always worded as possibilities. */
function ImpactBlock({ entry }: { entry?: ImpactEntry }) {
  if (!entry) return null;
  return (
    <div className="impact">
      <strong>Potential impact</strong>
      {entry.affectedSystems.length > 0 && <span className="muted"> · {entry.affectedSystems.join(", ")}</span>}
      {entry.potentialConsequences.length > 0 && (
        <ul>
          {entry.potentialConsequences.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      {entry.affectedTasks.length > 0 && (
        <>
          <div className="muted">Existing tasks that may need review (created earlier, not tracked as done):</div>
          <ul>
            {entry.affectedTasks.map((t) => (
              <li key={t.id}>
                {t.task} — {t.owner ?? "Unassigned"}, {fmtDate(t.deadline)}
                {t.meeting ? ` · ${t.meeting}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export default function MeetingPage() {
  const [phase, setPhase] = useState<Phase>("input");
  const [transcript, setTranscript] = useState("");
  const [meetingName, setMeetingName] = useState("Sprint Planning 14");
  const [meetingDate, setMeetingDate] = useState("2026-10-27");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [impact, setImpact] = useState<ImpactEntry[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [utterance, setUtterance] = useState("");
  const [assistant, setAssistant] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryNote, setMemoryNote] = useState("");
  const [result, setResult] = useState<ExecResult | null>(null);
  const [approvalId, setApprovalId] = useState("");
  const replyRef = useRef<HTMLInputElement>(null);

  async function loadDemo(d: (typeof DEMOS)[number]) {
    const res = await fetch(`/api/demo?name=${d.name}`);
    setTranscript((await res.json()).transcript);
    setMeetingDate(d.date);
    setMeetingName(d.title);
  }

  async function analyze() {
    setError(null);
    try {
      setBusy("Extracting decisions and action items…");
      const ex = await post<{ decisions: Decision[]; actionItems: ActionItem[] }>("/api/extract", { transcript, meetingDate });
      setBusy("Checking conflicts and impact…");
      const texts = ex.decisions.map((d) => d.text);
      // Conflict detection and impact assessment are independent questions; ask them together.
      const [{ conflicts }, { impact }] = await Promise.all([
        post<{ conflicts: Conflict[] }>("/api/conflicts", { decisions: texts }),
        post<{ impact: ImpactEntry[] }>("/api/impact", { decisions: texts }),
      ]);
      // The server keeps what is being reviewed; only its id comes back to the client.
      const proposal = await post<{ approvalId: string }>("/api/proposals", {
        meeting: meetingName,
        meetingDate,
        actionItems: ex.actionItems,
        decisions: ex.decisions.map((d) => ({ text: d.text, topic: d.topic, evidence: d.evidence })),
        conflicts: conflicts.map((c) => ({ newDecision: c.newDecision, conflictsWithId: c.conflictsWith.id })),
      });
      setApprovalId(proposal.approvalId);
      setDecisions(ex.decisions);
      setItems(ex.actionItems);
      setConflicts(conflicts);
      setImpact(impact);
      setResolutions({});
      const spoken = readBack(ex.actionItems, conflicts, impact);
      setAssistant(spoken);
      setPhase("review");
      speak(spoken);
      setTimeout(() => replyRef.current?.focus(), 100);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  /** Records an explicit choice for one conflict. Nothing defaults: the user decides. */
  async function choose(index: number, resolution: Resolution) {
    setError(null);
    try {
      const res = await fetch("/api/proposals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, index, resolution }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setResolutions(json.resolutions);
    } catch (e) {
      setError(String(e));
    }
  }

  /** Safe to call again: the server only creates items that don't exist yet. */
  async function executeTasks() {
    setError(null);
    setBusy("Creating tasks…");
    try {
      setResult(await post<ExecResult>("/api/tasks", { approvalId }));
      setPhase("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function respond() {
    if (!utterance.trim()) return;
    setError(null);
    setBusy("Understanding your response…");
    try {
      const r = await post<{
        intent: "confirm" | "edit" | "cancel" | "blocked" | "resolved";
        actionItems: ActionItem[];
        reply: string;
        resolutions?: Record<string, Resolution>;
      }>("/api/confirm", { approvalId, utterance });
      setUtterance("");
      setAssistant(r.reply);
      speak(r.reply);
      if (r.resolutions) setResolutions(r.resolutions);
      if (r.intent === "edit" || r.intent === "blocked") setItems(r.actionItems);
      if (r.intent === "cancel") reset();
      if (r.intent === "confirm") {
        setBusy(null);
        await executeTasks();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function resetMemory() {
    await fetch("/api/tasks", { method: "DELETE" });
    setMemoryNote("Cleared learned decisions and saved tasks (Trello cards untouched).");
  }

  function reset() {
    setPhase("input");
    setDecisions([]);
    setItems([]);
    setConflicts([]);
    setImpact([]);
    setResolutions({});
    setAssistant("");
    setApprovalId("");
    setResult(null);
    window.speechSynthesis?.cancel();
  }

  return (
    <>

      {phase === "input" && (
        <section className="card">
          <div className="row">
            {DEMOS.map((d) => (
              <button key={d.name} className="ghost" onClick={() => loadDemo(d)}>
                Load {d.label}
              </button>
            ))}
          </div>
          <div className="row">
            <label>
              Meeting
              <input value={meetingName} onChange={(e) => setMeetingName(e.target.value)} />
            </label>
            <label>
              Date
              <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
            </label>
          </div>
          <textarea
            rows={12}
            placeholder={"Paste or dictate a speaker-tagged transcript:\nAmeya: Let's ship on Friday...\nGowtham: I'll take the migration."}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
          <div className="row">
            <button onClick={analyze} disabled={!transcript.trim() || !!busy}>
              {busy ?? "Analyze meeting"}
            </button>
            <button className="ghost" disabled={!!busy} onClick={resetMemory}>
              Reset demo memory
            </button>
            {memoryNote && <span className="muted">{memoryNote}</span>}
          </div>
        </section>
      )}

      {phase === "review" && (
        <>
          {conflicts.map((c, i) => (
            <section key={i} className="conflict">
              <div className="badge">
                ⚠ Conflict with an earlier decision{c.type ? ` · ${TYPE_LABEL[c.type]}` : ""}
              </div>
              <div className="versus">
                <div>
                  <small>
                    Earlier · {c.conflictsWith.meeting} · {fmtDate(c.conflictsWith.date)}
                  </small>
                  <p>{c.conflictsWith.decision}</p>
                </div>
                <div className="arrow">→</div>
                <div>
                  <small>Now · {meetingName}</small>
                  <p>{c.newDecision}</p>
                </div>
              </div>
              <p className="why">
                <strong>Why this matters:</strong> {c.reasoning}
              </p>
              <ImpactBlock entry={impact.find((m) => m.decision === c.newDecision)} />
              {c.suggestedResolution && (
                <p className="why">
                  <strong>Suggested next step:</strong> {c.suggestedResolution}
                </p>
              )}
              <div className="choices">
                {RESOLUTIONS.map((r) => (
                  <button
                    key={r.value}
                    className={resolutions[String(i)] === r.value ? "" : "ghost"}
                    title={r.hint}
                    onClick={() => choose(i, r.value)}
                  >
                    {resolutions[String(i)] === r.value ? "✓ " : ""}
                    {r.label}
                  </button>
                ))}
              </div>
              {!resolutions[String(i)] && <p className="muted">Choose how to handle this before the tasks can be created.</p>}
            </section>
          ))}

          {impact
            .filter((m) => !conflicts.some((c) => c.newDecision === m.decision))
            .map((m) => (
              <section key={m.decision} className="card">
                <h2>Potential impact of: {m.decision}</h2>
                <ImpactBlock entry={m} />
              </section>
            ))}

          <section className="card">
            <h2>Decisions</h2>
            <ul>
              {decisions.map((d, i) => (
                <li key={i}>
                  {d.text}
                  <EvidenceLine e={d.evidence} verified={d.evidenceVerified} />
                </li>
              ))}
              {decisions.length === 0 && <li className="muted">None found</li>}
            </ul>
            <h2>Action items</h2>
            <table>
              <tbody>
                {items.map((a, i) => (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td>
                      {a.task}
                      <EvidenceLine e={a.evidence} verified={a.evidenceVerified} />
                    </td>
                    <td>
                      {a.owner ?? "Unassigned"}
                      {(!a.owner || a.ownership === "unclear") && <span className="pill overdue"> needs owner</span>}
                    </td>
                    <td>{fmtDate(a.deadline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card voice">
            <p className="assistant">🔊 {assistant}</p>
            <div className="row">
              <button className="ghost" onClick={() => speak(assistant)}>
                Replay
              </button>
              <button className="ghost" onClick={() => { setUtterance("confirm"); }}>
                Fill “confirm”
              </button>
            </div>
            <div className="row">
              <input
                ref={replyRef}
                value={utterance}
                placeholder="Speak with Wispr: “change the second deadline to Friday” or “confirm”"
                onChange={(e) => setUtterance(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && respond()}
                disabled={!!busy}
              />
              <button onClick={respond} disabled={!utterance.trim() || !!busy}>
                {busy ?? "Send"}
              </button>
            </div>
          </section>
        </>
      )}

      {phase === "done" && result && (
        <section className="card">
          <h2>
            {result.failed === 0 ? "✅" : "⚠"} {result.created} of {result.total} tasks created
          </h2>
          <p className="muted">
            {result.trello ? "Cards were created on your Trello board." : "Trello is not configured yet, so tasks were saved locally only."}
          </p>
          <ul>
            {result.items.map((a, i) => (
              <li key={i}>
                {a.task} — {a.owner}, {fmtDate(a.deadline)}{" "}
                {a.status === "failed" ? (
                  <span className="err">failed: {a.error}</span>
                ) : (
                  a.trelloUrl && <a href={a.trelloUrl} target="_blank">card</a>
                )}
              </li>
            ))}
          </ul>
          <div className="row">
            {result.failed > 0 && (
              <button onClick={executeTasks} disabled={!!busy}>
                {busy ?? `Retry ${result.failed} failed`}
              </button>
            )}
            <button className={result.failed > 0 ? "ghost" : ""} onClick={reset}>
              New meeting
            </button>
          </div>
        </section>
      )}

      {error && <p className="err">{error}</p>}
    </>
  );
}
