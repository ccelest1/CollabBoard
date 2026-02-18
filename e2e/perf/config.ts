export function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function perfBoardId() {
  return process.env.PERF_BOARD_ID ?? "PERFTEST";
}

export function requiresPerfCredentials() {
  return Boolean(process.env.E2E_LOGIN_EMAIL && process.env.E2E_LOGIN_PASSWORD);
}
