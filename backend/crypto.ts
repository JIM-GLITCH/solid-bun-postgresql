/**
 * 后端 RSA 密钥与解密：用于接收前端加密后的密码并解密
 * 仅服务端持有私钥，前端只拿公钥加密，传输中不出现明文密码
 */

import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";

let keyPair: { publicKey: string; privateKey: string } | null = null;

function getKeyPair(): { publicKey: string; privateKey: string } {
  if (!keyPair) {
    keyPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }) as { publicKey: string; privateKey: string };
  }
  return keyPair;
}

/** 返回 PEM 格式公钥，供前端加密密码 */
export function getPublicKeyPem(): string {
  return getKeyPair().publicKey;
}

/** 用私钥解密前端传来的 base64 密文，得到明文密码 */
export function decryptPassword(encryptedBase64: string): string {
  const { privateKey } = getKeyPair();
  const buf = Buffer.from(encryptedBase64, "base64");
  const decrypted = privateDecrypt(
    {
      key: privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    buf
  );
  return decrypted.toString("utf8");
}
