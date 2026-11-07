import type { ItsmRole } from "./itsm-rbac";

export type ItsmRoleDirectoryEvent = {
  userId: string;
  role: ItsmRole | null;
};

type Listener = (event: ItsmRoleDirectoryEvent) => void;
const listeners = new Set<Listener>();

export function subscribeToItsmRoleDirectoryEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishItsmRoleDirectoryEvent(event: ItsmRoleDirectoryEvent): void {
  // Construct a fresh, minimal payload so Clerk metadata can never be forwarded.
  const directoryEvent = { userId: event.userId, role: event.role };
  for (const listener of listeners) listener(directoryEvent);
}
