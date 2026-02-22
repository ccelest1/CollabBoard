"use client";

import Link from "next/link";
import { Press_Start_2P } from "next/font/google";
import { motion, useAnimationControls } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const pressStart = Press_Start_2P({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const aiMessages = [
  "Creating a card component for the dashboard...",
  "Adjusting layout to match your brand colors...",
  "Adding responsive breakpoints to the grid...",
  "Generating a nav with dark mode support...",
];

type Theme = "light" | "dark";
type SceneCursorId = "maya" | "jordan" | "alex";

const THEME_STORAGE_KEY = "collab-theme";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5V5.2M12 18.8V21.5M21.5 12H18.8M5.2 12H2.5M18.7 5.3L16.8 7.2M7.2 16.8L5.3 18.7M18.7 18.7L16.8 16.8M7.2 7.2L5.3 5.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M14.8 2.9C11 3.2 8 6.3 8 10.2c0 4.1 3.3 7.4 7.4 7.4 2.6 0 4.9-1.3 6.2-3.3-0.9.3-1.9.5-2.9.5-4.5 0-8.1-3.6-8.1-8.1 0-1.4.4-2.6 1-3.8 0.9-0.1 2-0.1 3.2 0z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HomeLandingClient() {
  const mayaControls = useAnimationControls();
  const jordanControls = useAnimationControls();
  const alexControls = useAnimationControls();

  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [showSwotFrame, setShowSwotFrame] = useState(false);
  const [visibleQuadrants, setVisibleQuadrants] = useState(0);
  const [stickiesVisible, setStickiesVisible] = useState({
    strengths: false,
    opportunities: false,
    threats: false,
  });
  const [showReaction, setShowReaction] = useState(false);
  const [sceneVisible, setSceneVisible] = useState(true);
  const [messageIndex, setMessageIndex] = useState(0);
  const [typedText, setTypedText] = useState("");
  const [phase, setPhase] = useState<"typing" | "pause" | "deleting" | "idle">("typing");
  const timeoutIdsRef = useRef<Set<number>>(new Set());
  const isMountedRef = useRef(false);

  const clearAllTimeouts = () => {
    timeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
    timeoutIdsRef.current.clear();
  };

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        timeoutIdsRef.current.delete(timeoutId);
        resolve();
      }, ms);
      timeoutIdsRef.current.add(timeoutId);
    });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme: Theme = stored ?? (systemPrefersDark ? "dark" : "light");
    if (!isMountedRef.current) return;
    setTheme(initialTheme);
    applyTheme(initialTheme);
    setMounted(true);
  }, []);

  useEffect(() => {
    const syncViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const safeSet = (setter: () => void) => {
      if (!isMountedRef.current || cancelled) return;
      setter();
    };
    const p = (xRatio: number, yRatio: number) => ({
      x: Math.round(viewport.width * xRatio),
      y: Math.round(viewport.height * yRatio),
    });

    const moveCursor = async (
      controls: ReturnType<typeof useAnimationControls>,
      _id: SceneCursorId,
      waypoint: { x: number; y: number; opacity?: number },
      pauseMin = 800,
      pauseMax = 1500,
    ) => {
      if (cancelled) return;
      await controls.start({
        x: waypoint.x,
        y: waypoint.y,
        opacity: waypoint.opacity ?? 1,
        transition: { duration: 2, ease: "easeInOut" },
      });
      if (cancelled) return;
      const randomPause = pauseMin + Math.round(Math.random() * (pauseMax - pauseMin));
      await wait(randomPause);
    };

    const runSceneLoop = async () => {
      while (!cancelled) {
        clearAllTimeouts();
        safeSet(() => {
          setSceneVisible(true);
          setShowSwotFrame(false);
          setVisibleQuadrants(0);
          setStickiesVisible({ strengths: false, opportunities: false, threats: false });
          setShowReaction(false);
        });

        mayaControls.set({ x: -32, y: 28, opacity: 0 });
        jordanControls.set({ x: viewport.width + 36, y: viewport.height - 80, opacity: 0 });
        alexControls.set({ x: viewport.width + 30, y: viewport.height * 0.58, opacity: 0 });

        // Act 1 (~8s)
        await wait(220);
        if (cancelled) break;
        await moveCursor(mayaControls, "maya", { ...p(0.16, 0.2), opacity: 1 }, 900, 1200);
        if (cancelled) break;
        safeSet(() => setShowSwotFrame(true));
        for (let i = 1; i <= 4; i += 1) {
          await wait(200);
          if (cancelled) break;
          safeSet(() => setVisibleQuadrants(i));
        }
        if (cancelled) break;
        await moveCursor(mayaControls, "maya", p(0.5, 0.52), 1000, 1300);

        // Act 2 (~10s)
        await moveCursor(jordanControls, "jordan", { ...p(0.8, 0.72), opacity: 1 }, 850, 1200);
        await moveCursor(jordanControls, "jordan", p(0.44, 0.44), 900, 1200);
        if (cancelled) break;
        safeSet(() => setStickiesVisible((current) => ({ ...current, strengths: true })));
        await wait(600);
        if (cancelled) break;
        await moveCursor(alexControls, "alex", { ...p(0.85, 0.58), opacity: 1 }, 850, 1200);
        await moveCursor(alexControls, "alex", p(0.59, 0.54), 900, 1300);
        if (cancelled) break;
        safeSet(() => setStickiesVisible((current) => ({ ...current, opportunities: true })));
        await wait(700);
        if (cancelled) break;
        await moveCursor(mayaControls, "maya", p(0.62, 0.66), 900, 1200);
        if (cancelled) break;
        safeSet(() => setStickiesVisible((current) => ({ ...current, threats: true })));

        // Act 3 (~5s)
        await wait(700);
        if (cancelled) break;
        await moveCursor(jordanControls, "jordan", p(0.64, 0.67), 900, 1100);
        if (cancelled) break;
        safeSet(() => setShowReaction(true));
        await wait(1200);
        if (cancelled) break;
        safeSet(() => setShowReaction(false));
        await Promise.all([
          moveCursor(mayaControls, "maya", p(0.58, 0.63), 800, 900),
          moveCursor(jordanControls, "jordan", p(0.6, 0.64), 800, 900),
          moveCursor(alexControls, "alex", p(0.63, 0.6), 800, 900),
        ]);
        if (cancelled) break;
        await Promise.all([
          mayaControls.start({ opacity: 0, transition: { duration: 0.9, ease: "easeOut" } }),
          jordanControls.start({ opacity: 0, transition: { duration: 0.9, ease: "easeOut" } }),
          alexControls.start({ opacity: 0, transition: { duration: 0.9, ease: "easeOut" } }),
        ]);
        if (cancelled) break;
        safeSet(() => setSceneVisible(false));
        await wait(500);
      }
    };

    void runSceneLoop();
    return () => {
      cancelled = true;
      clearAllTimeouts();
      mayaControls.stop();
      jordanControls.stop();
      alexControls.stop();
    };
  }, [viewport.height, viewport.width, alexControls, jordanControls, mayaControls]);

  useEffect(() => {
    const currentMessage = aiMessages[messageIndex];
    let timeoutId: number;

    if (phase === "typing") {
      if (typedText.length < currentMessage.length) {
        timeoutId = window.setTimeout(() => {
          if (!isMountedRef.current) return;
          setTypedText(currentMessage.slice(0, typedText.length + 1));
        }, 40);
      } else {
        timeoutId = window.setTimeout(() => {
          if (!isMountedRef.current) return;
          setPhase("pause");
        }, 800);
      }
    } else if (phase === "pause") {
      timeoutId = window.setTimeout(() => {
        if (!isMountedRef.current) return;
        setPhase("deleting");
      }, 550);
    } else if (phase === "deleting") {
      if (typedText.length > 0) {
        timeoutId = window.setTimeout(() => {
          if (!isMountedRef.current) return;
          setTypedText(currentMessage.slice(0, typedText.length - 1));
        }, 20);
      } else {
        timeoutId = window.setTimeout(() => {
          if (!isMountedRef.current) return;
          setPhase("idle");
        }, 260);
      }
    } else {
      timeoutId = window.setTimeout(() => {
        if (!isMountedRef.current) return;
        setMessageIndex((index) => (index + 1) % aiMessages.length);
        setPhase("typing");
      }, 260);
    }

    return () => window.clearTimeout(timeoutId);
  }, [messageIndex, phase, typedText]);

  const setAndPersistTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#f5f5f5] text-[#151515] dark:bg-[#3a3a3a] dark:text-white">
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#e8e8e8] dark:bg-[#3a3a3a]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(100,116,139,0.28)_1px,transparent_0)] [background-size:24px_24px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.08)_1px,transparent_0)]" />

        <motion.div
          initial={false}
          animate={{ opacity: sceneVisible ? 1 : 0 }}
          transition={{ duration: 0.5 }}
          className="absolute inset-0"
        >
          <motion.div
            initial={false}
            animate={{ opacity: showSwotFrame ? 1 : 0, scale: showSwotFrame ? 1 : 0.96 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="absolute left-1/2 top-1/2 h-[320px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-black/20 bg-white/65 p-3 shadow-sm dark:border-white/15 dark:bg-black/25"
          >
            <p className="text-sm font-medium text-black/70 dark:text-white/80">SWOT Analysis</p>
            <div className="mt-2 grid h-[270px] grid-cols-2 grid-rows-2 gap-2">
              {["Strengths", "Weaknesses", "Opportunities", "Threats"].map((label, index) => (
                <motion.div
                  key={label}
                  initial={false}
                  animate={{ opacity: visibleQuadrants > index ? 1 : 0, scale: visibleQuadrants > index ? 1 : 0.94 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  className="rounded-md border border-black/20 bg-white/60 p-2 dark:border-white/15 dark:bg-black/20"
                >
                  <p className="text-xs font-medium text-black/65 dark:text-white/75">{label}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={false}
            animate={{ opacity: stickiesVisible.strengths ? 1 : 0, scale: stickiesVisible.strengths ? 1 : 0.92 }}
            transition={{ duration: 0.28 }}
            className="absolute left-[calc(50%-210px)] top-[calc(50%-78px)] w-[130px] rotate-[-2deg] rounded-sm border border-black/20 bg-[#FFE66D] px-2 py-2 text-[12px] text-black shadow-md"
          >
            Fast iteration
          </motion.div>
          <motion.div
            initial={false}
            animate={{ opacity: stickiesVisible.opportunities ? 1 : 0, scale: stickiesVisible.opportunities ? 1 : 0.92 }}
            transition={{ duration: 0.28 }}
            className="absolute left-[calc(50%+70px)] top-[calc(50%-62px)] w-[168px] rotate-[1deg] rounded-sm border border-black/20 bg-[#7CC4FF] px-2 py-2 text-[12px] text-black shadow-md"
          >
            New market segment
          </motion.div>
          <motion.div
            initial={false}
            animate={{ opacity: stickiesVisible.threats ? 1 : 0, scale: stickiesVisible.threats ? 1 : 0.92 }}
            transition={{ duration: 0.28 }}
            className="absolute left-[calc(50%+58px)] top-[calc(50%+88px)] w-[158px] rotate-[-1deg] rounded-sm border border-black/20 bg-[#FF8BB0] px-2 py-2 text-[12px] text-black shadow-md"
          >
            Competitor pricing
          </motion.div>

          <motion.div
            initial={false}
            animate={{ opacity: showReaction ? 1 : 0, scale: showReaction ? 1 : 0.85, y: showReaction ? 0 : 6 }}
            transition={{ duration: 0.22 }}
            className="absolute left-[calc(50%+114px)] top-[calc(50%+56px)] rounded-full border border-black/20 bg-white px-2 py-1 text-xs text-black shadow-sm"
          >
            +1 👍
          </motion.div>

          {[
            { name: "Maya", color: "#FF6B6B", controls: mayaControls },
            { name: "Jordan", color: "#4ECDC4", controls: jordanControls },
            { name: "Alex", color: "#FFE66D", controls: alexControls },
          ].map((cursor) => (
            <motion.div
              key={cursor.name}
              initial={{ x: -120, y: -120, opacity: 0 }}
              animate={cursor.controls}
              className="pointer-events-none absolute left-0 top-0 z-30"
              style={{ willChange: "transform" }}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 drop-shadow-sm" aria-hidden="true">
                <path
                  d="M4 2.8L19.2 13.6L12.5 14.2L8.7 21L8.4 9.8L4 2.8Z"
                  fill="transparent"
                  stroke="#111827"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div
                className="mt-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium text-white shadow-sm"
                style={{ backgroundColor: cursor.color }}
              >
                {cursor.name}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      <div className="fixed right-4 top-4 z-[100]">
        <div className="flex items-center gap-1 rounded-full bg-white px-[6px] py-1 shadow-[0_1px_4px_rgba(0,0,0,0.12)]">
          <button
            type="button"
            onClick={() => setAndPersistTheme("light")}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[#444444] transition-all duration-150 ease-in-out hover:bg-black/[0.10] ${theme === "light"
                ? "opacity-100"
                : "opacity-[0.35]"
              }`}
            aria-label="Switch to light mode"
          >
            <SunIcon />
          </button>
          <button
            type="button"
            onClick={() => setAndPersistTheme("dark")}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[#444444] transition-all duration-150 ease-in-out hover:bg-black/[0.10] ${theme === "dark"
                ? "opacity-100"
                : "opacity-[0.35]"
              }`}
            aria-label="Switch to dark mode"
          >
            <MoonIcon />
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: mounted ? 1 : 0, y: mounted ? 0 : 20 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative z-10 h-full w-full"
      >
        <div className="absolute left-1/2 top-[6vh] z-[1] w-full max-w-[480px] -translate-x-1/2 text-center">
          <img
            src="/icons/bend-browser-icon.png"
            alt="BEND arch icon"
            className="mx-auto block h-auto w-[150px] dark:invert"
            style={{ background: "none", border: "none", boxShadow: "none" }}
          />
          <h1 className={`${pressStart.className} mt-4 text-[3.75rem] leading-none text-black/90 dark:text-white`}>BEND</h1>
          <p className="mx-auto mt-5 max-w-[480px] text-2xl font-semibold leading-tight tracking-tight text-black/85 dark:text-white/90">
            The AI-enabled real time canvas for creative teams to design and ship faster
          </p>
        </div>

        <div className="absolute left-[5vw] top-[66%] z-[1] w-full max-w-[480px] -translate-y-1/2 text-left">
          <div className="w-full max-w-[480px] rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-lg dark:border-white/12 dark:bg-[#2e2e2e]">
            <div className="flex items-center">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">BEND AI Agent</p>
              <div className="ml-auto flex items-center gap-1">
                <span className="rounded-md px-2 py-1 text-xs text-slate-500 dark:text-slate-300">Clear input</span>
                <span className="rounded-md px-2 py-1 text-xs text-slate-500 dark:text-slate-300">Clear chat</span>
              </div>
            </div>
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-white/10 dark:bg-[#252525]">
              <p className="text-xs text-slate-500 dark:text-slate-400">Chat History:</p>
              <div className="mt-2 flex min-h-[88px] flex-col gap-2">
                <div className="ml-auto max-w-[86%] rounded-2xl bg-[#DBEAFE] px-2.5 py-1.5 text-xs text-blue-900">
                  Write a quick product strategy board.
                </div>
                <div className="mr-auto max-w-[90%] rounded-2xl bg-[#F3F4F6] px-2.5 py-1.5 text-xs leading-5 text-slate-800 dark:bg-[#2a2a2a] dark:text-slate-100">
                  {typedText}
                  <span className="ml-0.5 inline-block h-[0.9em] w-[1px] animate-pulse bg-slate-500 align-middle dark:bg-slate-300" />
                </div>
              </div>
            </div>
            <div className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-500 dark:border-white/10 dark:bg-[#262626] dark:text-slate-300">
              Ask AI to do something...
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-start gap-6">
            <div className="w-[220px] text-left">
              <p className="mb-2 text-xs font-medium text-black/50 dark:text-white/50">New to Bend?</p>
              <Link
                href="/login?mode=sign-up"
                className="inline-flex h-11 w-full items-center justify-center rounded-md border border-[#282928] bg-[#282928] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.2)] transition-colors duration-150 hover:bg-[#3a3a3a] dark:border-[#1a1a1a] dark:bg-[#1a1a1a] dark:hover:bg-[#242424]"
              >
                Sign Up
              </Link>
            </div>
            <div className="w-[220px] text-left">
              <p className="mb-2 text-xs font-medium text-black/50 dark:text-white/50">
                Already a Bend User?
              </p>
              <Link
                href="/login?mode=sign-in"
                className="inline-flex h-11 w-full items-center justify-center rounded-md border border-black/35 bg-transparent px-4 text-sm font-medium text-black/80 transition-colors duration-150 hover:bg-black/[0.06] dark:border-white/[0.3] dark:bg-[#3a3a3a] dark:text-white/90 dark:hover:bg-white/[0.08]"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
