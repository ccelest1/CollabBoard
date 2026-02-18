"use client";

import { createClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Mode = "sign-in" | "sign-up";

export function AuthForm() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [username, setUsername] = useState("");
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
