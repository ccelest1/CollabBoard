import { ThreeBoardBackground } from "./ThreeBoardBackground";

type GridBackgroundProps = {
  mode?: "default" | "home" | "dashboard";
};

export function GridBackground({ mode = "default" }: GridBackgroundProps) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-slate-50 dark:bg-black" />
      <div
        className="absolute inset-0 opacity-25 dark:opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(100,116,139,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(100,116,139,0.22) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />

      {mode === "home" && (
        <div className="absolute right-0 top-0 h-full w-[80%] bg-white/70 dark:bg-slate-900/75">
          <ThreeBoardBackground />
          <div className="absolute left-0 top-0 h-full w-24 bg-gradient-to-r from-slate-50/85 to-transparent dark:from-black/85" />
        </div>
      )}

      {mode === "dashboard" && (
        <div className="absolute bottom-0 left-0 h-[56%] w-[42%] overflow-hidden rounded-tr-3xl border-t border-r border-slate-300/80 bg-white/80 shadow-xl dark:border-slate-700/80 dark:bg-slate-900/70">
          <ThreeBoardBackground />
          <div className="absolute inset-0 bg-gradient-to-tr from-slate-50/65 to-transparent dark:from-black/60" />
        </div>
      )}
    </div>
  );
}
