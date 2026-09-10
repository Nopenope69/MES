// apps/web/src/services/traceability.api.ts
import {
  FIXTURE_PANEL_0042,
  FIXTURE_PANEL_CLEAN,
  FIXTURE_RECALL_REEL,
  FIXTURE_BATCH_SUMMARY
} from '../fixtures/traceability.fixtures';

export type TraceabilityDataSource =
  | 'LIVE'
  | 'OFFLINE_FIXTURE'
  | 'OFFLINE_NO_DATA'
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'ERROR';

export interface TraceabilityResponse<T> {
  source: TraceabilityDataSource;
  data: T | null;
  error?: string;
  statusCode?: number;
  fixtureId?: string;
  fixtureVersion?: string;
}

// Global fixture mode state
let fixtureModeEnabled = true;

export function isFixtureModeEnabled(): boolean {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem('TRACEABILITY_FIXTURE_MODE');
    if (stored !== null) {
      return stored === 'true';
    }
  }
  return fixtureModeEnabled;
}

export function setFixtureModeEnabled(enabled: boolean): void {
  fixtureModeEnabled = enabled;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('TRACEABILITY_FIXTURE_MODE', enabled ? 'true' : 'false');
  }
}

/**
 * Get request headers incorporating bearer token or session credentials if present
 */
function getRequestHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('mes_access_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      // In development cleanroom proxy, supply dev API key if stored or configured
      const apiKey = window.localStorage.getItem('mes_api_key');
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
    }
  }

  return headers;
}

/**
 * Generic fetch wrapper enforcing strict Live vs Fixture state machine
 */
async function fetchWithPolicy<T>(
  url: string,
  fixtureFallback: () => T | null,
  fixtureId?: string
): Promise<TraceabilityResponse<T>> {
  try {
    const res = await fetch(url, {
      headers: getRequestHeaders()
    });

    // Handle explicit HTTP status codes
    if (res.ok) {
      const json = await res.json();
      return {
        source: 'LIVE',
        data: (json.data || json) as T,
        statusCode: res.status
      };
    }

    // 401 / 403: MUST NEVER fall back to fixtures
    if (res.status === 401 || res.status === 403) {
      let customErr: string | undefined;
      try {
        const errJson = await res.json();
        customErr = errJson.message || errJson.error;
      } catch {
        // ignore
      }
      return {
        source: 'AUTH_ERROR',
        data: null,
        error: customErr || 'Authentication failed. Please verify operator token or role credentials.',
        statusCode: res.status
      };
    }

    // 404: Normal record not found, MUST NOT fall back to fixtures
    if (res.status === 404) {
      let customErr: string | undefined;
      try {
        const errJson = await res.json();
        customErr = errJson.message || errJson.error;
      } catch {
        // ignore
      }
      return {
        source: 'NOT_FOUND',
        data: null,
        error: customErr || 'Record not found in manufacturing database.',
        statusCode: 404
      };
    }

    // 400 / 500 / other error
    let errMessage = `HTTP ${res.status} ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson.message || errJson.error) {
        errMessage = errJson.message || errJson.error;
      }
    } catch {
      // Ignore body parse errors
    }

    return {
      source: 'ERROR',
      data: null,
      error: errMessage,
      statusCode: res.status
    };
  } catch (networkErr: any) {
    // Live API unavailable (connection refused, network timeout, offline)
    if (isFixtureModeEnabled()) {
      const fixtureData = fixtureFallback();
      if (fixtureData) {
        return {
          source: 'OFFLINE_FIXTURE',
          data: fixtureData,
          fixtureId: fixtureId || 'CANONICAL_FIXTURE',
          fixtureVersion: '1.0.0'
        };
      }
    }

    return {
      source: 'OFFLINE_NO_DATA',
      data: null,
      error: 'Live MES API unavailable and offline fixture mode is disabled or no fixture exists for this query.'
    };
  }
}

/**
 * 1. Fetch complete panel genealogy (bulk-assembled)
 */
export async function getPanelGenealogy(panelBarcode: string): Promise<TraceabilityResponse<any>> {
  return fetchWithPolicy<any>(
    `/api/v1/genealogy/panel/${encodeURIComponent(panelBarcode.trim())}`,
    () => {
      const code = panelBarcode.trim().toUpperCase();
      if (code.includes('0042')) return FIXTURE_PANEL_0042;
      if (code.includes('00140')) return FIXTURE_PANEL_CLEAN;
      return FIXTURE_PANEL_0042; // default canonical fixture
    },
    panelBarcode.trim()
  );
}

/**
 * 2. Fetch discrete unit genealogy
 */
export async function getUnitGenealogy(panelBarcode: string, unitPosition: number): Promise<TraceabilityResponse<any>> {
  return fetchWithPolicy<any>(
    `/api/v1/genealogy/unit/${encodeURIComponent(panelBarcode.trim())}/${unitPosition}`,
    () => {
      const panel = panelBarcode.trim().toUpperCase().includes('00140') ? FIXTURE_PANEL_CLEAN : FIXTURE_PANEL_0042;
      return panel.units.find((u: any) => u.unitPosition === unitPosition) || panel.units[0];
    },
    `${panelBarcode.trim()}-U${unitPosition}`
  );
}

/**
 * 3. Fetch unit genealogy by discrete PCB serial number
 */
export async function lookupBySerialNumber(serialNumber: string): Promise<TraceabilityResponse<any>> {
  return fetchWithPolicy<any>(
    `/api/v1/genealogy/serial/${encodeURIComponent(serialNumber.trim())}`,
    () => {
      const sn = serialNumber.trim().toUpperCase();
      const allUnits = [...FIXTURE_PANEL_0042.units, ...FIXTURE_PANEL_CLEAN.units];
      return allUnits.find((u: any) => u.unitSerialNumber?.toUpperCase() === sn) || FIXTURE_PANEL_0042.units[2];
    },
    serialNumber.trim()
  );
}

/**
 * 4. Execute set-based backward/forward containment recall
 */
export async function recallByIdentifier(identifier: string, namespace?: string): Promise<TraceabilityResponse<any>> {
  const queryParam = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';
  return fetchWithPolicy<any>(
    `/api/v1/genealogy/recall/${encodeURIComponent(identifier.trim())}${queryParam}`,
    () => {
      return FIXTURE_RECALL_REEL;
    },
    `RECALL-${identifier.trim()}`
  );
}

/**
 * 5. Fetch batch-level summary rollup
 */
export async function getBatchGenealogy(batchNumberOrId: string): Promise<TraceabilityResponse<any>> {
  return fetchWithPolicy<any>(
    `/api/v1/genealogy/summary/batch/${encodeURIComponent(batchNumberOrId.trim())}`,
    () => {
      return FIXTURE_BATCH_SUMMARY;
    },
    `BATCH-${batchNumberOrId.trim()}`
  );
}

export const traceabilityApi = {
  getPanelGenealogy,
  getUnitGenealogy,
  lookupBySerialNumber,
  recallByIdentifier,
  getBatchGenealogy
};

