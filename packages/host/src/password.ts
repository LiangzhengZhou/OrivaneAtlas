import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
export function username(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(normalized))
    throw new Error("Invalid username");
  return normalized;
}
export async function passwordHash(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  if (password.length < 12 || password.length > 128)
    throw new Error("Invalid password");
  const hash = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      32,
      { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
  return salt + ":" + hash.toString("hex");
}
export async function passwordMatches(password: string, verifier: string) {
  const [salt, hash] = verifier.split(":");
  if (
    !salt ||
    !hash ||
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    return false;
  if (password.length < 12 || password.length > 128) return false;
  const actual = await passwordHash(password, salt);
  return timingSafeEqual(Buffer.from(actual), Buffer.from(verifier));
}
