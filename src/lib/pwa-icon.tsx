import { ImageResponse } from "next/og";

/** Opaque home-screen icon: white top-down airplane on a blue grid. Shapes only, no fonts. */
export function pwaIcon(size: number, safe = 1): ImageResponse {
  const s = size * safe;
  const off = (size - s) / 2;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", background: "#1d4ed8" }}>
        <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <g transform={`translate(${(off / size) * 100} ${(off / size) * 100}) scale(${safe})`}>
            <g stroke="#3b6ef0" strokeWidth="1.5">
              {[20, 40, 60, 80].map((p) => (
                <line key={`v${p}`} x1={p} y1="8" x2={p} y2="92" />
              ))}
              {[20, 40, 60, 80].map((p) => (
                <line key={`h${p}`} x1="8" y1={p} x2="92" y2={p} />
              ))}
            </g>
            <polygon
              fill="#ffffff"
              points="50,12 56,30 56,42 90,62 90,70 56,60 56,76 66,84 66,90 50,86 34,90 34,84 44,76 44,60 10,70 10,62 44,42 44,30"
            />
          </g>
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
