================================================================================
   ANTIGRAVITY SMT CLEANROOM MES - STANDALONE SIMULATOR & WORKSTATION
================================================================================
Version: 1.0.0 (Phases 1-6 Enterprise Architecture)
Distribution Package: Zero Installation / Standalone Executable

QUICK START INSTRUCTIONS:
-------------------------
For Windows Colleagues:
  Option A (Direct Executable):
    Double-click "mes-simulator-win.exe" (or run it in Command Prompt / PowerShell).

  Option B (If cloned from Git repository):
    1. Double-click "restore-win.bat" (assembles the executable from parts in <1 second).
    2. Double-click the generated "mes-simulator-win.exe".

  What happens automatically:
    • The embedded MES engine starts and creates "mes_local.db" in the same folder.
    • Your default web browser automatically opens to: http://localhost:4000/
    • No Node.js, Python, Git, or database installation required!

For macOS Colleagues:
  1. In Terminal, navigate to this folder and run:
     ./mes-simulator-macos
  2. The Cleanroom Cockpit opens automatically in your browser at http://localhost:4000/

AVAILABLE WORKSTATIONS & CLEANROOM TABS:
-----------------------------------------
Tab 1:  Operator Station        - SMT Assembly Line Execution & Barcode Dispatch
Tab 2:  Supervisor Dashboard    - eBR Electronic Batch Records & Part 11 Sign-off
Tab 3:  Traceability Genealogy  - Deep Component & PCB Panel Genealogy Trees
Tab 4:  Component Splicing      - Feeder Reel Setup, MSL Clocks & Interlocks
Tab 5:  Solder Paste & 3D SPI   - Stencil Lifespan, Inspection & Squeegee Tuning
Tab 6:  3D AOI & Defect Sentinel- Optical Inspection & Repeat Defect Production Halt
Tab 7:  Reflow Profiling (Ph.6) - KIC/Datapaq/MOLE PWI Engine & Oven Drift Actuation
Tab 8:  Autonomous AGV Fleet    - Floor Navigation, Missions & Replenishment Dispatch
Tab 9:  Predictive Intelligence - Weibull Reliability, SPC Cpk & Mahalanobis Distance
Tab 10: SRE & Topology Health   - System RED Metrics, Ingress Pipeline & SLO Status

ADDITIONAL NETWORK ENDPOINTS:
----------------------------
Interactive API Docs (Swagger):  http://localhost:4000/api-docs
OpenAPI 3.1 Specification:       http://localhost:4000/api/v1/openapi.json
Prometheus Metrics (RED/USE):    http://localhost:4000/metrics
Fuji Nexim TCP Socket Gateway:   tcp://localhost:30040

DATABASE PERSISTENCE & RESET:
-----------------------------
- All events, inspections, batches, and profiles are saved in "mes_local.db" in the current directory.
- To reset the cleanroom to factory fresh baseline state:
  Simply delete "mes_local.db" and re-launch the executable.

Enjoy testing the MES Simulator!
================================================================================
