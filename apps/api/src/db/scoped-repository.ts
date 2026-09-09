// apps/api/src/db/scoped-repository.ts
import { IDatabase } from './database';
import {
  ExecutionContext,
  SecurityContextMissingError,
  getPrincipalOrganizationId,
  getPrincipalSiteId,
  isHumanPrincipal
} from '../security/context';

export interface ScopedDataRepository {
  // Site-Scoped Repositories
  readonly batches: ScopedBatchRepository;
  readonly genealogy: ScopedGenealogyRepository;
  readonly compliance: ScopedComplianceRepository;
  readonly smt: ScopedSmtRepository;
  readonly reflow: ScopedReflowRepository;

  // Organization-Scoped Repositories
  readonly organizationSettings: ScopedOrgSettingsRepository;

  // Global Repositories
  readonly sites: GlobalSiteRepository;
  readonly permissionCatalog: GlobalPermissionCatalog;
}

export class ScopedBatchRepository {
  constructor(
    private readonly db: IDatabase,
    private readonly organizationId: string,
    private readonly siteId: string | null
  ) {}

  private requireSiteScope(): { organizationId: string; siteId: string } {
    if (!this.siteId) {
      throw new SecurityContextMissingError(
        'Site-scoped operation requires active siteId in execution context'
      );
    }
    return { organizationId: this.organizationId, siteId: this.siteId };
  }

  async findById(id: string): Promise<any | null> {
    const { organizationId, siteId } = this.requireSiteScope();
    const rows = await this.db.query(
      `SELECT * FROM batches 
       WHERE (id = ? OR batch_number = ?) 
         AND organization_id = ? 
         AND site_id = ?`,
      [id, id, organizationId, siteId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async list(filters: { status?: string; workCenterId?: string } = {}): Promise<any[]> {
    const { organizationId, siteId } = this.requireSiteScope();
    let sql = `SELECT * FROM batches WHERE organization_id = ? AND site_id = ?`;
    const params: any[] = [organizationId, siteId];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters.workCenterId) {
      sql += ' AND work_center_id = ?';
      params.push(filters.workCenterId);
    }

    sql += ' ORDER BY started_at DESC NULLS LAST, id DESC';
    return this.db.query(sql, params);
  }

  async create(data: {
    id: string;
    batchNumber: string;
    workOrderNumber: string;
    productCode: string;
    recipeCode: string;
    workCenterId: string;
    plannedQuantity: number;
    status?: string;
    operatorId?: string;
  }): Promise<any> {
    const { organizationId, siteId } = this.requireSiteScope();
    await this.db.execute(
      `INSERT INTO batches (
        id, organization_id, site_id, batch_number, work_order_number,
        product_code, recipe_code, work_center_id, status, planned_quantity, operator_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.id,
        organizationId,
        siteId,
        data.batchNumber,
        data.workOrderNumber,
        data.productCode,
        data.recipeCode,
        data.workCenterId,
        data.status || 'READY',
        data.plannedQuantity,
        data.operatorId || null
      ]
    );
    return this.findById(data.id);
  }
}

export class ScopedGenealogyRepository {
  constructor(
    private readonly db: IDatabase,
    private readonly organizationId: string,
    private readonly siteId: string | null
  ) {}

  private requireSiteScope() {
    if (!this.siteId) {
      throw new SecurityContextMissingError('Site-scoped operation requires active siteId');
    }
    return { organizationId: this.organizationId, siteId: this.siteId };
  }

  async findByLot(lotNumber: string): Promise<any | null> {
    this.requireSiteScope();
    const rows = await this.db.query(
      `SELECT * FROM device_history_records WHERE dhr_number = ?`,
      [lotNumber]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

export class ScopedComplianceRepository {
  constructor(
    private readonly db: IDatabase,
    private readonly organizationId: string,
    private readonly siteId: string | null
  ) {}

  private requireSiteScope() {
    if (!this.siteId) {
      throw new SecurityContextMissingError('Site-scoped compliance requires active siteId');
    }
    return { organizationId: this.organizationId, siteId: this.siteId };
  }

  async getSignaturesForEntity(entityType: string, entityId: string): Promise<any[]> {
    this.requireSiteScope();
    return this.db.query(
      `SELECT * FROM compliance_audit_ledger 
       WHERE entity_type = ? AND entity_id = ? 
       ORDER BY sequence_number ASC`,
      [entityType, entityId]
    );
  }
}

export class ScopedSmtRepository {
  constructor(
    private readonly db: IDatabase,
    private readonly organizationId: string,
    private readonly siteId: string | null
  ) {}

  private requireSiteScope() {
    if (!this.siteId) {
      throw new SecurityContextMissingError('Site-scoped SMT requires active siteId');
    }
    return { organizationId: this.organizationId, siteId: this.siteId };
  }

  async getFeederSlots(workCenterId: string): Promise<any[]> {
    this.requireSiteScope();
    return this.db.query(
      `SELECT * FROM smt_feeder_slots WHERE work_center_id = ? ORDER BY slot_no ASC`,
      [workCenterId]
    );
  }
}

export class ScopedReflowRepository {
  constructor(
    private readonly db: IDatabase,
    private readonly organizationId: string,
    private readonly siteId: string | null
  ) {}

  private requireSiteScope() {
    if (!this.siteId) {
      throw new SecurityContextMissingError('Site-scoped Reflow requires active siteId');
    }
    return { organizationId: this.organizationId, siteId: this.siteId };
  }

  async getActiveProfile(workCenterId: string): Promise<any | null> {
    this.requireSiteScope();
    const rows = await this.db.query(
      `SELECT * FROM reflow_thermal_specifications WHERE work_center_id = ? ORDER BY revision DESC LIMIT 1`,
      [workCenterId]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

export class ScopedOrgSettingsRepository {
  constructor(
    private readonly db: IDatabase,
    private readonly organizationId: string
  ) {}

  async get(key: string): Promise<string | null> {
    const rows = await this.db.query(
      `SELECT setting_value FROM organization_settings WHERE organization_id = ? AND setting_key = ?`,
      [this.organizationId, key]
    );
    return rows.length > 0 ? rows[0].setting_value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
       VALUES (?, ?, ?)
       ON CONFLICT(organization_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
      [this.organizationId, key, value]
    );
  }
}

export class GlobalSiteRepository {
  constructor(private readonly db: IDatabase) {}

  async listAll(): Promise<any[]> {
    return this.db.query(`SELECT * FROM sites ORDER BY name ASC`);
  }

  async findById(id: string): Promise<any | null> {
    const rows = await this.db.query(`SELECT * FROM sites WHERE id = ?`, [id]);
    return rows.length > 0 ? rows[0] : null;
  }
}

export class GlobalPermissionCatalog {
  constructor(private readonly db: IDatabase) {}

  async listCapabilities(): Promise<string[]> {
    return [
      'batch:view',
      'batch:manage',
      'smt:splice:verify',
      'reflow:profile:upload',
      'reflow:profile:approve',
      'compliance:sign',
      'system:config',
      'system:backup'
    ];
  }
}

class ScopedDataRepositoryImpl implements ScopedDataRepository {
  public readonly batches: ScopedBatchRepository;
  public readonly genealogy: ScopedGenealogyRepository;
  public readonly compliance: ScopedComplianceRepository;
  public readonly smt: ScopedSmtRepository;
  public readonly reflow: ScopedReflowRepository;
  public readonly organizationSettings: ScopedOrgSettingsRepository;
  public readonly sites: GlobalSiteRepository;
  public readonly permissionCatalog: GlobalPermissionCatalog;

  constructor(db: IDatabase, ctx: ExecutionContext) {
    const organizationId = getPrincipalOrganizationId(ctx.principal);
    const siteId = getPrincipalSiteId(ctx.principal);

    this.batches = new ScopedBatchRepository(db, organizationId, siteId);
    this.genealogy = new ScopedGenealogyRepository(db, organizationId, siteId);
    this.compliance = new ScopedComplianceRepository(db, organizationId, siteId);
    this.smt = new ScopedSmtRepository(db, organizationId, siteId);
    this.reflow = new ScopedReflowRepository(db, organizationId, siteId);
    this.organizationSettings = new ScopedOrgSettingsRepository(db, organizationId);
    this.sites = new GlobalSiteRepository(db);
    this.permissionCatalog = new GlobalPermissionCatalog(db);
  }
}

export class MasterRepository {
  constructor(protected readonly db: IDatabase) {}

  public forContext(ctx: ExecutionContext): ScopedDataRepository {
    if (!ctx || !ctx.principal) {
      throw new SecurityContextMissingError(
        'Attempted database access without a valid ExecutionContext'
      );
    }
    return new ScopedDataRepositoryImpl(this.db, ctx);
  }
}
