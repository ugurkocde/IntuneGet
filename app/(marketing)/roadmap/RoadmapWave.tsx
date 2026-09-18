import { T, Var } from "gt-next";
import { roadmapStages } from "@/lib/data/roadmap-data";

interface Station {
  id: string;
  title: string;
  timeframe: string;
  count: number;
  dot: string;
  line: string;
  pill: string;
}

const stationStyles: Record<
  string,
  { dot: string; line: string; pill: string }
> = {
  shipped: {
    dot: "bg-emerald-500",
    line: "bg-gradient-to-b from-emerald-500/50 to-emerald-500/5",
    pill: "border-emerald-500/30 text-emerald-500",
  },
  "in-progress": {
    dot: "bg-accent-cyan",
    line: "bg-gradient-to-b from-accent-cyan/50 to-accent-cyan/5",
    pill: "border-accent-cyan/30 text-accent-cyan",
  },
  "next-up": {
    dot: "bg-amber-500",
    line: "bg-gradient-to-b from-amber-500/50 to-amber-500/5",
    pill: "border-amber-500/30 text-amber-500",
  },
  exploring: {
    dot: "bg-violet-500",
    line: "bg-gradient-to-b from-violet-500/50 to-violet-500/5",
    pill: "border-violet-500/30 text-violet-500",
  },
};

const stations: Station[] = roadmapStages.map((stage) => ({
  id: stage.id,
  title: stage.title,
  timeframe: stage.timeframe,
  count: stage.items.length,
  ...stationStyles[stage.id],
}));

function StationNode({ id }: { id: string }) {
  if (id === "shipped") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 transition-transform group-hover:scale-110">
        <svg
          className="h-3 w-3 text-white"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3.5 8.5l3 3 6-6.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (id === "in-progress") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-accent-cyan bg-bg-deepest ring-4 ring-accent-cyan/15 transition-transform group-hover:scale-110">
        <span className="h-2.5 w-2.5 rounded-full bg-accent-cyan motion-safe:animate-pulse" />
      </span>
    );
  }
  if (id === "next-up") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-amber-500 bg-bg-deepest transition-transform group-hover:scale-110">
        <span className="h-2 w-2 rounded-full border-2 border-amber-500" />
      </span>
    );
  }
  return (
    <span className="h-6 w-6 rounded-full border-2 border-dashed border-violet-500 bg-bg-deepest transition-transform group-hover:scale-110" />
  );
}

export function RoadmapWave() {
  return (
    <div aria-label="Roadmap timeline">
      {/* Desktop wave timeline */}
      <div className="relative hidden h-[340px] md:block">
        <svg
          className="absolute inset-x-0 bottom-0 h-[240px] w-full"
          viewBox="0 0 1200 280"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="roadmap-wave-stroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0.125" stopColor="#10b981" />
              <stop offset="0.375" stopColor="#06b6d4" />
              <stop offset="0.625" stopColor="#f59e0b" />
              <stop offset="0.875" stopColor="#8b5cf6" />
            </linearGradient>
            <linearGradient id="roadmap-wave-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#06b6d4" stopOpacity="0.16" />
              <stop offset="1" stopColor="#06b6d4" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M 0 225 C 75 225 75 120 150 120 C 225 120 225 235 300 235 C 375 235 375 120 450 120 C 525 120 525 218 600 218 C 675 218 675 120 750 120 C 825 120 825 230 900 230 C 975 230 975 120 1050 120 C 1125 120 1125 222 1200 222 L 1200 280 L 0 280 Z"
            fill="url(#roadmap-wave-fill)"
          />
          <path
            d="M 0 225 C 75 225 75 120 150 120 C 225 120 225 235 300 235 C 375 235 375 120 450 120 C 525 120 525 218 600 218 C 675 218 675 120 750 120 C 825 120 825 230 900 230 C 975 230 975 120 1050 120 C 1125 120 1125 222 1200 222"
            fill="none"
            stroke="url(#roadmap-wave-stroke)"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>

        <div className="absolute inset-0 grid grid-cols-4">
          {stations.map((station) => (
            <a
              key={station.id}
              href={`#${station.id}`}
              className="group relative block h-full"
            >
              {/* dot at the top of the connector */}
              <span
                className={`absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 rounded-full ${station.dot}`}
              />
              {/* connector line down to the wave node */}
              <span
                className={`absolute left-1/2 top-3 h-[179px] w-px ${station.line}`}
              />
              {/* label */}
              <span className="absolute left-1/2 top-0 block pl-4 pr-2">
                <span className="block text-lg font-bold text-text-primary transition-colors group-hover:text-accent-cyan">
                  <T>{station.title}</T>
                </span>
                <span className="mt-0.5 block font-mono text-xs text-text-muted">
                  <T>{station.timeframe}</T>
                </span>
                <span className="mt-1 block font-mono text-xs text-text-muted">
                  <Var>{station.count}</Var> <T>items</T>
                </span>
              </span>
              {/* node sitting on the wave crest */}
              <span className="absolute left-1/2 top-[203px] -translate-x-1/2 -translate-y-1/2">
                <StationNode id={station.id} />
              </span>
            </a>
          ))}
        </div>
      </div>

      {/* Mobile fallback */}
      <div className="grid grid-cols-2 gap-2 md:hidden">
        {stations.map((station) => (
          <a
            key={station.id}
            href={`#${station.id}`}
            className={`flex items-center justify-between rounded-xl border bg-bg-elevated px-4 py-3 ${station.pill}`}
          >
            <span>
              <span className="block text-sm font-semibold text-text-primary">
                <T>{station.title}</T>
              </span>
              <span className="block font-mono text-[11px] text-text-muted">
                <T>{station.timeframe}</T>
              </span>
            </span>
            <span className="font-mono text-xs">
              <Var>{station.count}</Var>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
