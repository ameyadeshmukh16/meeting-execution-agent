import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ActionItem } from "./confirm";
import { dataPath } from "./paths";

export type StoredItem = ActionItem & {
  id: string;
  meeting: string;
  meetingDate: string;
  trelloUrl?: string;
  /** `approvalId:index`, the idempotency key for this item. Absent on records from before approvals. */
  key?: string;
  /** Absent on older records, which were all created. */
  status?: "created" | "failed" | "pending";
  error?: string;
};

const FILE = dataPath("items.json");

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
