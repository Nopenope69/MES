# ADR-003: Universal Integration Adapter Contract (SDK)

## Status
**ACCEPTED** (Date: 2026-09-03)

## Context
Industrial integration is notoriously prone to "integration debt": engineers write ad-hoc scripts connecting specific PLCs or machines directly to the application database. Over time, protocols change, machine firmware updates break schemas, and the core MES codebase becomes riddled with vendor-specific edge cases.

## Decision
We define an explicit **Integration Adapter SDK Contract (`IIntegrationAdapter`)**. Every physical connector (Fuji Nexim socket, OPC-UA, Modbus TCP, MQTT, CSV watchdogs, SAP ERP webhooks) must be an isolated plugin that implements this contract:

```typescript
export interface IIntegrationAdapter {
  readonly adapterId: string;
  readonly protocol: 'TCP_SOCKET' | 'OPC_UA' | 'MODBUS' | 'MQTT' | 'REST_WEBHOOK';

  // 1. Connection & Lifecycle
  connect(config: Record<string, any>): Promise<void>;
  disconnect(): Promise<void>;
  checkHealth(): Promise<{ status: 'HEALTHY' | 'DEGRADED' | 'DOWN'; latencyMs: number }>;

  // 2. Ingress & Normalization
  receiveRaw(rawBytes: Buffer | string): Promise<{ messageId: string; rawPayload: string }>;
  validate(rawPayload: string): boolean;
  normalizeToCanonical(rawPayload: string, assetContext: AssetContext): MesEventEnvelope | null;
  deduplicate(sequenceId: number, sourceId: string): Promise<boolean>;

  // 3. Egress & Feedback (System Transport ACK vs Business Disposition)
  acknowledge(messageId: string, resultOk: boolean, responseDetails?: any): Promise<void>;
}
```

### Architectural Rules
1. **No Direct DB Access**: Adapters are forbidden from writing directly to domain tables (`batches`, `recipes`, `work_centers`). They may only write to `ingress_events` and emit canonical envelopes to `EventIngestionService`.
2. **Raw Ingress Preservation**: The exact byte stream or text message must be preserved untouched in `ingress_events`.
3. **Transport ACK $\neq$ Business Disposition**: Acknowledging a TCP socket frame (e.g. Fuji `KEEPALIVE_ACK` or `LOADCOMP_ACK`) signals transport receipt. Business authorizations (e.g. Quality Release, Deviation Disposition) require explicit cryptographic signatures in the MES layer.

## Consequences
### Positive
*   Connectors are completely pluggable and testable in isolation using unit-test mock generators.
*   The Site Integration Gateway can be run as an edge process inside the plant's OT/IT DMZ without requiring direct inbound internet access to plant PLCs.
