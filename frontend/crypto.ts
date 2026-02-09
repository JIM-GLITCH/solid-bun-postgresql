/**
 * 前端密码加密：使用后端下发的 RSA 公钥加密，避免明文传输
 */

/** 将 PEM 公钥（含头尾行）转为二进制，供 Web Crypto 使用 */
function pemToBinary(pem: string): ArrayBuffer {
  const lines = pem.split("\n").filter((l) => l && !l.includes("-----"));
  const b64 = lines.join("");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * 用 PEM 格式的 RSA 公钥加密明文，返回 base64 密文
 */
export async function encryptWithPublicKey(pemPublicKey: string, plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "spki",
    pemToBinary(pemPublicKey),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const data = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(cipher)));
  return b64;
}
