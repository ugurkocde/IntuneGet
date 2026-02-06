/**
 * Team Invitation Email Template
 * Email sent when a user is invited to join an MSP organization
 */

export interface TeamInvitationData {
  inviter_name: string;
  inviter_email: string;
  organization_name: string;
  role: string;
  accept_url: string;
  expires_at: Date;
}

function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => escapeMap[char] || char);
}

function formatRole(role: string): string {
  const roleMap: Record<string, string> = {
    owner: 'Owner',
    admin: 'Admin',
    operator: 'Operator',
    viewer: 'Viewer',
  };
  return roleMap[role] || role.charAt(0).toUpperCase() + role.slice(1);
}

function formatExpiryDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function generateTeamInvitationEmail(data: TeamInvitationData): {
  subject: string;
  html: string;
  text: string;
} {
  const safeInviterName = escapeHtml(data.inviter_name);
  const safeInviterEmail = escapeHtml(data.inviter_email);
  const safeOrgName = escapeHtml(data.organization_name);
  const formattedRole = formatRole(data.role);
  const formattedExpiry = formatExpiryDate(data.expires_at);

  const subject = `You've been invited to join ${data.organization_name} on IntuneGet`;

  const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Team Invitation</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 24px;">IntuneGet</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Team Invitation</p>
    </div>

    <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
      <h2 style="color: #111827; margin-top: 0; font-size: 20px;">You're invited to join ${safeOrgName}</h2>

      <p style="color: #6b7280; margin-bottom: 20px;">
        <strong>${safeInviterName}</strong> (${safeInviterEmail}) has invited you to join their organization on IntuneGet.
      </p>

      <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="color: #6b7280; padding: 4px 0;">Organization:</td>
            <td style="color: #111827; font-weight: 600; text-align: right;">${safeOrgName}</td>
          </tr>
          <tr>
            <td style="color: #6b7280; padding: 4px 0;">Your Role:</td>
            <td style="color: #111827; font-weight: 600; text-align: right;">${formattedRole}</td>
          </tr>
        </table>
      </div>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${data.accept_url}"
           style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
          Accept Invitation
        </a>
      </div>

      <div style="background: #fef3c7; border-radius: 8px; padding: 12px 16px; margin-top: 24px;">
        <p style="color: #92400e; margin: 0; font-size: 14px;">
          <strong>Note:</strong> This invitation expires on ${formattedExpiry}. You'll need to sign in with your Microsoft work account from the same organization.
        </p>
      </div>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

      <p style="color: #9ca3af; font-size: 12px; margin-bottom: 0;">
        If you weren't expecting this invitation or don't recognize the sender, you can safely ignore this email.
        No action will be taken if you don't accept.
      </p>
    </div>

    <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
      <p style="margin: 0 0 8px 0;">Sent by IntuneGet</p>
      <p style="margin: 0;">
        <a href="https://intuneget.com" style="color: #9ca3af; text-decoration: underline;">intuneget.com</a>
      </p>
    </div>
  </body>
</html>
`.trim();

  const text = `
You've been invited to join ${data.organization_name} on IntuneGet

${data.inviter_name} (${data.inviter_email}) has invited you to join their organization.

Organization: ${data.organization_name}
Your Role: ${formattedRole}

Accept your invitation:
${data.accept_url}

This invitation expires on ${formattedExpiry}.

You'll need to sign in with your Microsoft work account from the same organization.

If you weren't expecting this invitation, you can safely ignore this email.

---
Sent by IntuneGet
https://intuneget.com
`.trim();

  return { subject, html, text };
}
