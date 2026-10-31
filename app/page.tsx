"use client";

import React, { useState } from "react";
import { fmtDate, speak } from "@/lib/dates";

type EvidenceIssue = "missing" | "not_found" | "wrong_speaker";
type Resolution = "replace" | "keep_both" | "needs_clarification";

interface Evidence {
  quote?: string;
  speaker?: string;
}

interface DecisionItem {
  text: string;
  madeBy?: string;
  topic?: string;
  evidence?: Evidence;
  evidenceVerified?: boolean;
  evidenceIssue?: EvidenceIssue;
}

interface ActionItem {
  task: string;
  owner: string | null;
  ownership?: "accepted" | "assigned" | "unclear";
  deadline: string | null;
  deadlineText?: string | null;
  evidence?: Evidence;
  evidenceVerified?: boolean;
  evidenceIssue?: EvidenceIssue;
}

interface ConflictItem {
  newDecision: string;
  conflictsWith: {
    id: string;
    meeting: string;
    date: string;
    decision: string;
    rationale?: string;
  };
  reasoning: string;
  type?: "direct_contradiction" | "scope_conflict" | "dependency_conflict";
  suggestedResolution?: string;
}

interface AffectedTask {
  id: string;
  task: string;
  owner?: string | null;
  deadline?: string | null;
  meeting?: string;
}

interface ImpactItem {
  decision: string;
  affectedSystems: string[];
  potentialConsequences: string[];
  affectedTasks: AffectedTask[];
}

interface CreatedTaskItem extends ActionItem {
  status: "created" | "failed";
  trelloUrl?: string;
  error?: string;
}

interface Accepted {
  task: string;
  at: string;
}

const DEFAULT_REPLY = "Please review the extracted decisions and settle any open conflicts before proceeding.";

const ISSUE_TEXT: Record<EvidenceIssue, string> = {
  missing: "no transcript evidence",
  not_found: "quote not found in the transcript",
  wrong_speaker: "quote attributed to the wrong speaker",
};

/** The full spoken summary: tasks, owners, evidence gaps, conflicts, impact, and what to say next. */
function readBack(items: ActionItem[], conflicts: ConflictItem[], impact: ImpactItem[]) {
  const parts = [`I found ${items.length} action items.`];
  items.forEach((a, i) => {
    const who = !a.owner ? "No owner" : a.ownership === "unclear" ? `${a.owner}, not confirmed` : a.owner;
    parts.push(`${i + 1}. ${who}: ${a.task}, due ${fmtDate(a.deadline)}.`);
  });
  const open = items.flatMap((a, i) => (!a.owner || a.ownership === "unclear" ? [i + 1] : []));
  if (open.length) parts.push(`Before I can create tasks, tell me who owns item ${open.join(" and ")}.`);
  const ungrounded = items.flatMap((a, i) => (a.evidenceVerified ? [] : [i + 1]));
  if (ungrounded.length) {
    parts.push(`Item ${ungrounded.join(" and ")} has no verified transcript evidence. Accept it anyway, or remove it.`);
  }
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

/** POST helper that surfaces the server's own error message. */
async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

/** A transcript quote in curly quotes, with its speaker. */
function Quote({ evidence }: { evidence?: Evidence }) {
  if (!evidence?.quote) return null;
  return (
    <div className="evidence-quote">
      {`“${evidence.quote}”${evidence.speaker ? ` — ${evidence.speaker}` : ""}`}
    </div>
  );
}

export default function MeetingPage() {
  const [phase, setPhase] = useState<"input" | "review" | "done">("input");

  // Input phase state
  const [meetingName, setMeetingName] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [transcript, setTranscript] = useState("");
  const [archiveTrello, setArchiveTrello] = useState(true);
  const [resetNote, setResetNote] = useState<string | null>(null);

  // Busy/Progress states
  const [isBusy, setIsBusy] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Review phase state
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [impactList, setImpactList] = useState<ImpactItem[]>([]);
  const [impactUnavailable, setImpactUnavailable] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [evidenceAccepted, setEvidenceAccepted] = useState<Accepted[]>([]);
  const [acknowledgedReview, setAcknowledgedReview] = useState(false);
  const [isProceeding, setIsProceeding] = useState(false);

  // Voice & Chat interaction
  const [lastReply, setLastReply] = useState<string>(DEFAULT_REPLY);
  const [utteranceInput, setUtteranceInput] = useState("");

  // Done phase state
  const [createdTasks, setCreatedTasks] = useState<CreatedTaskItem[]>([]);
  const [trelloConfigured, setTrelloConfigured] = useState(false);
  const [taskSummary, setTaskSummary] = useState({ total: 0, created: 0, failed: 0 });

  /** Clears everything that belongs to one reviewed meeting, so nothing leaks into the next. */
  const resetReviewState = () => {
    setApprovalId(null);
    setDecisions([]);
    setActionItems([]);
    setConflicts([]);
    setImpactList([]);
    setImpactUnavailable(false);
    setResolutions({});
    setEvidenceAccepted([]);
    setAcknowledgedReview(false);
    setIsProceeding(false);
    setLastReply(DEFAULT_REPLY);
    setUtteranceInput("");
    setCreatedTasks([]);
    setTaskSummary({ total: 0, created: 0, failed: 0 });
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  };

  // Demo transcript loaders
  const loadDemo = async (demoKey: "meeting1" | "meeting2" | "meeting3") => {
    setErrorMessage(null);
    if (demoKey === "meeting1") {
      setMeetingName("Sprint Planning 12");
      setMeetingDate("2026-10-06");
    } else if (demoKey === "meeting2") {
      setMeetingName("Sprint Planning 14");
      setMeetingDate("2026-10-27");
    } else if (demoKey === "meeting3") {
      setMeetingName("Standup 2026-11-03");
      setMeetingDate("2026-11-03");
    }

    try {
      const res = await fetch(`/api/demo?name=${demoKey}`);
      if (!res.ok) throw new Error("Failed to load demo transcript");
      const data = await res.json();
      setTranscript(data.transcript || "");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error loading demo transcript");
    }
  };

  // Reset Memory Handler
  const handleReset = async () => {
    setResetNote(null);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/tasks${archiveTrello ? "?archive=1" : ""}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setResetNote(
          archiveTrello
            ? `Memory reset. Archived ${data.archived ?? 0} Trello card(s)${data.archiveFailed ? `, ${data.archiveFailed} failed` : ""}.`
            : "Memory reset. Trello cards untouched.",
        );
      } else {
        setErrorMessage(data.error ?? "Failed to reset demo memory.");
      }
    } catch {
      setErrorMessage("Error communicating with reset endpoint.");
    }
  };

  // Analyze Meeting (Input -> Review)
  const handleAnalyzeMeeting = async () => {
    setIsBusy(true);
    setErrorMessage(null);
    resetReviewState();
    setProgressText("Extracting decisions and action items…");

    try {
      // 1. POST /api/extract
      const extracted = await apiPost<{ decisions: DecisionItem[]; actionItems: ActionItem[] }>("/api/extract", {
        transcript,
        meetingDate,
      });
      const extractedDecisions = extracted.decisions || [];
      const extractedActionItems = extracted.actionItems || [];
      const decTexts = extractedDecisions.map((d) => d.text);

      setProgressText("Checking conflicts and impact…");

      // 2 + 3. Conflicts and impact are independent questions; ask them together.
      // A failed conflict check must stop the flow (we cannot claim "no conflicts" unchecked).
      // Impact is advisory: if it fails we say so and carry on.
      const [conflictData, impactData] = await Promise.all([
        apiPost<{ conflicts: ConflictItem[] }>("/api/conflicts", { decisions: decTexts }),
        apiPost<{ impact: ImpactItem[] }>("/api/impact", { decisions: decTexts }).catch(() => null),
      ]);
      const loadedConflicts = conflictData.conflicts || [];
      const loadedImpact = impactData?.impact || [];

      // 4. POST /api/proposals: the server keeps what is being reviewed; only its id comes back.
      const proposal = await apiPost<{ approvalId: string }>("/api/proposals", {
        meeting: meetingName,
        meetingDate: meetingDate,
        actionItems: extractedActionItems,
        decisions: extractedDecisions.map((d) => ({
          text: d.text,
          topic: d.topic,
          evidence: d.evidence,
        })),
        conflicts: loadedConflicts.map((c) => ({
          newDecision: c.newDecision,
          conflictsWithId: c.conflictsWith.id,
        })),
      });

      setApprovalId(proposal.approvalId);
      setDecisions(extractedDecisions);
      setActionItems(extractedActionItems);
      setConflicts(loadedConflicts);
      setImpactList(loadedImpact);
      setImpactUnavailable(impactData === null);

      const spoken = readBack(extractedActionItems, loadedConflicts, loadedImpact);
      setLastReply(spoken);
      speak(spoken);

      setPhase("review");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error analyzing meeting.");
    } finally {
      setIsBusy(false);
      setProgressText("");
    }
  };

  /** Sends one explicit human decision to the server and mirrors the server's state back. */
  const decide = async (body: Record<string, unknown>) => {
    if (!approvalId) return;
    setErrorMessage(null);
    try {
      const res = await fetch("/api/proposals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResolutions(data.resolutions || {});
      setEvidenceAccepted(data.evidenceAccepted || []);
      setAcknowledgedReview(Boolean(data.acknowledgedReview));
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Could not record your decision.");
    }
  };

  const handleSelectResolution = (index: number, resolution: Resolution) => decide({ index, resolution });
  const handleAcceptEvidence = (index: number) => decide({ acceptEvidence: index });
  const handleProceedAnyway = async () => {
    setIsProceeding(true);
    try {
      await decide({ acknowledgeReview: true });
    } finally {
      setIsProceeding(false);
    }
  };

  // Execute Tasks Creation (safe to call again: the server only creates items that don't exist yet)
  const handleExecuteTasks = async () => {
    if (!approvalId) return;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const data = await apiPost<{
        items: CreatedTaskItem[];
        trello: boolean;
        total?: number;
        created?: number;
        failed?: number;
      }>("/api/tasks", { approvalId });
      setCreatedTasks(data.items || []);
      setTrelloConfigured(Boolean(data.trello));
      setTaskSummary({
        total: data.total ?? data.items?.length ?? 0,
        created: data.created ?? 0,
        failed: data.failed ?? 0,
      });
      setPhase("done");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Error creating tasks.");
    } finally {
      setIsBusy(false);
    }
  };

  // User Utterance Submission (verbatim, never trimmed or reformatted)
  const handleSendUtterance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvalId || isBusy || !utteranceInput) return;

    setIsBusy(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, utterance: utteranceInput }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Error processing your request.");
        return;
      }

      if (data.reply) {
        setLastReply(data.reply);
        speak(data.reply);
      }
      if (data.actionItems) setActionItems(data.actionItems);
      if (data.resolutions) setResolutions(data.resolutions);
      if (data.evidenceAccepted) setEvidenceAccepted(data.evidenceAccepted);
      if (data.acknowledgedReview !== undefined) setAcknowledgedReview(Boolean(data.acknowledgedReview));

      setUtteranceInput("");

      if (data.intent === "confirm") {
        setIsBusy(false);
        await handleExecuteTasks();
      } else if (data.intent === "cancel") {
        resetReviewState();
        setPhase("input");
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Voice confirm failed.");
    } finally {
      setIsBusy(false);
    }
  };

  // Helper formatting conflict type label
  const formatConflictType = (type?: string) => {
    if (type === "direct_contradiction") return "Direct Contradiction";
    if (type === "scope_conflict") return "Scope Conflict";
    if (type === "dependency_conflict") return "Dependency Conflict";
    return "Contradiction";
  };

  return (
    <div>
      {/* Workflow Indicator */}
      <div className="flow-progress-bar">
        <div className={`flow-step ${phase === "input" ? "active" : "done"}`}>
          <span className="flow-step-num">1</span>
          <span>Input & Transcript</span>
        </div>
        <div className="flow-divider" />
        <div className={`flow-step ${phase === "review" ? "active" : phase === "done" ? "done" : ""}`}>
          <span className="flow-step-num">2</span>
          <span>Review & Align</span>
        </div>
        <div className="flow-divider" />
        <div className={`flow-step ${phase === "done" ? "active done" : ""}`}>
          <span className="flow-step-num">3</span>
          <span>Executed Tasks</span>
        </div>
      </div>

      {errorMessage && (
        <div
          className="under-review-banner"
          style={{ background: "var(--danger-soft)", color: "var(--danger-text)", borderColor: "var(--danger-border)" }}
        >
          <span>⚠️ {errorMessage}</span>
        </div>
      )}

      {/* PHASE 1: INPUT */}
      {phase === "input" && (
        <div>
          <div className="demo-preset-panel">
            <span className="preset-title">Fast Demo Pre-load</span>
            <div className="preset-buttons">
              <button type="button" className="btn-preset" onClick={() => loadDemo("meeting1")}>
                📂 Load Meeting 1 (Baseline)
              </button>
              <button type="button" className="btn-preset" onClick={() => loadDemo("meeting2")}>
                ⚡ Load Meeting 2 (Conflict)
              </button>
              <button type="button" className="btn-preset" onClick={() => loadDemo("meeting3")}>
                🔄 Load Meeting 3 (Reversal)
              </button>
            </div>
          </div>

          <div className="ui-card">
            <h2 className="ui-card-title" style={{ marginBottom: "0.5rem" }}>
              Meeting Ingestion
            </h2>
            <p style={{ color: "var(--text-tertiary)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
              Paste or dictate a speaker-tagged transcript. The agent extracts decisions and tasks, checks them against what
              the team already decided, and waits for your approval before creating anything.
            </p>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label" htmlFor="meetingName">
                  Meeting Name
                </label>
                <input
                  id="meetingName"
                  className="form-input"
                  type="text"
                  placeholder="e.g. Sprint Planning 14"
                  value={meetingName}
                  onChange={(e) => setMeetingName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="meetingDate">
                  Meeting Date
                </label>
                <input
                  id="meetingDate"
                  className="form-input"
                  type="date"
                  value={meetingDate}
                  onChange={(e) => setMeetingDate(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="transcript">
                Speaker-Tagged Transcript
              </label>
              <textarea
                id="transcript"
                className="form-textarea"
                placeholder="Ameya: Let's ship on Friday...&#10;Gowtham: I'll take the migration."
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
              />
            </div>

            <button
              type="button"
              className="btn-primary"
              disabled={isBusy || !transcript || !meetingName || !meetingDate}
              onClick={handleAnalyzeMeeting}
              style={{ width: "100%", padding: "0.875rem" }}
            >
              {isBusy ? progressText : "Analyze Meeting & Detect Conflicts →"}
            </button>
          </div>

          <div className="reset-memory-bar">
            <div className="reset-controls">
              <label className="reset-checkbox-label">
                <input type="checkbox" checked={archiveTrello} onChange={(e) => setArchiveTrello(e.target.checked)} />
                Also archive Trello cards created by this app
              </label>
              <button type="button" className="btn-danger-outline" disabled={isBusy} onClick={handleReset}>
                Reset demo memory
              </button>
            </div>
            {resetNote && (
              <span style={{ fontSize: "0.8125rem", color: "var(--success-primary)", fontWeight: 500 }}>{resetNote}</span>
            )}
          </div>
        </div>
      )}

      {/* PHASE 2: REVIEW */}
      {phase === "review" && (
        <div>
          {impactUnavailable && (
            <div
              className="under-review-banner"
              style={{ background: "var(--bg-subtle)", color: "var(--text-secondary)", borderColor: "var(--border-strong)" }}
            >
              <span>Impact check was unavailable for this meeting, so potential impact is not shown. Conflicts are unaffected.</span>
            </div>
          )}

          {/* HERO CONFLICT CARDS */}
          {conflicts.map((conflict, idx) => {
            const currentChoice = resolutions[String(idx)];
            const matchedImpact = impactList.find((imp) => imp.decision === conflict.newDecision);

            return (
              <div key={idx} className="hero-conflict-card">
                <div className="conflict-banner">
                  <div className="conflict-banner-left">
                    <span>⚡ Conflict with an earlier decision</span>
                    <span className="conflict-type-pill">{formatConflictType(conflict.type)}</span>
                  </div>
                  <span style={{ fontSize: "0.75rem", opacity: 0.9 }}>Action required to proceed</span>
                </div>

                <div className="conflict-body">
                  {/* Earlier vs Now Split Comparison */}
                  <div className="comparison-grid">
                    <div className="comparison-panel earlier">
                      <span className="panel-meta">
                        Earlier · {conflict.conflictsWith.meeting} · {fmtDate(conflict.conflictsWith.date)}
                      </span>
                      <p className="panel-text">{conflict.conflictsWith.decision}</p>
                      {conflict.conflictsWith.rationale && (
                        <span style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>
                          Rationale: {conflict.conflictsWith.rationale}
                        </span>
                      )}
                    </div>

                    <div className="comparison-arrow">➔</div>

                    <div className="comparison-panel now">
                      <span className="panel-meta now-meta">Now · {meetingName}</span>
                      <p className="panel-text">{conflict.newDecision}</p>
                    </div>
                  </div>

                  {/* Why this matters & Suggested next step */}
                  <div className="conflict-insight-block">
                    <div className="insight-section">
                      <span className="insight-label">Why this matters</span>
                      <p className="insight-content">{conflict.reasoning}</p>
                    </div>
                    {conflict.suggestedResolution && (
                      <div className="insight-section">
                        <span className="insight-label">Suggested next step</span>
                        <p className="insight-content">{conflict.suggestedResolution}</p>
                      </div>
                    )}
                  </div>

                  {/* Potential Impact */}
                  {matchedImpact && (
                    <div className="impact-summary-box">
                      <span className="impact-header-line">⚠️ Potential Impact Assessment</span>

                      {matchedImpact.affectedSystems?.length > 0 && (
                        <div>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", fontWeight: 600 }}>
                            Affected Systems:
                          </span>
                          <div className="systems-tag-list" style={{ marginTop: "0.25rem" }}>
                            {matchedImpact.affectedSystems.map((sys, sIdx) => (
                              <span key={sIdx} className="system-tag">
                                {sys}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {matchedImpact.potentialConsequences?.length > 0 && (
                        <ul className="consequences-list">
                          {matchedImpact.potentialConsequences.map((c, cIdx) => (
                            <li key={cIdx}>{c}</li>
                          ))}
                        </ul>
                      )}

                      {matchedImpact.affectedTasks?.length > 0 && (
                        <div>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", fontWeight: 600 }}>
                            Existing tasks that may need review (created earlier, not tracked as done):
                          </span>
                          <div className="affected-tasks-table-wrapper">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Task</th>
                                  <th>Owner</th>
                                  <th>Due Date</th>
                                  <th>Meeting</th>
                                </tr>
                              </thead>
                              <tbody>
                                {matchedImpact.affectedTasks.map((at) => (
                                  <tr key={at.id}>
                                    <td>{at.task}</td>
                                    <td>{at.owner || "Unassigned"}</td>
                                    <td>
                                      <span className="pill pill-neutral">{at.deadline || "None"}</span>
                                    </td>
                                    <td>{at.meeting || "Earlier"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Conflict Choice Action Buttons: nothing defaults, the user decides */}
                <div className="resolution-dock">
                  {!currentChoice && (
                    <p className="resolution-hint">
                      <span>⚠️</span> Choose how to handle this before the tasks can be created.
                    </p>
                  )}
                  <div className="resolution-buttons">
                    <button
                      type="button"
                      className={`btn-choice ${currentChoice === "replace" ? "selected" : ""}`}
                      onClick={() => handleSelectResolution(idx, "replace")}
                    >
                      {currentChoice === "replace" ? "✓ " : ""}Replace earlier decision
                    </button>
                    <button
                      type="button"
                      className={`btn-choice ${currentChoice === "keep_both" ? "selected" : ""}`}
                      onClick={() => handleSelectResolution(idx, "keep_both")}
                    >
                      {currentChoice === "keep_both" ? "✓ " : ""}Keep both
                    </button>
                    <button
                      type="button"
                      className={`btn-choice ${currentChoice === "needs_clarification" ? "selected" : ""}`}
                      onClick={() => handleSelectResolution(idx, "needs_clarification")}
                    >
                      {currentChoice === "needs_clarification" ? "✓ " : ""}Needs clarification
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Impact Cards for decisions with impact but no conflict */}
          {impactList
            .filter((imp) => !conflicts.some((c) => c.newDecision === imp.decision))
            .map((imp, idx) => (
              <div key={idx} className="ui-card" style={{ borderLeft: "4px solid var(--info-primary)" }}>
                <div className="ui-card-header">
                  <div>
                    <span className="pill pill-info" style={{ marginBottom: "0.25rem" }}>
                      Potential Impact
                    </span>
                    <h3 className="ui-card-title">{imp.decision}</h3>
                  </div>
                </div>
                {imp.affectedSystems?.length > 0 && (
                  <div className="systems-tag-list" style={{ marginBottom: "0.5rem" }}>
                    {imp.affectedSystems.map((s, sIdx) => (
                      <span key={sIdx} className="system-tag">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <ul className="consequences-list">
                  {imp.potentialConsequences?.map((c, cIdx) => (
                    <li key={cIdx}>{c}</li>
                  ))}
                </ul>
                {imp.affectedTasks?.length > 0 && (
                  <ul className="consequences-list" style={{ marginTop: "0.5rem" }}>
                    {imp.affectedTasks.map((t) => (
                      <li key={t.id}>
                        <strong>{t.task}</strong> — {t.owner || "Unassigned"}, due {t.deadline || "no date"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

          {/* Under Review Notice Banner */}
          {Object.values(resolutions).includes("needs_clarification") && (
            <div className="under-review-banner">
              <div>
                <strong>A decision is left under review</strong>
                <p style={{ fontSize: "0.8125rem", marginTop: "0.25rem" }}>
                  Tasks can still be created, but the decision stays unresolved and nothing here treats it as settled.
                </p>
              </div>
              {acknowledgedReview ? (
                <span style={{ fontSize: "0.8125rem", fontStyle: "italic" }}>Proceeding… (recorded)</span>
              ) : (
                <button type="button" className="btn-secondary" disabled={isProceeding} onClick={handleProceedAnyway}>
                  Proceed anyway
                </button>
              )}
            </div>
          )}

          {/* Extracted Decisions List */}
          <div className="ui-card">
            <h3 className="ui-card-title" style={{ marginBottom: "1rem" }}>
              Extracted Decisions ({decisions.length})
            </h3>
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Decision</th>
                    <th>Topic</th>
                    <th>Evidence Quote</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((dec, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 600 }}>{dec.text}</td>
                      <td>
                        <span className="pill pill-neutral">{dec.topic || "General"}</span>
                      </td>
                      <td>
                        {dec.evidence?.quote ? <Quote evidence={dec.evidence} /> : null}
                        {!dec.evidenceVerified && (
                          <div className="evidence-warning">
                            <span>⚠️ Evidence not verified ({ISSUE_TEXT[dec.evidenceIssue ?? "missing"]})</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {decisions.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ color: "var(--text-tertiary)" }}>
                        No decisions found in this meeting.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Extracted Action Items Table */}
          <div className="ui-card">
            <h3 className="ui-card-title" style={{ marginBottom: "1rem" }}>
              Action Items & Accountability ({actionItems.length})
            </h3>
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: "3rem" }}>#</th>
                    <th>Task & Evidence</th>
                    <th>Owner</th>
                    <th>Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {actionItems.map((item, idx) => {
                    const isAccepted = evidenceAccepted.some(
                      (ea) => ea.task.trim().toLowerCase() === item.task.trim().toLowerCase(),
                    );
                    const missingOwner = !item.owner || item.ownership === "unclear";

                    return (
                      <tr key={idx}>
                        <td style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>{idx + 1}</td>
                        <td>
                          <div className="task-title">{item.task}</div>
                          <Quote evidence={item.evidence} />

                          {!item.evidenceVerified && !isAccepted && (
                            <div className="evidence-warning">
                              <span>⚠️ Evidence not verified ({ISSUE_TEXT[item.evidenceIssue ?? "missing"]})</span>
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ padding: "0.2rem 0.5rem", fontSize: "0.6875rem" }}
                                onClick={() => handleAcceptEvidence(idx)}
                              >
                                Accept without evidence
                              </button>
                            </div>
                          )}

                          {!item.evidenceVerified && isAccepted && (
                            <div style={{ fontSize: "0.6875rem", color: "var(--text-tertiary)", marginTop: "0.25rem" }}>
                              accepted without verified evidence (recorded)
                            </div>
                          )}
                        </td>
                        <td>
                          {missingOwner ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
                              <span style={{ color: item.owner ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: item.owner ? 600 : 400 }}>
                                {item.owner ?? "Unassigned"}
                              </span>
                              <span className="pill pill-danger">needs owner</span>
                            </div>
                          ) : (
                            <span style={{ fontWeight: 600 }}>{item.owner}</span>
                          )}
                        </td>
                        <td>
                          {item.deadline ? (
                            <span className="pill pill-neutral">{item.deadline}</span>
                          ) : (
                            <span style={{ color: "var(--text-tertiary)" }}>No date</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Voice & Assistant Interaction Dock */}
          <div className="voice-dock">
            <div className="assistant-speech-bubble">
              <span className="assistant-avatar">🤖</span>
              <div className="assistant-text">
                <strong>Assistant:</strong> {lastReply}
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => speak(lastReply)}
                title="Replay Voice Summary"
                style={{ padding: "0.375rem 0.625rem", fontSize: "0.75rem" }}
              >
                🔊 Replay
              </button>
            </div>

            <form onSubmit={handleSendUtterance} className="voice-input-row">
              <input
                className="voice-input"
                type="text"
                placeholder="Type or dictate (e.g. “confirm”, “replace the earlier decision”, “change the second deadline to Friday”)"
                value={utteranceInput}
                onChange={(e) => setUtteranceInput(e.target.value)}
                disabled={isBusy}
                autoComplete="off"
              />
              <button type="submit" className="btn-primary" disabled={isBusy || !utteranceInput}>
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* PHASE 3: DONE */}
      {phase === "done" && (
        <div className="ui-card">
          <div style={{ marginBottom: "1.5rem" }}>
            <span
              className={`pill ${taskSummary.failed === 0 ? "pill-success" : "pill-warning"}`}
              style={{ fontSize: "0.8125rem", padding: "0.25rem 0.75rem", marginBottom: "0.5rem" }}
            >
              {taskSummary.failed === 0 ? "✓ Complete" : "⚠️ Attention Required"}
            </span>
            <h2 className="ui-card-title" style={{ fontSize: "1.5rem", marginTop: "0.5rem" }}>
              {taskSummary.created} of {taskSummary.total} tasks created
            </h2>
            <p style={{ color: "var(--text-tertiary)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
              {trelloConfigured
                ? "Cards were created on your Trello board."
                : "Trello is not configured, so tasks were saved locally only."}
            </p>
          </div>

          <div className="data-table-container" style={{ marginBottom: "1.5rem" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Owner</th>
                  <th>Deadline</th>
                  <th>Trello</th>
                </tr>
              </thead>
              <tbody>
                {createdTasks.map((t, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600 }}>{t.task}</td>
                    <td>{t.owner || "Unassigned"}</td>
                    <td>{t.deadline ? <span className="pill pill-neutral">{t.deadline}</span> : "—"}</td>
                    <td>
                      {t.status === "created" ? (
                        t.trelloUrl ? (
                          <a
                            href={t.trelloUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pill pill-success"
                            style={{ textDecoration: "underline" }}
                          >
                            card ↗
                          </a>
                        ) : (
                          <span className="pill pill-success">created</span>
                        )
                      ) : (
                        <span className="pill pill-danger">failed: {t.error || "Execution error"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            {taskSummary.failed > 0 && (
              <button type="button" className="btn-primary" onClick={handleExecuteTasks} disabled={isBusy}>
                {isBusy ? "Retrying…" : `Retry ${taskSummary.failed} failed`}
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                resetReviewState();
                setTranscript("");
                setMeetingName("");
                setMeetingDate("");
                setPhase("input");
              }}
            >
              New meeting
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
