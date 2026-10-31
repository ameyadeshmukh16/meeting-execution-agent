import type { ActionItem } from "./confirm";

export function trelloConfigured() {
  return Boolean(process.env.TRELLO_KEY && process.env.TRELLO_TOKEN && process.env.TRELLO_LIST_ID);
}

export type CreatedCard = { id: string; url: string };

export async function createCard(item: ActionItem, meeting: string): Promise<CreatedCard> {
  const params = new URLSearchParams({
    key: process.env.TRELLO_KEY!,
    token: process.env.TRELLO_TOKEN!,
    idList: process.env.TRELLO_LIST_ID!,
    name: `${item.task} (${item.owner})`,
    desc: `Owner: ${item.owner}\nSource: ${meeting}${item.deadlineText ? `\nSaid in meeting: "${item.deadlineText}"` : ""}`,
  });
  if (item.deadline) params.set("due", `${item.deadline}T17:00:00.000Z`);

  const res = await fetch("https://api.trello.com/1/cards", { method: "POST", body: params });
  if (!res.ok) throw new Error(`Trello ${res.status}: ${await res.text()}`);
  const card = await res.json();
  return { id: card.id, url: card.shortUrl ?? card.url };
}
