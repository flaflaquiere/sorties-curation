import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "");
const KEY = "weekly";

export async function getWeekly() {
  const raw = await redis.get(KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function setWeekly(data: any) {
  await redis.set(KEY, JSON.stringify(data));
}
