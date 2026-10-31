"use client";

import { useEffect, useState } from "react";
import { daysBetween, fmtDate, todayIso } from "@/lib/dates";

type Item = { id: string; task: string; owner: string | null; deadline: string | null; meeting: string };

/** Reminder rule (UI only, nothing is sent): notify 1 day before the deadline, again on the day, and daily once overdue. */
function reminder(deadline: string, asOf: string) {
  const d = daysBetween(asOf, deadline);
  if (d < 0) return { group: 0, label: `Overdue by ${-d} day${d === -1 ? "" : "s"}`, notify: "Would notify daily until done", cls: "overdue" };
  if (d === 0) return { group: 1, label: "Due today", notify: "Would notify now", cls: "soon" };
  if (d === 1) return { group: 1, label: "Due tomorrow", notify: "Would notify now (1 day before)", cls: "soon" };
  return { group: 2, label: `Due in ${d} days`, notify: `Would notify on ${fmtDate(new Date(Date.parse(`${deadline}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10))}`, cls: "" };
}

export default function DeadlinesPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [asOf, setAsOf] = useState("");

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((j) => {
        // Read the clock after mount so prerendering never bakes in a stale "today".
        setAsOf(todayIso());
        setItems(j.items);
      });
  }, []);

  if (items === null || !asOf) return <p className="muted">Loading…</p>;

  const dated = items
    .filter((i) => i.deadline)
    .map((i) => ({ ...i, r: reminder(i.deadline!, asOf) }))
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!));

  return (
    <>
      <div className="row">
        <label>
          Viewing as of (change to preview reminders on another day)
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
      </div>
      {dated.length === 0 ? (
        <section className="card">
          <p className="muted">No tasks with deadlines yet.</p>
        </section>
      ) : (
        <section className="card">
          <table>
            <tbody>
              {dated.map((t) => (
                <tr key={t.id}>
                  <td>
                    <span className={`pill ${t.r.cls}`}>{t.r.label}</span>
                  </td>
                  <td>{t.task}</td>
                  <td>{t.owner ?? "Unassigned"}</td>
                  <td>{fmtDate(t.deadline)}</td>
                  <td className="muted">🔔 {t.r.notify} {t.owner ?? "the team"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Reminders are shown as UI state only. No email or SMS is sent.</p>
        </section>
      )}
    </>
  );
}
