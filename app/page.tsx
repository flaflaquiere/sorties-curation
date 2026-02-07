export const dynamic = "force-dynamic";

import { getWeekly } from "../lib/store";

export default async function Home() {
  const data = (await getWeekly()) ?? { weekId: "non-généré", items: [] };

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>Top 20 – sorties importantes</h1>
      <p style={{ marginTop: 0, opacity: 0.7 }}>
        Semaine: {data.weekId} · Mis à jour automatiquement
      </p>

      {data.items?.length ? (
        <div style={{ display: "grid", gap: 12 }}>
          {data.items.map((it: any) => (
            <div
              key={it.rank}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.6 }}>#{it.rank}</div>
              <div style={{ fontWeight: 800 }}>{it.albumName}</div>
              <div style={{ opacity: 0.85 }}>{it.artistName}</div>

              <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <a href={it.links?.youtubeMusic} target="_blank" rel="noreferrer">
                  YouTube Music
                </a>
                <a href={it.links?.soundcloud} target="_blank" rel="noreferrer">
                  SoundCloud
                </a>
              </div>

              {it.artistSummary && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Résumé artiste</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{it.artistSummary}</div>
                </div>
              )}

              {it.editorialReview && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Avis éditorial</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{it.editorialReview}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ marginTop: 16, opacity: 0.7 }}>
          Pas encore généré. Va sur /admin pour lancer le refresh.
        </p>
      )}
    </main>
  );
}
