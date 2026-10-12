-- Remove unused Microsoft token columns from user_profiles.
--
-- IntuneGet does not persist user Microsoft access or refresh tokens. The only
-- code that wrote these columns (storeUserProfile in lib/auth.ts and
-- updateMicrosoftTokens in lib/supabase.ts) had no call sites and has been
-- removed. Privileged Graph access runs server-side with an application
-- permission through the service principal, so user tokens are not needed.
--
-- A production audit on 2026-09-18 found zero non-null values across
-- microsoft_access_token, microsoft_refresh_token, and token_expires_at in all
-- 305 user_profiles rows.
--
-- If token persistence is implemented later, add the columns back with an
-- explicit, documented storage and retention design instead of restoring them
-- silently.

ALTER TABLE user_profiles
  DROP COLUMN IF EXISTS microsoft_access_token,
  DROP COLUMN IF EXISTS microsoft_refresh_token,
  DROP COLUMN IF EXISTS token_expires_at;
