import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActionItem } from "./confirm";

export type StoredItem = ActionItem & {
  id: string;
  meeting: string;
  meetingDate: string;
  trelloUrl?: string;
};

const FILE = path.join(process.cwd(), "data", "items.json");

export async function loadItems(): Promise<StoredItem[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return [];
  }
}

export async function saveItems(items: StoredItem[]) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(items, null, 2));
}
