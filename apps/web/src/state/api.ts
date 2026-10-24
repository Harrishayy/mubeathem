import { createCueApi, type CueApi } from '@cue/client';
import { settingsStore } from './settings';

let cached: { key: string; api: CueApi } | null = null;

/** The API client for the current server URL and token. Rebuilt only when either changes. */
export function getApi(): CueApi {
  const { serverUrl, token } = settingsStore.get();
  const key = `${serverUrl}|${token}`;
  if (!cached || cached.key !== key) cached = { key, api: createCueApi({ baseUrl: serverUrl, ...(token ? { token } : {}) }) };
  return cached.api;
}
