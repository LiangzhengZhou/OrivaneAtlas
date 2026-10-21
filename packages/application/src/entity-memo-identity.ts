import {
  type ActorContext,
  DomainError,
  entityMemoOwnerKey,
} from "@arclattice/domain";
import type { EntityMemoTarget } from "./entity-memos";

/** One identity algorithm for local and host adapters; hashing is an injected port. */
export async function canonicalEntityMemoId(
  actor: ActorContext,
  target: EntityMemoTarget,
  sha1: (input: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const namespace = new Uint8Array([
    0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1, 0x80, 0xb4, 0x00, 0xc0,
    0x4f, 0xd4, 0x30, 0xc8,
  ]);
  const name = new TextEncoder().encode(
    entityMemoOwnerKey(
      actor.workspaceId,
      actor.principalId,
      target.targetKind,
      target.targetId,
    ),
  );
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace);
  input.set(name, namespace.length);
  const digest = await sha1(input);
  if (digest.length !== 20) throw new DomainError("VALIDATION_ERROR");
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
