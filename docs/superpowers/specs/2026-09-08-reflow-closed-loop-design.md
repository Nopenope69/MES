# Phase 6: Closed-Loop Reflow Oven Telemetry & Thermal Profiling Engine
## Deep Architecture Specification (IPC-7530B-Aligned & J-STD-001H Process-Control Implementation)

- **Author**: Antigravity Autonomous Agent (Tier-1 SMT Specialist)
- **Document Version**: 1.0.0 (Validated Design Baseline)
- **Date**: September 8, 2026
- **Status**: APPROVED
- **Repository**: [https://github.com/Nopenope69/MES](https://github.com/Nopenope69/MES)
- **Target Standard**: IPC-7530B (Generic Temperature Profiling Guidance for Mass Soldering Processes, Jan 2025) & J-STD-001H

---

## 1. Executive Summary & Foundational Invariants

Phase 6 introduces deep closed-loop reflow oven thermal management to the Antigravity SMT MES Engine. It unifies high-frequency oven machine telemetry with physical multi-channel thermocouple profiler runs (KIC, Datapaq, ECD M.O.L.E.) to ensure strict metallurgical solder joint compliance without compromising transactional database performance or physical equipment safety.

### The Four Hard Boundaries:

```text
┌───────────────────────────┐    ┌───────────────────────────┐    ┌───────────────────────────┐
│    Reflow Profile Store   │    │      ITelemetryStore      │    │     EventStoreModule      │
├───────────────────────────┤    ├───────────────────────────┤    ├───────────────────────────┤
│ • Authoritative Physical  │    │ • Authoritative Machine   │    │ • Authoritative Business  │
│   PCB Thermal Response    │    │   Operating State         │    │   Facts & Audit Trail     │
│ • Immutable T(t) Curves   │    │ • 10-12 Zone Temps (1-5Hz)│    │ • REFLOW_PROFILE_*        │
│ • PWI & Process Windows   │    │ • Conveyor Speed (cm/min) │    │ • REFLOW_DRIFT_*          │
│ • Provenance & SHA-256    │    │ • N2 Flow & O2 (ppm)      │    │ • 21 CFR Part 11 Sign-off │
└───────────────────────────┘    └───────────────────────────┘    └───────────────────────────┘
                                               │
                                               ▼
                                ┌─────────────────────────────┐
                                │    MachineControlModule     │
                                ├─────────────────────────────┤
                                │ • Authoritative Physical    │
                                │   Equipment Actuation Seam  │
                                │ • Gated Interlocks & Holds  │
                                │ • OEM-Governed Safe Motion  │
                                └─────────────────────────────┘
```

1. **Physical Profiler Data $\rightarrow$ Dedicated Reflow Profile Store**: Physical thermocouple measurements establish actual board temperatures ($T(t)$) and cannot be substituted by oven air temperature.
2. **High-Frequency Continuous Oven Telemetry $\rightarrow$ `ITelemetryStore`**: 1–5 Hz zone temperatures, conveyor speeds, and oxygen/nitrogen telemetry reside in sliding-window time-series tables, strictly isolated from the transactional event spine.
3. **Derived Compliance & Governance $\rightarrow$ `EventStoreModule`**: Only discrete business decisions, approval sign-offs, drift classifications, and interlock trigger requests enter the immutable event log.
4. **Physical Interventions $\rightarrow$ `MachineControlModule`**: The analytical and drift detection engine is an inference-only module; it requests validated OEM emergency responses rather than asserting direct physical motion sequences.
5. **Predictive Analytics $\rightarrow$ Consumes Both, Owns Neither**: Predictive models evaluate physical profiler baselines against live telemetry streams without acting as an unvalidated process safety controller.

---

## 2. Deep Subsystem Structure: `ReflowProfilingModule`

The reflow subsystem is structured as an isolated, deep module following the project's architectural seam standards:

```text
apps/api/src/modules/reflow-profiling/
├── reflow-profiling.module.ts              # Primary facade & DI entry point
├── reflow-profiling.interface.ts           # Public domain contracts & interfaces
├── services/
│   ├── profiler-import.service.ts          # Orchestrates provenance, sniffing & parsing
│   ├── profile-lifecycle.service.ts        # Enforces UPLOADED -> ACTIVE -> RETIRED
│   ├── pwi-calculation.service.ts          # Computes exact midpoint PWI & characteristics
│   ├── recipe-specification.service.ts     # Versioned, immutable process windows
│   ├── oven-drift.service.ts               # Bivariate mean-shift & oscillation drift
│   ├── thermal-impact.service.ts           # Estimates PCB pad impact from oven drift
│   └── profile-correlation.service.ts      # Correlates physical run with oven window
├── adapters/
│   ├── profiler-importer.interface.ts      # IProfilerImporter abstraction
│   ├── kic-importer.adapter.ts             # .KIC2000Profile, KIC Explorer, CSV parser
│   ├── datapaq-importer.adapter.ts         # .paqfile, Datapaq Insight CSV/text parser
│   └── mole-importer.adapter.ts            # ECD M.O.L.E. .mdm, .xmg, text parser
└── storage/
    ├── reflow-profile.store.interface.ts   # IReflowProfileDataStore abstraction
    └── reflow-profile.store.ts             # Dual-dialect SQLite/PostgreSQL store
```

### Public Domain Seam (`IReflowProfilingModule`):

```typescript
export interface IReflowProfilingModule {
  // 1. Profiler Run Ingress & Audit Lifecycle
  importProfileRun(params: ImportProfileRunParams): Promise<ImportProfileRunResult>;
  validateProfileRun(profileRunId: string): Promise<ProfileValidationResult>;
  approveProfileRun(profileRunId: string, approverId: string, signatureMeaning?: string): Promise<void>;
  activateProfileRun(profileRunId: string, operatorId: string): Promise<void>;

  // 2. Query & Active Baseline Resolution
  getActiveProfile(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
  }): Promise<ReflowProfileRun | null>;
  getProfileRunById(profileRunId: string): Promise<ReflowProfileRun | null>;

  // 3. Telemetry Drift Analysis & Compliance Evaluation
  evaluateOvenDrift(params: EvaluateOvenDriftParams): Promise<OvenDriftReport>;
  correlateProfileWithTelemetry(profileRunId: string): Promise<ProfileTelemetryCorrelation>;

  // 4. Recipe Thermal Specifications
  getThermalSpecification(params: {
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
  }): Promise<ReflowThermalSpecification | null>;
  registerThermalSpecification(spec: RegisterThermalSpecificationParams): Promise<ReflowThermalSpecification>;
}
```

---

## 3. State Models & Decoupled Lifecycles

### A. Profile Run Lifecycle (Immutable Historical Artifact)

A physical profiler pass is an immutable historical measurement. Its status tracks verification, sign-off, and production activation:

```text
      ┌──────────────┐
      │   UPLOADED   │
      └──────┬───────┘
             │
             ├── Parsing Exception / Corrupt
             ▼
       ┌──────────────┐   [Failure]   ┌──────────────────┐
       │  VALIDATING  ├──────────────►│VALIDATION_FAILED │ (Corrupt data, non-monotonic timestamps,
       └──────┬───────┘               └──────────────────┘  physical temperature bounds violated)
              │ [Success: REFLOW_PROFILE_VALIDATED]
              ▼
       ┌──────────────┐
       │  VALIDATED   │ (Dataset is physically usable & structurally sound)
       └──────┬───────┘
              │ [PWI Computation: REFLOW_PROFILE_COMPLIANCE_EVALUATED]
              ├── Result: PASS | WARNING | FAIL
              ▼
       ┌────────────────┐ [QA Rejection]┌──────────────┐
       │ REVIEW_REQUIRED├──────────────►│   REJECTED   │
       └──────┬─────────┘               └──────────────┘
              │ [QA Approved]
              ▼
       ┌──────────────┐
       │   APPROVED   │
       └──────┬───────┘
              │ [Operator Mount]
              ▼
       ┌──────────────┐
       │    ACTIVE    │ (Governs current production)
       └──────┬───────┘
              │ [Superseded by New Active Run]
              ▼
       ┌──────────────┐
       │    RETIRED    │ (Immutable historical archive)
       └──────────────┘
```

> [!IMPORTANT]
> **Validation vs Compliance Evaluation Semantics**:
> `REFLOW_PROFILE_VALIDATED` confirms structural, temporal, and physical integrity of the measurement file. If a file is malformed or corrupt, it transitions to `VALIDATION_FAILED`.
> Once validated, `REFLOW_PROFILE_COMPLIANCE_EVALUATED` is emitted with `complianceResult: 'PASS' | 'WARNING' | 'FAIL'` based on PWI calculation. A run with $PWI = 131.1\%$ is a valid historical measurement that evaluates to `FAIL` — it is **not** a validation failure.
>
> **PWI-FAIL Activation Guard Invariant**:
> A profile run with `complianceResult === 'FAIL'` ($PWI > 100\%$) enters `REVIEW_REQUIRED` (and can be formally `REJECTED` by QA), but is **strictly barred from transitioning to `ACTIVE`**. Any call to `activateProfileRun()` on a non-compliant run throws `CANNOT_ACTIVATE_NON_COMPLIANT_PROFILE`. Only runs with $PWI \le 100\%$ (`PASS` or `WARNING`) are eligible for production baseline activation.

### B. Process Compliance State (Continuous Real-Time Monitoring)

Independently of the active profile run, the active recipe/oven equipment state is monitored against live telemetry:

```text
┌─────────────────────────────────────────────────────────────┐
│                         COMPLIANT                           │
│  Live telemetry matches active profile within tolerances    │
└──────────────────────────────┬──────────────────────────────┘
                               │ Minor drift observed
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      DRIFT_SUSPECTED                        │
│  Telemetry exceeds tolerance for < persistenceDuration      │
└──────────────────────────────┬──────────────────────────────┘
                               │ Sustained for ≥ persistenceDuration
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      DRIFT_CONFIRMED                        │
│  Statistically confirmed; process-risk evaluated            │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               │ Low thermal risk             │ High risk / margin breached
               ▼                              ▼
┌─────────────────────────────┐  ┌────────────────────────────┐
│      ADVISORY NOTICE        │  │   REVALIDATION_REQUIRED    │
│ Remains operational with alert│ │ New profiler pass required │
└─────────────────────────────┘  └────────────┬───────────────┘
                                              │
                                              ▼
                                 ┌────────────────────────────┐
                                 │ MachineControl Emergency   │
                                 │ Interlock Hold (If safety) │
                                 └────────────────────────────┘
```

*When required zones or speed telemetry drop out or are stale, the engine enters `DATA_INSUFFICIENT` instead of falsely reporting `COMPLIANT`.*

---

## 4. Data Models & Storage Architecture

### A. Immutable Versioned Thermal Specification

```typescript
export interface ReflowThermalSpecification {
  id: string;
  recipeId: string;
  boardPartNumber: string;
  boardRevision: string;
  specificationVersion: number; // 1, 2, 3...
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  alloy: 'SAC305' | 'SAC307' | 'SN63PB37' | 'LOW_TEMP_BISMUTH' | string;

  rampRate: {
    minCPerSec: number;        // e.g. 1.0 °C/s
    maxCPerSec: number;        // e.g. 3.0 °C/s
    targetCPerSec?: number;    // Engineering target
    evaluationStartTempC?: number; // default ambient (30°C)
    evaluationEndTempC: number;    // e.g. 150°C (soak start)
  };

  soak: {
    minTempC: number;          // e.g. 150°C
    maxTempC: number;          // e.g. 200°C
    minSeconds: number;        // e.g. 60s
    maxSeconds: number;        // e.g. 120s
    targetSeconds?: number;
  };

  tal: {
    liquidusTempC: number;     // e.g. 217°C for SAC305
    minSeconds: number;        // e.g. 45s
    maxSeconds: number;        // e.g. 90s
    targetSeconds?: number;
  };

  peak: {
    minC: number;              // e.g. 235°C
    maxC: number;              // e.g. 248°C
    targetC?: number;
  };

  cooling: {
    minCPerSec: number;        // e.g. 1.0 °C/s (positive magnitude, required for midpoint PWI)
    maxCPerSec: number;        // e.g. 4.0 °C/s (positive magnitude)
    evaluationStartTempC: number; // e.g. peakTemp
    evaluationEndTempC: number;   // e.g. liquidusTemp
  };

  conveyorSpeedLimit: {
    minCmPerMin: number;
    maxCmPerMin: number;
    targetCmPerMin: number;
    toleranceCmPerMin: number; // e.g. ±1.5 cm/min
  };

  oxygenControl?: {
    targetPpm: number;         // e.g. 500 ppm
    tolerancePpm: number;      // e.g. ±100 ppm
    maxPpm: number;            // e.g. 800 ppm (interlock threshold)
  };

  zoneTolerancesC: number;     // Allowable zone temperature deviation (e.g. ±2.5°C)
  variabilityLimitC: number;   // Allowable window standard deviation (e.g. 1.2°C)
  minimumSigmaC: number;       // Baseline variance noise floor (e.g. 0.5°C)

  createdBy: string;
  createdAt: string;
}
```

### B. Physical Profile Run Record

```typescript
export interface ReflowProfileRun {
  id: string; // uuidv4
  applicabilityKey: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    panelConfiguration?: string;
  };

  sourceFile: {
    originalFilename: string;
    sha256: string; // Server-computed
    sizeBytes: number;
    mimeType?: string;
  };

  profilerMetadata: {
    manufacturer: 'KIC' | 'DATAPAQ' | 'MOLE' | string;
    model?: string;
    serialNumber?: string;
    parserVersion: string;
    sampleIntervalNominalSeconds?: number;
    runDurationSeconds: number;
    runTimestamp: string;
  };

  specificationId: string;
  specificationVersion: number;
  calculationVersion: string; // e.g. 'pwi-engine-v1.0'

  calculatedPwi: {
    overallPwi: number;
    complianceResult: 'PASS' | 'WARNING' | 'FAIL';
    limitingParameter: 'RAMP' | 'SOAK' | 'TAL' | 'PEAK' | 'COOLING';
    limitingProbeIndex: number;
    characteristicPwis: {
      rampRatePwi: number;
      soakDurationPwi: number;
      talPwi: number;
      peakTempPwi: number;
      coolingRatePwi: number;
    };
  };

  status: 'UPLOADED' | 'PARSED' | 'PARSE_FAILED' | 'VALIDATED' | 'VALIDATION_FAILED' | 'REVIEW_REQUIRED' | 'REJECTED' | 'APPROVED' | 'ACTIVE' | 'RETIRED';
  rejectionReason?: string;
  importedBy: string;
  importedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  activatedAt?: string;
  retiredAt?: string;
}
```

### C. Thermocouple Probes & Normalized Time-Series

```typescript
export interface ReflowProfileProbe {
  id: string;
  profileRunId: string;
  probeIndex: number;
  label: string;
  thermalRole: 'HOTSPOT' | 'COLDSPOT' | 'COMPONENT_LIMIT' | 'SOLDER_JOINT' | 'BOARD_SURFACE';
  componentRefDes?: string;
  packageType?: string;
  location?: {
    xMm?: number;
    yMm?: number;
    side: 'TOP' | 'BOTTOM';
  };
  calibration: {
    calibrationOffsetC?: number;
    calibrationSource: 'VENDOR_FILE' | 'MANUAL' | 'NONE';
  };
  metrics: {
    maxRampRateCPerSec: number;
    soakDurationSeconds: number;
    timeAboveLiquidusSeconds: number;
    peakTemperatureC: number;
    maxCoolingRateCPerSec: number;
  };
  pwi: {
    overall: number;
    ramp: number;
    soak: number;
    tal: number;
    peak: number;
    cooling: number;
  };
  samples: {
    timeSeconds: number;
    temperatureC: number;
  }[];
}
```

### D. Relational Schema & Indices (`005_phase6_reflow_profiling.sql`)

```sql
-- Versioned Thermal Specifications
CREATE TABLE reflow_thermal_specifications (
  id VARCHAR(64) PRIMARY KEY,
  recipe_id VARCHAR(64) NOT NULL,
  board_part_number VARCHAR(64) NOT NULL,
  board_revision VARCHAR(32) NOT NULL,
  specification_version INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- DRAFT, ACTIVE, RETIRED
  alloy VARCHAR(32) NOT NULL,
  specification_json TEXT NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE(recipe_id, board_part_number, board_revision, specification_version)
);

-- Physical Profile Runs
CREATE TABLE reflow_profile_runs (
  id VARCHAR(64) PRIMARY KEY,
  line_id VARCHAR(64) NOT NULL,
  equipment_id VARCHAR(64) NOT NULL,
  recipe_id VARCHAR(64) NOT NULL,
  board_part_number VARCHAR(64) NOT NULL,
  board_revision VARCHAR(32) NOT NULL,
  file_sha256 VARCHAR(64) NOT NULL,
  specification_id VARCHAR(64) NOT NULL,
  specification_version INTEGER NOT NULL,
  calculation_version VARCHAR(32) NOT NULL,
  overall_pwi REAL NOT NULL,
  compliance_result VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  metadata_json TEXT NOT NULL,
  imported_by VARCHAR(64) NOT NULL,
  imported_at TIMESTAMP NOT NULL,
  approved_by VARCHAR(64),
  approved_at TIMESTAMP,
  activated_at TIMESTAMP,
  retired_at TIMESTAMP
);

-- Partial Unique Index guaranteeing at most one active profile baseline per scope
CREATE UNIQUE INDEX idx_reflow_profile_active_scope 
ON reflow_profile_runs(line_id, equipment_id, recipe_id, board_part_number, board_revision) 
WHERE status = 'ACTIVE';

-- Profile Probes & Measurements
CREATE TABLE reflow_profile_probes (
  id VARCHAR(64) PRIMARY KEY,
  profile_run_id VARCHAR(64) NOT NULL REFERENCES reflow_profile_runs(id) ON DELETE CASCADE,
  probe_index INTEGER NOT NULL,
  label VARCHAR(64) NOT NULL,
  thermal_role VARCHAR(32) NOT NULL,
  metrics_json TEXT NOT NULL,
  pwi_json TEXT NOT NULL,
  samples_json TEXT NOT NULL -- Explicit timeSeconds & temperatureC array
);

-- Active Process Compliance Snapshot
CREATE TABLE reflow_process_states (
  line_id VARCHAR(64) NOT NULL,
  equipment_id VARCHAR(64) NOT NULL,
  recipe_id VARCHAR(64) NOT NULL,
  board_part_number VARCHAR(64) NOT NULL,
  board_revision VARCHAR(32) NOT NULL,
  active_profile_run_id VARCHAR(64),
  compliance_status VARCHAR(32) NOT NULL, -- COMPLIANT, DRIFT_SUSPECTED, DRIFT_CONFIRMED, REVALIDATION_REQUIRED, DATA_INSUFFICIENT
  consecutive_drift_seconds REAL NOT NULL DEFAULT 0.0,
  consecutive_healthy_seconds REAL NOT NULL DEFAULT 0.0,
  last_evaluated_at TIMESTAMP NOT NULL,
  drift_metrics_json TEXT NOT NULL,
  PRIMARY KEY(line_id, equipment_id, recipe_id, board_part_number, board_revision)
);
```

---

## 5. Mathematical Algorithms: PWI, Extraction & Bivariate Drift

### 1. Midpoint Process Window Index (PWI)
For parameter $k$ with bounds $[LSL_k, USL_k]$:
- Center: $C_k = \frac{USL_k + LSL_k}{2}$
- Half-Window: $W_k = \frac{USL_k - LSL_k}{2}$
- Parameter PWI:
  $$PWI_k = \frac{|\text{Measured}_k - C_k|}{W_k} \times 100\%$$

Overall Profile PWI:
$$PWI_{\text{overall}} = \max_{p \in \text{Probes}} \left( \max \left( PWI_{\text{ramp}, p}, PWI_{\text{soak}, p}, PWI_{\text{TAL}, p}, PWI_{\text{peak}, p}, PWI_{\text{cooling}, p} \right) \right)$$

Process Margin:
$$\text{Margin}_{\text{PWI}} = 100.0\% - PWI_{\text{overall}}$$

### 2. Characteristic Extraction from Continuous $T(t)$
- **Interpolated Threshold Crossing**: For a target temperature $T^*$ between samples $(t_i, T_i)$ and $(t_{i+1}, T_{i+1})$:
  $$t^* = t_i + (t_{i+1} - t_i) \cdot \frac{T^* - T_i}{T_{i+1} - T_i}$$
  - **Soak Time**: $t_{\text{soak}} = t^*(T_{\text{soak\_max}}, \text{UP}) - t^*(T_{\text{soak\_min}}, \text{UP})$
  - **TAL**: $TAL = t^*(T_{\text{liquidus}}, \text{DOWN}) - t^*(T_{\text{liquidus}}, \text{UP})$
- **Rolling Least-Squares Regression Slope**:
  Over a sliding window of $N$ points (e.g. 5 seconds):
  $$b = \frac{N \sum (t_i T_i) - \sum t_i \sum T_i}{N \sum t_i^2 - (\sum t_i)^2}$$
  - **Heating Ramp**: $\text{Ramp}_{\max} = \max_{t \in [t_{\text{start}}, t_{\text{soak\_start}}]} b(t)$
  - **Cooling Rate**: $\text{Cooling}_{\max} = \max_{t \in [t_{\text{peak}}, t_{\text{exit}}]} |b(t)|$ (Positive magnitude convention).

### 3. Bivariate Statistical Oven Drift
Evaluated over observation window $W$ against validated baseline parameters:
- **Mean Shift Standardized Score**:
  $$Z_{\mu, z} = \frac{\mu_{z, W} - T_{z, \text{baseline}}}{\max(\sigma_{z, \text{baseline}}, \text{minimumSigma})}$$
- **Variance / Oscillation Standardized Score**:
  $$Z_{\sigma, z} = \frac{\sigma_{z, W} - \sigma_{z, \text{baseline}}}{\max(\sigma_{z, \text{baseline}}, \text{minimumSigma})}$$
- **Strictly Normalized Composite Severity**:
  Given verified configuration vector where $\sum w_z + w_v + w_{O2} = 1.0$:
  $$S_{\text{drift}} = \sum_{z} w_z \left( \frac{|\mu_{z, W} - T_{z, \text{baseline}}|}{\text{zoneTolerance}_z} \right) + w_v \left( \frac{|\mu_{v, W} - v_{\text{baseline}}|}{\text{speedTolerance}} \right) + w_{O2} \left( \frac{|\mu_{O2, W} - O2_{\text{baseline}}|}{\text{O2Tolerance}} \right)$$

### 4. Conservative Thermal Impact Estimation
`ThermalImpactService` evaluates process-risk without manufacturing unverified thermal certainty:
```typescript
export interface ThermalImpactEstimate {
  estimatedPeakDeltaC?: number;
  estimatedTalDeltaSeconds?: number;
  confidence: number; // 0.0 to 1.0
  basis: 'EMPIRICAL' | 'MODEL' | 'RULE_BASED' | 'UNKNOWN';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}
```
**Conservative Safety Principle**: `UNKNOWN` or low-confidence estimates must never be treated as proof of compliance. The MES may infer risk when drift occurs, but never manufactures thermal certainty that has not been physically validated by a profiler pass.

---

## 6. Secure Profiler Importer Pipeline

```text
Upload (Buffer, Filename, Mime)
   │
   ▼
[ Security & Size Pre-flight ] (Max 15MB, extension/MIME check, XXE-safe parser configuration with external entity resolution disabled)
   │
   ▼
[ Server-Computed SHA-256 ] ──► [ Idempotency Check ] (Hash + Scope)
   │
   ▼
[ Adapter Sniffing & Detection ]
   ├── KIC: .KIC2000Profile, .KIC2000MVP, KIC Explorer text
   ├── Datapaq: .paqfile, Insight CSV/text
   └── M.O.L.E.: .mdm, .xmg, MAP text
   │
   ▼
[ Parser Execution with Timeout ] (10s max execution sandbox)
   │
   ├── Throw: ParseError ──────► Persist PARSE_FAILED
   ▼
[ Structural Validation ]
   ├── Monotonic timestamps, no duplicates, no time jumps
   ├── Temperatures within physical range (-20°C to +350°C)
   ├── No NaN / Infinity
   ├── Units converted to seconds and Celsius
   ├── Preserve calibration offsets
   │
   ├── Violation ──────────────► Persist VALIDATION_FAILED
   ▼
[ Specification Resolution & PWI Engine ]
   ├── Overall PWI computed
   │
   ▼
[ Review Ready ] ─────────────► Persist REVIEW_REQUIRED
                                 (Audit fact: REFLOW_PROFILE_VALIDATED)
```

---

## 7. Safety, Gated Control & MachineControlModule Boundary

```text
                       OvenDriftService
                              │
                              ▼
                     Process-Risk Assessment
                   (Drift vs Margin_PWI Model)
                              │
               ┌──────────────┴──────────────┐
               │                             │
    Critical Heater Failure          Controlled Trim / Drift
    (Zone Drop > 15°C)               (PWI Margin Risk)
               │                             │
               ▼                             ▼
   REFLOW_INTERLOCK_REQUESTED        REFLOW_REVALIDATION_REQUESTED
               │                             │
               ▼                             ▼
       MachineControlModule           QA Policy Gate
               │                             │
       [ OEM Safety Request ]         [ Engineering Sign-off ]
               │                             │
     ┌─────────┴─────────┐                   │
     ▼                   ▼                   │
  Success             Failure                ▼
REFLOW_INTERLOCK_   REFLOW_INTERLOCK_  MachineControlModule
   CONFIRMED             FAILED       (Conveyor/Recipe Trim)
```

1. **No Autonomous Motion Sequences**: The MES requests the validated emergency response; the machine PLC and safety circuit manage physical board conveyance.
2. **Deterministic Interlock Triad**:
   - `REFLOW_INTERLOCK_REQUESTED` $\rightarrow$ Command issued to HAL.
   - `REFLOW_INTERLOCK_CONFIRMED` $\rightarrow$ HAL reports hardware latch success.
   - `REFLOW_INTERLOCK_FAILED` $\rightarrow$ HAL reports communication failure or timeout (never masked as success).

---

## 8. Master 16-Category Verification Matrix

| # | Category | Verification Scope | Target Assertion |
|---|---|---|---|
| **01** | Adapter Dispatch | Sniffs KIC, Datapaq, and M.O.L.E. file signatures | Routes correctly; unknown formats fail with `PARSE_FAILED` |
| **02** | Importer Security & Fuzzing | XXE entity expansion attempt, oversized payload, NaN/Infinity inputs | Zero process crashes; external entity resolution blocked; clean quarantine |
| **03** | Structural Normalization | Monotonic timestamps, out-of-order samples, duplicate times | Discontinuous files fail with `VALIDATION_FAILED` |
| **04** | Units & Calibration | Fahrenheit to Celsius, minutes to seconds, probe offsets | Raw vs corrected temperatures clearly distinguishable |
| **05** | PWI Mathematical Accuracy | Midpoint PWI formulation on benchmark values | Computed values match exact formulas ($PWI = 20.0\%$, $TAL\_PWI = 131.1\%$) |
| **06** | PWI Boundary Conditions | Numerical evaluation at $0\%$, $79.99\%$, $80\%$, $99.99\%$, $100\%$, $100.01\%$ | Strict $<$ vs $\le$ compliance classification |
| **07** | Probe-Specific Constraints | Coldspot TAL constraints vs Component Limit peak temp | Probe-specific rules evaluated without rigid hardcoding |
| **08** | Specification Validation | LSL $\ge$ USL, negative durations, min $>$ max | Invalid specs rejected at registration time |
| **09** | Activation Atomicity | Concurrent profile activations on identical scope | Exact atomic transition; partial unique index blocks race |
| **10** | Telemetry Correlation | Statistical correlation with 6-minute oven telemetry | Zone $\mu$, $\sigma$, $\min$, $\max$ preserved with integrity score |
| **11** | Bivariate Drift Detection | Steady mean offset vs high-variance PID hunting | Mean shift triggers $Z_\mu$; oscillation triggers $Z_\sigma$ |
| **12** | Persistence & Hysteresis | 15s persistence and 45s recovery across 1Hz and 5Hz | Time-based invariants immune to packet frequency |
| **13** | Telemetry Integrity & Dropout | Missing zone packets, stale timestamps, clock jumps | Enters `DATA_INSUFFICIENT` without false compliance |
| **14** | Process-Risk Gating | High margin ($PWI=42\%$) vs Low margin ($PWI=94\%$) | Margin depletion triggers `REVALIDATION_REQUIRED` |
| **15** | Interlock Confirmation Seam | Thermal collapse interlock request, success, and failure | `INTERLOCK_REQUESTED` vs `CONFIRMED` vs `FAILED` |
| **16** | 21 CFR Part 11 Audit Integrity | Electronic signatures, tamper-evident SHA-256 | Unauthorized operators blocked; audit trail immutable |
| **X** | **Tri-Store Invariant** | Cross-cutting data segregation check | Raw curves in Profile Store, 10Hz in Telemetry, facts in EventStore |

---

## 9. Non-Regression Invariant

All pre-existing 176 tests across Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, and Deep Modules must continue to pass 100% green without modification to existing behavioral assertions.
