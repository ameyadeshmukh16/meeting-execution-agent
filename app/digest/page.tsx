"use client";

import React, { useEffect, useState } from "react";
import { fmtDate, speak } from "@/lib/dates";

interface TaskItem {
  id: string;
  task: string;
  owner?: string | null;
  deadline?: string | null;
  meeting?: string;
  trelloUrl?: string;
  status?: string;
}

const UNASSIGNED = "Unassigned";
const personOf = (t: TaskItem) => t.owner ?? UNASSIGNED;

export default function DigestPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tasks")
      .then((res) => res.json())
      .then((data) => {
        const items: TaskItem[] = data.items || [];
        setTasks(items);
        const people = Array.from(new Set(items.map(personOf))).sort();
        if (people.length > 0) setSelectedPerson(people[0]);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const peopleList = Array.from(new Set(tasks.map(personOf))).sort();
  const personTasks = tasks
    .filter((t) => personOf(t) === selectedPerson)
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));

  const readDigestAloud = () => {
    const text =
      personTasks.length > 0
        ? `${selectedPerson} has ${personTasks.length} task${personTasks.length === 1 ? "" : "s"}. ${personTasks
            .map((t, idx) => `${idx + 1}. ${t.task}, due ${fmtDate(t.deadline ?? null)}.`)
            .join(" ")}`
        : `No current tasks for ${selectedPerson}.`;
    speak(text);
  };

  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          Per-person Digest
        </h1>
        <p style={{ color: "var(--text-tertiary)", marginTop: "0.25rem" }}>
          Each person&apos;s tasks from every confirmed meeting, on demand.
        </p>
      </div>

      {isLoading ? (
        <div style={{ padding: "3rem 0", textAlign: "center", color: "var(--text-tertiary)" }}>
          Loading task digests…
        </div>
      ) : peopleList.length === 0 ? (
        <div className="ui-card" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
          <p style={{ color: "var(--text-tertiary)" }}>
            No confirmed tasks yet. Confirm a meeting and its tasks will show up here.
          </p>
        </div>
      ) : (
        <div>
          {/* Person Selector Tabs */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
            {peopleList.map((person) => (
              <button
                key={person}
                type="button"
                className={`btn-choice ${selectedPerson === person ? "selected" : ""}`}
                style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
                onClick={() => setSelectedPerson(person)}
              >
                👤 {person}
              </button>
            ))}
          </div>

          <div className="ui-card">
            <div className="ui-card-header">
              <div>
                <h2 className="ui-card-title">{`${selectedPerson}'s digest`}</h2>
                <span style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>
                  {personTasks.length} {personTasks.length === 1 ? "task" : "tasks"}
                </span>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={readDigestAloud}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}
              >
                🔊 Read digest aloud
              </button>
            </div>

            {personTasks.length === 0 ? (
              <p style={{ color: "var(--text-tertiary)", fontStyle: "italic" }}>
                No tasks found for {selectedPerson}.
              </p>
            ) : (
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Due Date</th>
                      <th>Meeting</th>
                      <th>Trello</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personTasks.map((t) => (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 600 }}>{t.task}</td>
                        <td>
                          {t.deadline ? (
                            <span className="pill pill-neutral">{t.deadline}</span>
                          ) : (
                            <span style={{ color: "var(--text-tertiary)" }}>No date</span>
                          )}
                        </td>
                        <td>{t.meeting || "—"}</td>
                        <td>
                          {t.trelloUrl ? (
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
                            <span className="pill pill-neutral">Local only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
