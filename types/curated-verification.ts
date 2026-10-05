import type { PSADTConfig } from './psadt';

export interface CuratedSettingsStatus {
  itemId: string;
  status: 'ready' | 'requested' | 'verifying' | 'failed' | 'unavailable';
  defaultConfig?: PSADTConfig;
}

export interface CuratedSettingsResponse {
  items: CuratedSettingsStatus[];
}
