"use client";

import { useEffect } from "react";
import { MicrosoftAuthProvider } from "@/components/providers/MicrosoftAuthProvider";
import { useMicrosoftAuth } from "@/hooks/useMicrosoftAuth";
import { useProfileStore } from "@/stores/profile-store";
import { cn } from "@/lib/utils";

interface AuthedAvatarProps {
  size?: "sm" | "md";
}

function AvatarInner({ size = "sm" }: AuthedAvatarProps) {
  const { isAuthenticated, user, getAccessToken } = useMicrosoftAuth();
  const { profileImage, fetchProfileImage, hasFetched } = useProfileStore();
  const initials = user?.name?.charAt(0) || user?.email?.charAt(0) || "U";

  useEffect(() => {
    if (isAuthenticated && !hasFetched) {
      getAccessToken().then((token) => {
        if (token) fetchProfileImage(token);
      });
    }
  }, [isAuthenticated, hasFetched, getAccessToken, fetchProfileImage]);

  if (!isAuthenticated) {
    // MSAL still initializing, or the hint cookie was stale (no real
    // session): show the neutral placeholder instead of a bogus "U" avatar.
    // In the stale case MicrosoftAuthProvider clears the cookie and notifies
    // useAuthHint, so the Header swaps back to the signed-out state.
    return (
      <div className="relative flex-shrink-0">
        <div
          className={cn(
            "relative rounded-full bg-overlay/[0.06]",
            size === "sm" ? "w-8 h-8" : "w-9 h-9"
          )}
        />
      </div>
    );
  }

  return (
    <div className="relative flex-shrink-0">
      <div className="absolute -inset-0.5 bg-gradient-to-br from-accent-cyan to-accent-cyan-dim rounded-full opacity-75 group-hover:opacity-100 transition-opacity" />
      <div
        className={cn(
          "relative rounded-full bg-overlay/[0.06] flex items-center justify-center overflow-hidden",
          size === "sm" ? "w-8 h-8" : "w-9 h-9"
        )}
      >
        {profileImage ? (
          <img
            src={profileImage}
            alt="Profile"
            width={32}
            height={32}
            className="w-full h-full object-cover"
            onError={() => useProfileStore.getState().setProfileImage(null)}
          />
        ) : (
          <span className="text-sm font-semibold text-text-secondary">
            {initials}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Signed-in avatar for the marketing header. Mounts its own
 * MicrosoftAuthProvider because public pages render without the app provider
 * stack; the Header only mounts this (via next/dynamic) when the
 * msal-auth-hint cookie says the visitor is signed in, so anonymous visitors
 * never download MSAL.
 */
export function AuthedAvatar({ size = "sm" }: AuthedAvatarProps) {
  return (
    <MicrosoftAuthProvider>
      <AvatarInner size={size} />
    </MicrosoftAuthProvider>
  );
}
