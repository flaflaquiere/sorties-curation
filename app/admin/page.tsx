"use client";

export default function Admin() {
  return (
    <main style={{ padding: 16, fontFamily: "system-ui" }}>
      <h1>Admin</h1>
      <p>Clique pour générer / mettre à jour le Top 20.</p>

      <button
        style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd", cursor: "pointer" }}
        onClick={async () => {
          const key = prompt("CRON_KEY ?");
          if (!key) return;

          const res = await fetch("/api/refresh", {
            method: "POST",
            headers: { "x-cron-key": key }
          });

          const txt = await res.text();
          alert(txt);
        }}
      >
        Lancer refresh
      </button>
    </main>
  );
}
