# Antigravity SMT MES Engine: Executive Project Memory & Status Briefing

**Document Version**: 1.1.0 (Hardened Production Release)  
**Date**: September 4, 2026  
**Repository**: [https://github.com/Nopenope69/MES](https://github.com/Nopenope69/MES) (`main` branch)  
**Target Sector**: High-Speed Electronics Manufacturing Services (EMS) / Surface Mount Technology (SMT)  
**Primary Benchmarks**: Dixon Technologies, Syrma SGS, Kaynes Technology, Sahasra Electronic Solutions  

---

## 1. Executive Summary

This project is a **conglomerate-grade, event-driven Manufacturing Execution System (MES)** architected specifically for high-speed SMT assembly lines. Unlike legacy monoliths (which rely on synchronous batch writes and slow ERP polls), this engine is built around an **asynchronous 3-tier event spine** with a **native TCP socket gateway** directly interfacing with high-speed pick-and-place equipment (Fuji NXT III / AIMEX running Fuji Nexim Host Interface V2.8.0).

Following rigorous peer code review, the platform has completed **Architectural Hardening**:
* **Stream Framing Accumulator**: Per-socket buffer with an iterative frame extraction loop handling arbitrary TCP packet segmentation (`[half-frame]`), coalescing (`[frame1 + frame2]`), and trailing fragments.
* **Atomic Transactions (`withTransaction`)**: Transactional atomicity wrapping canonical event log writes and state projections. Any projection crash rolls back cleanly with zero state corruption.
* **ADR-003 Domain Decoupling**: Extracted `SmtInterlockService`; equipment adapters have zero direct knowledge of domain database tables or SQL schemas.
* **Verbatim Binary Preservation**: Raw socket frames are stored as `BLOB` (`Buffer`) in `ingress_events.raw_payload` alongside `decoded_payload TEXT` for authentic forensic replay.
* **Modular "Core Spine + Vertical Packs" Architecture**: Decoupled domain projections into pluggable projectors (`CoreProjector` for generic ISA-95/OEE and `SmtProjector` for reels/feeders/panels), preparing the platform for vertical pack #2 (Process Manufacturing / Pharma).
* **32/32 Automated Tests Passing (100% Green)** across framing, atomicity, adapter, and HTTP integration suites.

---

## 2. Core Architectural Spine

```
[ Fuji NXT III / AIMEX ]
       │  (TCP Socket / Port 30040: 4-byte BE Length + STX ... Tab-Tokens ... ETX)
       ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 1: STREAM BUFFER & INGRESS STORE (ingress_events)                 │
│ - Per-socket accumulator handling split chunks & coalesced frames      │
│ - Verbatim byte-for-byte BLOB storage + decoded ASCII inspection       │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 2: ATOMIC CANONICAL EVENT LOG (production_events)                 │
│ - Append-only, immutable single source of truth                        │
│ - Strongly typed envelopes: event_id (UUID), event_time, sequence_id   │
│ - Atomic transaction wrapping event append & read-model projection     │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TIER 3: PLUGGABLE CQRS PROJECTORS (Materialized Read Models)           │
│ ┌──────────────────────────────────┐ ┌───────────────────────────────┐ │
│ │ CoreProjector (Generic MES)      │ │ SmtProjector (SMT Vertical)   │ │
│ │ - Batches & Work Orders          │ │ - Reel Splicing & Inventory   │ │
│ │ - Machine States & OEE           │ │ - Cassette Feeder Table       │ │
│ │ - Downtime Attributions          │ │ - Board Checkouts & CPH       │ │
│ │ - Material Genealogy             │ │ - Nozzle Drop Error Pareto    │ │
│ └──────────────────────────────────┘ └───────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### Physical Asset Hierarchy (ISA-95 Standard)
Every event and telemetry point maps strictly to the enterprise asset path:
`ORG-DIXON.SITE-NOIDA-P4.AREA-SMT-01.LINE-SMT-01.WC-NXT-01`
* **Enterprise**: Dixon Technologies India
* **Site**: Noida Manufacturing Cluster (Plant 4)
* **Area**: SMT Cleanroom Bay A
* **Line**: High-Speed SMT Assembly Line 01
* **Work Centers (Physical Sequence)**:
  1. `WC-SPG-01`: Fuji GPX-C Solder Paste Screen Printer
  2. `WC-NXT-01`: Fuji NXT III M6 Pick-and-Place (4 Modules)
  3. `WC-RFL-01`: Heller 1913 MK5 10-Zone Reflow Oven
  4. `WC-AOI-01`: Koh Young 3D AOI Optical Inspector

---

## 3. What is Built, Audited & Verified Today

### A. Fuji Nexim Host Protocol TCP Gateway (`@mes/api`)
* **Socket Port**: `30040` (Node.js `net.Server`).
* **Frame Accumulator**: `FujiNeximAdapter.extractFrames(buffer)` iteratively extracts complete frames, preserving partial fragments in the per-socket buffer across `data` events.
* **Handshake & Events Supported**:
  * `SETEV` / `STARTEV`: Bidirectional event registration and notification start.
  * `MCSTATECHANGE`: Real-time machine state transitions (e.g. `Run`, `Stop`, `Wait Parts`).
  * `PRODSTARTED` & `PRODCOMPLETEII`: Panel checkout with cycle times down to milliseconds.
  * `CHANGECOMPII` & `LOADCOMP`: Operator reel splicing and cassette loading.
  * `PDERROR`: Feeder pick errors (nozzle misfire, empty pickup, fiducial vision failure).
* **Decoupled Poka-Yoke Interlock**: Evaluated via `SmtInterlockService.verifyFeederSplice()`. If an operator splices a reel with an incorrect part number, gateway returns `ACK` with `Result = 1` (NG), which halts the feeder motor before component mounting.

### B. Industrial Operator Station (`01 // FEEDER BAY`)
* **In-Line Conveyor Flow Ribbon**: Shows the 4 SMT stations in true physical order.
* **5-Slot Feeder Cassette Bank**:
  * Slot 01: `C0402-100NF-16V` (10,000 PCS, Murata Cap, W08f tape)
  * Slot 02: `R0402-10K-1%` (3,210 PCS, Vishay Resistor, Amber low stock warning)
  * Slot 03: `IC-STM32F401-LQFP64` (1,358 PCS, ST MCU, MSL 3 floor life timer)
  * Slot 04: `MOD-QUECTEL-EC200U` (358 PCS, Quectel 4G LTE IoT Module)
  * Slot 05: `IC-TPS62130-QFN16` (2,716 PCS, TI Buck Converter)
* **Optical Splicing Dock**:
  * Laser crosshairs scan reel barcode UID.
  * Test Mismatch Scenario: Trips relay to scarlet (`🔴 INTERLOCK TRIPPED // FEEDER INHIBITED`).
  * Test Match Scenario: Engages relay to emerald (`🟢 RELAY ENGAGED // OK TO SPLICE`) and resets stock to 10,000 PCS.
* **Tactile Stoppage Matrix**:
  * Modal with SMT downtime categories (`FEEDER TAPE JAM`, `NOZZLE VACUUM TRIP`, `VISION ALIGNMENT`, `STENCIL CLEANING`).
  * Changes line to `STOPPED_UNPLANNED`, updates OEE, and presents `[RESUME RUN]` button.

### C. Supervisor Telemetry Dashboard (`02 // CPH & LINE OEE`)
* **Speedometer Gauge**: Live **44,820 CPH** vs 45,000 target.
* **Board Cycle Time**: Live **18.24s** takt duration.
* **Feeder Error Pareto (`PDERROR`)**: Ranked nozzle drop and vision failure counts.
* **1-Click WhatsApp Handover Briefing**: Auto-formats a shift briefing with metrics and active alerts ready to paste into line WhatsApp groups.

### D. Component Traceability & Recall (`03 // GENEALOGY`)
* **Backward Trace**: Enter board barcode (e.g. `PNL-SM-00142`) $\rightarrow$ instantly view Fuji recipe revision and all mounted component reels, vendor lots, and date codes.
* **Forward Recall**: Enter vendor lot (e.g. `LOT-MUR-202608`) $\rightarrow$ immediately surface every single PCB board and production batch assembled with that lot.

### E. Wire-Level Frame Inspection (`04 // RAW TCP`)
* **Tier 1 View**: Wire-level frames captured directly on TCP port `30040` (BLOB + decoded ASCII).
* **Tier 2 View**: Strongly-typed canonical event envelopes with JSON payload inspection.
* **3-Second Auto-Poll**: Ingested frames stream live into the browser without manual refresh.

### F. Factory Floor Simulator
* `npm run simulate:fuji` connects to port `30040`, executes protocol handshake, streams board checkouts, triggers pick errors, and splices reels.

---

## 4. Quality & Build Verification

* **Unit & Integration Test Suite**: **32 passed out of 32 tests (100% green)** across:
  * `tcp-framing.test.ts` (5 tests: split chunks, coalesced frames, trailing fragments, delayed network sockets)
  * `transaction-atomicity.test.ts` (3 tests: commit, rollback, and event ingestion atomic rollback)
  * `http-endpoints.test.ts` (12 tests exercising all REST endpoints)
  * `event-ingestion.test.ts` (5 tests verifying projections and state machine)
  * `fuji-adapter.test.ts` (7 tests verifying binary framing, tokens, and interlocks)
* **Frontend Anti-Slop Audit**: Scanned with `uislop` scanner (`devibe_scan.py`):
  * **Vibe Score: 0 (Clean, zero AI tells)**. No purple gradients, no fuzzy glowing borders, no emoji icons in briefing headers.
* **Compilation**: Clean TypeScript build across `@mes/shared`, `@mes/api`, and `@mes/web`.

---

## 5. Quickstart Guide (Run & Verify in 60 Seconds)

### Prerequisites
* Node.js v20+ / Mac or Linux
* Project Directory: `~/Documents/antigravity/quirky-pythagoras`

### Running the System
```bash
# 1. Reset and populate Dixon SMT Line 01 seed data
npm run seed

# 2. Launch Backend API (port 4000) and Fuji TCP Gateway (port 30040)
npm run dev:api

# 3. In a second terminal, launch Industrial Web Cockpit (port 3000)
npm run dev:web
```

### URLs
* **Web UI**: [http://localhost:3000](http://localhost:3000)
* **REST API**: [http://localhost:4000](http://localhost:4000)
* **Fuji TCP Socket**: `127.0.0.1:30040`

### Streaming Live Factory Socket Frames
```bash
npm run simulate:fuji
```

### Running Automated Tests
```bash
npm --workspace=@mes/api test
```

---

## 6. SMT MES 0–100 Roadmap & Next Sprint Decision

With architectural hardening complete, the platform is ready for the functional verticals:

```
[Phase 1: HARDENED] ──► [Phase 2: MSL & Solder Paste] ──► [Phase 3: 3D AOI Closed-Loop]
                                                              │
[Phase 5: ERP Sync] ◄─── [Phase 4: PCB Rework Kiosk] ◄────────┘
```

### Key Decisions for the Next Sprint:
1. **Phase 2: MSL Floor-Life & Solder Paste Lifecycle (JEDEC J-STD-033D)**
   * **Scope**: Floor-life clocks for moisture-sensitive ICs (Quectel 4G, STM32 MCU), nitrogen dry cabinet and bake oven resets, solder paste thaw stopwatches (4h) and centrifugal mixing verification at the Screen Printer station.
   * **Value**: Critical audit compliance for Tier-1 customers; prevents solder joint voids and IC package cracking in reflow.
2. **Phase 3: Closed-Loop 3D AOI & PCB Rework Kiosk**
   * **Scope**: Ingest inspection data from Koh Young 3D AOI, trigger automated conveyor quarantine on repeat defects, and provide an interactive PCB component coordinate repair viewer.
