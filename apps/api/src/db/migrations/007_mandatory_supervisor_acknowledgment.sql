-- ============================================================================
-- 007_mandatory_supervisor_acknowledgment.sql
-- Mandatory Supervisor Acknowledgment (MSA) for Production Line Holds (Task I-03 / Gate G-10)
-- Forward-only migration following 001-006.
-- ============================================================================

-- 1. Add status to production_lines if not present
ALTER TABLE production_lines ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'RUNNING';

-- 2. Create production_line_holds table
CREATE TABLE IF NOT EXISTS production_line_holds (
  id VARCHAR(64) PRIMARY KEY,
  line_id VARCHAR(64) NOT NULL,
  work_center_id VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'HOLD_ACTIVE',
  reason VARCHAR(512) NOT NULL,
  trigger_defect_json TEXT,
  tripped_at TIMESTAMP NOT NULL,
  acknowledged_at TIMESTAMP,
  acknowledged_by VARCHAR(64),
  acknowledged_by_name VARCHAR(128),
  acknowledged_role VARCHAR(64),
  acknowledgement_reason TEXT,
  digital_signature VARCHAR(128)
);

CREATE INDEX IF NOT EXISTS idx_line_holds_line ON production_line_holds(line_id);
CREATE INDEX IF NOT EXISTS idx_line_holds_status ON production_line_holds(status);
