/** Public display evidence only. It never authorizes deployment or a QA retry. */
export interface CustomerQaStatus {
  category: 'installer_security_hold' | 'source_retry' | 'reputation_unknown' | 'publication' | 'queued' | 'testing' | 'unavailable';
  message: string;
  nextEventAt: string | null;
}
