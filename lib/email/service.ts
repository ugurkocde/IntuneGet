/**
 * Email Service
 * Handles sending emails via Resend
 */

import { Resend } from 'resend';
import type { EmailTemplateData, NotificationPayload } from '@/types/notifications';
import { generateUpdateNotificationEmail } from './templates/update-notification';
import { generateTeamInvitationEmail, type TeamInvitationData } from './templates/team-invitation';

// Initialize Resend client lazily
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY environment variable is not set');
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

// Default sender email
const DEFAULT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'IntuneGet <updates@intuneget.com>';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a generic email
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  try {
    const resend = getResendClient();

    const { data, error } = await resend.emails.send({
      from: DEFAULT_FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    if (error) {
      console.error('Resend error:', error);
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      messageId: data?.id,
    };
  } catch (error) {
    console.error('Email send error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send app update notification email
 */
export async function sendUpdateNotificationEmail(
  to: string,
  payload: NotificationPayload,
  userName?: string
): Promise<SendEmailResult> {
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://intuneget.com';

  const templateData: EmailTemplateData = {
    user_name: userName,
    updates: payload.updates,
    summary: payload.summary,
    tenant_name: payload.tenant_name,
    dashboard_url: `${dashboardUrl}/dashboard`,
  };

  const { subject, html, text } = generateUpdateNotificationEmail(templateData);

  return sendEmail({
    to,
    subject,
    html,
    text,
  });
}

/**
 * Send team invitation email
 */
export async function sendTeamInvitationEmail(
  to: string,
  data: Omit<TeamInvitationData, 'accept_url'> & { token: string }
): Promise<SendEmailResult> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL || 'https://intuneget.com';
  const acceptUrl = `${baseUrl.replace(/\/$/, '')}/msp/invite/accept?token=${data.token}`;

  const templateData: TeamInvitationData = {
    inviter_name: data.inviter_name,
    inviter_email: data.inviter_email,
    organization_name: data.organization_name,
    role: data.role,
    accept_url: acceptUrl,
    expires_at: data.expires_at,
  };

  const { subject, html, text } = generateTeamInvitationEmail(templateData);

  return sendEmail({
    to,
    subject,
    html,
    text,
  });
}

/**
 * Send test email to verify configuration
 */
export async function sendTestEmail(to: string): Promise<SendEmailResult> {
  const subject = 'IntuneGet - Email Notifications Enabled';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test Email</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">IntuneGet</h1>
        </div>

        <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <h2 style="color: #111827; margin-top: 0;">Email Notifications Enabled</h2>

          <p style="color: #6b7280;">
            This is a test email to confirm that your email notification settings are working correctly.
          </p>

          <p style="color: #6b7280;">
            You will now receive notifications when updates are available for your deployed Intune applications.
          </p>

          <div style="margin-top: 24px; padding: 16px; background: #ecfdf5; border-radius: 8px; border-left: 4px solid #10b981;">
            <p style="color: #065f46; margin: 0; font-weight: 500;">
              Configuration successful!
            </p>
          </div>

          <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
            If you did not request this email, you can safely ignore it.
          </p>
        </div>

        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
          <p style="margin: 0;">Sent by IntuneGet</p>
        </div>
      </body>
    </html>
  `;

  const text = `
IntuneGet - Email Notifications Enabled

This is a test email to confirm that your email notification settings are working correctly.

You will now receive notifications when updates are available for your deployed Intune applications.

Configuration successful!

If you did not request this email, you can safely ignore it.

Sent by IntuneGet
  `.trim();

  return sendEmail({
    to,
    subject,
    html,
    text,
  });
}

/**
 * Check if email service is configured
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
