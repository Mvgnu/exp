import { WorkspaceSnapshotSchema } from "@deeplake/core/contract";
import type { WorkspaceSnapshot } from "@deeplake/core/contract";
export interface Connection {
  url: string;
  token: string;
}
export const connectionKey = "deeplake.operator.connection";
export function normalizeConnection(input: Connection): Connection {
  const url = new URL(input.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTP(S) API URL without credentials, query parameters or fragments.",
    );
  if (input.token.trim().length < 24)
    throw new Error("The operator token must contain at least 24 characters.");
  return { url: url.href.replace(/\/$/, ""), token: input.token.trim() };
}
export async function request(
  connection: Connection,
  path: string,
  body?: unknown,
  method = "POST",
): Promise<unknown> {
  const response = await fetch(`${connection.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${connection.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      `The API returned an unreadable response (${response.status}).`,
    );
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    if (
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string"
    )
      message = value.error;
    throw new Error(message);
  }
  return value;
}
export async function fetchSnapshot(
  connection: Connection,
): Promise<WorkspaceSnapshot> {
  return WorkspaceSnapshotSchema.parse(
    await request(connection, "/api/snapshot", undefined, "GET"),
  );
}
