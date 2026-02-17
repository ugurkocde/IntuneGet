import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
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

    const supabase = createServerClient() as ReturnType<typeof createServerClient> & {
      from: (relation: string, ...args: unknown[]) => any;
    };

    const { data, error } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', user.userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch user settings' },
        { status: 500 }
      );
    }

    const storedSettings = isStoredSettings(data?.settings)
      ? (data?.settings as Record<string, unknown>)
      : undefined;
    const sanitizedStoredSettings = storedSettings
      ? sanitizeSettings(storedSettings)
      : {};
    const hasStoredSettings =
      data !== null &&
      data !== undefined &&
      Object.keys(sanitizedStoredSettings).length > 0;

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

    const supabase = createServerClient() as ReturnType<typeof createServerClient> & {
      from: (relation: string, ...args: unknown[]) => any;
    };

    const { data: existingRow, error: fetchError } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', user.userId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { error: 'Failed to update user settings' },
        { status: 500 }
      );
    }

    const existingSettings = sanitizeSettings(
      isStoredSettings(existingRow?.settings)
        ? (existingRow?.settings as Record<string, unknown>)
        : {}
    );

    const mergedSettings: UserSettingsUpdate = {
      ...existingSettings,
      ...settingsUpdate,
    };

    const { data: updatedRow, error: upsertError } = await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: user.userId,
          settings: mergedSettings,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select('settings')
      .single();

    if (upsertError) {
      return NextResponse.json(
        { error: 'Failed to update user settings' },
        { status: 500 }
      );
    }

    if (!updatedRow) {
      return NextResponse.json(
        { error: 'Failed to read updated user settings' },
        { status: 500 }
      );
    }

    const updatedStoredSettings = isStoredSettings(updatedRow.settings)
      ? (updatedRow.settings as Record<string, unknown>)
      : mergedSettings;
    const updatedSettings = sanitizeSettings(updatedStoredSettings);

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
