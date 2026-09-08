# Phase 6 Implementation Plan: Closed-Loop Reflow Oven Telemetry & Thermal Profiling Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Phase 6: an audit-grade closed-loop reflow thermal profiling and oven drift management subsystem featuring multi-vendor profiler ingestion (KIC, Datapaq, M.O.L.E.), exact midpoint PWI mathematical calculations, bivariate statistical oven drift analysis ($Z_\mu$ and $Z_\sigma$), OEM-gated safety interlocks via `MachineControlModule`, and cleanroom cockpit UI.

**Architecture:** Deep `ReflowProfilingModule` separating physical PCB thermal response (Reflow Profile Store) from continuous high-frequency oven telemetry (`ITelemetryStore`), derived compliance facts (`EventStoreModule`), and machine safety actuation (`MachineControlModule`).

**Tech Stack:** TypeScript, Express, SQLite (`better-sqlite3`), PostgreSQL dual-dialect, Vitest, React 19, Tailwind CSS, Lucide icons.

**Spec:** [`docs/superpowers/specs/2026-09-08-reflow-closed-loop-design.md`](file:///Users/tecbusiness/Documents/antigravity/quirky-pythagoras/docs/superpowers/specs/2026-09-08-reflow-closed-loop-design.md)

## Global Constraints

- All pre-existing 176 tests across Phases 1–5 must remain green without weakening or modifying existing behavioral assertions.
- Raw $T(t)$ thermocouple curves and continuous 1–5 Hz zone telemetry MUST NOT enter `EventStoreModule`.
- PWI calculation is midpoint-based: $PWI = \frac{|\text{Measured} - C|}{W} \times 100\%$, with overall PWI determined by the worst probe and characteristic.
- Profile run lifecycle (`UPLOADED` $\rightarrow$ `ACTIVE` $\rightarrow$ `RETIRED`) is decoupled from live process compliance state (`COMPLIANT` $\rightarrow$ `DRIFT_CONFIRMED` $\rightarrow$ `REVALIDATION_REQUIRED`).
- Profiles with $PWI > 100\%$ (`FAIL`) are strictly barred from becoming `ACTIVE`.
- Concurrency invariant: partial unique index `idx_reflow_profile_active_scope` on `(line_id, equipment_id, recipe_id, board_part_number, board_revision) WHERE status = 'ACTIVE'`.
- Persistence duration invariant: 15 seconds persistence for drift confirmation, 45 seconds recovery hysteresis, independent of 1 Hz vs 5 Hz telemetry rates.
- Safety invariant: `OvenDriftService` is inference-only; all physical interlocks request validated OEM responses through `MachineControlModule`.

---

## File Structure

```text
packages/shared/
  src/events.ts                                # [MODIFY] Add Phase 6 domain event schemas & Zod validators
  src/domain.ts                                # [MODIFY] Export ReflowThermalSpecification, ReflowProfileRun, etc.

apps/api/
  src/db/migrations/005_phase6_reflow_profiling.sql # [NEW] PostgreSQL migration
  src/db/schema.sql                            # [MODIFY] Add Phase 6 SQLite tables & partial unique index
  src/db/seed.ts                               # [MODIFY] Seed thermal spec, baseline profile run, & telemetry fixtures
  src/modules/event-store/event-schema.registry.ts # [MODIFY] Register Phase 6 event schemas

  src/modules/reflow-profiling/
    reflow-profiling.interface.ts              # [NEW] Public contracts & interfaces
    reflow-profiling.module.ts                 # [NEW] Deep module facade & DI entry point
    storage/
      reflow-profile.store.interface.ts        # [NEW] Data store contract
      reflow-profile.store.ts                  # [NEW] Dual-dialect SQL store
    adapters/
      profiler-importer.interface.ts           # [NEW] Importer abstraction & ProfilerFile interface
      kic-importer.adapter.ts                  # [NEW] KIC parser (.KIC2000Profile, CSV)
      datapaq-importer.adapter.ts              # [NEW] Datapaq parser (.paqfile, CSV)
      mole-importer.adapter.ts                 # [NEW] M.O.L.E. parser (.mdm, text)
    services/
      pwi-calculation.service.ts               # [NEW] Midpoint PWI, crossing interpolation & rolling regression
      recipe-specification.service.ts          # [NEW] Versioned immutable thermal specification management
      profile-lifecycle.service.ts             # [NEW] Profile run state machine & atomic activation
      profiler-import.service.ts               # [NEW] File ingress, SHA-256 provenance, normalization & PWI
      oven-drift.service.ts                    # [NEW] Bivariate Z-score drift, persistence, hysteresis, DATA_INSUFFICIENT
      thermal-impact.service.ts                # [NEW] Process-risk estimation (PWI margin vs drift)
      profile-correlation.service.ts           # [NEW] Statistical correlation with oven telemetry window

  src/routes/reflow.router.ts                  # [NEW] REST API router
  src/server.ts                                # [MODIFY] Mount reflow router

  tests/fixtures/reflow/                       # [NEW] Golden test fixtures (KIC, Datapaq, M.O.L.E., corrupt, out-of-spec)
  tests/reflow-closed-loop-phase-6.test.ts     # [NEW] 16-category comprehensive test suite

apps/web/
  src/components/ReflowThermalStation.tsx      # [NEW] Cleanroom cockpit thermal station
  src/App.tsx                                  # [MODIFY] Mount reflow station tab
```

---

## Task List

### Task 1: Shared Domain Types & Phase 6 Event Schemas (`packages/shared`)

**Files:**
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/domain.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: 
  - `ReflowThermalSpecification`, `ReflowProfileRun`, `ReflowProfileProbe`, `CalculatedProfilePwi`, `ReflowProcessState`, `OvenDriftReport`
  - Event schemas: `REFLOW_PROFILE_UPLOADED`, `REFLOW_PROFILE_VALIDATED`, `REFLOW_PROFILE_APPROVED`, `REFLOW_PROFILE_REJECTED`, `REFLOW_PROFILE_ACTIVATED`, `REFLOW_PROFILE_RETIRED`, `REFLOW_PROFILE_COMPLIANCE_EVALUATED`, `REFLOW_DRIFT_DETECTED`, `REFLOW_PROCESS_STATE_CHANGED`, `REFLOW_INTERLOCK_REQUESTED`, `REFLOW_INTERLOCK_CONFIRMED`, `REFLOW_INTERLOCK_FAILED`, `REFLOW_REVALIDATION_REQUESTED`

- [ ] **Step 1: Write schemas in `packages/shared/src/events.ts`**
- [ ] **Step 2: Add TypeScript domain interfaces to `packages/shared/src/domain.ts`**
- [ ] **Step 3: Export from `packages/shared/src/index.ts`**
- [ ] **Step 4: Build shared workspace**
  Run: `npm --workspace=@mes/shared run build`
  Expected: `code 0`
- [ ] **Step 5: Commit changes**
  Run: `git add packages/shared/ && git commit -m "feat(shared): add Phase 6 reflow thermal schemas and domain types"`

---

### Task 2: Database Migration, Schema, Seed & Schema Registry (`apps/api`)

**Files:**
- Create: `apps/api/src/db/migrations/005_phase6_reflow_profiling.sql`
- Modify: `apps/api/src/db/schema.sql`
- Modify: `apps/api/src/db/seed.ts`
- Modify: `apps/api/src/modules/event-store/event-schema.registry.ts`

**Interfaces:**
- Consumes: Shared schemas from Task 1
- Produces: Tables `reflow_thermal_specifications`, `reflow_profile_runs`, `reflow_profile_probes`, `reflow_process_states`, `reflow_profile_correlations` with partial unique index `idx_reflow_profile_active_scope`

- [ ] **Step 1: Create `005_phase6_reflow_profiling.sql` migration for PostgreSQL**
- [ ] **Step 2: Update `schema.sql` with SQLite tables, constraints, and partial unique index**
- [ ] **Step 3: Register all Phase 6 event schemas in `event-schema.registry.ts`**
- [ ] **Step 4: Update `seed.ts` with active thermal specification for `PROG-SM-METER-TOP-REV4`, baseline profile run, and oven calibration telemetry**
- [ ] **Step 5: Run seed to verify database creation**
  Run: `npm --workspace=@mes/api run seed`
  Expected: Success output with Phase 6 reflow fixtures confirmed
- [ ] **Step 6: Commit changes**
  Run: `git add apps/api/src/db/ apps/api/src/modules/event-store/ && git commit -m "feat(api): add Phase 6 reflow database schema, migration, and seed fixtures"`

---

### Task 3: Reflow Profile Data Store (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/reflow-profiling/storage/reflow-profile.store.interface.ts`
- Create: `apps/api/src/modules/reflow-profiling/storage/reflow-profile.store.ts`

**Interfaces:**
- Consumes: `IDatabase` from `src/db/database.ts`, types from `@mes/shared`
- Produces: `IReflowProfileDataStore` implementation managing specifications, runs, probes, and process state

- [ ] **Step 1: Define `IReflowProfileDataStore` interface with methods for save/get/update of specs, runs, probes, and process states**
- [ ] **Step 2: Implement `ReflowProfileStore` handling both SQLite and PostgreSQL dual dialects**
- [ ] **Step 3: Ensure probe time-series samples are serialized cleanly as JSON without loss of timestamp precision**
- [ ] **Step 4: Enforce atomic activation query in transaction: retirement of prior active run + activation of target run**
- [ ] **Step 5: Commit changes**
  Run: `git add apps/api/src/modules/reflow-profiling/storage/ && git commit -m "feat(reflow): implement ReflowProfileStore abstraction"`

---

### Task 4: Vendor Profiler Importer Adapters (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/reflow-profiling/adapters/profiler-importer.interface.ts`
- Create: `apps/api/src/modules/reflow-profiling/adapters/kic-importer.adapter.ts`
- Create: `apps/api/src/modules/reflow-profiling/adapters/datapaq-importer.adapter.ts`
- Create: `apps/api/src/modules/reflow-profiling/adapters/mole-importer.adapter.ts`

**Interfaces:**
- Produces: `IProfilerImporter` with `canParse(file)` and `parse(file): Promise<RawProfilerRun>`
- Implements: Secure file parsing (MIME check, 15MB size limit, XXE-safe parser configuration with external entity resolution disabled, NaN/Infinity rejection, unit conversion)

- [ ] **Step 1: Define `IProfilerImporter` and `ProfilerFile` interfaces**
- [ ] **Step 2: Implement `KicImporterAdapter` for KIC files (`.KIC2000Profile`, `.KIC2000MVP`, and CSV exports)**
- [ ] **Step 3: Implement `DatapaqImporterAdapter` for Datapaq files (`.paqfile`, CSV/text exports)**
- [ ] **Step 4: Implement `MoleImporterAdapter` for ECD M.O.L.E. files (`.mdm`, `.xmg`, text exports)**
- [ ] **Step 5: Ensure all adapters extract explicit `timeSeconds` and `temperatureC` per sample with calibration provenance retained**
- [ ] **Step 6: Commit changes**
  Run: `git add apps/api/src/modules/reflow-profiling/adapters/ && git commit -m "feat(reflow): add KIC, Datapaq, and M.O.L.E. profiler adapters"`

---

### Task 5: PWI Mathematical Calculation & Curve Extraction Engine (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/reflow-profiling/services/pwi-calculation.service.ts`

**Interfaces:**
- Consumes: `ReflowThermalSpecification`, `RawProfilerRun`
- Produces: `CalculatedProfilePwi` with exact midpoint PWI, interpolated threshold crossings, and rolling least-squares regression slopes

- [ ] **Step 1: Implement linear interpolation crossing helper `findThresholdCrossing(samples, threshold, direction)`**
- [ ] **Step 2: Implement rolling least-squares linear regression slope helper `calculateRollingSlope(samples, windowSeconds)`**
- [ ] **Step 3: Implement characteristic extractors: Peak Temperature, TAL (upward & downward crossings), Soak Duration (min & max upward crossings), Max Ramp Rate, and Max Cooling Rate (positive magnitude)**
- [ ] **Step 4: Implement midpoint PWI formula: $PWI_k = \frac{|\text{Measured} - C_k|}{W_k} \times 100\%$**
- [ ] **Step 5: Implement overall PWI aggregation: worst-case across all active probes and characteristics**
- [ ] **Step 6: Classify result: `PASS` ($PWI \le 80\%$), `WARNING` ($80\% < PWI \le 100\%$), `FAIL` ($PWI > 100\%$)**
- [ ] **Step 7: Commit changes**
  Run: `git add apps/api/src/modules/reflow-profiling/services/pwi-calculation.service.ts && git commit -m "feat(reflow): implement midpoint PWI and curve extraction service"`

---

### Task 6: Profiler Ingress, Lifecycle & Invariant Enforcement Services (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/reflow-profiling/services/recipe-specification.service.ts`
- Create: `apps/api/src/modules/reflow-profiling/services/profile-lifecycle.service.ts`
- Create: `apps/api/src/modules/reflow-profiling/services/profiler-import.service.ts`

**Interfaces:**
- Consumes: Data store, importer adapters, PWI calculation engine, `EventStoreModule`
- Produces: Ingress workflow, server-side SHA-256, structural validation (`REFLOW_PROFILE_VALIDATED` or `VALIDATION_FAILED`), compliance evaluation (`REFLOW_PROFILE_COMPLIANCE_EVALUATED` with `PASS` | `WARNING` | `FAIL`), lifecycle state machine (`UPLOADED` $\rightarrow$ `ACTIVE` $\rightarrow$ `RETIRED`)
- Invariant: Profiles with `complianceResult === 'FAIL'` CANNOT transition to `ACTIVE`.

- [ ] **Step 1: Implement `RecipeSpecificationService` managing immutable versioned specs with validation (LSL < USL, min < max)**
- [ ] **Step 2: Implement `ProfileLifecycleService` managing state transitions, QA approval (21 CFR Part 11 sign-off), and atomic baseline activation**
- [ ] **Step 3: Enforce `PWI-FAIL` guard in `ProfileLifecycleService`: reject activation if $PWI > 100\%$ with `CANNOT_ACTIVATE_NON_COMPLIANT_PROFILE`**
- [ ] **Step 4: Implement `ProfilerImportService`: server-side SHA-256 hash, adapter detection, structural validation emitting `REFLOW_PROFILE_VALIDATED` (or `VALIDATION_FAILED`), PWI calculation emitting `REFLOW_PROFILE_COMPLIANCE_EVALUATED` (`PASS` | `WARNING` | `FAIL`), and event emission to `EventStoreModule`**
- [ ] **Step 5: Commit changes**
  Run: `git add apps/api/src/modules/reflow-profiling/services/ && git commit -m "feat(reflow): implement profile import and lifecycle services"`

---

### Task 7: Bivariate Oven Drift Detection, Thermal Impact & Correlation Services (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/reflow-profiling/services/thermal-impact.service.ts`
- Create: `apps/api/src/modules/reflow-profiling/services/profile-correlation.service.ts`
- Create: `apps/api/src/modules/reflow-profiling/services/oven-drift.service.ts`

**Interfaces:**
- Consumes: `ITelemetryStore`, `ReflowProfileStore`, `MachineControlModule`
- Produces: Bivariate drift detection ($Z_\mu$ mean shift, $Z_\sigma$ oscillation), normalized severity, persistence duration, recovery hysteresis, `DATA_INSUFFICIENT` handling, conservative `ThermalImpactEstimate`, and emergency interlock requests

- [ ] **Step 1: Implement `ProfileCorrelationService` capturing contemporaneous oven telemetry window ($\mu$, $\sigma$, $\min$, $\max$) during a physical profiler pass**
- [ ] **Step 2: Implement conservative `ThermalImpactService` estimating process-window risk with explicit confidence and basis (`EMPIRICAL` | `MODEL` | `RULE_BASED` | `UNKNOWN`), ensuring `UNKNOWN` or low confidence never asserts compliance**
- [ ] **Step 3: Implement `OvenDriftService`: bivariate $Z$-scores with `minimumSigmaC` floor, normalized composite severity vector ($\sum w = 1.0$), 15s persistence duration, and 45s recovery hysteresis**
- [ ] **Step 4: Implement `DATA_INSUFFICIENT` state when zone or speed packets are missing/stale**
- [ ] **Step 5: Wire critical thermal collapse ($> 15^\circ\text{C}$ drop) to dispatch `EMERGENCY_HOLD` through `MachineControlModule`**
- [ ] **Step 6: Commit changes**
  Run: `git add apps/api/src/modules/reflow-profiling/services/ && git commit -m "feat(reflow): implement bivariate oven drift and thermal impact services"`

---

### Task 8: Reflow Deep Module Facade, REST API Router & Server Mount (`apps/api`)

**Files:**
- Create: `apps/api/src/modules/reflow-profiling/reflow-profiling.interface.ts`
- Create: `apps/api/src/modules/reflow-profiling/reflow-profiling.module.ts`
- Create: `apps/api/src/routes/reflow.router.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Produces: REST endpoints under `/api/v1/reflow/*` mounted in Express server

- [ ] **Step 1: Implement `ReflowProfilingModule` facade unifying all services behind `IReflowProfilingModule`**
- [ ] **Step 2: Implement `reflow.router.ts`: file upload multipart endpoint, profile query, approve, activate, process-state, and `GET /api/v1/reflow/specifications/:recipeId?boardPartNumber=...&boardRevision=...`**
- [ ] **Step 3: Mount `reflowRouter` in `server.ts` at `/api/v1/reflow`**
- [ ] **Step 4: Build API workspace**
  Run: `npm --workspace=@mes/api run build`
  Expected: `code 0`
- [ ] **Step 5: Commit changes**
  Run: `git add apps/api/src/modules/reflow-profiling/ apps/api/src/routes/reflow.router.ts apps/api/src/server.ts && git commit -m "feat(reflow): implement ReflowProfilingModule facade and REST endpoints"`

---

### Task 9: Phase 6 Master 16-Category Verification Suite (`apps/api/tests`)

**Files:**
- Create: `apps/api/tests/fixtures/reflow/golden/kic-valid-compliant.kic` (or CSV)
- Create: `apps/api/tests/fixtures/reflow/golden/datapaq-out-of-spec-tal.csv`
- Create: `apps/api/tests/fixtures/reflow/golden/mole-structural-invalid.txt`
- Create: `apps/api/tests/fixtures/reflow/golden/corrupt-tampered-header.bin`
- Create: `apps/api/tests/reflow-closed-loop-phase-6.test.ts`

**Interfaces:**
- Tests all 16 verification categories from Section 8 of the design specification:
  1. Adapter dispatch
  2. Importer security & fuzzing (XXE, oversized)
  3. Structural normalization (monotonicity, bounds)
  4. Units & calibration normalization
  5. PWI mathematical accuracy (exact $PWI = 20.0\%$, $TAL\_PWI = 131.1\%$)
  6. PWI boundary conditions ($0\%$, $80\%$, $100\%$, $100.001\%$)
  7. Probe-specific thermal constraints
  8. Specification validation & immutability
  9. Profile lifecycle & atomic activation (PWI FAIL barred from ACTIVE)
  10. Profile-to-telemetry correlation ($\mu$, $\sigma$, $\min$, $\max$)
  11. Bivariate drift ($Z_\mu$ mean shift vs $Z_\sigma$ oscillation)
  12. Persistence (15s) & hysteresis (45s) across 1Hz and 5Hz
  13. `DATA_INSUFFICIENT` handling on packet drop
  14. Process-risk gating (margin breach triggers `REVALIDATION_REQUIRED`)
  15. MachineControl interlock confirmation triad (`REQUESTED`, `CONFIRMED`, `FAILED`)
  16. 21 CFR Part 11 audit integrity & deterministic replay
  X. Tri-store segregation invariant

- [ ] **Step 1: Create fixture files under `tests/fixtures/reflow/golden/`**
- [ ] **Step 2: Implement test suite `tests/reflow-closed-loop-phase-6.test.ts`**
- [ ] **Step 3: Run Phase 6 test suite**
  Run: `npm --workspace=@mes/api test -- tests/reflow-closed-loop-phase-6.test.ts`
  Expected: All 16 category tests pass 100% green
- [ ] **Step 4: Run full API test suite to verify non-regression**
  Run: `npm --workspace=@mes/api test`
  Expected: 24 test files passed (100% green, 192+ tests)
- [ ] **Step 5: Commit changes**
  Run: `git add apps/api/tests/ && git commit -m "test(reflow): add Phase 6 16-category automated verification suite"`

---

### Task 10: Cleanroom Web Cockpit Reflow Station & Monorepo Update (`apps/web` & root)

**Files:**
- Create: `apps/web/src/components/ReflowThermalStation.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `PROJECT_MEMORY.md`

**Interfaces:**
- Provides tactile cleanroom station:
  - Interactive thermocouple $T(t)$ curve chart with liquidus $217^\circ\text{C}$ line, soak window, and peak markers.
  - PWI dials & probe breakdown table.
  - Real-time 10-zone oven drift monitor ($Z_\mu$ and $Z_\sigma$).
  - Profile run approval (21 CFR Part 11 electronic signature) and activation controls.
- Updates `PROJECT_MEMORY.md` to version 7.0.0.

- [ ] **Step 1: Create `ReflowThermalStation.tsx` component**
- [ ] **Step 2: Mount `ReflowThermalStation` in `App.tsx` under tab `10 // REFLOW THERMAL`**
- [ ] **Step 3: Build web workspace**
  Run: `npm --workspace=@mes/web run build`
  Expected: `code 0`
- [ ] **Step 4: Update `PROJECT_MEMORY.md` to Version 7.0.0**
- [ ] **Step 5: Verify full monorepo build and test**
  Run: `npm run build && npm test`
  Expected: Clean build (`code 0`) and all test suites passing 100% green
- [ ] **Step 6: Commit changes**
  Run: `git add apps/web/ PROJECT_MEMORY.md && git commit -m "feat(web): add ReflowThermalStation cockpit and update project memory to v7.0.0"`
