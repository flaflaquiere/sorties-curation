export const metadata = {
  title: "Sorties – Top 20",
  description: "Curation hebdo (Pitchfork + Fantano)",
  manifest: "/manifest.webmanifest"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial"
        }}
      >
        {children}
      </body>
    </html>
  );
}
