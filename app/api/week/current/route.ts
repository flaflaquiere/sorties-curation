// app/api/week/current/route.ts
import { getWeekly } from "../../../../lib/store";

export async function GET() {
  const data = await getWeekly();
  if (!data) return Response.json({ weekId: "non-généré", items: [] });
  return Response.json(data);
}
