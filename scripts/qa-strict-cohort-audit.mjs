// The same production audit serves the scheduled guardian and operator checks.
if (!process.env.CRON_SECRET) throw new Error('Production CRON_SECRET is required.');
const response = await fetch('https://www.intuneget.com/api/qa/cohort', {
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  signal: AbortSignal.timeout(290000),
});
if (!response.ok) throw new Error(`Authoritative cohort audit unavailable (${response.status}); count is unknown.`);
console.log(JSON.stringify(await response.json(), null, 2));
