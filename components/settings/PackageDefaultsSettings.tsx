'use client';

import { useState } from 'react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useUserSettings } from '@/components/providers/UserSettingsProvider';
import { pickPackageDefaults } from '@/lib/package-defaults';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { PackageDefaults } from '@/types/user-settings';

const BOOLEAN_FIELDS = [
  ['showClosePrompt', 'Show close prompt'],
  ['blockExecution', 'Block execution during installation'],
  ['promptToSave', 'Prompt to save work'],
  ['persistPrompt', 'Keep prompt visible'],
  ['minimizeWindows', 'Minimize windows'],
  ['allowDefer', 'Allow deferral'],
  ['checkDiskSpace', 'Check disk space'],
  ['removeExistingInstall', 'Remove existing installation'],
] as const;
const NUMBER_FIELDS = [
  ['closeCountdown', 'Close countdown in seconds', 10, 300],
  ['deferTimes', 'Allowed deferrals', 1, 99],
  ['deferDays', 'Deferral days', 1, 365],
] as const;
const SELECT_FIELDS = [
  ['deployMode', 'Deploy mode', ['Silent', 'NonInteractive', 'Auto']],
  ['restartBehavior', 'Restart behavior', ['Suppress', 'Force', 'Prompt']],
  ['windowLocation', 'Dialog position', ['Default', 'Center', 'Top', 'Bottom', 'TopLeft', 'TopRight', 'BottomLeft', 'BottomRight']],
] as const;
const INPUT_CLASS = 'rounded-md border border-overlay/15 bg-bg-elevated px-3 py-2 text-text-primary';

export function PackageDefaultsSettings() {
  const { account, isAuthenticated, isInitializing } = useMicrosoftAuth();
  const key = isAuthenticated && !isInitializing && account
    ? JSON.stringify([account.homeAccountId, account.tenantId]) : 'signed-out';
  return <DefaultsCard key={key} signedIn={key !== 'signed-out'} />;
}

function DefaultsCard({ signedIn }: { signedIn: boolean }) {
  const { packageDefaults, packageDefaultsStatus, savePackageDefaults, isLoading } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const values = { ...pickPackageDefaults(DEFAULT_PSADT_CONFIG), ...packageDefaults };
  const disabled = !signedIn || isLoading || saving || packageDefaultsStatus !== 'loaded';

  function validNumber(input: HTMLInputElement, label: string, min: number, max: number, saved: number | undefined) {
    if (input.value !== '' && input.validity.valid && Number.isInteger(input.valueAsNumber) && input.valueAsNumber >= min && input.valueAsNumber <= max) return true;
    setStatus({ error: true, text: `${label} must be between ${min} and ${max}.` });
    input.value = saved === undefined ? '' : String(saved);
    return false;
  }

  async function save(next: PackageDefaults | null) {
    setSaving(true);
    setStatus(null);
    try {
      await savePackageDefaults(next);
      setStatus({ error: false, text: next ? 'Package defaults saved.' : 'Saved defaults cleared.' });
    } catch (error) {
      setStatus({ error: true, text: error instanceof Error ? error.message : 'Package defaults were not saved.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass-light rounded-xl p-6 border border-overlay/5" aria-labelledby="package-defaults-heading">
      <h2 id="package-defaults-heading" className="text-lg font-semibold text-text-primary">New package defaults</h2>
      <p className="mt-1 text-sm text-text-muted">Applies to new Win32 packages opened in the configuration dialog. Quick add and bulk add use the standard settings. Packages already in your cart keep their settings.</p>
      <p className="mt-1 text-sm text-text-muted">Commands, detection, processes, branding and installer verification are never saved. Saving requires hosted services.</p>
      <label className="mt-4 flex items-center gap-2 text-sm text-text-primary">
        <input type="checkbox" checked={Boolean(packageDefaults)} disabled={disabled} onChange={(event) => void save(event.target.checked ? values : null)} />
        Use saved package defaults
      </label>
      {packageDefaults && (
        <fieldset disabled={disabled} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="sr-only">Package defaults</legend>
          {SELECT_FIELDS.map(([key, label, options]) => (
            <label key={key} className="flex flex-col gap-1 text-sm text-text-secondary">
              {label}
              <select className={INPUT_CLASS} value={values[key]} onChange={(event) => void save({ ...values, [key]: event.target.value })}>
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          ))}
          {BOOLEAN_FIELDS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={Boolean(values[key])} onChange={(event) => void save({ ...values, [key]: event.target.checked })} />
              {label}
            </label>
          ))}
          {NUMBER_FIELDS.map(([key, label, min, max]) => (
            <label key={key} className="flex flex-col gap-1 text-sm text-text-secondary">
              {label}
              <input key={`${key}-${values[key]}`} className={INPUT_CLASS} type="number" min={min} max={max} step={1} defaultValue={values[key]} onBlur={(event) => {
                if (key === 'deferDays' && event.target.value === '' && !event.target.validity.badInput) {
                  if (values.deferDays !== undefined) {
                    const { deferDays: _deferDays, ...rest } = values;
                    void save(rest);
                  }
                  return;
                }
                if (validNumber(event.target, label, min, max, values[key]) && event.target.valueAsNumber !== values[key]) {
                  void save({ ...values, [key]: event.target.valueAsNumber });
                }
              }} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={Boolean(values.restartPrompt?.enabled)} onChange={(event) => void save({ ...values, restartPrompt: { ...DEFAULT_PSADT_CONFIG.restartPrompt, ...values.restartPrompt, enabled: event.target.checked } })} />
            Show restart prompt
          </label>
          {([
            ['countdownSeconds', 'Restart countdown in seconds', 60, 3600],
            ['countdownNoHideSeconds', 'Restart countdown without hiding in seconds', 10, 300],
          ] as const).map(([key, label, min, max]) => (
            <label key={key} className="flex flex-col gap-1 text-sm text-text-secondary">
              {label}
              <input key={`${key}-${values.restartPrompt?.[key]}`} className={INPUT_CLASS} type="number" min={min} max={max} step={1} defaultValue={values.restartPrompt?.[key]} onBlur={(event) => {
                if (validNumber(event.target, label, min, max, values.restartPrompt?.[key]) && event.target.valueAsNumber !== values.restartPrompt?.[key]) {
                  void save({ ...values, restartPrompt: { ...DEFAULT_PSADT_CONFIG.restartPrompt, ...values.restartPrompt, [key]: event.target.valueAsNumber } });
                }
              }} />
            </label>
          ))}
        </fieldset>
      )}
      {!signedIn && <p className="mt-2 text-sm text-text-muted">Sign in to manage package defaults.</p>}
      {signedIn && packageDefaultsStatus === 'error' && <p role="alert" className="mt-2 text-sm text-red-400">Saved defaults could not be loaded. Reload to edit them.</p>}
      {(saving || isLoading) && <p role="status" className="mt-2 text-sm text-text-muted">{saving ? 'Saving package defaults...' : 'Loading package defaults...'}</p>}
      {status && <p role={status.error ? 'alert' : 'status'} className={`mt-2 text-sm ${status.error ? 'text-red-400' : 'text-text-muted'}`}>{status.text}</p>}
    </section>
  );
}
