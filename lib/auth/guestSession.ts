export const GUEST_NAME_COOKIE = "bend_guest_name";
export const GUEST_ID_COOKIE = "bend_guest_id";

export type GuestSession = {
  guestId: string;
  guestName: string;
};

type CookieReader = {
  get: (name: string) => { value: string } | undefined;
};

export function readGuestSession(cookies: CookieReader): GuestSession | null {
  const guestId = cookies.get(GUEST_ID_COOKIE)?.value?.trim() ?? "";
  const guestName = cookies.get(GUEST_NAME_COOKIE)?.value?.trim() ?? "";
  if (!guestId || !guestName) return null;
  return { guestId, guestName };
}
