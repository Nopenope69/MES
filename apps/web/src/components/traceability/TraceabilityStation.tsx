// apps/web/src/components/traceability/TraceabilityStation.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  TraceabilityStatusBar
} from './TraceabilityStatusBar';
import {
  TraceabilitySearch,
  StationMode
} from './TraceabilitySearch';
import { GenealogyMode } from './GenealogyMode';
import { RecallMode } from './RecallMode';
import { BatchMode } from './BatchMode';
import {
  traceabilityApi,
  TraceabilityDataSource,
  isFixtureModeEnabled
} from '../../services/traceability.api';
import {
  FIXTURE_PANEL_0042,
  FIXTURE_RECALL_REEL,
  FIXTURE_BATCH_SUMMARY
} from '../../fixtures/traceability.fixtures';

export const TraceabilityStation: React.FC = () => {
  const [mode, setMode] = useState<StationMode>('GENEALOGY');
  const [query, setQuery] = useState<string>('PNL-260901-0042');
  const [loading, setLoading] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<TraceabilityDataSource>('OFFLINE_FIXTURE');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [fixtureId, setFixtureId] = useState<string | undefined>('PNL-260901-0042');
  const [ambiguousDetail, setAmbiguousDetail] = useState<string | undefined>(undefined);

  // Mode Data State
  const [panelData, setPanelData] = useState<any>(FIXTURE_PANEL_0042);
  const [recallData, setRecallData] = useState<any>(null);
  const [batchData, setBatchData] = useState<any>(null);

  const executeSearch = useCallback(
    async (overrideQuery?: string, overrideMode?: StationMode, overrideNamespace?: string) => {
      const targetQuery = (overrideQuery ?? query).trim();
      const targetMode = overrideMode ?? mode;

      if (!targetQuery) return;

      setLoading(true);
      setErrorMessage(undefined);
      setAmbiguousDetail(undefined);

      try {
        if (targetMode === 'GENEALOGY') {
          let res;
          if (targetQuery.toUpperCase().startsWith('SN-')) {
            res = await traceabilityApi.lookupBySerialNumber(targetQuery);
          } else {
            res = await traceabilityApi.getPanelGenealogy(targetQuery);
          }

          setDataSource(res.source);
          setFixtureId(res.fixtureId);

          if (res.source === 'AUTH_ERROR') {
            setErrorMessage('Authentication required (HTTP 401/403). Live MES bus requires valid credentials.');
          } else if (res.source === 'NOT_FOUND') {
            setErrorMessage(`Panel or serial "${targetQuery}" not found in manufacturing records (HTTP 404).`);
            setPanelData(null);
          } else if (res.source === 'ERROR') {
            setErrorMessage(res.error || 'Server error encountered while retrieving genealogy (HTTP 500).');
            setPanelData(null);
          } else if (res.source === 'OFFLINE_NO_DATA') {
            setErrorMessage('Network connection offline and demo fixture fallback is disabled.');
            setPanelData(null);
          } else {
            if (res.data) {
              if (res.data.units) {
                setPanelData(res.data);
              } else {
                setPanelData({
                  panelBarcode: res.data.panelBarcode || targetQuery,
                  checkout: null,
                  units: [res.data]
                });
              }
            }
          }
        } else if (targetMode === 'RECALL') {
          const res = await traceabilityApi.recallByIdentifier(targetQuery, overrideNamespace);
          setDataSource(res.source);
          setFixtureId(res.fixtureId);

          if (res.source === 'AUTH_ERROR') {
            setErrorMessage('Authentication required (HTTP 401/403). Live MES bus requires valid credentials.');
          } else if (res.source === 'NOT_FOUND') {
            setErrorMessage(`Recall identifier "${targetQuery}" not found in production records (HTTP 404).`);
            setRecallData(null);
          } else if (res.source === 'ERROR') {
            setErrorMessage(res.error || 'Server error encountered while running containment recall (HTTP 500).');
            setRecallData(null);
          } else if (res.source === 'OFFLINE_NO_DATA') {
            setErrorMessage('Network connection offline and demo fixture fallback is disabled.');
            setRecallData(null);
          } else {
            if (res.data?.ambiguous) {
              setAmbiguousDetail(res.data.ambiguityDetail || 'Identifier matched multiple production namespaces.');
            }
            setRecallData(res.data);
          }
        } else if (targetMode === 'BATCH') {
          const res = await traceabilityApi.getBatchGenealogy(targetQuery);
          setDataSource(res.source);
          setFixtureId(res.fixtureId);

          if (res.source === 'AUTH_ERROR') {
            setErrorMessage('Authentication required (HTTP 401/403). Live MES bus requires valid credentials.');
          } else if (res.source === 'NOT_FOUND') {
            setErrorMessage(`Batch "${targetQuery}" not found in production records (HTTP 404).`);
            setBatchData(null);
          } else if (res.source === 'ERROR') {
            setErrorMessage(res.error || 'Server error encountered while retrieving batch rollup (HTTP 500).');
            setBatchData(null);
          } else if (res.source === 'OFFLINE_NO_DATA') {
            setErrorMessage('Network connection offline and demo fixture fallback is disabled.');
            setBatchData(null);
          } else {
            setBatchData(res.data);
          }
        }
      } catch (err: any) {
        setDataSource('ERROR');
        setErrorMessage(err.message || 'Unexpected exception occurred while querying MES bus.');
      } finally {
        setLoading(false);
      }
    },
    [query, mode]
  );

  const handleModeChange = (newMode: StationMode) => {
    setMode(newMode);
    // Switch default query placeholder if current query is empty or default
    if (newMode === 'GENEALOGY' && (!query || query.startsWith('REEL-') || query.startsWith('JOB-'))) {
      setQuery('PNL-260901-0042');
      if (!panelData) setPanelData(FIXTURE_PANEL_0042);
    } else if (newMode === 'RECALL' && (!query || query.startsWith('PNL-') || query.startsWith('JOB-'))) {
      setQuery('REEL-MUR-98124');
      if (!recallData) setRecallData(FIXTURE_RECALL_REEL);
    } else if (newMode === 'BATCH' && (!query || query.startsWith('PNL-') || query.startsWith('REEL-'))) {
      setQuery('JOB-SM-260901');
      if (!batchData) setBatchData(FIXTURE_BATCH_SUMMARY);
    }
  };

  const handleSelectPanel = (panelBarcode: string) => {
    setQuery(panelBarcode);
    setMode('GENEALOGY');
    executeSearch(panelBarcode, 'GENEALOGY');
  };

  const handleDisambiguation = (namespace: string) => {
    setAmbiguousDetail(undefined);
    executeSearch(query, 'RECALL', namespace);
  };

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* 1. Status Bar (Source State & Regulatory Tags) */}
      <TraceabilityStatusBar
        source={dataSource}
        error={errorMessage}
        fixtureId={fixtureId}
        onRefresh={() => executeSearch()}
        onFixtureModeToggled={() => executeSearch()}
      />

      {/* 2. Omni-Search & Mode Switcher */}
      <TraceabilitySearch
        mode={mode}
        onModeChange={handleModeChange}
        query={query}
        onQueryChange={setQuery}
        onSearch={executeSearch}
        loading={loading}
        ambiguousDetail={ambiguousDetail}
        onSelectDisambiguation={handleDisambiguation}
      />

      {/* 3. Mode Container Routing */}
      {mode === 'GENEALOGY' && (
        <>
          {panelData ? (
            <GenealogyMode panelData={panelData} />
          ) : (
            <div className="milled-panel rounded-xl p-8 text-center text-xs font-mono text-[#7A8A9E]">
              {errorMessage || 'Scan or search for a panel barcode above to view as-built genealogy.'}
            </div>
          )}
        </>
      )}

      {mode === 'RECALL' && (
        <RecallMode recallData={recallData} onSelectPanel={handleSelectPanel} />
      )}

      {mode === 'BATCH' && (
        <BatchMode batchData={batchData} onSelectPanel={handleSelectPanel} />
      )}
    </div>
  );
};
