"use client";

import { createClient } from "@/lib/supabase/client";
import { GUEST_ID_COOKIE, GUEST_NAME_COOKIE } from "@/lib/auth/guestSession";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Mode = "sign-in" | "sign-up";

export function AuthForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [username, setUsername] = useState("");
  const [guestName, setGuestName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const authPollRef = useRef<number | null>(null);

  const isLoading = status === "loading";
  const redirectPathRaw = searchParams.get("redirect");
  const redirectPath =
    redirectPathRaw && redirectPathRaw.startsWith("/") && !redirectPathRaw.startsWith("//")
      ? redirectPathRaw
      : "/dashboard";
  const navigateNow = (path: string) => {
    window.location.assign(path);
  };

  useEffect(() => {
    const modeParam = searchParams.get("mode");
    if (modeParam === "sign-up" || modeParam === "sign-in") {
      setMode(modeParam);
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (authPollRef.current) {
        window.clearInterval(authPollRef.current);
      }
    };
  }, []);

  async function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setMessage("");

    const supabase = createClient();
    document.cookie = `${GUEST_ID_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    document.cookie = `${GUEST_NAME_COOKIE}=; path=/; max-age=0; SameSite=Lax`;

    if (mode === "sign-up") {
      const trimmedUsername = username.trim();
      if (!trimmedUsername) {
        setStatus("error");
        setMessage("Please choose a username.");
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            username: trimmedUsername,
          },
        },
      });

      if (error) {
        setStatus("error");
        setMessage(error.message);
        return;
      }

      if (data.session) {
        setStatus("success");
        setMessage("Signing you in...");
        navigateNow(redirectPath);
        return;
      }

      setStatus("success");
      setMessage("Account created. Check your email to confirm, then sign in.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    setStatus("success");
    setMessage("Signing you in...");
    navigateNow(redirectPath);
  }

  function handleGuestSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = guestName.trim();
    if (trimmed.length < 2) {
      setStatus("error");
      setMessage("Please enter a guest name (at least 2 characters).");
      return;
    }
    const sanitized = trimmed.slice(0, 24);
    const guestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `guest-${crypto.randomUUID()}`
        : `guest-${Date.now()}`;
    const encodedName = encodeURIComponent(sanitized);
    const encodedId = encodeURIComponent(guestId);
    const oneDay = 60 * 60 * 24;
    document.cookie = `${GUEST_NAME_COOKIE}=${encodedName}; path=/; max-age=${oneDay}; SameSite=Lax`;
    document.cookie = `${GUEST_ID_COOKIE}=${encodedId}; path=/; max-age=${oneDay}; SameSite=Lax`;
    setStatus("success");
    setMessage(`Entering as ${sanitized}...`);
    navigateNow(redirectPath);
  }

  async function handleGoogleAuth(intent: Mode) {
    setStatus("loading");
    setMessage("");
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectPath)}&popup=1`;

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: {
          prompt: intent === "sign-up" ? "consent" : "select_account",
        },
      },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    if (!data?.url) {
      setStatus("error");
      setMessage("Unable to open Google auth window.");
      return;
    }

    const popupWidth = 520;
    const popupHeight = 660;
    const left = Math.max(0, window.screenX + (window.outerWidth - popupWidth) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - popupHeight) / 2);
    const popup = window.open(
      data.url,
      "google-oauth",
      `width=${popupWidth},height=${popupHeight},left=${Math.round(left)},top=${Math.round(top)},resizable=yes,scrollbars=yes,status=1`,
    );

    if (!popup) {
      setStatus("error");
      setMessage("Popup blocked. Please allow popups and try again.");
      return;
    }

    if (authPollRef.current) {
      window.clearInterval(authPollRef.current);
    }

    const messageHandler = (event: MessageEvent<{ source?: string; ok?: boolean }>) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== "supabase-oauth") return;

      if (event.data.ok === true) {
        if (authPollRef.current) {
          window.clearInterval(authPollRef.current);
          authPollRef.current = null;
        }
        window.removeEventListener("message", messageHandler);
        setStatus("success");
        setMessage("Signed in with Google.");
        navigateNow(redirectPath);
        return;
      }

      if (event.data.ok === false) {
        setStatus("error");
        setMessage("Google auth did not complete.");
      }
    };
    window.addEventListener("message", messageHandler);

    setMessage("Complete Google auth in the popup.");
    authPollRef.current = window.setInterval(async () => {
      const [{ data: sessionData }, popupClosed] = await Promise.all([
        supabase.auth.getSession(),
        Promise.resolve(popup.closed),
      ]);

      if (sessionData.session) {
        if (authPollRef.current) {
          window.clearInterval(authPollRef.current);
          authPollRef.current = null;
        }
        window.removeEventListener("message", messageHandler);
        setStatus("success");
        setMessage("Signed in with Google.");
        navigateNow(redirectPath);
        return;
      }

      if (popupClosed) {
        if (authPollRef.current) {
          window.clearInterval(authPollRef.current);
          authPollRef.current = null;
        }
        window.removeEventListener("message", messageHandler);
        setStatus("idle");
        setMessage("");
      }
    }, 700);
  }

  const inputClass =
    "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => {
            setMode("sign-in");
            setMessage("");
          }}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${mode === "sign-in"
            ? "border-slate-900 text-slate-900"
            : "border-transparent text-slate-500"
            }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("sign-up");
            setMessage("");
          }}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${mode === "sign-up"
            ? "border-slate-900 text-slate-900"
            : "border-transparent text-slate-500"
            }`}
        >
          Sign up
        </button>
      </div>
      <p className="text-center text-sm text-slate-700">
        {mode === "sign-in"
          ? "Already a user? Sign in."
          : "Sign up with your email/password, or with Google below."}
      </p>
      <button
        type="button"
        onClick={() => handleGoogleAuth(mode)}
        disabled={isLoading}
        className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {mode === "sign-in" ? "Sign in with Google" : "Sign up with Google"}
      </button>
      <form onSubmit={handleGuestSubmit} className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-700">Continue as guest</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            minLength={2}
            maxLength={24}
            placeholder="Enter a display name"
            className={`${inputClass} mt-0`}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </form>
      <form onSubmit={handlePasswordSubmit} className="space-y-4">
        {mode === "sign-up" && (
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-700">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={2}
              maxLength={24}
              placeholder="yourname"
              className={inputClass}
              disabled={isLoading}
            />
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            className={inputClass}
            disabled={isLoading}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder={mode === "sign-up" ? "Min 6 characters" : ""}
            className={inputClass}
            disabled={isLoading}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isLoading ? "Please wait..." : mode === "sign-in" ? "Sign in" : "Sign up"}
        </button>
      </form>

      {message && (
        <p className={`text-sm ${status === "error" ? "text-red-500" : "text-green-600"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
