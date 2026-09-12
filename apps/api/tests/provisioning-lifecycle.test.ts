import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase, initDatabase } from '../src/db/database';
import { OnboardingService } from '../src/services/onboarding.service';

describe('Provisioning Lifecycle & State Persistence Suite (Stage 1 / D-04 & Gate G-03)', () => {
  beforeEach(async () => {
    await initDatabase();
    const db = getDatabase();
    await db.execute("DELETE FROM system_settings WHERE setting_key = 'lifecycle_state'");
    await db.execute("DELETE FROM operators WHERE role = 'SYSTEM_ADMIN'");
    OnboardingService.reset();
  });

  it('detects UNINITIALIZED initially and transitions to PROVISIONING_REQUIRED', async () => {
    const state = await OnboardingService.refreshStateFromDb();
    expect(state).toBe('UNINITIALIZED');
    expect(OnboardingService.isBootstrapAvailable()).toBe(true);

    await OnboardingService.setState('PROVISIONING_REQUIRED');
    expect(await OnboardingService.refreshStateFromDb()).toBe('PROVISIONING_REQUIRED');
  });

  it('persists PRODUCTION_ACTIVE to system_settings on successful bootstrap', async () => {
    const result = await OnboardingService.provision({
      organizationId: 'org-test',
      organizationName: 'Apex Electronics SMT',
      siteId: 'site-test-01',
      siteName: 'Plant 1',
      adminUsername: 'lead_admin',
      adminPin: 'SuperSecurePIN123!',
      adminName: 'Lead Systems Engineer'
    });

    expect(result.status).toBe('PRODUCTION_ACTIVE');
    expect(result.adminCode).toBe('lead_admin');

    // Verify state in database
    const db = getDatabase();
    const rows = await db.query<{ setting_value: string }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'lifecycle_state'"
    );
    expect(rows.length).toBe(1);
    expect(rows[0].setting_value).toBe('PRODUCTION_ACTIVE');

    // Verify operator created with hashed PIN
    const opRows = await db.query<any>("SELECT code, role, pin_hash FROM operators WHERE code = 'lead_admin'");
    expect(opRows.length).toBe(1);
    expect(opRows[0].role).toBe('SYSTEM_ADMIN');
    expect(opRows[0].pin_hash).toMatch(/^\$argon2/);
  });

  it('refuses subsequent bootstrap calls with 410 APPLIANCE_ALREADY_PROVISIONED', async () => {
    await OnboardingService.provision({
      adminUsername: 'initial_admin',
      adminPin: 'StrongPassword123#',
      adminName: 'Site Admin'
    });

    expect(OnboardingService.getState()).toBe('PRODUCTION_ACTIVE');
    expect(OnboardingService.isBootstrapAvailable()).toBe(false);

    // Attempting another provisioning call must throw 410
    await expect(
      OnboardingService.provision({
        adminUsername: 'second_admin',
        adminPin: 'AnotherPassword123#',
        adminName: 'Second Admin'
      })
    ).rejects.toThrow(/APPLIANCE_ALREADY_PROVISIONED/);
  });

  it('survives in-memory reset by reading state from database on refreshStateFromDb', async () => {
    await OnboardingService.provision({
      adminUsername: 'persistent_admin',
      adminPin: 'PersistentSecret123$',
      adminName: 'Persistent Admin'
    });

    // Simulate in-memory restart/wipe
    (OnboardingService as any).currentState = 'UNINITIALIZED';

    // State refreshed from DB must recover PRODUCTION_ACTIVE
    const recovered = await OnboardingService.refreshStateFromDb();
    expect(recovered).toBe('PRODUCTION_ACTIVE');
  });
});
