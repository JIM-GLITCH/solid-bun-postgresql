/**
 * 前端密码加密：使用后端下发的 RSA 公钥加密，避免明文传输
 * 始终在前端加密，传输中不出现明文
 */
// @ts-expect-error node-forge 无 .d.ts
import forge from "node-forge";

/** 将 PEM 公钥（含头尾行）转为二进制，供 Web Crypto 使用 */
function pemToBinary(pem: string): ArrayBuffer {
  const lines = pem.split("\n").filter((l) => l && !l.includes("-----"));
  const b64 = lines.join("");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Web Crypto API 加密（需安全上下文，如 localhost/HTTPS） */
async function encryptWithWebCrypto(pemPublicKey: string, plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "spki",
    pemToBinary(pemPublicKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const data = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, data);
  return btoa(String.fromCharCode(...new Uint8Array(cipher)));
}

/** node-forge 加密（crypto.subtle 不可用时 fallback，如 Electrobun views://） */
function encryptWithForge(pemPublicKey: string, plaintext: string): string {
  const publicKey = forge.pki.publicKeyFromPem(pemPublicKey);
  const bytes = forge.util.encodeUtf8(plaintext);
  const encrypted = publicKey.encrypt(bytes, "RSA-OAEP", {
    md: forge.md.sha256.create(),
  });
  return forge.util.encode64(encrypted);
}

/**
 * 用 PEM 格式的 RSA 公钥加密明文，返回 base64 密文
 * 优先用 Web Crypto，不可用时用 node-forge，始终在前端完成加密
 */
export async function encryptWithPublicKey(pemPublicKey: string, plaintext: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return encryptWithWebCrypto(pemPublicKey, plaintext);
  }
  return encryptWithForge(pemPublicKey, plaintext);
}
