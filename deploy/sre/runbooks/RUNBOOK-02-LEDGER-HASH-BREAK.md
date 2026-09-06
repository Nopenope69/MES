# RUNBOOK-02: 21 CFR Part 11 Cryptographic Audit Ledger Integrity Failure

**Severity:** SEV1 (Regulatory Compliance & Forensic Breach)  
**Component:** `apps/api/src/services/compliance-ledger.service.ts`  
**Regulations:** FDA 21 CFR Part 11, ISO 13485:2016 Clause 7.5.3

---

## 1. Symptoms & Alert Triggers
- Metric Alert: `smt_ledger_integrity_status == 0`
- Scheduled integrity walk (`/api/v1/compliance/ledger/verify`) returns `valid: false`.
- Error message indicates either:
  - Sequence gap: missing or deleted audit entry.
  - Previous hash mismatch: reordered or injected block.
  - SHA-256 payload checksum mismatch: modified actor, action, or metadata.

---

## 2. Immediate Containment
1. **Immediate Line Quarantine**:
   - Prevent QA release of any open Device History Records:
     ```bash
     curl -s http://localhost:4000/api/v1/compliance/ledger/verify | jq .
     ```
2. Identify the first corrupted sequence number:
   - Note the `brokenSequence` field in the verification output.

---

## 3. Forensic Investigation Protocol
1. Query database for the compromised block and surrounding blocks:
   ```sql
   SELECT sequence_number, previous_hash, current_hash, actor_id, action_type, signed_at 
   FROM compliance_audit_ledger 
   WHERE sequence_number BETWEEN <brokenSequence - 2> AND <brokenSequence + 2>;
   ```
2. Recompute manual SHA-256 digest:
   ```
   SHA256(sequence|previous_hash|actor_id|action_type|meaning|entity_type|entity_id|metadata|signed_at)
   ```
3. Inspect database audit logs or file system write timestamps for unauthorized direct SQL `UPDATE` or `DELETE` commands.

---

## 4. Remediation & Notification
1. If data corruption occurred due to a disk write fault, restore from authenticated WAL/PG backup.
2. If intentional or accidental unauthorized edit occurred:
   - File an internal Non-Conformance Report (NCR) and open a formal CAPA per ISO 13485 Clause 8.5.2.
   - Re-sign verified records under dual-authorization supervision.
