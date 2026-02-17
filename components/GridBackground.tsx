import { ThreeBoardBackground } from "./ThreeBoardBackground";

type GridBackgroundProps = {
  mode?: "default" | "home" | "dashboard";
};

export function GridBackground({ mode = "default" }: GridBackgroundProps) {
  const showThree = mode === "home" || mode === "dashboard" || mode === "default";

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-slate-50 dark:bg-black" />
      <div
        className="absolute inset-0 opacity-25 dark:opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(rgba(100,116,139,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(100,116,139,0.22) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          transformOrigin: "center",
          animation: "spin 180s linear infinite",
        }}
      />

      {showThree && (
        <div className="absolute right-0 top-0 h-full w-[60%] bg-white/75 dark:bg-slate-900/80">
          <ThreeBoardBackground />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-50/70 via-transparent to-transparent dark:from-black/70" />
        </div>
      )}
    </div>
  );
}
