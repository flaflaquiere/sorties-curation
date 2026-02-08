import { NextResponse } from "next/server";
import OpenAI from "openai";
import { setWeekly } from "@/lib/store";

type SourceLink = { label: string; url: string };

type Candidate = {
  artistName: string;
  albumName: string;
  signals: string[];
  sourceLinks: SourceLink[];
  score: number;
};

type WeeklyItem = {
  rank: number;
  artistName: string;
  albumName: string;
  signals: string[];
  artistSummary: string;
  editorialReview: string;
  links: { youtubeMusic: string; soundcloud: string };
  sourceLinks: SourceLink[];
};

type WeeklyPayload = { weekId: string; items: WeeklyItem[] };

// -------------------- helpers --------------------
function computeWeekId(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(weekNo).padStart(2, "0")}`;
}

function safeString(x: unknown) {
  return typeof x === "string" ? x.trim() : "";
}

function uniq(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return Array.from(new Set(arr.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)));
}

function ytMusicSearchUrl(artist: string, album: string) {
  const q = encodeURIComponent([artist, album].filter(Boolean).join(" ").trim());
  return `https://music.youtube.com/search?q=${q}`;
}
function scSearchUrl(artist: string, album: string) {
  const q = encodeURIComponent([artist, album].filter(Boolean).join(" ").trim());
  return `https://soundcloud.com/search?q=${q}`;
}

async function readCronKeyFromRequest(req: Request) {
  const h = req.headers.get("x-cron-key");
  if (h) return h;

  const url = new URL(req.url);
  const q = url.searchParams.get("key");
  if (q) return q;

  try {
    const body = await req.clone().json();
    if (body?.key && typeof body.key === "string") return body.key;
  } catch {}

  return "";
}

function authorized(provided: string) {
  const expected = process.env.CRON_KEY || "";
  if (!expected) return true; // si pas défini, on n’empêche pas
  return provided === expected;
}

// -------------------- pitchfork scraping --------------------
// On récupère des URLs de reviews depuis deux pages.
async function fetchPitchforkUrls(): Promise<Array<{ url: string; signal: string }>> {
  const sources = [
    { url: "https://pitchfork.com/best/new-music/", signal: "Pitchfork Best New Music" },
    { url: "https://pitchfork.com/reviews/albums/", signal: "Pitchfork Review" },
  ];

  const out: Array<{ url: string; signal: string }> = [];

  for (const s of sources) {
    const res = await fetch(s.url, {
      // éviter cache agressif
      cache: "no-store",
      headers: { "user-agent": "Mozilla/5.0" },
    });
    if (!res.ok) continue;
    const html = await res.text();

    // On capte des liens /reviews/albums/xxx/
    const re = /href="(\/reviews\/albums\/[^"]+?)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const path = m[1];
      const full = `https://pitchfork.com${path}`;
      out.push({ url: full, signal: s.signal });
    }
  }

  // uniq par URL (garde signal le plus “fort” si doublon)
  const map = new Map<string, string>();
  for (const x of out) {
    if (!map.has(x.url)) map.set(x.url, x.signal);
    // si doublon, on combine
    else map.set(x.url, `${map.get(x.url)} + ${x.signal}`);
  }

  return Array.from(map.entries()).map(([url, signal]) => ({ url, signal }));
}

// Extrait "Artist — Album" depuis la page Pitchfork.
// Pitchfork met souvent un JSON-LD "MusicAlbum".
async function fetchPitchforkMeta(reviewUrl: string): Promise<{ artistName: string; albumName: string } | null> {
  const res = await fetch(reviewUrl, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const html = await res.text();

  // 1) JSON-LD
  const jsonldMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (jsonldMatch) {
    try {
      const raw = jsonldMatch[1].trim();
      const obj = JSON.parse(raw);

      // parfois c’est un tableau
      const items = Array.isArray(obj) ? obj : [obj];
      for (const it of items) {
        if (it && it["@type"] === "MusicAlbum") {
          const albumName = safeString(it.name);
          const byArtist = it.byArtist;
          let artistName = "";
          if (typeof byArtist === "string") artistName = byArtist;
          else if (byArtist && typeof byArtist === "object") artistName = safeString(byArtist.name);
          if (artistName && albumName) return { artistName, albumName };
        }
      }
    } catch {
      // ignore
    }
  }

  // 2) fallback: souvent un <title> "Artist: Album"
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  if (titleMatch) {
    const t = titleMatch[1].replace(/\s+\|\s+Pitchfork.*$/i, "").trim();
    // formes courantes: "Artist: Album", "Artist Album Review"
    const colon = t.split(":");
    if (colon.length >= 2) {
      const artistName = colon[0].trim();
      const albumName = colon.slice(1).join(":").trim();
      if (artistName && albumName) return { artistName, albumName };
    }
  }

  return null;
}

// -------------------- OpenAI enrich (1 call) --------------------
async function openaiEnrichBatch(items: Array<{ rank: number; artistName: string; albumName: string; signals: string[] }>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return items.map((it) => ({ rank: it.rank, artistSummary: "", editorialReview: "" }));
  }

  const client = new OpenAI({ apiKey });

  const input = [
    {
      role: "system" as const,
      content:
        "Tu es un éditeur musique. Pour chaque album, écris (en français) : " +
        "1) un résumé artiste 2-3 phrases (contexte + style), " +
        "2) un avis éditorial 2-3 phrases (à quoi s’attendre). " +
        "Ne cite pas de sources. Réponds en JSON strict { items: [...] }.",
    },
    {
      role: "user" as const,
      content: JSON.stringify({ items }),
    },
  ];

  try {
    const resp = await client.responses.create({
      model: "gpt-5-mini",
      input,
      text: { format: { type: "json_object" } },
    });

    const parsed = JSON.parse(resp.output_text || "{}");
    const arr = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(arr)) return items.map((it) => ({ rank: it.rank, artistSummary: "", editorialReview: "" }));

    return arr.map((x: any) => ({
      rank: Number(x.rank),
      artistSummary: safeString(x.artistSummary),
      editorialReview: safeString(x.editorialReview),
    }));
  } catch {
    // si 429 / quota, on renvoie vide sans casser le site
    return items.map((it) => ({ rank: it.rank, artistSummary: "", editorialReview: "" }));
  }
}

// -------------------- POST handler --------------------
export async function POST(req: Request) {
  const key = await readCronKeyFromRequest(req);
  if (!authorized(key)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 1) urls pitchfork
  const urls = await fetchPitchforkUrls();

  // 2) metas
  const candidates: Candidate[] = [];
  for (const u of urls.slice(0, 60)) {
    const meta = await fetchPitchforkMeta(u.url);
    if (!meta) continue;

    // Score simple : Best New Music > Review
    const score = u.signal.includes("Best New Music") ? 100 : 60;

    candidates.push({
      artistName: meta.artistName,
      albumName: meta.albumName,
      signals: uniq(u.signal.split("+").map((s) => s.trim())),
      sourceLinks: [{ label: "Pitchfork", url: u.url }],
      score,
    });
  }

  // 3) Top 20
  const top = candidates
    .filter((c) => c.artistName && c.albumName)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const baseItems = top.map((c, idx) => ({
    rank: idx + 1,
    artistName: c.artistName,
    albumName: c.albumName,
    signals: c.signals,
    sourceLinks: c.sourceLinks,
  }));

  // 4) Enrich OpenAI (1 call)
  const enriched = await openaiEnrichBatch(
    baseItems.map((it) => ({ rank: it.rank, artistName: it.artistName, albumName: it.albumName, signals: it.signals }))
  );

  // 5) Merge final
  const finalItems: WeeklyItem[] = baseItems.map((it) => {
    const e = enriched.find((x) => x.rank === it.rank);
    return {
      rank: it.rank,
      artistName: it.artistName,
      albumName: it.albumName,
      signals: it.signals,
      artistSummary: safeString(e?.artistSummary),
      editorialReview: safeString(e?.editorialReview),
      links: {
        youtubeMusic: ytMusicSearchUrl(it.artistName, it.albumName),
        soundcloud: scSearchUrl(it.artistName, it.albumName),
      },
      sourceLinks: it.sourceLinks,
    };
  });

  const weekly: WeeklyPayload = { weekId: computeWeekId(), items: finalItems };

  await setWeekly(weekly);

  return NextResponse.json({ ok: true, weekId: weekly.weekId, count: weekly.items.length });
}
