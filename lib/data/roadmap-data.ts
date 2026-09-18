export type RoadmapCategory =
  | "package-quality"
  | "rollout-control"
  | "fleet-visibility"
  | "catalog"
  | "integrations"
  | "msp"
  | "trust";

export type RoadmapStageId = "shipped" | "in-progress" | "next-up" | "exploring";

export interface RoadmapItem {
  title: string;
  description: string;
  category: RoadmapCategory;
}

export interface RoadmapStage {
  id: RoadmapStageId;
  title: string;
  timeframe: string;
  items: RoadmapItem[];
}

export const categoryLabels: Record<RoadmapCategory, string> = {
  "package-quality": "Package quality",
  "rollout-control": "Rollout control",
  "fleet-visibility": "Fleet visibility",
  catalog: "Catalog",
  integrations: "Integrations",
  msp: "MSP",
  trust: "Trust",
};

export const roadmapStages: RoadmapStage[] = [
  {
    id: "shipped",
    title: "Shipped",
    timeframe: "Live today",
    items: [
      {
        title: "Winget app catalog",
        description:
          "10,000+ apps synced hourly from winget-pkgs, with locale variants, Microsoft Store apps, and custom apps by URL.",
        category: "catalog",
      },
      {
        title: "PSADT v4 packaging",
        description:
          "Automated intunewin builds with generated detection rules, install commands, and a full dialog and branding surface.",
        category: "package-quality",
      },
      {
        title: "Auto-updates with policies",
        description:
          "Per-app auto update, notify, ignore, and pin policies with failure thresholds, cooldowns, and update history.",
        category: "rollout-control",
      },
      {
        title: "Supersedence and carry-over",
        description:
          "New versions supersede the old app and inherit its assignments, categories, and relationships.",
        category: "rollout-control",
      },
      {
        title: "Unmanaged app discovery",
        description:
          "Scan Intune discovered apps, match them to winget packages, and take over management with one click.",
        category: "fleet-visibility",
      },
      {
        title: "MSP multi-tenant",
        description:
          "Customer tenants with consent tracking, roles, batch cross-tenant deployments, audit logs, and webhooks.",
        category: "msp",
      },
      {
        title: "SCCM migration",
        description:
          "Import, match, preview, and convert ConfigMgr apps into the packaging pipeline.",
        category: "integrations",
      },
      {
        title: "ESP deployment integration",
        description:
          "Add newly deployed apps to Enrollment Status Page profiles during deployment.",
        category: "integrations",
      },
      {
        title: "Self-hosting",
        description:
          "AGPL source, Docker, SQLite mode, and a local Windows packager CLI. Run everything on your own terms.",
        category: "trust",
      },
    ],
  },
  {
    id: "in-progress",
    title: "In Progress",
    timeframe: "Q3 2026 target",
    items: [
      {
        title: "Package verification pipeline",
        description:
          "Every package installs and uninstalls in an isolated Windows VM before release, with a published test report.",
        category: "package-quality",
      },
      {
        title: "Deployment waves",
        description:
          "Pilot group first, then the fleet, with configurable delays, success thresholds, and an optional approval gate.",
        category: "rollout-control",
      },
      {
        title: "Installer malware scanning",
        description:
          "Every downloaded installer is scanned before packaging and blocked on detections.",
        category: "trust",
      },
      {
        title: "Version retention policy",
        description:
          "Keep a set number of previous versions per app and clean up superseded apps in Intune automatically.",
        category: "rollout-control",
      },
    ],
  },
  {
    id: "next-up",
    title: "Next Up",
    timeframe: "Q4 2026 target",
    items: [
      {
        title: "CVE visibility",
        description:
          "See exactly which tenants and apps are running versions with known vulnerabilities.",
        category: "fleet-visibility",
      },
      {
        title: "Rollback",
        description:
          "One action to redeploy the previous version and supersede a bad update.",
        category: "rollout-control",
      },
      {
        title: "PSADT script signing",
        description:
          "Sign generated scripts with your own certificate or a managed per-organization certificate.",
        category: "trust",
      },
      {
        title: "ESP auto version update",
        description:
          "Enrollment Status Page references update automatically when a new version supersedes.",
        category: "integrations",
      },
      {
        title: "Public REST API",
        description:
          "API keys and documented endpoints for catalog search, packaging jobs, update policies, and batch deployments.",
        category: "integrations",
      },
      {
        title: "Scheduled deployments",
        description:
          "Queue a deployment or update for a specific date, time, and timezone, per tenant.",
        category: "rollout-control",
      },
      {
        title: "XLSX report export",
        description: "Export deployment and update reports as CSV, JSON, or XLSX.",
        category: "fleet-visibility",
      },
    ],
  },
  {
    id: "exploring",
    title: "Exploring",
    timeframe: "2027",
    items: [
      {
        title: "Custom app binary upload",
        description:
          "Upload licensed or private installers directly instead of pointing at a public URL.",
        category: "catalog",
      },
      {
        title: "Maintenance windows",
        description:
          "Tenant-level windows that control when auto-updates are allowed to run.",
        category: "rollout-control",
      },
      {
        title: "Endpoint agent",
        description:
          "A lightweight agent for self-service installs and faster update enforcement on managed devices.",
        category: "integrations",
      },
    ],
  },
];
