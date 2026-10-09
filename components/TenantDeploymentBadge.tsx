export function TenantDeploymentBadge({ deployedBy }: { deployedBy?: string | null }) {
  if (deployedBy === undefined) return null;
  return (
    <span
      title={deployedBy ? 'Deployed in this tenant by ' + deployedBy : 'Deployed in this tenant'}
      className="text-xs text-text-secondary border border-overlay/15 rounded-md px-2 py-1"
    >
      Deployed in this tenant
    </span>
  );
}
