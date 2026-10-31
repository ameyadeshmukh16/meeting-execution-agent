"use client";

import React, { useEffect, useState } from "react";
import { todayIso } from "@/lib/dates";

interface DeadlineTask {
  id: string;
  task: string;
  owner?: string | null;
  deadline: string | null;
  meeting?: string;
}

export default function DeadlinesPage() {
  const [tasks, setTasks] = useState<DeadlineTask[]>([]);
  const [asOfDate, setAsOfDate] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tasks")
      .then((res) => res.json())
      .then((data) => {
        setTasks(data.items || []);
        // Read the clock after mount so prerendering never bakes in a stale "today".
        setAsOfDate(todayIso());
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const getDayDiff = (targetDateStr: string, baseDateStr: string) => {
    const target = new Date(targetDateStr);
    const base = new Date(baseDateStr);
    const diffTime = target.getTime() - base.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getDeadlineStatus = (deadline: string | null, baseDate: string) => {
    if (!deadline) {
      return { label: "No Date", pillClass: "pill-neutral", notifyText: "unscheduled" };
    }
    const days = getDayDiff(deadline, baseDate);
    if (days < 0) {
      return { label: "Overdue", pillClass: "pill-danger", notifyText: "daily until done (overdue)" };
    }
    if (days === 0) {
      return { label: "Due today", pillClass: "pill-warning", notifyText: "today" };
    }
    if (days === 1) {
      return { label: "Due tomorrow", pillClass: "pill-warning", notifyText: "now (1 day before)" };
    }
    return { label: `Due in ${days} days`, pillClass: "pill-info", notifyText: `1 day before the deadline` };
  };

  // Sort by deadline date
  const sortedTasks = [...tasks].sort((a, b) => {
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "1rem", marginBottom: "2rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
            Deadlines & Reminders
          </h1>
          <p style={{ color: "var(--text-tertiary)", marginTop: "0.25rem" }}>
            Task urgency and the reminders that would be sent, relative to the date you choose.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label htmlFor="asOfDate" style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-secondary)" }}>
            Viewing as of:
          </label>
          <input
            id="asOfDate"
            type="date"
            className="form-input"
            style={{ width: "auto" }}
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
        </div>
      </div>

      <div className="ui-card">
        {isLoading || !asOfDate ? (
          <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--text-tertiary)" }}>
            Loading…
          </div>
        ) : sortedTasks.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", textAlign: "center", padding: "2rem 0" }}>
            No scheduled action items found.
          </p>
        ) : (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Task</th>
                  <th>Owner</th>
                  <th>Due Date</th>
                  <th>Reminder (simulated)</th>
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map((t) => {
                  const status = getDeadlineStatus(t.deadline, asOfDate);
                  return (
                    <tr key={t.id}>
                      <td>
                        <span className={`pill ${status.pillClass}`}>{status.label}</span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{t.task}</td>
                      <td>{t.owner || "Unassigned"}</td>
                      <td>
                        {t.deadline ? (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>{t.deadline}</span>
                        ) : (
                          <span style={{ color: "var(--text-tertiary)" }}>—</span>
                        )}
                      </td>
                      <td style={{ color: "var(--text-tertiary)", fontSize: "0.8125rem" }}>
                        would notify {t.owner ?? "the team"} {status.notifyText}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid var(--border-default)", fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
          Reminders are shown as UI state only. No email, SMS or webhook is sent.
        </div>
      </div>
    </div>
  );
}
