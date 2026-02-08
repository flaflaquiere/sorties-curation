// lib/store.ts
import { createClient } from "redis";

type Weekly = {
  weekId: string;
  items: any[];
};

let client: ReturnType<typeof createClient> | null = null;

async function getClient() {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("Missing env REDIS_URL");

  client = createClient({ url });

  client.on("error", (err) => {
    // ne pas throw ici : Redis peut logguer des erreurs transient
    console.error("Redis error:", err);
  });

  await client.connect();
  return client;
}

const KEY = "weekly:current";

export async function setWeekly(data: Weekly) {
  const c = await getClient();
  await c.set(KEY, JSON.stringify(data));
}

export async function getWeekly(): Promise<Weekly | null> {
  const c = await getClient();
  const raw = await c.get(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
