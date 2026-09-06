-- ============================================================================
-- 002_brin_and_advanced_indexes.sql (Track D: BRIN & High-Scale Indexing)
-- Optimized for 100,000+ CPH SMT lines and Sub-Second Temporal Queries
-- ============================================================================

-- 1. Block Range Indexes (BRIN) for High-Volume Time-Series
-- BRIN indexes occupy a fraction of 1% of the disk footprint of B-Trees
-- and accelerate temporal window scans over billions of placement records.
CREATE INDEX IF NOT EXISTS idx_production_events_brin_time
  ON production_events USING brin (event_time);

CREATE INDEX IF NOT EXISTS idx_ingress_events_brin_time
  ON ingress_events USING brin (received_at);

-- 2. High-Frequency B-Tree Composite Query Indexes
CREATE INDEX IF NOT EXISTS idx_prod_events_wc_time
  ON production_events (work_center_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_prod_events_type_time
  ON production_events (event_type, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_prod_events_batch_time
  ON production_events (batch_id, event_time DESC)
  WHERE batch_id IS NOT NULL;

-- 3. GIN Semi-Structured JSONB Indexes for Dynamic Industrial Telemetry
CREATE INDEX IF NOT EXISTS idx_prod_events_payload_gin
  ON production_events USING gin (payload_json);

CREATE INDEX IF NOT EXISTS idx_ledger_metadata_gin
  ON compliance_audit_ledger USING gin (metadata_json);

CREATE INDEX IF NOT EXISTS idx_dhr_payload_gin
  ON device_history_records USING gin (dhr_payload_json);

-- 4. Fast Lookups on Physical Equipment Foreign Keys
CREATE INDEX IF NOT EXISTS idx_feeder_slots_reel
  ON smt_feeder_slots (current_reel_id)
  WHERE current_reel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paste_loads_jar
  ON stencil_paste_loads (paste_jar_id);

CREATE INDEX IF NOT EXISTS idx_stencil_sessions_batch
  ON stencil_sessions (batch_id)
  WHERE batch_id IS NOT NULL;
