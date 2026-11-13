DO $migration$
DECLARE
  existing_definition text;
BEGIN
  IF to_regclass('public.user_notifications') IS NULL THEN
    RETURN;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO existing_definition
  FROM pg_constraint
  WHERE conrelid = 'public.user_notifications'::regclass
    AND conname = 'user_notifications_type_check' AND contype = 'c';

  IF existing_definition = $expected$CHECK ((type = ANY (ARRAY['deployment_complete'::text, 'deployment_failed'::text, 'consent_expired'::text, 'consent_revoked'::text, 'suggestion_approved'::text, 'suggestion_implemented'::text, 'member_joined'::text, 'member_removed'::text, 'feedback_received'::text, 'update_available'::text, 'deployment_waiting'::text])))$expected$ THEN
    RETURN;
  END IF;
  IF existing_definition IS DISTINCT FROM $expected$CHECK ((type = ANY (ARRAY['deployment_complete'::text, 'deployment_failed'::text, 'consent_expired'::text, 'consent_revoked'::text, 'suggestion_approved'::text, 'suggestion_implemented'::text, 'member_joined'::text, 'member_removed'::text, 'feedback_received'::text, 'update_available'::text])))$expected$ THEN
    RAISE EXCEPTION 'Unexpected user notification type constraint';
  END IF;

  ALTER TABLE public.user_notifications DROP CONSTRAINT user_notifications_type_check;
  ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_type_check
    CHECK (type IN ('deployment_complete', 'deployment_failed', 'consent_expired', 'consent_revoked', 'suggestion_approved', 'suggestion_implemented', 'member_joined', 'member_removed', 'feedback_received', 'update_available', 'deployment_waiting'));
END
$migration$;
