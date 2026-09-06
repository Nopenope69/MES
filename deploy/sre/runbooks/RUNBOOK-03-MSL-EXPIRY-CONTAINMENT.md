# RUNBOOK-03: JEDEC J-STD-033D Moisture-Sensitive Floor-Life Expiration

**Severity:** SEV2 (Component Quality & Interlock Trip)  
**Component:** `apps/api/src/services/msl-floor-life.service.ts`  
**Standards:** JEDEC J-STD-033D, IPC-A-610 Class 3

---

## 1. Symptoms & Alert Triggers
- Metric Alert: `smt_msl_expired_reels_count > 0`
- Interlock Trip: Fuji placement machine feeder station receives a block signal upon attempting to splice or mount reel.
- Operator Station HUD: Yellow/Red alert showing "FLOOR LIFE EXPIRED".

---

## 2. Containment Protocol
1. **Halt Line Placement**:
   - Verify the specific feeder slot:
     ```bash
     curl -s http://localhost:4000/api/v1/smt/feeders | jq '.feeders[] | select(.status=="EXPIRED")'
     ```
2. **Immediate Reel Ejection**:
   - Operator scans feeder barcode and unmounts the expired component reel.
   - Do NOT attempt to splice with an active reel.

---

## 3. Thermal Desiccation & Bake Recovery
1. Query matching JEDEC bake profile for the component MSL level and package thickness:
   ```sql
   SELECT * FROM msl_bake_profiles WHERE msl_class = ? AND enabled = 1;
   ```
2. Transfer reel into validated desiccation baking oven (e.g. 125°C for 48 hours for MSL Level 3).
3. Log the bake initiation event into MES:
   ```bash
   curl -X POST http://localhost:4000/api/v1/events -H "Content-Type: application/json" -d '{
     "eventType": "REEL_BAKE_STARTED",
     "workCenterId": "wc-dry-01",
     "sourceType": "MANUAL_UI",
     "sourceId": "operator-01",
     "payload": { "reelId": "REEL-EXPIRED-01", "ovenTempC": 125 }
   }'
   ```

---

## 4. Line Release
- Mount a certified alternative reel with active remaining floor life.
- Perform barcode splice scan: `POST /api/v1/smt/splice-verify`.
- Verify interlock release and resume line operation.
