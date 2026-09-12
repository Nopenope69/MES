-- ============================================================================
-- 006_postgres_parity_and_system_settings.sql
-- Bridging migration: System settings, refresh tokens, DR drill history,
-- operator authz fields, and referential integrity constraints.
-- Forward-only migration following 001-005.
-- ============================================================================

-- 1. System Settings & Onboarding Persistence (Stage 1 / D-04 / Gate G-03)
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tenant & Organization Settings
CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id VARCHAR(64) NOT NULL,
  setting_key VARCHAR(64) NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, setting_key)
);

-- 3. Refresh Tokens & Session Rotation (Stage 1 / U-01 / Gate G-08)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id VARCHAR(64) PRIMARY KEY,
  operator_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  family_id VARCHAR(64) NOT NULL,
  revoked INTEGER DEFAULT 0,
  revoked_reason VARCHAR(64),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by_ip VARCHAR(64) NOT NULL,
  authz_version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

-- 4. Disaster Recovery Drill History (Stage 5 / O-01 / Gate G-11)
CREATE TABLE IF NOT EXISTS dr_drill_history (
  drill_id VARCHAR(64) PRIMARY KEY,
  drill_version VARCHAR(32) NOT NULL,
  backup_timestamp TIMESTAMP NOT NULL,
  drill_started_at TIMESTAMP NOT NULL,
  drill_completed_at TIMESTAMP NOT NULL,
  rpo_seconds INTEGER NOT NULL,
  rto_seconds INTEGER NOT NULL,
  schema_valid INTEGER NOT NULL DEFAULT 0,
  event_store_valid INTEGER NOT NULL DEFAULT 0,
  ledger_integrity INTEGER NOT NULL DEFAULT 0,
  manifest_integrity INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_dr_drill_status ON dr_drill_history(status, drill_completed_at);
