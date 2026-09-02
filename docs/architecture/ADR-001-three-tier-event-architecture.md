# ADR-001: The 3-Tier Event-Driven MES Architecture

## Status
**ACCEPTED** (Date: 2026-09-03)

## Context
Industrial Manufacturing Execution Systems (MES) struggle when they attempt to treat machine protocols, operator data entry, and business logic as a single monolithic database model. 
1. Equipment protocols (e.g. Fuji Nexim, OPC-UA, Modbus, Siemens S7) carry vendor-specific concepts (slots, nozzles, panels, memory registers) that contaminate the core domain model.
2. Compliance standards (US FDA 21 CFR Part 11, EU Annex 11, Indian GMP) demand attributable, contemporaneous, and immutable audit trails. Mutating existing records directly in SQL tables destroys historical lineage and auditability.
3. Machine integration and operator inputs operate at different speeds and network boundaries (OT/IT DMZ vs. Cloud/Enterprise LAN).

## Decision
We adopt a **3-Tier Event-Driven Architecture** that decouples physical ingress from business state:

```
[ Tier 1: Ingress Layer ]
Raw Inbound Frame / Kiosk POST (Unaltered, Protocol-specific, Stored in ingress_events)
       │
       ▼
[ Tier 2: Canonical Event Layer ]
Universal Event Envelope (Normalized, Typed, Validated, Appended to canonical_events)
       │
       ▼
[ Tier 3: Projection Layer ]
CQRS State Projectors (Updates batches, equipment_state_logs, material_consumptions)
```

### 1. Ingress Layer (`ingress_events`)
*   Preserves exact raw byte streams and message tokens received at the site gateway.
*   Enables post-incident replay, protocol debugging, and forensic verification without polluting the MES schema.

### 2. Canonical Event Layer (`canonical_events`)
*   The lingua franca of the MES.
*   Every event contains an immutable envelope: `eventId`, `eventType`, `eventTime` (UTC), `receivedTime` (UTC), `sourceType`, `sourceId`, `assetPath`, `batchId`, `operatorId`, and a strongly-typed `payload`.
*   Strictly append-only. Zero updates or deletes permitted.

### 3. Projection Layer (Read Models)
*   Business queries (e.g. "What is the active batch on Reactor 02?", "What is the current shift downtime?") query specialized read projections (`batches`, `equipment_state_logs`, `downtime_attributions`).
*   Projections can be rebuilt from the canonical event stream at any time.

## Consequences
### Positive
*   **Zero Domain Pollution**: Adding a new machine vendor (e.g., Fuji SMT line, Yokogawa DCS) only requires a new normalizer in the Site Integration Layer. The core MES schema remains untouched.
*   **Built-in Data Integrity**: Conforms to ALCOA+ standards on Day 1.
*   **Time-Travel & Audit Replay**: The complete state of the factory at any timestamp $T$ can be reconstructed.

### Negative / Trade-offs
*   Slightly higher storage usage due to preserving raw payloads alongside normalized events (negligible cost with modern SSD storage / PostgreSQL partitioning).
*   Dual-write discipline: Changes must be committed through the canonical event bus rather than direct CRUD updates.
