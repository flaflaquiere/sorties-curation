// app/api/refresh/route.ts
import { setWeekly } from "../../../../lib/store";

type SourceLink = { label: string; url: string };

function weekIdUTC(d = new Date()) {
  // ISO week (UTC)
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const yy = date.getUTCFullYear();
  const ww = String(weekNo).padStart(2, "0");
  return `${yy}-${ww}`;
}

function ytmusicSearchUrl(artist: string, album: string) {
  const q = encodeURIComponent(`${artist} ${album}`);
  return `https://music.youtube.com/search?q=${q}`;
}

function soundcloudSearchUrl(artist: string, album: string) {
  const q = encodeURIComponent(`${artist} ${album}`);
  return `https://soundcloud.com/search?q=${q}`;
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    // un user-agent aide parfois
    headers: { "user-agent": "Mozilla/5.0 sorties-curation-bot" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function extractOgTitle(html: string) {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i);
  return m?.[1]?.trim() || null;
}

function parsePitchforkOgTitle(ogTitle: string) {
  // Exemple: "Ratboys: Singin' to an Empty Chair Album Review | Pitchfork"
  // ou: "Rosalía: LUX Album Review | Pitchfork"
  const beforePipe = ogTitle.split("|")[0].trim();
  const m = beforePipe.match(/^(.+?):\s+(.+?)\s+Album Review/i);
  if (m) return { artistName: m[1].trim(), albumName: m[2].trim() };

  // fallback: parfois "Artist: Album" sans "Album Review"
  const parts = beforePipe.split(":");
  if (parts.length >= 2) {
    const artistName = parts[0].trim();
    const albumName = parts.slice(1).join(":").trim();
    if (artistName && albumName) return { artistName, albumName };
  }
  return null;
}

async function getPitchforkCandidates(): Promise<{ artistName: string; albumName: string; sourceLinks: SourceLink[]; signals: string[] }[]> {
  const out: { artistName: string; albumName: string; sourceLinks: SourceLink[]; signals: string[] }[] = [];

  // Pages sources (tu peux en ajouter après)
  const sources: { label: string; url: string; signal: string }[] = [
    { label: "Pitchfork Reviews", url: "https://pitchfork.com/reviews/albums/", signal: "Pitchfork Review" },
    { label: "Pitchfork Best New Music", url: "https://pitchfork.com/reviews/best/albums/", signal: "Pitchfork Best New" },
  ];

  for (const s of sources) {
    let html: string;
    try {
      html = await fetchText(s.url);
    } catch (e) {
      console.error("Source fetch failed:", s.url, e);
      continue;
    }

    // Extrait des liens d'albums: /reviews/albums/slug/
    const urls = new Set<string>();
    const re = /href=["'](\/reviews\/albums\/[^"']+\/)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const path = m[1];
      urls.add(`https://pitchfork.com${path}`);
      if (urls.size >= 40) break; // limite
    }

    for (const u of urls) {
      try {
        const page = await fetchText(u);
        const og = extractOgTitle(page);
        if (!og) continue;
        const parsed = parsePitchforkOgTitle(og);
        if (!parsed) continue;

        out.push({
          artistName: parsed.artistName,
          albumName: parsed.albumName,
          sourceLinks: [{ label: s.label, url: u }],
          signals: [s.signal],
        });
      } catch (e) {
        console.error("Album page parse failed:", u, e);
      }
    }
  }

  // Dé-doublonnage par artist+album
  const byKey = new Map<string, { artistName: string; albumName: string; sourceLinks: SourceLink[]; signals: string[] }>();
  for (const c of out) {
    const key = `${c.artistName.toLowerCase()}|||${c.albumName.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, c);
    else {
      // merge signals + links
      prev.signals = Array.from(new Set([...prev.signals, ...c.signals]));
      prev.sourceLinks = [...prev.sourceLinks, ...c.sourceLinks];
    }
  }

  return Array.from(byKey.values());
}

async function openaiGenerate(artistName: string, albumName: string, signals: string[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { artistSummary: "", editorialReview: "" };

  // IMPORTANT: pour éviter les 429, on fait un prompt court et 1 appel par item.
  const prompt = [
    `Tu es un curator musique.`,
    `Donne 2 blocs en français :`,
    `1) "Résumé artiste" (1-2 phrases factuelles, style neutre, pas de blabla).`,
    `2) "Avis éditorial" (2-3 phrases : à quoi s'attendre sur cet album, influences, ambiance).`,
    `Contexte: ${signals.join(", ")}`,
    `Artiste: ${artistName}`,
    `Album: ${albumName}`,
    `Réponds en JSON strict: {"artistSummary":"...","editorialReview":"..."}`,
  ].join("\n");

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  // retries simples en cas de 429
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        temperature: 0.6,
      }),
    });

    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 800 * attempt));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("OpenAI error:", res.status, errText);
      return { artistSummary: "", editorialReview: "" };
    }

    const json = await res.json();
    // La sortie "responses" peut varier, on extrait du texte puis JSON.parse
    const text =
      json?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")?.text ??
      json?.output_text ??
      "";

    try {
      const parsed = JSON.parse(text);
      return {
        artistSummary: String(parsed.artistSummary || ""),
        editorialReview: String(parsed.editorialReview || ""),
      };
    } catch {
      // fallback si pas du JSON strict
      return { artistSummary: "", editorialReview: "" };
    }
  }

  return { artistSummary: "", editorialReview: "" };
}

function getCronKeyFromRequest(req: Request) {
  const h = req.headers.get("x-cron-key") || "";
  if (h) return h.trim();

  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  const url = new URL(req.url);
  const q = url.searchParams.get("key");
  if (q) return q.trim();

  return "";
}

export async function POST(req: Request) {
  const expected = process.env.CRON_KEY || "";
  const providedHeaderOrQuery = getCronKeyFromRequest(req);

  // si admin envoie dans le body { key }, on le lit aussi
  let bodyKey = "";
  try {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = await req.json();
      if (b?.key) bodyKey = String(b.key).trim();
    }
  } catch {
    // ignore
  }

  const provided = providedHeaderOrQuery || bodyKey;

  if (expected && provided !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const candidates = await getPitchforkCandidates();

  // scoring simple: +1 par signal (tu pourras enrichir après)
  const ranked = candidates
    .map((c) => ({ ...c, score: c.signals.length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const items: any[] = [];
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const gen = await openaiGenerate(r.artistName, r.albumName, r.signals);

    items.push({
      rank: i + 1,
      artistName: r.artistName,
      albumName: r.albumName,
      signals: r.signals,
      artistSummary: gen.artistSummary,
      editorialReview: gen.editorialReview,
      links: {
        youtubeMusic: ytmusicSearchUrl(r.artistName, r.albumName),
        soundcloud: soundcloudSearchUrl(r.artistName, r.albumName),
      },
      sourceLinks: (r.sourceLinks || []).slice(0, 3),
    });
  }

  const weekly = { weekId: weekIdUTC(), items };
  await setWeekly(weekly);

  return Response.json({ ok: true, weekId: weekly.weekId, count: items.length });
}
