import type { ActionItem } from "./confirm";

export function trelloConfigured() {
  return Boolean(process.env.TRELLO_KEY && process.env.TRELLO_TOKEN && process.env.TRELLO_LIST_ID);
}

export type CreatedCard = { id: string; url: string };

const refMarker = (ref: string) => `[ref:${ref}]`;

export async function createCard(item: ActionItem, meeting: string, ref: string): Promise<CreatedCard> {
  const params = new URLSearchParams({
    key: process.env.TRELLO_KEY!,
    token: process.env.TRELLO_TOKEN!,
    idList: process.env.TRELLO_LIST_ID!,
    name: `${item.task} (${item.owner ?? "Unassigned"})`,
    desc: `Owner: ${item.owner ?? "Unassigned"}\nSource: ${meeting}${item.deadlineText ? `\nSaid in meeting: "${item.deadlineText}"` : ""}\n${refMarker(ref)}`,
  });
  if (item.deadline) params.set("due", `${item.deadline}T17:00:00.000Z`);

  const res = await fetch("https://api.trello.com/1/cards", { method: "POST", body: params });
  if (!res.ok) throw new Error(`Trello ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const card = await res.json();
  return { id: card.id, url: card.shortUrl ?? card.url };
}

/** Cards on the target list, used on retry to detect a card that was created but whose response was lost. */
export async function listCards(): Promise<{ desc: string; shortUrl: string }[]> {
  const url = `https://api.trello.com/1/lists/${process.env.TRELLO_LIST_ID}/cards?fields=desc,shortUrl&key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Trello ${res.status}`);
  return res.json();
}

/** Archives (closes) a card by its short URL. Used by the demo reset for cards this app created. */
export async function archiveCard(shortUrl: string): Promise<void> {
  const id = shortUrl.split("/c/")[1]?.split("/")[0];
  if (!id) throw new Error("Not a Trello card URL");
  const res = await fetch(
    `https://api.trello.com/1/cards/${id}?closed=true&key=${process.env.TRELLO_KEY}&token=${process.env.TRELLO_TOKEN}`,
    { method: "PUT" },
  );
  if (!res.ok) throw new Error(`Trello ${res.status}`);
}

export const hasRef = (card: { desc: string }, ref: string) => card.desc.includes(refMarker(ref));
