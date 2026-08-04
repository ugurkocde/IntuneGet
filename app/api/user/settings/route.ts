import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';
import { DEFAULT_USER_SETTINGS } from '@/types/user-settings';
import type { UserSettings, UserSettingsUpdate } from '@/types/user-settings';

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isThemeMode(value: unknown): value is UserSettings['theme'] {
  return value === 'light' || value === 'dark';
}

function isStoredSettings(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isViewMode(value: unknown): value is UserSettings['viewMode'] {
  return value === 'grid' || value === 'list';
}

function sanitizeSettings(payload: Record<string, unknown>): UserSettingsUpdate {
  const updates: UserSettingsUpdate = {};

  if (isThemeMode(payload.theme)) {
    updates.theme = payload.theme;
  }

  if (isBoolean(payload.sidebarCollapsed)) {
    updates.sidebarCollapsed = payload.sidebarCollapsed;
  }

  if (typeof payload.selectedTenantId === 'string' || payload.selectedTenantId === null) {
    updates.selectedTenantId = payload.selectedTenantId;
  }

  if (isBoolean(payload.cartAutoOpenOnAdd)) {
    updates.cartAutoOpenOnAdd = payload.cartAutoOpenOnAdd;
  }

  if (isViewMode(payload.viewMode)) {
    updates.viewMode = payload.viewMode;
  }

  if (isBoolean(payload.quickStartDismissed)) {
    updates.quickStartDismissed = payload.quickStartDismissed;
  }

  if (isBoolean(payload.onboardingCompleted)) {
    updates.onboardingCompleted = payload.onboardingCompleted;
  }

  if (isBoolean(payload.carryOverAssignments)) {
    updates.carryOverAssignments = payload.carryOverAssignments;
  }

  if (isBoolean(payload.supersedePreviousApp)) {
    updates.supersedePreviousApp = payload.supersedePreviousApp;
  }

  return updates;
}

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // user_settings is a plain per-user JSON blob and exists in both backends,
    // so this goes through the db abstraction. It previously called
    // createServerClient() unconditionally, which throws without Supabase - so
    // in a self-hosted install these settings could never be read or saved,
    // and the update path silently fell back to "carry over off, no
    // supersedence" no matter what the toggles showed.
    const stored = await getDatabase().userSettings.get(user.userId);

    const sanitizedStoredSettings = isStoredSettings(stored)
      ? sanitizeSettings(stored as Record<string, unknown>)
      : {};
    const hasStoredSettings = Object.keys(sanitizedStoredSettings).length > 0;

    const merged = {
      ...DEFAULT_USER_SETTINGS,
      ...sanitizedStoredSettings,
    };

    return NextResponse.json({
      settings: merged,
      hasStoredSettings,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const payload = (await request.json()) as Record<string, unknown>;
    const settingsUpdate = sanitizeSettings(payload);

    if (Object.keys(settingsUpdate).length === 0) {
      return NextResponse.json(
        { error: 'No valid settings provided' },
        { status: 400 }
      );
    }

    // The adapter merges read-and-write in one step, so a concurrent save
    // cannot merge onto a stale base and drop the other one's keys.
    let mergedRow: Record<string, unknown>;
    try {
      mergedRow = await getDatabase().userSettings.merge(
        user.userId,
        settingsUpdate as Record<string, unknown>
      );
    } catch {
      return NextResponse.json(
        { error: 'Failed to update user settings' },
        { status: 500 }
      );
    }

    const updatedSettings = sanitizeSettings(
      isStoredSettings(mergedRow) ? mergedRow : (settingsUpdate as Record<string, unknown>)
    );

    return NextResponse.json({
      settings: {
        ...DEFAULT_USER_SETTINGS,
        ...updatedSettings,
      },
      hasStoredSettings: true,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
