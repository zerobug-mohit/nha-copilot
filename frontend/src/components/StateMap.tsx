import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import geo from "../assets/india-districts.geo.json";

// Normalize a state name for matching across our data and the map (handles the
// MAHARASTRA misspelling, aliases, and casing).
function norm(s: unknown): string {
  return String(s ?? "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/&/g, "AND")
    .replace("MAHARASTRA", "MAHARASHTRA")
    .replace("ORISSA", "ODISHA")
    .replace("PONDICHERRY", "PUDUCHERRY")
    .replace("NATIONAL CAPITAL TERRITORY OF DELHI", "DELHI")
    .replace("NCT OF DELHI", "DELHI");
}

// Light → dark teal ramp.
function ramp(t: number): string {
  const a = [232, 243, 245], b = [10, 91, 102];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
const NO_DATA = "#eef1f2";

export default function StateMap({
  data,
  valueName,
  onStateClick,
}: {
  data: { name: string; value: number }[];
  valueName: string;
  onStateClick?: (name: string) => void;
}) {
  const [hover, setHover] = useState<{ name: string; value: number | null } | null>(null);

  const byState = useMemo(() => {
    const m = new Map<string, { display: string; value: number }>();
    for (const d of data) m.set(norm(d.name), { display: d.name, value: d.value });
    return m;
  }, [data]);

  const values = data.map((d) => d.value).filter((v) => Number.isFinite(v));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const color = (v: number) => ramp(max === min ? 0.85 : (v - min) / (max - min));

  const fmt = (n: number) => n.toLocaleString("en-IN");

  return (
    <div className="relative">
      <div className="mb-1 h-5 text-center text-[12px] font-medium text-ink">
        {hover ? (
          <span>
            {hover.name}: {hover.value != null ? fmt(hover.value) : "no data"}
          </span>
        ) : (
          <span className="text-ink-faint">Hover a state for its {valueName.toLowerCase()}</span>
        )}
      </div>
      <div className="mx-auto" style={{ maxWidth: 560 }}>
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ scale: 1050, center: [82.5, 22.6] }}
          width={560}
          height={620}
          style={{ width: "100%", height: "auto" }}
        >
          <Geographies geography={geo as any}>
            {({ geographies }: any) =>
              geographies.map((g: any) => {
                const entry = byState.get(norm(g.properties.st));
                const fill = entry ? color(entry.value) : NO_DATA;
                const display = entry?.display || g.properties.st;
                return (
                  <Geography
                    key={g.rsmKey}
                    geography={g}
                    fill={fill}
                    stroke="#ffffff"
                    strokeWidth={0.3}
                    onMouseEnter={() => setHover({ name: display, value: entry ? entry.value : null })}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => entry && onStateClick && onStateClick(entry.display)}
                    style={{
                      default: { outline: "none" },
                      hover: { outline: "none", opacity: 0.85, cursor: entry && onStateClick ? "pointer" : "default" },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>
      </div>
      {/* Legend */}
      <div className="mt-1 flex items-center justify-center gap-2 text-[11px] text-ink-muted">
        <span>{fmt(min)}</span>
        <span className="h-2 w-32 rounded" style={{ background: `linear-gradient(90deg, ${ramp(0)}, ${ramp(1)})` }} />
        <span>{fmt(max)}</span>
        <span className="ml-3 flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: NO_DATA }} /> no data
        </span>
      </div>
    </div>
  );
}
