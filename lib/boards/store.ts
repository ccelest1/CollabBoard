export type BoardRecord = {
  id: string;
  name: string;
  owned: boolean;
  createdAt: number;
  lastVisitedAt: number;
};

const STORAGE_KEY_PREFIX = "collabboard.boards.v1";
const BOARD_CATALOG_KEY = "collabboard.boardCatalog.v1";
const BOARD_SYNC_KEY = "collabboard.boardSync.v1";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function sanitizeBoardId(input: string) {
  return input.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function storageKeyForUser(userScope: string) {
  return `${STORAGE_KEY_PREFIX}:${userScope || "anonymous"}`;
}

function allBoardStorageKeys() {
  if (!canUseStorage()) return [] as string[];
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(`${STORAGE_KEY_PREFIX}:`)) {
      keys.push(key);
    }
  }
  return keys;
}

function inferBoardMetadataAcrossUsers(boardId: string) {
  if (!canUseStorage()) return { name: "", createdAt: Date.now() };
  const cleanId = sanitizeBoardId(boardId);
  const allMatches: Array<{ name: string; createdAt: number; owned: boolean }> = [];

  for (const key of allBoardStorageKeys()) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        const id = sanitizeBoardId(String(entry?.id ?? ""));
        if (id !== cleanId) continue;
        allMatches.push({
          name: typeof entry?.name === "string" ? entry.name.trim() : "",
          createdAt: typeof entry?.createdAt === "number" ? entry.createdAt : Date.now(),
          owned: Boolean(entry?.owned),
        });
      }
    } catch {
      // ignore malformed entry
    }
  }

  if (allMatches.length === 0) {
    return { name: "", createdAt: Date.now() };
  }

  // Prefer an owned board name first, then any non-empty name.
  const ownedNamed = allMatches.find((entry) => entry.owned && entry.name.length > 0);
  if (ownedNamed) return { name: ownedNamed.name, createdAt: ownedNamed.createdAt };
  const anyNamed = allMatches.find((entry) => entry.name.length > 0);
  if (anyNamed) return { name: anyNamed.name, createdAt: anyNamed.createdAt };
  const fallback = allMatches[0];
  return { name: "", createdAt: fallback.createdAt };
}

type BoardCatalogEntry = {
  id: string;
  name: string;
  createdAt: number;
};

function readBoardCatalog() {
  if (!canUseStorage()) return {} as Record<string, BoardCatalogEntry>;
  const raw = window.localStorage.getItem(BOARD_CATALOG_KEY);
  if (!raw) return {} as Record<string, BoardCatalogEntry>;
  try {
    const parsed = JSON.parse(raw) as Record<string, BoardCatalogEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {} as Record<string, BoardCatalogEntry>;
  }
}

function writeBoardCatalog(catalog: Record<string, BoardCatalogEntry>) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(BOARD_CATALOG_KEY, JSON.stringify(catalog));
  notifyBoardStoreUpdated();
}

function upsertCatalogEntry(id: string, name: string, createdAt: number) {
  const cleanId = sanitizeBoardId(id);
  if (!cleanId) return;
  const catalog = readBoardCatalog();
  catalog[cleanId] = {
    id: cleanId,
    name: name.trim(),
    createdAt: catalog[cleanId]?.createdAt ?? createdAt,
  };
  writeBoardCatalog(catalog);
}

function randomId(length = 8) {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
  }

  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return result;
}

export function generateBoardId() {
  return randomId(8);
}

export function getBoards(userScope: string) {
  if (!canUseStorage()) return [] as BoardRecord[];
  const raw = window.localStorage.getItem(storageKeyForUser(userScope));
  if (!raw) return [] as BoardRecord[];

  try {
    const catalog = readBoardCatalog();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as BoardRecord[];

    return parsed
      .filter((entry) => entry && typeof entry.id === "string")
      .map((entry) => {
        const id = sanitizeBoardId(entry.id);
        const fallbackName = typeof entry.name === "string" ? entry.name : "";
        const catalogName = catalog[id]?.name ?? "";
        return {
          id,
          name: catalogName || fallbackName,
          owned: Boolean(entry.owned),
          createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
          lastVisitedAt: typeof entry.lastVisitedAt === "number" ? entry.lastVisitedAt : Date.now(),
        };
      }) as BoardRecord[];
  } catch {
    return [] as BoardRecord[];
  }
}

function saveBoards(entries: BoardRecord[], userScope: string) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(storageKeyForUser(userScope), JSON.stringify(entries));
  notifyBoardStoreUpdated();
}

function notifyBoardStoreUpdated() {
  if (!canUseStorage()) return;
  window.localStorage.setItem(BOARD_SYNC_KEY, String(Date.now()));
  window.dispatchEvent(new Event("collabboard:boards-updated"));
}

function upsertBoard(next: BoardRecord, userScope: string) {
  const all = getBoards(userScope);
  const index = all.findIndex((entry) => entry.id === next.id);
  if (index === -1) {
    all.push(next);
  } else {
    all[index] = {
      ...all[index],
      ...next,
      owned: all[index].owned || next.owned,
    };
  }
  saveBoards(all, userScope);
}

export function createOwnedBoard(userScope: string, name?: string) {
  const id = generateBoardId();
  const now = Date.now();
  const boardName = (name ?? "").trim();
  upsertCatalogEntry(id, boardName, now);
  upsertBoard({
    id,
    name: boardName,
    owned: true,
    createdAt: now,
    lastVisitedAt: now,
  }, userScope);
  return id;
}

export function markBoardVisited(id: string, userScope: string) {
  const clean = sanitizeBoardId(id);
  if (!clean) return;

  const catalog = readBoardCatalog();
  const existing = getBoards(userScope).find((entry) => entry.id === clean);
  const now = Date.now();
  const inferred = inferBoardMetadataAcrossUsers(clean);
  const resolvedName = catalog[clean]?.name || inferred.name || existing?.name || "";

  if (!catalog[clean] || (catalog[clean].name || "").trim().length === 0) {
    upsertCatalogEntry(clean, resolvedName, existing?.createdAt ?? inferred.createdAt ?? now);
  }

  upsertBoard({
    id: clean,
    name: resolvedName,
    owned: existing?.owned ?? false,
    createdAt: existing?.createdAt ?? catalog[clean]?.createdAt ?? now,
    lastVisitedAt: now,
  }, userScope);
}

export function renameOwnedBoard(id: string, name: string, userScope: string) {
  const clean = sanitizeBoardId(id);
  const all = getBoards(userScope);
  const entry = all.find((candidate) => candidate.id === clean);
  if (!entry || !entry.owned) return;
  upsertCatalogEntry(clean, name.trim(), entry.createdAt);
  upsertBoard({ ...entry, name: name.trim(), lastVisitedAt: Date.now() }, userScope);
}

export function deleteOwnedBoard(id: string, userScope: string) {
  const clean = sanitizeBoardId(id);
  if (!clean || !canUseStorage()) return;

  const currentUserBoards = getBoards(userScope);
  const entry = currentUserBoards.find((candidate) => candidate.id === clean);
  if (!entry?.owned) return;

  for (const key of allBoardStorageKeys()) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      const filtered = parsed.filter((candidate) => sanitizeBoardId(String(candidate?.id ?? "")) !== clean);
      window.localStorage.setItem(key, JSON.stringify(filtered));
    } catch {
      // ignore malformed storage entries
    }
  }

  const catalog = readBoardCatalog();
  if (catalog[clean]) {
    delete catalog[clean];
    writeBoardCatalog(catalog);
  }
  notifyBoardStoreUpdated();
}

export function getMostRecentlyVisitedBoardId(userScope: string) {
  const all = getBoards(userScope);
  if (all.length === 0) return null;
  const sorted = [...all].sort((a, b) => b.lastVisitedAt - a.lastVisitedAt);
  return sorted[0]?.id ?? null;
}
