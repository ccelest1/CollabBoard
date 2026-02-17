import { ThreeBoardBackground } from "./ThreeBoardBackground";

export function GridBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-slate-50 dark:bg-black" />

      {/* Right-side 60% board-style background */}
      <div className="absolute right-0 top-0 h-full w-[60%] bg-white dark:bg-slate-900/95">
        <ThreeBoardBackground />
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              "linear-gradient(rgba(100,116,139,0.32) 1px, transparent 1px), linear-gradient(90deg, rgba(100,116,139,0.32) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Blend transition between 40% and 60% regions */}
        <div className="absolute left-0 top-0 h-full w-24 bg-gradient-to-r from-slate-50 to-transparent dark:from-black" />

        <div className="absolute left-[38%] top-[42%] h-3 w-12 animate-pulse rounded-sm bg-green-500/40 dark:bg-green-500/80" />
        <div
          className="absolute left-[58%] top-[56%] h-8 w-8 animate-pulse rounded-sm bg-amber-500/40 dark:bg-amber-500/80"
          style={{ animationDelay: "0.5s" }}
        />
        <div
          className="absolute left-[48%] top-[30%] h-4 w-4 animate-pulse rounded-sm bg-pink-500/40 dark:bg-pink-500/80"
          style={{ animationDelay: "1s" }}
        />

        <div className="absolute left-[62%] top-[45%] h-4 w-4 animate-blink rounded-sm border-2 border-blue-400 bg-blue-500/40 dark:bg-blue-500/60" />

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-float">
          <div className="rounded-lg border-2 border-slate-400 bg-slate-100/90 p-1 shadow-xl dark:border-slate-600 dark:bg-slate-800/90">
            <div className="h-40 w-56 rounded bg-slate-200/80 dark:bg-slate-700/80" />
          </div>
        </div>
      </div>
    </div>
  );
}
