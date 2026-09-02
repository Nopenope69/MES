# ADR-002: ISA-95 Physical Asset Hierarchy

## Status
**ACCEPTED** (Date: 2026-09-03)

## Context
Process manufacturing enterprises (pharma, chemicals, F&B) operate multiple plants with diverse areas (synthesis, formulation, packaging, utilities) and equipment suites. Systems that hardcode flat tables for "machines" cannot scale across multiple customer facilities, lines, or organizational divisions without extensive schema migrations.

## Decision
We implement the standard **ISA-95 Part 3 Physical Asset Hierarchy** in our relational schema from Day 1:

$$\text{Organization} \longrightarrow \text{Site} \longrightarrow \text{Area} \longrightarrow \text{Line / Cell} \longrightarrow \text{Work Center} \longrightarrow \text{Equipment Unit}$$

```
[ Organization ] (e.g. "Sun Pharma Ltd")
       │
       ▼
    [ Site ] (e.g. "Baddi Plant 01")
       │
       ▼
    [ Area ] (e.g. "Block A - Bulk Synthesis")
       │
       ▼
 [ Line / Cell ] (e.g. "Reactor Train 02")
       │
       ▼
 [ Work Center ] (e.g. "Glass Lined Reactor GLR-5000")
       │
       ▼
[ Equipment Unit ] (e.g. "Agitator Motor", "Condenser Unit", "Bottom Discharge Valve")
```

### Relational Representation & Dot-Notation Paths
Every asset is assigned an `asset_path` string (e.g. `ORG01.SITE01.AREA_A.CELL02.WC_GLR01`) allowing hierarchical prefix queries:
*   `SELECT * FROM canonical_events WHERE asset_path LIKE 'ORG01.SITE01.AREA_A%'` (Aggregates Area A downtime).
*   `SELECT * FROM canonical_events WHERE asset_path LIKE 'ORG01.SITE01%'` (Aggregates entire Site OEE).

## Consequences
### Positive
*   **Zero Migration Pain**: Moving from 1 pilot line to an entire facility, or rolling out to a conglomerate's 10 sister plants, requires no schema modifications.
*   **Role-Based Access Control (RBAC)**: Security boundaries can be attached at any level (e.g., Operator scoped to Work Center, Plant Head scoped to Site, Group VP scoped to Organization).
*   **Standard Industrial Vocabulary**: Gives instant credibility when presenting to enterprise engineering and IT committees.

### Negative / Trade-offs
*   Slightly more initial foreign key relationships; simplified in v1 UI by defaulting the active context to the pilot site.
