import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  mode: "hosted" | "self-hosted";
  timestamp: string;
  services: {
    database: boolean;
    auth: boolean;
    pipeline: boolean;
  };
  version?: string;
}

export async function GET() {
  const startTime = Date.now();

  const status: HealthStatus = {
    status: "healthy",
    mode: process.env.VERCEL === "1" ? "hosted" : "self-hosted",
    timestamp: new Date().toISOString(),
    services: {
      database: false,
      auth: false,
      pipeline: false,
    },
  };

  // Check database connectivity
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.from("apps").select("id").limit(1);
      status.services.database = !error;
    }
  } catch {
    status.services.database = false;
  }

  // Check auth configuration
  status.services.auth = Boolean(
    process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID &&
    (process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET)
  );

  // Check pipeline configuration (uses private workflows repo)
  status.services.pipeline = Boolean(
    process.env.GITHUB_PAT &&
    process.env.GITHUB_OWNER &&
    process.env.GITHUB_WORKFLOWS_REPO
  );

  // Determine overall status
  const criticalServices = [status.services.database, status.services.auth];
  const allCritical = criticalServices.every(Boolean);
  const someCritical = criticalServices.some(Boolean);

  if (allCritical) {
    status.status = status.services.pipeline ? "healthy" : "degraded";
  } else if (someCritical) {
    status.status = "degraded";
  } else {
    status.status = "unhealthy";
  }

  const responseTime = Date.now() - startTime;

  return NextResponse.json(
    {
      ...status,
      responseTime: `${responseTime}ms`,
    },
    {
      status: status.status === "unhealthy" ? 503 : 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
