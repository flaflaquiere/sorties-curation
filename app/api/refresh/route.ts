import Parser from "rss-parser";
import { getWeekly, setWeekly } from "../../../lib/store";

function weekId(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(weekNo).padStart(2, "0")}`;
}

function ytMusicSearchUrl(artist: string, album: string) {
  const q = encodeURIComponent(`${artist} ${album}`);
  return `https://music.youtube.com/search?q=${q}`;
}

function scSearchUrl(artist: string, album: string) {
  const q = encodeURIComponent(`${artist} ${album}`);
  return `https://soundcloud.com/search?q=${q}`;
}

function parseArtistAlbum(title: string) {
  const t = (title || "").replace(/\s+/g, " ").trim();
  const seps = [":", "–", "-", "—"];
  for (const sep of seps) {
    const idx = t.indexOf(sep);
    if (idx > 0 && idx < t.length - 1) {
      const artist = t.slice(0, idx).trim();
      const album = t.slice(idx + 1).trim();
      if (artist && album) return { artist, album };
    }
  }
  return { artist: "Je ne sais pas", album: t || "Je ne sais pas" };
}

async function openaiGenerate(artistName: string, albumName: string, signals: string[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      artistSummary: "Je ne sais pas (OPENAI_API_KEY non configurée).",
      editorialReview: "Je ne sais pas (OPENAI_API_KEY non configurée)."
    };
  }

  const prompt = `
Tu es un rédacteur musical.
Données fiables: artiste="${artistName}", album="${albumName}", signaux="${signals.join(" / ")}".
1) Résumé artiste (<= 600 caractères).
2) Avis éditorial album (<= 800 caractères).
Règle: ne pas inventer. Si info insuffisante, dire "Je ne sais pas" et rester général.
Retour JSON strict: {"artistSummary":"...","editorialReview":"..."}
`.trim();

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4.1-mini", input: prompt })
  });

  if (!res.ok) {
    return {
      artistSummary: `Je ne sais pas (OpenAI error ${res.status}).`,
      editorialReview: `Je ne sais pas (OpenAI error ${res.status}).`
    };
  }

  const json = await res.json();
  const text = json.output?.[0]?.content?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return {
      artistSummary: "Je ne sais pas (réponse OpenAI non exploitable).",
      editorialReview: "Je ne sais pas (réponse OpenAI non exploitable)."
    };
  }
}

export async function POST(req: Request) {
  const key = req.headers.get("x-cron-key");
  if (!process.env.CRON_KEY || key !== process.env.CRON_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parser = new Parser();

  // RSS Pitchfork (officiels)
  const pitchforkAlbumReviews = "https://pitchfork.com/feed/feed-album-reviews/rss";
  const pitchforkBestNewAlbums = "https://pitchfork.com/feed/reviews/best/albums/rss";

  const feeds = [
    { label: "Pitchfork Review", url: pitchforkAlbumReviews, weight: 6 },
    { label: "Pitchfork Best New", url: pitchforkBestNewAlbums, weight: 9 }
  ];

  // Collect candidates
  const candidates: Record<string, any> = {};

  for (const f of feeds) {
    try {
      const feed = await parser.parseURL(f.url);
      for (const it of (feed.items || []).slice(0, 50)) {
        const { artist, album } = parseArtistAlbum(it.title ?? "");
        const k = `${artist.toLowerCase()}|${album.toLowerCase()}`;
        const link = it.link ?? "";
        if (!candidates[k]) {
          candidates[k] = {
            artistName: artist,
            albumName: album,
            score: 0,
            signals: [],
            sourceLinks: []
          };
        }
        candidates[k].score += f.weight;
        candidates[k].signals.push(f.label);
        if (link) candidates[k].sourceLinks.push({ label: f.label, url: link });
      }
    } catch {
      // ignore feed errors
    }
  }

  // Rank top 20
  const ranked = Object.values(candidates)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 20);

  // Generate texts + links
  const items = [];
  for (let i = 0; i < ranked.length; i++) {
    const r: any = ranked[i];
   const uniqueSignals = Array.from(new Set((r.signals as string[]) || []));
    const signals = uniqueSignals.map(String);
   const { artistSummary, editorialReview } = await openaiGenerate(r.artistName, r.albumName, signals);

    items.push({
      rank: i + 1,
      artistName: r.artistName,
      albumName: r.albumName,
      signals: uniqueSignals,
      artistSummary,
      editorialReview,
      links: {
        youtubeMusic: ytMusicSearchUrl(r.artistName, r.albumName),
        soundcloud: scSearchUrl(r.artistName, r.albumName)
      },
      sourceLinks: (r.sourceLinks || []).slice(0, 3)
    });
  }
  const weekly = { weekId: weekId(), items };
  await setWeekly(weekly);
  const check = await getWeekly();

  return Response.json({
    ok: true,
    weekId: weekly.weekId,
    count: items.length,
    stored: !!check
  });
}
