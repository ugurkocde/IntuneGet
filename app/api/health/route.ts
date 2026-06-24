import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getDatabase, getDatabaseMode } from "@/lib/db";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  mode: "hosted" | "self-hosted";
  databaseMode: "sqlite" | "supabase";
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

  const databaseMode = getDatabaseMode();

  const status: HealthStatus = {
    status: "healthy",
    mode: process.env.VERCEL === "1" ? "hosted" : "self-hosted",
    databaseMode,
    timestamp: new Date().toISOString(),
    services: {
      database: false,
      auth: false,
      pipeline: false,
    },
  };

  // Check database connectivity
  try {
    if (databaseMode === "sqlite") {
      // Triggers SQLite file creation and schema init on first call
      await getDatabase().jobs.getStats();
      status.services.database = true;
    } else {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { error } = await supabase.from("apps").select("id").limit(1);
        status.services.database = !error;
      }
    }
  } catch {
    status.services.database = false;
  }

  // Check auth configuration. Managed-identity mode needs no secret; otherwise a
  // client id plus a client secret is required.
  const managedIdentity = (process.env.AZURE_AUTH_MODE || '').toLowerCase() === 'managed-identity';
  status.services.auth = managedIdentity || Boolean(
    (process.env.AZURE_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID) &&
    (process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET)
  );

  // Check pipeline configuration (GitHub Actions or local packager)
  const localPackager = process.env.PACKAGER_MODE === "local";
  const githubPipeline = Boolean(
    process.env.GITHUB_PAT &&
    process.env.GITHUB_OWNER &&
    process.env.GITHUB_WORKFLOWS_REPO
  );
  status.services.pipeline = localPackager || githubPipeline;

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
