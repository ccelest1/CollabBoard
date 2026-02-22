"use client";

import { useEffect, useRef, useState } from "react";
import { hexToRgb, hslToRgb, normalizeHex, rgbToHex, rgbToHsl } from "@/lib/ui/colorUtils";

type ColorPickerProps = {
  currentColor: string;
  onColorChange: (color: string) => void;
};

type Rgb = { r: number; g: number; b: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsv(rgb: Rgb) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s: s * 100, v: max * 100 };
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const c = val * sat;
  const hh = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = val - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 60) {
    rp = c;
    gp = x;
  } else if (hh < 120) {
    rp = x;
    gp = c;
  } else if (hh < 180) {
    gp = c;
    bp = x;
  } else if (hh < 240) {
    gp = x;
    bp = c;
  } else if (hh < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

function parseRgbInput(value: string): Rgb | null {
  const match = value.trim().match(/^rgb\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\)$/i);
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  if ([r, g, b].some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null;
  return { r, g, b };
}

function parseAnyColorInput(value: string) {
  const normalizedHex = normalizeHex(value);
  if (normalizedHex) return normalizedHex;
  const rgb = parseRgbInput(value);
  if (!rgb) return null;
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

export function ColorPicker({ currentColor, onColorChange }: ColorPickerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const invalidInputTimeoutRef = useRef<number | null>(null);
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [value, setValue] = useState(100);
  const [rgbInputs, setRgbInputs] = useState({ r: "", g: "", b: "" });
  const [hslInputs, setHslInputs] = useState({ h: "", s: "", l: "" });
  const [hexInput, setHexInput] = useState("");
  const [freeTypeInput, setFreeTypeInput] = useState("");
  const [showInvalidFreeType, setShowInvalidFreeType] = useState(false);

  useEffect(() => {
    const hsv = rgbToHsv(hexToRgb(currentColor));
    setHue(hsv.h);
    setSaturation(hsv.s);
    setValue(hsv.v);
    const rgb = hexToRgb(currentColor);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    setRgbInputs({ r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) });
    setHslInputs({ h: String(hsl.h), s: String(hsl.s), l: String(hsl.l) });
    setHexInput(currentColor.replace(/^#/, "").toUpperCase());
    setFreeTypeInput(currentColor.toUpperCase());
  }, [currentColor]);

  useEffect(() => {
    return () => {
      if (invalidInputTimeoutRef.current !== null) window.clearTimeout(invalidInputTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const gradH = ctx.createLinearGradient(0, 0, w, 0);
    gradH.addColorStop(0, "white");
    gradH.addColorStop(1, `hsl(${hue}, 100%, 50%)`);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, w, h);
    const gradV = ctx.createLinearGradient(0, 0, 0, h);
    gradV.addColorStop(0, "transparent");
    gradV.addColorStop(1, "black");
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, w, h);
  }, [hue]);

  const applyFromCanvas = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    const nextS = (x / rect.width) * 100;
    const nextV = 100 - (y / rect.height) * 100;
    setSaturation(nextS);
    setValue(nextV);
    const rgb = hsvToRgb(hue, nextS, nextV);
    onColorChange(rgbToHex(rgb.r, rgb.g, rgb.b));
  };

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!draggingRef.current) return;
      applyFromCanvas(event.clientX, event.clientY);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [hue]);

  const applyRgbValues = (next: { r: string; g: string; b: string }) => {
    const parsed = {
      r: Number(next.r),
      g: Number(next.g),
      b: Number(next.b),
    };
    if (Object.values(parsed).some((channel) => !Number.isFinite(channel))) return;
    const bounded = {
      r: clamp(parsed.r, 0, 255),
      g: clamp(parsed.g, 0, 255),
      b: clamp(parsed.b, 0, 255),
    };
    onColorChange(rgbToHex(bounded.r, bounded.g, bounded.b));
  };

  const applyHslValues = (next: { h: string; s: string; l: string }) => {
    const parsed = {
      h: Number(next.h),
      s: Number(next.s),
      l: Number(next.l),
    };
    if (Object.values(parsed).some((channel) => !Number.isFinite(channel))) return;
    const rgbFromHsl = hslToRgb(clamp(parsed.h, 0, 360), clamp(parsed.s, 0, 100), clamp(parsed.l, 0, 100));
    onColorChange(rgbToHex(rgbFromHsl.r, rgbFromHsl.g, rgbFromHsl.b));
  };

  const flashInvalidFreeType = () => {
    setShowInvalidFreeType(true);
    if (invalidInputTimeoutRef.current !== null) window.clearTimeout(invalidInputTimeoutRef.current);
    invalidInputTimeoutRef.current = window.setTimeout(() => {
      setShowInvalidFreeType(false);
      invalidInputTimeoutRef.current = null;
    }, 900);
  };

  const commitFreeTypeInput = () => {
    const parsed = parseAnyColorInput(freeTypeInput);
    if (!parsed) {
      flashInvalidFreeType();
      setFreeTypeInput(currentColor.toUpperCase());
      return;
    }
    onColorChange(parsed);
    setFreeTypeInput(parsed);
    setShowInvalidFreeType(false);
  };

  return (
    <div
      style={{
        width: 220,
        borderRadius: 12,
        border: "1px solid #E5E7EB",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        background: "#FFFFFF",
        padding: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "1px solid rgba(0,0,0,0.15)",
            background: currentColor,
          }}
        />
        <input
          value={freeTypeInput}
          placeholder="#F4A0C0 or rgb(244,160,192)"
          onChange={(event) => {
            setFreeTypeInput(event.target.value);
            setShowInvalidFreeType(false);
          }}
          onBlur={commitFreeTypeInput}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            commitFreeTypeInput();
            event.currentTarget.blur();
          }}
          style={{
            width: 120,
            border: `1px solid ${showInvalidFreeType ? "#EF4444" : "#E5E7EB"}`,
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 13,
            transition: "border-color 120ms ease",
          }}
          aria-label="Free-type color input"
        />
      </div>

      <div style={{ position: "relative", marginBottom: 10 }}>
        <canvas
          ref={canvasRef}
          width={196}
          height={140}
          onMouseDown={(event) => {
            draggingRef.current = true;
            applyFromCanvas(event.clientX, event.clientY);
          }}
          style={{ width: "100%", height: 140, borderRadius: 8, cursor: "crosshair", display: "block" }}
        />
        <div
          style={{
            position: "absolute",
            left: `${(saturation / 100) * 196}px`,
            top: `${((100 - value) / 100) * 140}px`,
            transform: "translate(-6px, -6px)",
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: "2px solid #FFFFFF",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
            pointerEvents: "none",
          }}
        />
      </div>

      <input
        type="range"
        min={0}
        max={360}
        step={1}
        value={hue}
        onChange={(event) => {
          const nextHue = Number(event.target.value);
          setHue(nextHue);
          const rgb = hsvToRgb(nextHue, saturation, value);
          onColorChange(rgbToHex(rgb.r, rgb.g, rgb.b));
        }}
        style={{
          width: "100%",
          height: 12,
          borderRadius: 6,
          marginBottom: 10,
          background:
            "linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)",
          appearance: "none",
          WebkitAppearance: "none",
        }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 6 }}>
        {(["r", "g", "b"] as const).map((channel) => (
          <label key={channel} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6B7280" }}>
            <span style={{ width: 10, textTransform: "uppercase" }}>{channel}</span>
            <input
              type="number"
              min={0}
              max={255}
              value={rgbInputs[channel]}
              onChange={(event) => {
                const next = { ...rgbInputs, [channel]: event.target.value };
                setRgbInputs(next);
                applyRgbValues(next);
              }}
              onBlur={(event) => {
                const bounded = String(clamp(Number(event.target.value || 0), 0, 255));
                const next = { ...rgbInputs, [channel]: bounded };
                setRgbInputs(next);
                applyRgbValues(next);
              }}
              style={{
                width: 52,
                height: 28,
                border: "1px solid #E5E7EB",
                borderRadius: 6,
                textAlign: "center",
                fontSize: 12,
              }}
              aria-label={`${channel.toUpperCase()} value`}
            />
          </label>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 6 }}>
        {(["h", "s", "l"] as const).map((channel) => (
          <label key={channel} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#6B7280" }}>
            <span style={{ width: 10, textTransform: "uppercase" }}>{channel}</span>
            <input
              type="number"
              min={channel === "h" ? 0 : 0}
              max={channel === "h" ? 360 : 100}
              value={hslInputs[channel]}
              onChange={(event) => {
                const next = { ...hslInputs, [channel]: event.target.value };
                setHslInputs(next);
                applyHslValues(next);
              }}
              onBlur={(event) => {
                const max = channel === "h" ? 360 : 100;
                const bounded = String(clamp(Number(event.target.value || 0), 0, max));
                const next = { ...hslInputs, [channel]: bounded };
                setHslInputs(next);
                applyHslValues(next);
              }}
              style={{
                width: 52,
                height: 28,
                border: "1px solid #E5E7EB",
                borderRadius: 6,
                textAlign: "center",
                fontSize: 12,
              }}
              aria-label={`${channel.toUpperCase()} value`}
            />
          </label>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: "#6B7280" }}>#</span>
        <input
          value={hexInput}
          onChange={(event) => {
            const next = event.target.value.toUpperCase();
            setHexInput(next);
            const normalized = normalizeHex(`#${next}`);
            if (normalized) onColorChange(normalized);
          }}
          onBlur={() => {
            const normalized = normalizeHex(`#${hexInput}`);
            if (!normalized) {
              setHexInput(currentColor.replace(/^#/, "").toUpperCase());
              return;
            }
            setHexInput(normalized.replace(/^#/, ""));
            onColorChange(normalized);
          }}
          style={{
            width: "100%",
            height: 28,
            border: "1px solid #E5E7EB",
            borderRadius: 6,
            textAlign: "center",
            fontSize: 12,
          }}
          aria-label="HEX value"
        />
      </div>
    </div>
  );
}
