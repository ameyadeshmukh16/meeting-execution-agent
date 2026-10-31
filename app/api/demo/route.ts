import { readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED = ["meeting1", "meeting2", "meeting3"];

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!ALLOWED.includes(name)) return Response.json({ error: "unknown demo" }, { status: 404 });
  const text = await readFile(path.join(process.cwd(), "data", "demo", `${name}.txt`), "utf8");
  return Response.json({ transcript: text });
}
