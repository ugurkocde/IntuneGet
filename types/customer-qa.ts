/** Public display evidence only. It never authorizes deployment or a QA retry. */
export interface CustomerQaStatus {
  category: 'blocked_upstream' | 'installer_security_hold' | 'source_retry' | 'reputation_unknown' | 'publication' | 'queued' | 'testing' | 'unavailable';
  reasonCode?: 'UPSTREAM_SOURCE_BACKOFF' | 'UPSTREAM_METADATA_MISMATCH' | 'VERSION_UNAVAILABLE' | 'PACKAGE_UNAVAILABLE' | 'ARCHITECTURE_UNAVAILABLE';
  message: string;
  nextEventAt: string | null;
}
