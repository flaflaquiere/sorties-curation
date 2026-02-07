import { getWeekly } from "../../../../lib/store";

export async function GET() {
  const data = await getWeekly();
  if (data) return Response.json(data);
  return Response.json({ weekId: "non-généré", items: [] });
}
