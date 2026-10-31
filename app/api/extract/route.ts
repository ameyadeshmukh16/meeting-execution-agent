import { extract } from "@/lib/extract";

export async function POST(req: Request) {
  const { transcript, meetingDate } = await req.json();
  if (!transcript || !meetingDate) {
    return Response.json({ error: "transcript and meetingDate are required" }, { status: 400 });
  }
  try {
    return Response.json(await extract(transcript, meetingDate));
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
