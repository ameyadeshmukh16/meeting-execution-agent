import { interpretResponse } from "@/lib/confirm";

export async function POST(req: Request) {
  const { utterance, actionItems, meetingDate } = await req.json();
  if (!utterance || !Array.isArray(actionItems) || !meetingDate) {
    return Response.json({ error: "utterance, actionItems and meetingDate are required" }, { status: 400 });
  }
  try {
    return Response.json(await interpretResponse(utterance, actionItems, meetingDate));
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
