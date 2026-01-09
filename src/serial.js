export function normalizeSerial(input) {
  if (!input) return null;
  const cleaned = input.toString().toUpperCase().replace(/[^0-9A-F]/g, "");
  if (cleaned.length !== 6) return null;
  return cleaned;
}

export function extractSerialFromQRText(text) {
  if (!text) return null;
  const upper = text.toString().toUpperCase();
  const match = upper.match(/\b[0-9A-F]{6}\b/);
  return match ? match[0] : null;
}

export function extractZFromQRText(text) {
  if (!text) return null;
  const upper = text.toString().toUpperCase();
  const match = upper.match(/\bZ:([0-9A-F]{8,})/);
  return match ? match[1] : null;
}

export async function serialFromZHex(zHex, digestFn = defaultDigest) {
  if (!zHex) return null;
  const clean = zHex.toString().trim().toUpperCase();
  if (!/^[0-9A-F]+$/.test(clean) || clean.length % 2 !== 0) return null;
  const bytes = hexToBytes(clean);
  const digest = await digestFn(bytes);
  if (!digest || digest.length < 3) return null;
  return bytesToHex(digest.slice(0, 3));
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

async function defaultDigest(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto not available (HTTPS required).");
  }
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(buffer);
}
