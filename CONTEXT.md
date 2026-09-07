# SMT Manufacturing Execution Context

Domain model and ubiquitous language for high-speed Surface Mount Technology (SMT) electronics manufacturing lines.

## Asset Hierarchy & Execution

**Work Center**:
A specific physical equipment asset along the SMT line where manufacturing, printing, placement, or inspection occurs.
_Avoid_: Station, machine, cell, tool

**Batch**:
An active manufacturing execution run of a specific product recipe for a planned panel quantity.
_Avoid_: Job, run, lot, work order run

**Panel**:
A multi-up carrier board passing through the line containing one or more circuit units.
_Avoid_: Board, PCB, PCBA, carrier, card

**Unit**:
An individual circuit instance residing at a distinct indexed position within a panel.
_Avoid_: Circuit, sub-board, device

## Material Lifecycle & Feeder Bank

**Feeder Slot**:
A numbered physical mounting location on a placement module holding an intelligent tape feeder.
_Avoid_: Bank, lane, track, slot

**Component Reel**:
An EIA-481 tape package of surface mount electronic parts tracked by Reel ID, Lot Number, and MPN.
_Avoid_: Spool, reel, tape, part

**Splice**:
The physical splicing of a new component reel to the expiring tape of an active feeder without line stoppage.
_Avoid_: Reload, swap, feeder refill

**MSL Floor-Life**:
The allowable ambient atmospheric exposure time for moisture-sensitive components per JEDEC J-STD-033D before desiccation baking is mandated.
_Avoid_: Expiry, shelf-life, dry time, countdown

**Solder Paste Jar**:
A serialized container of solder paste managed through refrigeration, thawing, centrifugal mixing, and stencil rolling life.
_Avoid_: Pot, tub, solder container

## Quality Control & Closed-Loop Corrections

**Process Window**:
The recipe-governed boundaries of physical measurements and machine setpoints defining acceptable processing.
_Avoid_: Limits, tolerance, thresholds, specs

**Interlock**:
An automated equipment inhibit commanding machine halt, feeder lock, or board divert upon quality gate breach.
_Avoid_: Stop, halt, lock, safety trip

**Inspection**:
An automated optical 3D scan (SPI or AOI) evaluating aperture deposition or solder joint integrity against the process window.
_Avoid_: Check, scan, test, vision

**Rework**:
The authorized replacement and soldering of a defective component at a repair station followed by mandatory re-inspection.
_Avoid_: Repair, fix, touch-up

**Device History Record (eDHR)**:
An immutable, cryptographically sealed record of manufacturing history, material genealogy, inspection results, and compliance approvals.
_Avoid_: Traveler, batch log, audit sheet

## Architectural Deep Modules & Seams

**Event Store**:
The append-only persistence and projection spine validating canonical event schemas, upcasting versions, and synchronizing read-model checkpoints.
_Avoid_: Event bus, message broker, ingestion layer

**Machine Control**:
The hardware abstraction layer providing bidirectional equipment interlocks, parameter tuning, and maintenance actions across line machinery.
_Avoid_: Driver, socket manager, equipment bridge

**Defect Lifecycle**:
The end-to-end quality engine governing optical inspection ingestion, CAD correlation, repeat-defect sentinels, and component rework validation.
_Avoid_: AOI engine, defect tracker, rework service

**Material Gate**:
The pre-execution compliance authority validating component reels, JEDEC MSL floor-life, solder paste jars, and stencils before machine consumption.
_Avoid_: Splicing checker, paste validator, authorization checker

