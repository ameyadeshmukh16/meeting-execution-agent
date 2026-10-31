"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtDate, speak } from "@/lib/dates";

type Item = { id: string; task: string; owner: string; deadline: string | null; meeting: string; trelloUrl?: string };

export default function DigestPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [person, setPerson] = useState<string>("");

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((j) => setItems(j.items));
  }, []);

  const people = useMemo(() => [...new Set((items ?? []).map((i) => i.owner))].sort(), [items]);
  const selected = person || people[0] || "";
  const mine = useMemo(
    () => (items ?? []).filter((i) => i.owner === selected).sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")),
    [items, selected],
  );

  const digestText = `${selected} has ${mine.length} task${mine.length === 1 ? "" : "s"}. ${mine
    .map((t, i) => `${i + 1}. ${t.task}, due ${fmtDate(t.deadline)}.`)
    .join(" ")}`;

  if (items === null) return <p className="muted">Loading…</p>;
  if (items.length === 0)
    return (
      <section className="card">
        <p className="muted">No confirmed tasks yet. Confirm a meeting on the Meeting page and they will show up here.</p>
      </section>
    );

  return (
    <>
      <div className="row tabs">
        {people.map((p) => (
          <button key={p} className={p === selected ? "" : "ghost"} onClick={() => setPerson(p)}>
            {p}
          </button>
        ))}
      </div>
      <section className="card">
        <h2>
          {selected}’s digest · {mine.length} open
        </h2>
        <table>
          <tbody>
            {mine.map((t) => (
              <tr key={t.id}>
                <td>{t.task}</td>
                <td>{fmtDate(t.deadline)}</td>
                <td className="muted">{t.meeting}</td>
                <td>{t.trelloUrl && <a href={t.trelloUrl} target="_blank">card</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="ghost" onClick={() => speak(digestText)}>
            🔊 Read digest aloud
          </button>
        </div>
      </section>
    </>
  );
}
