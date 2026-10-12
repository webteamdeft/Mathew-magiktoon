function requireEnv(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(
      `Missing required environment variable: ${name}`
    );
  }

  return value.trim();
}

export function getGeminiConfig() {
  return {
    apiKey: requireEnv("GEMINI_API_KEY"),
    model:
      process.env.GEMINI_MODEL ||
      "gemini-2.5-flash-image",
  };
}

export function getGelatoConfig() {
  return {
    apiKey: requireEnv("GELATO_API_KEY"),
    storeId: requireEnv("GELATO_STORE_ID"),
    deleteAfterMockup:
      String(
        process.env.GELATO_DELETE_AFTER_MOCKUP || "false"
      ).toLowerCase() === "true",
  };
}

export function getArtworkSigningConfig() {
  const ttl = Number(
    process.env.ARTWORK_URL_TTL_MS || "3600000"
  );

  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error(
      "ARTWORK_URL_TTL_MS must be a positive number"
    );
  }

  return {
    secret: requireEnv("ARTWORK_SIGNING_SECRET"),
    ttlMs: ttl,
  };
}