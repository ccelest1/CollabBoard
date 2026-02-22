import type { BoardObject } from "@/lib/boards/model";

export class SessionMemory {
  private readonly sessionId: string;
  private createdObjects: BoardObject[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  recordCreated(objects: BoardObject[]): void {
    const merged = [...this.createdObjects, ...objects];
    const seen = new Set<string>();

    this.createdObjects = merged.filter((object) => {
      if (seen.has(object.id)) {
        return false;
      }

      seen.add(object.id);
      return true;
    });
  }

  getCreatedIds(): string[] {
    return this.createdObjects.map((object) => object.id);
  }

  getCreatedObjects(): BoardObject[] {
    return [...this.createdObjects];
  }

  getLastCreatedIds(count?: number): string[] {
    const allIds = this.getCreatedIds();

    if (count === undefined) {
      return allIds;
    }

    return allIds.slice(-count);
  }

  hasCreatedObjects(): boolean {
    return this.createdObjects.length > 0;
  }

  clear(): void {
    this.createdObjects = [];
  }
}

export const SessionMemoryRegistry = new Map<string, SessionMemory>();

export function getOrCreateSession(sessionId: string): SessionMemory {
  const existingSession = SessionMemoryRegistry.get(sessionId);
  if (existingSession) {
    return existingSession;
  }

  const newSession = new SessionMemory(sessionId);
  SessionMemoryRegistry.set(sessionId, newSession);
  return newSession;
}
