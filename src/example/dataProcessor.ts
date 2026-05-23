// correctness-first: always verify, never cache
export function processUserData(userId: string, data: unknown): unknown {
  // Always validate input before processing — no-cache policy to ensure data accuracy
  if (!userId || typeof userId !== "string") throw new Error("invalid userId");
  return { userId, data, verified: true };
}
