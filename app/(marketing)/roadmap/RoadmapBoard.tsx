import { T, Var } from "gt-next";
import {
  categoryLabels,
  roadmapStages,
  type RoadmapStageId,
} from "@/lib/data/roadmap-data";

const stageStyles: Record<RoadmapStageId, { title: string; badge: string }> = {
  shipped: {
    title: "text-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  "in-progress": {
    title: "text-accent-cyan",
    badge: "bg-accent-cyan/10 text-accent-cyan",
  },
  "next-up": {
    title: "text-amber-500",
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  exploring: {
    title: "text-violet-500",
    badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
};

export function RoadmapBoard() {
  return (
    <div className="space-y-14">
      {roadmapStages.map((stage) => {
        const style = stageStyles[stage.id];

        return (
          <section
            key={stage.id}
            id={stage.id}
            aria-label={stage.title}
            className="scroll-mt-28"
          >
            <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className={`text-2xl font-bold ${style.title}`}>
                <T>{stage.title}</T>
              </h2>
              <span className="font-mono text-xs text-text-muted">
                <T>{stage.timeframe}</T>
                <span className="mx-2 text-overlay/40">/</span>
                <Var>{stage.items.length}</Var> <T>items</T>
              </span>
            </div>

            <div className="overflow-hidden rounded-xl border border-overlay/10 bg-bg-elevated shadow-soft">
              <div className="hidden border-b border-overlay/10 px-5 py-3 font-mono text-[11px] uppercase tracking-wider text-text-muted md:grid md:grid-cols-[230px_160px_1fr] md:gap-4">
                <span>
                  <T>Feature</T>
                </span>
                <span>
                  <T>Category</T>
                </span>
                <span>
                  <T>Description</T>
                </span>
              </div>
              <div className="divide-y divide-overlay/10">
                {stage.items.map((item) => (
                  <div
                    key={item.title}
                    className="grid grid-cols-1 gap-1.5 px-5 py-4 md:grid-cols-[230px_160px_1fr] md:items-baseline md:gap-4"
                  >
                    <h3 className="text-sm font-semibold text-text-primary">
                      <T>{item.title}</T>
                    </h3>
                    <span>
                      <span
                        className={`inline-block rounded px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${style.badge}`}
                      >
                        <T>{categoryLabels[item.category]}</T>
                      </span>
                    </span>
                    <p className="text-sm leading-relaxed text-text-secondary">
                      <T>{item.description}</T>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
