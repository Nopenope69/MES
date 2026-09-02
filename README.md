# Antigravity SMT MES Engine

> **Conglomerate-Grade Manufacturing Execution System for Indian Electronics Manufacturing Services (EMS) & SMT Assembly Lines.**  
> Built around the **Fuji Nexim Host Interface V2.8.0** with closed-loop splicing interlocks, real-time CPH placement telemetry, and bidirectional component reel genealogy.

---

## Architecture Overview

Antigravity MES is architected following the **3-Tier Event-Driven Model** and the **ISA-95 Part 3 Physical Asset Hierarchy**:

```
[ Physical SMT Line / Fuji NXT III / Screen Printer / Reflow ]
                            │
               TCP Socket Port 30040 (Big-Endian + STX/ETX)
                            ▼
     ┌──────────────────────────────────────────────┐
     │ Tier 1: Ingress Layer (ingress_events)       │
     │ Raw, unaltered byte streams & frames         │
     └──────────────────────┬───────────────────────┘
                            ▼
     ┌──────────────────────────────────────────────┐
     │ Tier 2: Canonical Event Store                │
     │ Strongly-typed, immutable production_events │
     └──────────────────────┬───────────────────────┘
                            ▼
     ┌──────────────────────────────────────────────┐
     │ Tier 3: CQRS Projections & Business State    │
     │ • batches & panel_checkouts                  │
     │ • smt_feeder_slots & component_reels         │
     │ • equipment_state_logs & feeder_error_logs   │
     └──────────────────────────────────────────────┘
```

### Key Capabilities

1. **Direct Fuji Nexim Host Interface Gateway (Port 30040)**:
   * Decodes Big-Endian 4-byte length + STX (`0x02`) + tab-separated ASCII + ETX (`0x03`) packets.
   * Auto-maps `MCSTATECHANGE` $\rightarrow$ `STATE_CHANGED`.
   * Auto-maps `PRODSTARTED` & `PRODCOMPLETEII` $\rightarrow$ `PANEL_CHECKOUT` (exact cycle time and skip bitmasks).
   * Auto-maps `PDERROR` & `NOZZLECOUNT` $\rightarrow$ `feeder_error_logs`.
   * Answers protocol handshakes (`SETEV`, `STARTEV`, `KEEPALIVE`).

2. **The 10x Quality Wedge: Closed-Loop Splicing Interlock**:
   * SMT lines place 50,000–100,000 components/hour. An operator splicing the wrong reel at 2 AM scraps hundreds of finished boards.
   * On `LOADCOMP` / `CHANGECOMP`, the MES validates the scanned component part number against the active BOM for that slot.
   * **Result = 0 (OK)**: Splicing approved, feeder advances.
   * **Result = 1 (NG)**: Mismatched reel detected! **Fuji NXT pick-and-place physically inhibits pickup from that feeder slot.**

3. **High-Precision Shopfloor Frontend (Zero AI Slop)**:
   * Custom Industrial Palette: Obsidian titanium chassis (`#0B0F14`), milled anodized metal panels (`#121820`), and subtle FR4 circuit trace grid.
   * **Fuji NXT III Feeder Bay Rack**: Physical cassette rail with individual Andon LEDs (Green = Nominal, Amber = Low Stock, Red = Interlock Trip).
   * **Optical Splicing Dock with Laser Reticle**: Dual-channel comparison of BOM specification vs scanned reel barcode.
   * **Placement Speed Gauge**: Real-time CPH (Components Per Hour) vs target (e.g. 45,000 CPH).
   * **Bidirectional Genealogy Explorer**: Trace from Panel Barcode $\rightarrow$ Component Reels $\rightarrow$ Vendors, or forward recall by Defective Reel ID.
   * **1-Click WhatsApp SMT Handover Briefing**: Formats a clean briefing ready for line managers.

---

## Monorepo Structure

```
├── packages/
│   └── shared/          # Universal event envelopes, Zod schemas, ISA-95 domain models, Fuji protocol
├── apps/
│   ├── api/             # Express server, SQLite/PostgreSQL driver, Fuji TCP gateway, Event Ingestion
│   │   ├── src/adapters/# Fuji Nexim Gateway & Fuji SMT Line Simulator
│   │   ├── src/services/# Event Ingestion, State Projections, Genealogy, OEE & Pareto
│   │   └── src/db/      # ISA-95 Schema & Dixon Technologies SMT Line 01 seed dataset
│   └── web/             # React 19 + Vite + Tailwind CSS industrial cleanroom instrument UI
└── docs/
    └── architecture/    # ADR-001, ADR-002, ADR-003
```

---

## Quickstart

### 1. Install Dependencies & Build Packages
```bash
npm install
npm --workspace=@mes/shared run build
```

### 2. Seed the SMT Database
Populates Dixon Technologies Noida SMT Line 01 with authentic programs, component reels, and feeder slots:
```bash
npm --workspace=@mes/api run seed
```

### 3. Run Automated Verification Tests
Executes the vitest suite (Fuji protocol parser, splicing interlocks, board checkouts, OEE calculation):
```bash
npm --workspace=@mes/api test
```

### 4. Launch Development Servers
```bash
# Terminal 1: Backend API & Fuji TCP Socket Gateway (Port 4000 & 30040)
npm run dev:api

# Terminal 2: React 19 SMT Web Instrument (Port 5173)
npm run dev:web
```

Open `http://localhost:5173` in your browser.
