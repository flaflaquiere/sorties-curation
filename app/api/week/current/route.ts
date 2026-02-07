let memory: any = null;

export async function GET() {
  if (memory) return Response.json(memory);
  return Response.json({ weekId: "non-généré", items: [] });
}

// (astuce) permet au refresh de stocker en mémoire
export function _setWeekly(data: any) {
  memory = data;
}
