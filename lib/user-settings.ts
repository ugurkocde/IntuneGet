import type { UserSettingsResponse, StoredUserSettingsUpdate } from "@/types/user-settings";

const USER_SETTINGS_ENDPOINT = "/api/user/settings";

export async function getUserSettings(
  accessToken: string
): Promise<UserSettingsResponse> {
  const response = await fetch(USER_SETTINGS_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message =
      data && typeof data.error === "string" ? data.error : "Failed to load user settings";
    throw new Error(message);
  }

  const payload = (await response.json()) as UserSettingsResponse;
  return payload;
}

export async function patchUserSettings(
  accessToken: string,
  settings: StoredUserSettingsUpdate
): Promise<UserSettingsResponse> {
  const response = await fetch(USER_SETTINGS_ENDPOINT, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message =
      data && typeof data.error === "string" ? data.error : "Failed to update user settings";
    throw new Error(message);
  }

  const payload = (await response.json()) as UserSettingsResponse;
  return payload;
}
