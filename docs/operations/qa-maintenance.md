# Manual QA maintenance

Set server-only `QA_MAINTENANCE_MODE=true` in the production Vercel environment and deploy. This setting has no timer: it remains active until explicitly disabled and redeployed.

Customer uploads skip QA demand and prior QA outcomes, create no new QA candidates, and proceed through normal packaging validation. Existing customer jobs awaiting QA are resumed by the normal cron. No QA pass is fabricated. Automatic updates retain their QA gates. Catalog scanning and dispatch remain paused.

The public QA page shows a maintenance message instead of current, queued, or historical apps. The live JSON returns no app data and frame GET returns 204. Existing candidates and results remain in storage.

To resume: bring the runner online, verify its health and packager compatibility, set QA_MAINTENANCE_MODE=false and redeploy. Disable/remove QA_DEFERRED_CUSTOMER_UPLOADS_UNTIL to restore strict customer QA even if its old continuity window has not expired. Then explicitly clear the database qa_pipeline_control pause through the established operator procedure. Clearing maintenance alone does not clear that independent pause.
