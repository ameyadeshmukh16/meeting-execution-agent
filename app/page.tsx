"use client";

import { useRef, useState } from "react";
import { fmtDate, speak } from "@/lib/dates";

type ActionItem = { task: string; owner: string; deadline: string | null; deadlineText?: string | null };
type Decision = { text: string; madeBy?: string };
type PastDecision = { id: string; meeting: string; date: string; decision: string; rationale: string };
type Conflict = { newDecision: string; conflictsWith: PastDecision; reasoning: string };
type Phase = "input" | "review" | "done";

const DEMOS = [
  { name: "meeting1", label: "Meeting 1 (baseline)", date: "2026-10-06", title: "Sprint Planning 12" },
  { name: "meeting2", label: "Meeting 2 (conflict)", date: "2026-10-27", title: "Sprint Planning 14" },
  { name: "meeting3", label: "Meeting 3 (reversal)", date: "2026-11-03", title: "Standup 2026-11-03" },
];


function readBack(items: ActionItem[], conflicts: Conflict[]) {
  const parts = [`I found ${items.length} action items.`];
  items.forEach((a, i) => parts.push(`${i + 1}. ${a.owner}: ${a.task}, due ${fmtDate(a.deadline)}.`));
  conflicts.forEach((c) =>
    parts.push(
      `Warning. "${c.newDecision}" conflicts with a decision from ${c.conflictsWith.meeting} on ${fmtDate(c.conflictsWith.date)}: "${c.conflictsWith.decision}". ${c.reasoning}`,
    ),
  );
  parts.push("Say confirm to create these tasks, or tell me what to change.");
  return parts.join(" ");
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
  const [utterance, setUtterance] = useState("");
  const [assistant, setAssistant] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryNote, setMemoryNote] = useState("");
  const [result, setResult] = useState<{ trello: boolean; errors: string[]; urls: (string | undefined)[] } | null>(null);
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
      setBusy("Checking against past decisions…");
      const { conflicts } = await post<{ conflicts: Conflict[] }>("/api/conflicts", { decisions: ex.decisions.map((d) => d.text) });
      setDecisions(ex.decisions);
      setItems(ex.actionItems);
      setConflicts(conflicts);
      setAssistant(readBack(ex.actionItems, conflicts));
      setPhase("review");
      speak(readBack(ex.actionItems, conflicts));
      setTimeout(() => replyRef.current?.focus(), 100);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function createTasks(final: ActionItem[]) {
    const r = await post<{ items: { trelloUrl?: string }[]; trello: boolean; errors: string[] }>("/api/tasks", {
      meeting: meetingName,
      meetingDate,
      actionItems: final,
      // Confirming a conflicting decision replaces the earlier one in the store.
      decisions: decisions.map((d) => ({
        text: d.text,
        supersedes: conflicts.find((c) => c.newDecision === d.text)?.conflictsWith.id,
      })),
    });
    setResult({ trello: r.trello, errors: r.errors, urls: r.items.map((i) => i.trelloUrl) });
    setPhase("done");
  }

  async function respond() {
    if (!utterance.trim()) return;
    setError(null);
    setBusy("Understanding your response…");
    try {
      const r = await post<{ intent: "confirm" | "edit" | "cancel"; actionItems: ActionItem[]; reply: string }>("/api/confirm", {
        utterance,
        actionItems: items,
        meetingDate,
      });
      setUtterance("");
      setAssistant(r.reply);
      speak(r.reply);
      if (r.intent === "edit") setItems(r.actionItems);
      if (r.intent === "confirm") await createTasks(r.actionItems);
      if (r.intent === "cancel") reset();
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
    setAssistant("");
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
              <div className="badge">⚠ Conflict with an earlier decision</div>
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
            </section>
          ))}

          <section className="card">
            <h2>Decisions</h2>
            <ul>
              {decisions.map((d, i) => (
                <li key={i}>{d.text}</li>
              ))}
              {decisions.length === 0 && <li className="muted">None found</li>}
            </ul>
            <h2>Action items</h2>
            <table>
              <tbody>
                {items.map((a, i) => (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td>{a.task}</td>
                    <td>{a.owner}</td>
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
          <h2>✅ {items.length} tasks created</h2>
          <p className="muted">
            {result.trello ? "Cards were created on your Trello board." : "Trello is not configured yet, so tasks were saved locally only."}
          </p>
          {result.errors.map((e, i) => (
            <p key={i} className="err">{e}</p>
          ))}
          <ul>
            {items.map((a, i) => (
              <li key={i}>
                {a.task} — {a.owner}, {fmtDate(a.deadline)}{" "}
                {result.urls[i] && <a href={result.urls[i]} target="_blank">card</a>}
              </li>
            ))}
          </ul>
          <button onClick={reset}>New meeting</button>
        </section>
      )}

      {error && <p className="err">{error}</p>}
    </>
  );
}
