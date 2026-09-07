# Antigravity SMT MES Engine: Executive Project Memory & Master State Briefing

**Document Version**: 5.0.0 (Architectural Deepening & Full Closed-Loop Quality Engine Release)  
**Last Updated**: September 8, 2026  
**Repository**: [https://github.com/Nopenope69/MES](https://github.com/Nopenope69/MES) (`main` branch)  
**Target Sector**: High-Speed Electronics Manufacturing Services (EMS) / Surface Mount Technology (SMT)  
**Primary Benchmarks**: Dixon Technologies, Syrma SGS, Kaynes Technology, Sahasra Electronic Solutions  
**Monorepo Health**: Clean TypeScript build (`code 0`) across all workspaces; **164/164 tests passing (100% green across 22 test files)** in 7.65s.

---

## 1. Executive Summary & Milestone Chronology

The Antigravity SMT MES platform is an enterprise-grade, event-driven Manufacturing Execution System engineered specifically for tier-1 high-speed SMT assembly lines. It has evolved through four major functional phases, a comprehensive diagnostic hardening sweep, and a foundational architectural deepening refactor.

### Phase Milestones Summary:
1. **Phase 1 — Operational Telemetry & Event Ingress**:
   - Asynchronous 3-tier event spine (Ingress BLOB Buffer $\rightarrow$ Atomic Canonical Event Log $\rightarrow$ Vertical Projectors).
   - High-speed Fuji Nexim TCP Socket Gateway (Port 30040) parsing split chunks and coalesced frames.
   - Core ISA-95 asset hierarchy, work order dispatch, and live OEE calculations.

2. **Phase 2 — Quality Enforcement & Controlled-Material Lifecycles**:
   - Single Splicing Authorization Gate (`SplicingAuthorizationService`) enforcing BOM + Reel Usability + JEDEC MSL floor life.
   - JEDEC J-STD-033D Moisture Sensitive Device (MSL) engine computed on-read from immutable exposure logs (`nominal - cumulative ambient exposure = remaining`).
   - Solder paste jar preparation and stencil rolling life tracking (Thaw 4h $\rightarrow$ Planetary Centrifugal Mix 120–300s $\rightarrow$ Stencil Life 8h).

3. **Phase 3 — Closed-Loop 3D AOI, Multi-Up PCB CAD Inspection & Cleanroom Rework**:
   - Canonical optical inspection model decoupling MES from proprietary vendor protocols (Koh Young, Omron, Mirtec, CyberOptics).
   - Multi-up PCB panel discretization ($1..N$ units per panel) with per-unit CAD coordinate mapping and individual `QUALITY_HOLD` containment.
   - Repeat Defect Sentinel: Trips machine interlock on consecutive defects or sliding window limits on the same RefDes.
   - Cleanroom rework execution engine: Thermal cycle limits (`max_rework_cycles`), mandatory engineering dispositions, and closed-loop post-rework optical inspection re-qualification.
   - Upstream root-cause correlation linking defect RefDes $\rightarrow$ CAD $\rightarrow$ Fuji Feeder Slot $\rightarrow$ Reel Lot $\rightarrow$ Placement Nozzle $\rightarrow$ Solder Paste Lot $\rightarrow$ Stencil Session.

4. **Phase 4 — Closed-Loop 3D SPI, Screen Printer IPC-CFX Auto-Tuning & Pre-Reflow Quality**:
   - Native IPC-CFX (IPC-2591 v1.7) AMQP 1.0 transport with in-process test broker ([`MockCfxAmqpBroker`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/adapters/cfx/mock-cfx-amqp-broker.ts)).
   - Recipe-controlled process windows with strict machine limits: squeegee pressure, separation speed, print speed.
   - Diagnostic separation (`SpiClosedLoopService`): detects aperture smear $\rightarrow$ commands CFX underside wipe; detects volume drift $\rightarrow$ commands squeegee micro-tunes; detects critical collapse $\rightarrow$ commands pre-reflow wash buffer divert.
   - Statistically defensible SPC (`SpiSpcService`): $C_p$, $C_{pk}$, $P_p$, $P_{pk}$ computed exclusively when $N \ge 30$ panels.
   - Mandatory closed-loop verification: machine adjustments are validated on the subsequent panel inspected by 3D SPI before release.

5. **Diagnostic Sweep & Bug Remediation (`diagnosing-bugs` Protocol)**:
   - Fixed historical catchup projection replay for Phase 3/4 events in `ProjectionReplayService`.
   - Added `003_phase3_and_phase4_quality_closed_loop.sql` Postgres migration and topological sync tables.
   - Implemented transaction depth re-entrancy in `NodeSqliteDatabase.withTransaction`.
   - Isolated SPC metrics by `recipeId` in `SpiSpcService`.
   - Updated `AoiProjector` to index clean inspection panel units as `PASSED`.

6. **Architectural Deepening Pass (`/improve-codebase-architecture`)**:
   - Replaced shallow services and static callbacks with 4 deep domain modules:
     - `EventStoreModule`: Declarative schema registry (41 schemas), atomic append, automatic upcasting, unified checkpoints and snapshots.
     - `MachineControlModule`: Hardware Abstraction Layer (HAL), strongly typed `MachineParameterCommand` & `MachineActionCommand` discriminated unions, capability discovery, work center state transitions, and audit logging.
     - `DefectLifecycleModule`: Consolidated inspection ingestion, sentinel evaluation, dispositions, component replacement, post-rework inspection, and CAD correlation. Strictly enforces JEDEC MSL floor life computed on-read via `MslService.getReelMslStatus`.
     - `MaterialGateModule`: Single pre-execution material compliance authority (`authorizeFeederSplice`, `authorizeScreenPrinter`, `authorizeReworkReel`) with 21 CFR Part 11 audit logging (`QUALITY_GATE_PASSED`, `QUALITY_GATE_BLOCKED`).
   - Legacy services converted into 100% backward-compatible facades.

---

## 2. Domain Glossary & Official System Vocabulary (`CONTEXT.md`)

All codebase entities strictly adhere to the domain definitions locked in [`CONTEXT.md`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/CONTEXT.md):
- **Core Invariant**: *No module bypasses the domain seam to access raw persistence state, legacy callbacks, uncomputed MSL columns, or vendor-specific machine command strings.*
- **Work Center**: Single physical production asset within an SMT line (e.g. `wc-spg-01`, `wc-spi-01`, `wc-nxt-01`, `wc-aoi-01`).
- **Panel vs Unit**: A raw PCB panel contains $1..N$ multi-up circuits. Quality hold locks individual defective units without invalidating non-defective sister circuits.
- **JEDEC Floor-Life Clock**: Calculated dynamically on-read (`nominal_floor_life - cumulative_ambient_exposure`). Never decremented via cron or background pollers.
- **Repeat Defect Sentinel**: Automated statistical tripwire halting pick-and-place lines upon recurring defect signatures.
- **Material Gate**: Mandatory pre-execution compliance barrier validating BOM, MSL, and expiration before physical attachment.
- **Hardware Abstraction Layer (HAL)**: Protocol-agnostic control seam communicating with machines exclusively via typed command objects and capability checks.

---

## 3. The 4 Deep Subsystems Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             ANTIGRAVITY SMT MES ENGINE                           │
└────────┬───────────────────────┬────────────────────────┬──────────────────────┬─┘
         │                       │                        │                      │
         ▼                       ▼                        ▼                      ▼
┌──────────────────┐    ┌──────────────────┐    ┌───────────────────┐   ┌──────────────────┐
│ EventStoreModule │    │MachineControlMod │    │DefectLifecycleMod │   │ MaterialGateMod  │
├──────────────────┤    ├──────────────────┤    ├───────────────────┤   ├──────────────────┤
│• Declarative     │    │• HAL Control Seam│    │• Closed-Loop AOI/ │   │• Single Material │
│  Event Registry  │    │• Strongly-Typed  │    │  SPI Ingestion    │   │  Gate Authority  │
│  (41 Schemas)    │    │  Command Unions  │    │• Repeat Defect    │   │• Typed Gate APIs:│
│• Atomic Append   │    │  (Param & Action)│    │  Sentinel Engine  │   │  - Feeder Splice │
│• Auto Upcasting  │    │• Capability Guard│    │• JEDEC MSL Floor  │   │  - Screen Printer│
│• Unified Catchup │    │• State Transition│    │  Life Enforcement │   │  - Rework Reels  │
│  Checkpoints &   │    │• Replaced Static │    │• Thermal Limit    │   │• 21 CFR Part 11  │
│  Snapshots       │    │  Callbacks       │    │  CAD Validation   │   │  Audit Logging   │
└──────────────────┘    └──────────────────┘    └───────────────────┘   └──────────────────┘
```

### 1. `EventStoreModule` (`apps/api/src/modules/event-store/`)
- **Seam**: [`IEventStoreModule`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/event-store/event-store.interface.ts)
- **Implementation**: [`EventStoreModule`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/event-store/event-store.module.ts)
- **Registry**: [`EventSchemaRegistry`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/event-store/event-schema.registry.ts) registering Zod schemas for all 41 MES event types.
- **Key Methods**:
  - `append(rawEvent: Partial<MesEventEnvelope>): Promise<EventAppendResult>`
  - `replay(options?: EventReplayOptions): Promise<EventReplayResult>`
  - `getCheckpoints(): Promise<ProjectionCheckpoint[]>`
  - `saveSnapshot(aggregateType, aggregateId, version, state): Promise<string>`
  - `getLatestSnapshot(aggregateType, aggregateId): Promise<AggregateSnapshot | null>`
- **Hermetic Adapter**: [`InMemoryEventStoreAdapter`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/event-store/in-memory-event-store.adapter.ts)

### 2. `MachineControlModule` (`apps/api/src/modules/machine-control/`)
- **Seam**: [`IMachineControlModule`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/machine-control/machine-control.interface.ts) & [`IControllableEquipmentAdapter`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/adapters/equipment-adapter.interface.ts)
- **Implementation**: [`MachineControlModule`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/machine-control/machine-control.module.ts)
- **Strongly Typed Commands**:
  - `MachineParameterCommand`: `{ type: 'SET_PARAMETER', parameter: 'SQUEEGEE_PRESSURE' | 'SEPARATION_SPEED' | 'PRINT_SPEED' | 'FEEDER_PITCH', value: number, unit: string }`
  - `MachineActionCommand`: `{ type: 'ACTION', action: 'CLEAN_STENCIL' | 'DIVERT_CONVEYOR' | 'HOLD_MACHINE' | 'RESUME_MACHINE', reason?: string, operatorId?: string }`
- **Key Methods**:
  - `registerAdapter(adapter: IControllableEquipmentAdapter): void`
  - `applyParameters(workCenterId, command, auditMetadata): Promise<MachineCommandResult>`
  - `executeAction(workCenterId, command, auditMetadata): Promise<MachineCommandResult>`
  - `tripInterlock(workCenterId, reason, auditMetadata): Promise<void>`
  - `clearInterlock(workCenterId, reason, operatorId): Promise<void>`
- **Hermetic Adapter**: [`InMemoryEquipmentAdapter`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/machine-control/in-memory-equipment.adapter.ts)

### 3. `DefectLifecycleModule` (`apps/api/src/modules/defect-lifecycle/`)
- **Seam**: [`IDefectLifecycleModule`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/defect-lifecycle/defect-lifecycle.interface.ts)
- **Implementation**: [`DefectLifecycleModule`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/defect-lifecycle/defect-lifecycle.module.ts)
- **Key Methods**:
  - `ingestInspection(canonical: CanonicalAoiInspectionResult): Promise<IngestionResult>`
  - `recordDisposition(params): Promise<{ success: boolean; dispositionId: string; status: string }>`
  - `verifyReplacement(panelBarcode, unitPosition, refDes, replacementReelId): Promise<ReplacementVerificationResult>`
  - `executeReplacement(params: ExecuteReplacementParams): Promise<{ success: boolean; reworkEventId: string; reworkCycle: number; message: string }>`
  - `verifyPostRework(params: PostReworkInspectionParams): Promise<{ success: boolean; panelStatus: string; message: string }>`
  - `evaluateRepeatDefects(canonical, programId?, revision?): Promise<SentinelEvaluationResult>`
  - `correlate(panelBarcode, unitPosition?, refDes?): Promise<DefectCorrelationReport>`
  - `getPanelQuality(panelBarcode): Promise<any>`
  - `getCadDefinitions(programId?, revision?, boardSide?): Promise<CadCoordinateDefinition[]>`
  - `getDefectHeatmap(programId?, revision?): Promise<any[]>`

### 4. `MaterialGateModule` (`apps/api/src/modules/material-gate/`)
- **Seam**: [`IMaterialGateModule`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/material-gate/material-gate.interface.ts)
- **Implementation**: [`MaterialGateModule`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/apps/api/src/modules/material-gate/material-gate.module.ts)
- **Key Methods**:
  - `authorizeFeederSplice(params: SplicingAuthParams): Promise<SplicingDecision>`
  - `authorizeScreenPrinter(params: PrinterAuthParams): Promise<PrinterAuthDecision>`
  - `authorizeReworkReel(params: ReworkReelAuthParams): Promise<ReworkReelAuthDecision>`
- **Compliance**: Appends immutable `QUALITY_GATE_PASSED` and `QUALITY_GATE_BLOCKED` events into `EventStoreModule` with operator ID, reason, and work center ID.

---

## 4. Master Database Schema Reference (`schema.sql`)

### Storage & Event Spine:
* `ingress_events`: Raw byte-level socket store (`id`, `source_type`, `source_ip`, `raw_payload` [BLOB], `decoded_payload` [TEXT], `frame_length`, `received_at`).
* `production_events`: Canonical domain event log (`id`, `event_id`, `event_type`, `schema_version`, `event_time`, `received_time`, `source_type`, `source_id`, `sequence_id`, `site_id`, `work_center_id`, `asset_path`, `ingress_event_id`, `batch_id`, `work_order_id`, `operator_id`, `correlation_id`, `payload_json`, `created_at`).
* `projection_checkpoints`: Checkpoint store (`projection_name`, `last_event_id`, `last_event_time`, `events_processed`, `updated_at`).
* `projection_snapshots`: Catchup state snapshots (`id`, `aggregate_type`, `aggregate_id`, `snapshot_version`, `state_json`, `created_at`).

### Material & Equipment Master Data:
* `component_reels`: Reel inventory (`id`, `reel_id`, `part_number`, `part_name`, `supplier_name`, `lot_number`, `date_code`, `initial_quantity`, `current_quantity`, `msl_level`, `msl_class`, `msl_remaining_minutes`, `mbb_opened_at`, `mbb_resealed_at`, `storage_location`, `storage_state`, `floor_clock_state`, `floor_life_nominal_minutes`, `floor_life_expires_at`, `hic_status`, `bake_status`, `bake_started_at`, `last_bake_profile_id`, `last_bake_completed_at`, `status`).
* `msl_exposure_logs`: Interval exposure records (`id`, `reel_id`, `state`, `started_at`, `ended_at`, `duration_seconds`, `cabinet_id`, `source_event_id`, `created_at`).
* `dry_cabinets`: Dry storage cabinets (`id`, `code`, `name`, `rh_limit_percent`, `temperature_min_c`, `temperature_max_c`, `validation_status`, `last_calibrated_at`).
* `msl_bake_profiles`: Thermal bake profiles (`id`, `standard`, `standard_revision`, `msl_class`, `package_thickness_class`, `temperature_c`, `minimum_duration_minutes`, `carrier_type`, `enabled`).
* `solder_paste_profiles`: Solder paste specs (`id`, `manufacturer`, `product_code`, `alloy_type`, `storage_min_c`, `storage_max_c`, `thaw_required_minutes`, `minimum_processing_temperature_c`, `mixing_min_seconds`, `mixing_max_seconds`, `stencil_life_minutes`, `shelf_life_days`, `active`).
* `solder_paste_jars`: Individual paste containers (`id`, `jar_id`, `part_number`, `profile_id`, `alloy_type`, `lot_number`, `expiry_date`, `status`, `removed_from_cold_at`, `thaw_verified_at`, `temperature_verified_c`, `mixed_at`, `mixed_duration_seconds`, `current_stencil_session_id`, `current_work_center_id`).
* `stencils`: Stencil master (`id`, `stencil_id`, `part_number`, `revision`, `stencil_serial_number`, `status`, `created_at`).
* `stencil_sessions`: Active printing sessions (`id`, `stencil_id`, `work_center_id`, `batch_id`, `started_at`, `ended_at`, `status`, `life_expires_at`).
* `stencil_paste_loads`: Paste load history (`id`, `stencil_session_id`, `paste_jar_id`, `loaded_at`, `removed_at`, `status`).
* `smt_feeder_slots`: Fuji NXT feeder bank setup (`id`, `work_center_id`, `module_no`, `stage_no`, `slot_no`, `feeder_id`, `feeder_type`, `assigned_part_number`, `current_reel_id`, `status`).
* `feeder_error_logs`: Hardware pickup error telemetry (`id`, `work_center_id`, `module_no`, `slot_no`, `nozzle_id`, `error_type`, `occurred_at`).

### Quality, Inspection & Rework Models:
* `pcb_cad_definitions`: Board CAD layout (`id`, `product_id`, `product_revision`, `program_id`, `program_revision`, `board_side`, `cad_revision`, `ref_des`, `unit_position`, `x_mm`, `y_mm`, `rotation_deg`, `package_type`, `assigned_part_number`, `max_rework_cycles`).
* `panel_units`: Multi-up board units (`id`, `panel_barcode`, `unit_position`, `unit_serial_number`, `status`, `created_at`, `updated_at`).
* `quality_rules`: Sentinel thresholds (`id`, `product_id`, `product_revision`, `program_id`, `program_revision`, `defect_type`, `defect_category`, `ref_des`, `consecutive_failure_limit`, `sliding_window_size`, `sliding_window_threshold`, `action_required`, `active`).
* `aoi_inspections`: AOI inspection headers (`id`, `source_system`, `source_inspection_id`, `source_file_hash`, `panel_barcode`, `batch_id`, `work_center_id`, `optical_machine_id`, `inspection_phase`, `result`, `total_defects`, `duration_seconds`, `inspected_at`, `created_at`).
* `aoi_defects`: Optical defects (`id`, `inspection_id`, `panel_barcode`, `unit_position`, `ref_des`, `defect_category`, `defect_type`, `defect_signature`, `offset_x_um`, `offset_y_um`, `rotation_deg`, `board_side`, `status`, `image_ref`, `created_at`).
* `rework_dispositions`: MRB dispositions (`id`, `defect_id`, `panel_barcode`, `unit_position`, `disposition`, `reason`, `authorized_by`, `disposition_at`).
* `rework_events`: Rework execution logs (`id`, `defect_id`, `panel_barcode`, `unit_position`, `ref_des`, `technician_id`, `station_id`, `old_mpn`, `old_reel_id`, `replacement_mpn`, `replacement_reel_id`, `rework_method`, `temperature_profile_id`, `rework_cycle`, `created_at`).
* `spi_inspections`: 3D SPI headers (`id`, `inspection_id`, `panel_barcode`, `batch_id`, `work_center_id`, `optical_machine_id`, `recipe_id`, `result`, `total_pads`, `defective_pads`, `cycle_time_seconds`, `inspected_at`, `created_at`).
* `spi_pad_measurements`: Solder paste pad geometry (`id`, `spi_inspection_id`, `panel_barcode`, `unit_position`, `pad_id`, `ref_des`, `volume_percent`, `height_um`, `area_percent`, `offset_x_um`, `offset_y_um`, `status`, `defect_type`).
* `recipe_process_windows`: SPI & Printer tolerances (`id`, `recipe_code`, `product_id`, `stencil_nominal_thickness_um`, `volume_lower_limit_percent`, `volume_upper_limit_percent`, `volume_warning_lower_percent`, `volume_warning_upper_percent`, `height_lower_limit_um`, `height_upper_limit_um`, `area_lower_limit_percent`, `max_xy_offset_um`, `squeegee_pressure_min_kgf`, `squeegee_pressure_max_kgf`, `separation_speed_min_mms`, `separation_speed_max_mms`, `active`).
* `printer_tuning_logs`: Closed-loop tuning records (`id`, `work_center_id`, `recipe_id`, `source_spi_inspection_id`, `tuning_action`, `parameter_modified`, `old_value`, `new_value`, `unit`, `correction_reason`, `verification_status`, `verification_spi_inspection_id`, `created_at`).

---

## 5. Master Test Suite Matrix (22 Files, 164 Tests, 100% Green)

```text
Test Files  22 passed (22)
     Tests  164 passed (164)
  Duration  7.65s
```

| Suite Name | Scope | Tests |
|---|---|---|
| `tests/modules/event-store.module.test.ts` | Schema registry, atomic transactional append, upcasting, unified checkpoints | 3 |
| `tests/modules/machine-control.module.test.ts` | HAL seam, parameter & action command unions, capability discovery, audit events | 7 |
| `tests/modules/defect-lifecycle.module.test.ts` | Ingestion, repeat defect sentinel, dispositions, rework MSL block, CAD correlation | 5 |
| `tests/modules/material-gate.module.test.ts` | Feeder splice authorization, screen printer quality gate, rework reel, 21 CFR Part 11 | 13 |
| `tests/spi-closed-loop-phase-4.test.ts` | IPC-CFX AMQP 1.0, Koh Young SPI, stencil smear wipe, squeegee pressure tune, divert | 15 |
| `tests/aoi-rework-phase-3.test.ts` | Canonical AOI, multi-up panel hold, CAD visualizer, repeat defect trip, rework loop | 17 |
| `tests/splicing-authorization.test.ts` | Splicing gate, BOM matching, MSL interlock trips, REST vs TCP gateway equivalence | 6 |
| `tests/solder-paste.test.ts` | Cold storage retrieval, thaw verification, planetary mix, stencil rolling life | 9 |
| `tests/msl-lifecycle.test.ts` | JEDEC J-STD-033D, FakeClock multi-cycle exposure, dry cabinet pause, bake restore | 9 |
| `tests/tcp-framing.test.ts` | TCP streaming frame accumulator, network fragmentation, coalescing, loopback socket | 5 |
| `tests/transaction-atomicity.test.ts` | Database transaction commit, rollback, and event ingestion fault handling | 3 |
| `tests/fuji-adapter.test.ts` | Fuji Nexim framing, SETEV/STARTEV handshake, LOADCOMP, CHANGECOMP, ACK codes | 7 |
| `tests/event-ingestion.test.ts` | Event ingestion pipeline, ISA-95 Core and SMT projections, OEE and shift tracking | 5 |
| `tests/http-endpoints.test.ts` | End-to-end REST API endpoints: health, OEE metrics, shift summary, feeder map | 12 |
| `tests/repo-diagnostics.test.ts` | Projection catchup replay, migration tables, transaction depth, recipe isolation | 5 |
| `tests/database-scaling-track-d.test.ts` | PostgreSQL dual-dialect schema, migrations, connection pool, and sync runner | 6 |
| `tests/qa-performance-track-f.test.ts` | High-load concurrent ingestion benchmarking, latch latency, stress resilience | 5 |
| `tests/enterprise-security-track-e.test.ts` | JWT auth, RBAC authorization, tamper-evident audit logs, rate limiting | 18 |
| `tests/devops-track-c.test.ts` | Docker multi-stage build, container health checks, environment variables | 6 |
| `tests/projectors/smt-projector.test.ts` | SMT projector material and feeder slot read model updates | 3 |
| `tests/projectors/core-projector.test.ts` | Core projector batch and machine state read model updates | 3 |
| `tests/utils/clock.test.ts` | SystemClock and FakeClock deterministic time progression utilities | 2 |

---

## 6. Monorepo Structure & Key Paths

```text
quirky-pythagoras/
├── CONTEXT.md                                 # Official SMT domain glossary & language definitions
├── PROJECT_MEMORY.md                          # Master memory briefing (this document)
├── README.md                                  # System overview & quickstart guide
├── docker-compose.yml                         # Containerized deployment orchestration
├── packages/
│   └── shared/                                # Monorepo types, Zod schemas, CFX message definitions
│       └── src/
│           ├── cfx.ts                         # IPC-CFX 1.7 message envelopes & topics
│           ├── events.ts                      # 41 MES domain event schemas
│           └── index.ts                       # Shared exports
└── apps/
    ├── api/                                   # Node.js / Express / TypeScript MES backend
    │   ├── src/
    │   │   ├── modules/                       # The 4 Deep Domain Modules
    │   │   │   ├── event-store/               # Declarative schema registry, append, checkpoints
    │   │   │   ├── machine-control/           # Hardware Abstraction Layer & typed commands
    │   │   │   ├── defect-lifecycle/          # AOI/SPI ingestion, sentinel, rework, correlation
    │   │   │   └── material-gate/             # Single compliance authority & 21 CFR Part 11 audit
    │   │   ├── adapters/                      # Equipment gateways (Fuji Nexim TCP, IPC-CFX AMQP)
    │   │   ├── services/                      # Backward-compatible facades & specialized services
    │   │   ├── routes/                        # Express HTTP endpoints (/api/v1/smt, /auth, etc.)
    │   │   ├── db/                            # Database connection, migrations, seed, schema.sql
    │   │   └── server.ts                      # Express app & TCP gateway bootstrap
    │   └── tests/                             # Vitest automated test suites (22 files)
    └── web/                                   # React / TypeScript / Tailwind Cleanroom Cockpit
        └── src/
            ├── components/                    # Industrial station UIs (SpiStation, AoiStation, etc.)
            └── App.tsx                        # Master navigation tabs
```

---

## 7. Recommended Next Steps for Future Sessions

When resuming in a new chat, the system is primed for the following high-value extensions:
1. **Physical Industrial Gateway Pilots**:
   - Transitioning `MockCfxAmqpBroker` to production Apache Qpid Proton / RabbitMQ AMQP 1.0 connection to physical Koh Young / Omron machines.
   - Deploying Fuji Nexim TCP gateway to physical shop-floor subnets with TLS encapsulation.
2. **AI-Driven Preventive Root-Cause Intelligence**:
   - Expanding `DefectCorrelationReport` with online machine learning clustering across feeder error telemetry, nozzle vacuum profiles, and stencil solder height distributions to predict aperture clogging before defects trip.
3. **Multi-Line Enterprise Fleet Orchestration**:
   - Scaling `MachineControlModule` and `MaterialGateModule` to coordinate concurrent multi-line SMT bays with central warehouse automated guided vehicles (AGVs).
