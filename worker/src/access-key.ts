const ACCESS_KEY_MAX_LEN = 64;
const ACCESS_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function generateAccessKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeAccessKey(value: string): string | null {
  const key = value.trim();
  if (!key || key.length > ACCESS_KEY_MAX_LEN || !ACCESS_KEY_PATTERN.test(key)) {
    return null;
  }
  return key;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
