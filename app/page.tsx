export default async function Home() {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  const res = await fetch(`${base}/api/week/current`, { cache: "no-store" });
  const data = res.ok ? await res.json() : { weekId: "non-généré", items: [] };

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>Top 20 – sorties importantes</h1>
      <p style={{ marginTop: 0, opacity: 0.7 }}>
        Semaine: {data.weekId} · Mis à jour automatiquement
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {data.items.map((it: any) => (
          <div key={it.rank} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>#{it.rank}</div>
                <div style={{ fontWeight: 800 }}>{it.albumName}</div>
                <div style={{ opacity: 0.85 }}>{it.artistName}</div>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
                  {it.signals?.length ? it.signals.join(" · ") : ""}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <a href={it.links.youtubeMusic} target="_blank" rel="noreferrer">YouTube Music</a>
                <a href={it.links.soundcloud} target="_blank" rel="noreferrer">SoundCloud</a>
                {it.sourceLinks?.map((s: any) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Résumé artiste</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{it.artistSummary}</div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Avis éditorial</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{it.editorialReview}</div>
            </div>
          </div>
        ))}
      </div>

      {data.items.length === 0 && (
        <p style={{ marginTop: 16, opacity: 0.7 }}>
          Pas encore généré. Va sur /admin pour lancer le refresh.
        </p>
      )}
    </main>
  );
}
