import { Metadata } from "next";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle,
  HelpCircle,
  Github,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import {
  Callout,
  CodeBlock,
  Collapsible,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
} from "@/components/docs";

export const metadata: Metadata = {
  title: "Troubleshooting | IntuneGet Docs",
  description:
    "Common issues and solutions for IntuneGet self-hosting. FAQ and debugging guide.",
};

const faqs = [
  {
    question: "How long does the initial setup take?",
    answer:
      "The complete setup typically takes 1-2 hours if you follow the guide step by step. Most of this time is spent on Entra ID configuration. The actual deployment with Docker takes only a few minutes.",
  },
  {
    question: "Is IntuneGet really free to self-host?",
    answer:
      "Yes! IntuneGet is free and open source under the AGPL-3.0 license. The self-hosted version uses SQLite (embedded, no external service needed) and runs in Docker. There are no external database costs. If you use GitHub Actions for packaging (optional), private repos may incur costs after 2,000 minutes/month.",
  },
  {
    question: "Do I need admin access to create the Entra ID app registration?",
    answer:
      "You need permission to create app registrations, which is often available to all users by default. However, a Global Administrator is needed to grant admin consent for the application permissions that allow uploading to Intune.",
  },
  {
    question: "Can I use a different database instead of SQLite?",
    answer:
      "The self-hosted version uses SQLite by default, which requires zero configuration. The hosted version (intuneget.com) uses a different backend. For self-hosting, SQLite is recommended as it provides simple backups (just copy the file) and no external dependencies.",
  },
  {
    question: "How do I update my self-hosted instance?",
    answer:
      "Pull the latest changes from your upstream remote (git fetch upstream && git merge upstream/main), then redeploy. For Docker: docker-compose down && docker-compose build --no-cache && docker-compose up -d. Check release notes for any required migrations.",
  },
  {
    question: "Can multiple tenants use the same self-hosted instance?",
    answer:
      "Yes! IntuneGet is designed as a multi-tenant application. Users from different Microsoft 365 organizations can sign in and deploy apps to their respective Intune tenants, as long as their admin has granted consent. The MSP features provide additional multi-tenant management capabilities.",
  },
  {
    question: "How do I add custom apps not in Winget?",
    answer:
      "Currently, IntuneGet only supports apps available in the Winget repository. You can use the Unmanaged Apps feature to discover applications on your devices and manually link them to Winget packages if a match exists. Custom app support is on the roadmap for future releases.",
  },
  {
    question: "What are unmanaged apps and how do I use this feature?",
    answer:
      "Unmanaged apps are applications discovered on your Intune-managed devices that are not yet deployed through Intune. IntuneGet detects these apps, matches them against the Winget repository, and lets you claim them for deployment. This requires the DeviceManagementManagedDevices.Read.All permission.",
  },
  {
    question: "How do the MSP features work?",
    answer:
      "The MSP (Managed Service Provider) features allow you to manage multiple client tenants from a single dashboard. You can batch-deploy applications across tenants, manage team access with roles, configure webhooks for deployment notifications, view audit logs, and generate cross-tenant reports.",
  },
  {
    question: "How do webhooks and notifications work?",
    answer:
      "IntuneGet supports email notifications (real-time, daily digest, or critical-only) and webhooks for Slack, Microsoft Teams, Discord, or custom HTTP endpoints. Webhooks are signed with HMAC for security. Configure both in the Settings page under the Notifications tab.",
  },
];

export default function TroubleshootingPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          Troubleshooting
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          Solutions to common issues and frequently asked questions about
          self-hosting IntuneGet.
        </p>
      </div>

      {/* Quick Diagnosis */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Quick Diagnosis
        </h2>
        <p className="text-text-secondary mb-4">
          Start by checking the health endpoint to identify which components are
          working:
        </p>

        <CodeBlock language="bash">curl https://your-app.vercel.app/api/health</CodeBlock>

        <p className="text-text-secondary mt-4 mb-2">Expected response:</p>
        <CodeBlock language="json">
{`{
  "status": "healthy",
  "mode": "self-hosted",
  "services": {
    "database": true,
    "auth": true,
    "pipeline": true
  }
}`}
        </CodeBlock>

        <p className="text-text-secondary mt-4">
          If any service shows <code>false</code>, focus troubleshooting on that
          component.
        </p>
      </section>

      {/* Common Errors */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-6">
          Common Error Messages
        </h2>

        {/* Authentication Errors */}
        <h3 className="text-lg font-semibold text-text-primary mb-4 mt-8">
          Authentication Errors
        </h3>

        <div className="space-y-4">
          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              AADSTS50011: The reply URL specified in the request does not match
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              The redirect URI in your request doesn&apos;t match the configured
              URIs.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>Go to Azure Portal &gt; Your App Registration &gt; Authentication</li>
                <li>
                  Verify your URL is listed (e.g.,{" "}
                  <code className="text-accent-cyan">https://your-app.vercel.app</code>)
                </li>
                <li>Ensure it&apos;s added as a SPA redirect, not Web</li>
                <li>Check for trailing slashes - they must match exactly</li>
              </ol>
            </div>
          </div>

          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              AADSTS65001: The user or administrator has not consented
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              Admin consent has not been granted for your tenant.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>Contact your Global Administrator</li>
                <li>
                  Have them visit:{" "}
                  <code className="text-accent-cyan text-[10px] break-all">
                    https://login.microsoftonline.com/YOUR_TENANT/adminconsent?client_id=YOUR_CLIENT_ID
                  </code>
                </li>
                <li>They must click Accept on the consent screen</li>
              </ol>
            </div>
          </div>

          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              AADSTS700016: Application with identifier was not found
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              The client ID is incorrect or the app was deleted.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>
                  Verify NEXT_PUBLIC_AZURE_AD_CLIENT_ID is correct
                </li>
                <li>Check the app still exists in Entra ID</li>
                <li>
                  Compare the ID in your .env with the Overview page in Azure
                </li>
              </ol>
            </div>
          </div>
        </div>

        {/* Database & Packager Errors */}
        <h3 className="text-lg font-semibold text-text-primary mb-4 mt-8">
          Database & Packager Errors
        </h3>

        <div className="space-y-4">
          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Database not found / SQLite error
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              The SQLite database file cannot be accessed or created.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>Verify DATABASE_MODE is set to &quot;sqlite&quot;</li>
                <li>Check DATABASE_PATH points to a writable location (default: ./data/intuneget.db)</li>
                <li>Ensure the /data directory exists and has write permissions</li>
                <li>For Docker: verify the volume mount is configured correctly</li>
              </ol>
            </div>
          </div>

          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Packager API key invalid / Connection refused
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              The local packager cannot authenticate or connect to the web app.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>Verify PACKAGER_MODE is set to &quot;local&quot;</li>
                <li>Check PACKAGER_API_KEY matches between the web app and the packager service</li>
                <li>Ensure the packager Windows machine can reach your web app URL</li>
                <li>Verify NEXT_PUBLIC_URL is correct and accessible</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Unmanaged Apps Errors */}
        <h3 className="text-lg font-semibold text-text-primary mb-4 mt-8">
          Unmanaged Apps Errors
        </h3>

        <div className="space-y-4">
          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Permission error on Unmanaged Apps page
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              Missing DeviceManagementManagedDevices.Read.All permission.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>Go to Settings &gt; Permissions tab and run &quot;Check Permissions&quot;</li>
                <li>If the DeviceManagementManagedDevices.Read.All permission shows as missing, have a Global Administrator re-grant admin consent</li>
                <li>Add the permission in Azure Portal &gt; App Registration &gt; API Permissions if it is not listed</li>
              </ol>
            </div>
          </div>

          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Webhook delivery failed
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              Webhook notifications are not being received by the target endpoint.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>Verify the webhook URL is correct and publicly accessible</li>
                <li>Check the webhook delivery logs in Settings &gt; Notifications</li>
                <li>Ensure the endpoint accepts POST requests with JSON payloads</li>
                <li>For Slack/Teams/Discord, verify the incoming webhook URL has not been revoked</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Pipeline Errors */}
        <h3 className="text-lg font-semibold text-text-primary mb-4 mt-8">
          Pipeline Errors
        </h3>

        <div className="space-y-4">
          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Workflow not triggering
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              Deployments get stuck in &quot;pending&quot; status.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>Verify GITHUB_PAT has repo and workflow scopes</li>
                <li>Check workflows are enabled in your fork&apos;s Actions tab</li>
                <li>Verify GITHUB_OWNER and GITHUB_REPO match your fork</li>
                <li>Check the PAT hasn&apos;t expired</li>
              </ol>
            </div>
          </div>

          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Callback verification failed
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              Pipeline completes but status doesn&apos;t update.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>
                  Verify CALLBACK_SECRET matches in both GitHub Secrets and .env
                </li>
                <li>Check NEXT_PUBLIC_URL is accessible from the internet</li>
                <li>Look at the workflow run logs in GitHub Actions</li>
              </ol>
            </div>
          </div>

          <div className="rounded-lg border border-status-error/20 bg-status-error/5 p-4">
            <h4 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              IntuneWinAppUtil failed
            </h4>
            <p className="text-sm text-text-secondary mb-3">
              Packaging fails for specific apps.
            </p>
            <div className="rounded bg-white p-3">
              <p className="text-xs font-semibold text-text-secondary mb-2">Solution:</p>
              <ol className="list-decimal list-inside text-xs text-text-secondary space-y-1">
                <li>Check the app exists in Winget: winget show {"{app-id}"}</li>
                <li>Verify the app has a supported installer type</li>
                <li>Check workflow logs for specific error messages</li>
                <li>Some apps may not be compatible with IntuneWinAppUtil</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* Debugging Tips */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Debugging Tips
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-semibold text-text-primary mb-2">Check Logs</h3>
            <p className="text-sm text-text-secondary mb-3">
              Vercel: Dashboard &gt; Your Project &gt; Logs
            </p>
            <p className="text-sm text-text-secondary">
              Docker: <code>docker-compose logs -f</code>
            </p>
          </div>

          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-semibold text-text-primary mb-2">Browser Console</h3>
            <p className="text-sm text-text-secondary">
              Press F12 and check the Console and Network tabs for errors and
              failed requests.
            </p>
          </div>

          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-semibold text-text-primary mb-2">GitHub Actions</h3>
            <p className="text-sm text-text-secondary">
              Check your fork&apos;s Actions tab for workflow run details and
              error messages.
            </p>
          </div>

          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-semibold text-text-primary mb-2">Environment Check</h3>
            <p className="text-sm text-text-secondary">
              Verify all environment variables are set. Missing or incorrect
              values cause most issues.
            </p>
          </div>
        </div>
      </section>

      {/* Environment Variable Checklist */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Environment Variable Checklist
        </h2>
        <p className="text-text-secondary mb-4">
          Verify each variable is set correctly:
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Variable</TableHeader>
              <TableHeader>Check</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>
                <code className="text-xs text-accent-cyan">
                  DATABASE_MODE
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Set to &quot;sqlite&quot; for self-hosted deployments
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-xs text-accent-cyan">
                  DATABASE_PATH
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Path to SQLite file (default: ./data/intuneget.db)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-xs text-accent-cyan">
                  PACKAGER_MODE
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Set to &quot;local&quot; for the local packager service
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-xs text-accent-cyan">
                  PACKAGER_API_KEY
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Shared secret between web app and packager service
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-xs text-accent-cyan">
                  NEXT_PUBLIC_AZURE_AD_CLIENT_ID
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-xs text-accent-cyan">
                  AZURE_CLIENT_SECRET
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Should not be expired, contains ~
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-xs text-accent-cyan">NEXT_PUBLIC_URL</code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Full URL with https://, no trailing slash
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* FAQ */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-6">
          Frequently Asked Questions
        </h2>

        <div className="space-y-3">
          {faqs.map((faq, index) => (
            <Collapsible key={index} title={faq.question}>
              <p className="text-text-secondary leading-relaxed">{faq.answer}</p>
            </Collapsible>
          ))}
        </div>
      </section>

      {/* Getting Help */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Getting Help</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <a
            href="https://github.com/ugurkocde/IntuneGet/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-black/10 bg-white p-6 hover:border-accent-cyan/30 hover:bg-bg-elevated transition-all"
          >
            <div className="flex items-center gap-3 mb-3">
              <Github className="h-6 w-6 text-accent-cyan" />
              <h3 className="font-semibold text-text-primary">GitHub Issues</h3>
            </div>
            <p className="text-sm text-text-secondary">
              Report bugs or request features. Search existing issues first to see
              if your problem has been solved.
            </p>
          </a>

        </div>

        <Callout type="info" title="Before Opening an Issue">
          <ul className="list-disc list-inside space-y-1">
            <li>Search existing issues for similar problems</li>
            <li>Include your deployment method (Vercel, Docker, etc.)</li>
            <li>Share relevant error messages (redact sensitive info)</li>
            <li>Describe what you expected vs. what happened</li>
          </ul>
        </Callout>
      </section>

      {/* Back to Docs */}
      <section className="rounded-lg border border-black/10 bg-white p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3">
          Still Need Help?
        </h2>
        <p className="text-text-secondary mb-4">
          Review the detailed setup guides for each component:
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/docs/azure-setup"
            className="text-sm text-accent-cyan hover:underline"
          >
            Entra ID Setup
          </Link>
          <span className="text-text-muted">|</span>
          <Link
            href="/docs/database-setup"
            className="text-sm text-accent-cyan hover:underline"
          >
            Database Setup
          </Link>
          <span className="text-text-muted">|</span>
          <Link
            href="/docs/github-setup"
            className="text-sm text-accent-cyan hover:underline"
          >
            GitHub Setup
          </Link>
          <span className="text-text-muted">|</span>
          <Link
            href="/docs/docker"
            className="text-sm text-accent-cyan hover:underline"
          >
            Docker Deployment
          </Link>
        </div>
      </section>
    </div>
  );
}
