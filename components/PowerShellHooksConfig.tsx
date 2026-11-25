'use client';

import { useId } from 'react';
import type { PSADTConfig } from '@/types/psadt';

export function PowerShellHooksConfig({ config, onChange }: {
  config: PSADTConfig;
  onChange: (updates: Partial<PSADTConfig>) => void;
}) {
  const id = useId();
  return <fieldset className="space-y-4">
    <legend className="text-sm font-medium text-text-secondary">PowerShell session hooks (optional)</legend>
    <p id={`${id}-help`} className="text-xs text-text-muted">
      Runs after existing commands in the PSADT 4.1.8 session with PSADT functions available.
      A script error fails deployment. Use Start-ADTProcess for native commands so failures are handled.
      Do not include secrets: this text is stored in the job configuration and package.
      Catalog installation validation does not validate your custom PowerShell.
      Syntax is checked during packaging; this is not a sandbox. Self-hosted packagers currently reject nonempty hooks.
    </p>
    {(['postInstallPowerShell', 'postUninstallPowerShell'] as const).map((field) => {
      const label = field === 'postInstallPowerShell' ? 'Post-install PowerShell' : 'Post-uninstall PowerShell';
      return <div key={field}>
        <label htmlFor={`${id}-${field}`} className="block text-sm font-medium text-text-secondary mb-2">{label}</label>
        <textarea id={`${id}-${field}`} aria-label={label} aria-describedby={`${id}-help ${id}-${field}-length`}
          value={config[field] ?? ''} maxLength={8192} rows={5} spellCheck={false}
          onChange={(event) => onChange({ [field]: event.target.value || undefined })}
          className="w-full px-3 py-2 bg-bg-elevated border border-overlay/15 rounded-lg text-text-primary text-sm font-mono" />
        <p id={`${id}-${field}-length`} className="text-xs text-text-muted">{config[field]?.length ?? 0} / 8192 characters</p>
      </div>;
    })}
  </fieldset>;
}
