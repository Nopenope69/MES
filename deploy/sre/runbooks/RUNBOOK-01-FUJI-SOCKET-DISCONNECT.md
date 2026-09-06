# RUNBOOK-01: Fuji Nexim TCP Socket Disconnection & Frame Timeout

**Severity:** SEV1 (Line Stoppage)  
**Component:** `apps/api/src/adapters/fuji-nexim.adapter.ts`  
**Port:** TCP 30040  
**Target:** SMT Placement Lines (e.g. Fuji NXT III / AIMEX III)

---

## 1. Symptoms & Alert Triggers
- Metric Alert: `smt_fuji_active_connections == 0` for $> 15\text{s}$ while line is in `RUNNING` state.
- Machine Status: Fuji machine operator terminal displays communication error or communication handshake timeout.
- Ingress Events: `MCSTATECHANGE` or `PRODCOMPLETEII` events cease appearing in event feed.

---

## 2. Immediate Containment (T-0 to T-5 min)
1. Confirm whether the physical SMT machine or the MES gateway lost connectivity:
   ```bash
   # From the MES edge server, ping the Fuji Machine IP on OT VLAN:
   ping -c 3 192.168.10.42
   ```
2. Verify local TCP port 30040 is bound and listening:
   ```bash
   lsof -i :30040 || netstat -an | grep 30040
   ```
3. Check MES logs for framing accumulator anomalies or partial frame buffer timeouts:
   ```bash
   grep "FujiNexim" /var/log/mes/api.log | tail -n 50
   ```

---

## 3. Resolution Steps
1. If the machine socket is in `CLOSE_WAIT` or half-open state:
   - Restart the gateway listener via API:
     ```bash
     curl -X POST http://localhost:4000/api/v1/smt/equipment/restart-gateway
     ```
2. On the Fuji machine control console:
   - Navigate to **Communication Settings -> Host Link -> Re-connect**.
3. Verify frame receipt:
   - The first message upon reconnection will be an `\x02MCSTATECHANGE...\x03` frame.
   - Confirm Prometheus metric `smt_fuji_frames_total{direction="inbound"}` increments.

---

## 4. Post-Incident Verification
- Verify line state transitions back to `RUNNING`.
- Confirm no unhandled frame drops or missing panel checkouts during the disconnect interval.
