// app/api/refresh/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

// >>>> ADAPTE CET IMPORT SI TON lib/store EXPORT DES NOMS DIFFERENTS <<<<
import { setWeekly } from "@/lib/store";

// --------------------
// Types
// --------------------
type SourceLink = { label: string; url: string };

type Candidate = {
  artistName: string; // peut être vide au départ
  albumName: string;
  signals?: string[];
  sourceLinks?: SourceLink[];
  score?: number;
};

type WeeklyItem = {
  rank: number;
  artistName: string;
  albumName: string;
  signals: string[];
  artistSummary: string;
  editorialReview: string;
  links: {
    youtubeMusic: string;
    soundcloud: string;
  };
  sourceLinks: SourceLink[];
};

type WeeklyPayload = {
  weekId: string;
  items: WeeklyItem[];
};

// --------------------
// Helpers
// --------------------
function computeWeekId(d = new Date()) {
  // ISO week (approx simple). Si tu avais déjà une fonction weekId ailleurs, utilise-la.
  // Format: YYYY-WW
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const ww = String(weekNo).padStart(2, "0");
  return `${date.getUTCFullYear()}-${ww}`;
}

function ytMusicSearchUrl(artist: string, album: string) {
  const q = encodeURIComponent([artist, album].filter(Boolean).join(" ").trim());
  return `https://music.youtube.com/search?q=${q}`;
}

function scSearchUrl(artist: string, album: string) {
  const q = encodeURIComponent([artist, album].filter(Boolean).join(" ").trim());
  return `https://soundcloud.com/search?q=${q}`;
}

function uniqStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const cleaned = arr
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

function safeString(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

// --------------------
// Auth CRON_KEY
// --------------------
async function readCronKeyFromRequest(req: Request): Promise<string> {
  // On accepte plusieurs façons (pratique)
  // 1) header: x-cron-key
  const h = req.headers.get("x-cron-key");
  if (h) return h;

  // 2) query: ?key=...
  const url = new URL(req.url);
  const q = url.searchParams.get("key");
  if (q) return q;

  // 3) body JSON: { key: "..." }
  try {
    const body = await req.clone().json();
    if (body?.key && typeof body.key === "string") return body.key;
  } catch {
    // ignore
  }

  return "";
}

function isAuthorized(provided: string) {
  const expected = process.env.CRON_KEY || "";
  // si pas de CRON_KEY configurée, on autorise (tu peux changer en "false" si tu veux forcer)
  if (!expected) return true;
  return provided === expected;
}

// --------------------
// 1) Collect candidates
// --------------------
// IMPORTANT : je ne peux pas deviner tes sources exactes.
// Donc je te mets une version "safe" qui prend les candidats depuis un fichier statique
// OU depuis une liste codée ici.
// Si tu avais déjà du scraping/feeds, colle ton code dans cette fonction.
async function collectCandidates(): Promise<Candidate[]> {
  // TODO: remplace par ta logique existante (Pitchfork, Fnac, etc.)
  // Pour éviter de casser, on renvoie un tableau vide si rien.
  return [];
}

// --------------------
// 2) OpenAI enrich batch (1 seul appel)
// --------------------
async function openaiEnrichBatch(items: Array<{ rank: number; artistName: string; albumName: string; signals: string[] }>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Pas de clé => on renvoie vide (mais on garde artistName existant)
    return items.map((it) => ({
      rank: it.rank,
      artistName: it.artistName || "",
      artistSummary: "",
      editorialReview: "",
    }));
  }

  const client = new OpenAI({ apiKey });

  // On demande un JSON strict.
  const input = [
    {
      role: "system" as const,
      content:
        "Tu es un éditeur musique. Tu reçois une liste d'albums. Pour chaque item, tu dois: " +
        "1) Déduire/corriger artistName si possible (sinon garder celui fourni), " +
        "2) écrire artistSummary (2-3 phrases), " +
        "3) écrire editorialReview (2-3 phrases). " +
        "Réponds en JSON strict, sans texte autour.",
    },
    {
      role: "user" as const,
      content:
        "Retourne un objet JSON { items: [...] } avec items = tableau de { rank, artistName, artistSummary, editorialReview } " +
        "Langue: français.\n\n" +
        JSON.stringify({ items }),
    },
  ];

  try {
    const resp = await client.responses.create({
      model: "gpt-5-mini",
      input,
      text: { format: { type: "json_object" } },
    });

    const txt = resp.output_text || "{}";
    const parsed = JSON.parse(txt);

    const arr = Array.isArray(parsed) ? parsed : parsed.items;
    if (!Array.isArray(arr)) {
      return items.map((it) => ({
        rank: it.rank,
        artistName: it.artistName || "",
        artistSummary: "",
        editorialReview: "",
      }));
    }

    // Normalisation
    return arr.map((x: any) => ({
      rank: Number(x.rank),
      artistName: safeString(x.artistName),
      artistSummary: safeString(x.artistSummary),
      editorialReview: safeString(x.editorialReview),
    }));
  } catch (e: any) {
    // Si 429 / quota / rate-limit => on ne casse pas
    return items.map((it) => ({
      rank: it.rank,
      artistName: it.artistName || "",
      artistSummary: "",
      editorialReview: "",
    }));
  }
}

// --------------------
// POST handler
// --------------------
export async function POST(req: Request) {
  const providedKey = await readCronKeyFromRequest(req);
  if (!isAuthorized(providedKey)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 1) Récupérer les candidats (à remplacer par ton code existant)
  const candidatesRaw = await collectCandidates();

  // Si collectCandidates renvoie vide, on ne fait rien mais on renvoie une réponse claire
  if (!candidatesRaw.length) {
    const weeklyEmpty: WeeklyPayload = { weekId: computeWeekId(), items: [] };
    await setWeekly(weeklyEmpty);
    return NextResponse.json({ ok: true, weekId: weeklyEmpty.weekId, count: 0, note: "No candidates" });
  }

  // 2) Scoring + tri + top20 (score optionnel)
  const scored = candidatesRaw.map((c) => ({
    ...c,
    score: typeof c.score === "number" ? c.score : 0,
  }));

  const ranked = scored
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 20);

  // 3) Préparer items "basiques"
  const baseItems = ranked.map((r, idx) => ({
    rank: idx + 1,
    artistName: safeString(r.artistName),
    albumName: safeString(r.albumName),
    signals: uniqStrings(r.signals),
    sourceLinks: (Array.isArray(r.sourceLinks) ? r.sourceLinks : []).slice(0, 3),
  }));

  // 4) OpenAI enrich (1 seul call)
  const enriched = await openaiEnrichBatch(
    baseItems.map((it) => ({
      rank: it.rank,
      artistName: it.artistName,
      albumName: it.albumName,
      signals: it.signals,
    }))
  );

  // 5) Merge + liens
  const finalItems: WeeklyItem[] = baseItems.map((it) => {
    const e = enriched.find((x) => x.rank === it.rank);

    // ArtistName: priorité au retour IA, sinon celui existant
    const artistName = safeString(e?.artistName) || it.artistName;
    const albumName = it.albumName;

    return {
      rank: it.rank,
      artistName,
      albumName,
      signals: it.signals,
      artistSummary: safeString(e?.artistSummary),
      editorialReview: safeString(e?.editorialReview),
      links: {
        youtubeMusic: ytMusicSearchUrl(artistName, albumName),
        soundcloud: scSearchUrl(artistName, albumName),
      },
      sourceLinks: it.sourceLinks,
    };
  });

  const weekly: WeeklyPayload = { weekId: computeWeekId(), items: finalItems };

  // 6) Save
  await setWeekly(weekly);

  return NextResponse.json({ ok: true, weekId: weekly.weekId, count: weekly.items.length });
}
