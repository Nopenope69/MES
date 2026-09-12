import { test, expect } from '@playwright/test';

test.describe('Cleanroom Manufacturing Floor Journey E2E Suite (Task Q-02 / Gate G-11)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to root cleanroom cockpit
    await page.goto('/');
  });

  test('Complete SMT Floor Journey: Auth -> Feeder Splice Interlock -> Reflow -> Rework -> Genealogy Tree', async ({ page }) => {
    // --------------------------------------------------------------------------
    // Step 1: Initial Cockpit Perimeter & Operator Login Flow (Gate G-08)
    // --------------------------------------------------------------------------
    await expect(page.locator('header')).toContainText('APEX ELECTRONICS');
    await expect(page.locator('header')).toContainText('NOIDA CLUSTER P4');
    await expect(page.locator('header')).toContainText('Fuji NXT III M6');

    // Open operator login modal
    const signInBtn = page.getByRole('button', { name: /OPERATOR SIGN-IN/i });
    await expect(signInBtn).toBeVisible();
    await signInBtn.click();

    // Verify modal dialog appears
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Cleanroom Operator Sign-In');

    // Click quick role select preset for OP-01 (Operator)
    const op01Preset = modal.getByRole('button', { name: /OP-01/i });
    await expect(op01Preset).toBeVisible();
    await op01Preset.click();

    // Submit authorization
    const authorizeBtn = modal.getByRole('button', { name: /AUTHORIZE OPERATOR/i });
    await expect(authorizeBtn).toBeVisible();
    await authorizeBtn.click();

    // Verify modal dismissed and operator profile badge mounted in header
    await expect(modal).not.toBeVisible();
    await expect(page.locator('header')).toContainText('OP-01');
    await expect(page.locator('header')).toContainText('OPERATOR');
    const lockBtn = page.getByRole('button', { name: /LOCK/i });
    await expect(lockBtn).toBeVisible();

    // --------------------------------------------------------------------------
    // Step 2: Feeder Bay & Splicing Interlock Verification (PASS & Simulated NG)
    // --------------------------------------------------------------------------
    const feederTab = page.getByRole('button', { name: /01 \/\/ FEEDER BAY/i });
    await expect(feederTab).toBeVisible();
    await feederTab.click();

    // Verify Feeder Bay Station mounts
    await expect(page.getByText('OPTICAL SPLICING DOCK')).toBeVisible({ timeout: 10000 });

    // 2.1 Test Simulated NG: Click [MISMATCH MISFIRE] scenario
    const mismatchScenarioBtn = page.getByRole('button', { name: /\[MISMATCH MISFIRE\]/i });
    await expect(mismatchScenarioBtn).toBeVisible();
    await mismatchScenarioBtn.click();

    const spliceBtn = page.getByRole('button', { name: /RUN LASER SCAN & VERIFY SPLICE/i });
    await expect(spliceBtn).toBeVisible();
    await spliceBtn.click();

    // Feeder interlock trips and inhibits the feeder
    await expect(page.locator('body')).toContainText(/INTERLOCK TRIPPED \/\/ FEEDER INHIBITED|FATAL|rejected/i, { timeout: 10000 });

    // 2.2 Test PASS: Click [MATCH] scenario
    const matchScenarioBtn = page.getByRole('button', { name: /\[MATCH\]/i });
    await expect(matchScenarioBtn).toBeVisible();
    await matchScenarioBtn.click();

    await spliceBtn.click();

    // Feeder interlock unlocks and approves splice
    await expect(page.locator('body')).toContainText(/RELAY ENGAGED \/\/ OK TO SPLICE|SAFE TO SPLICE/i, { timeout: 10000 });

    // --------------------------------------------------------------------------
    // Step 3: Reflow Thermal Profiling & Process Window Inspection
    // --------------------------------------------------------------------------
    const reflowTab = page.getByRole('button', { name: /10 \/\/ REFLOW PROFILE/i });
    await expect(reflowTab).toBeVisible();
    await reflowTab.click();

    // Verify Reflow Profiler instrumentation mounts
    await expect(page.getByText(/Closed-Loop Reflow Oven Telemetry/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Heller 1913 MK5|Thermocouple Curves|Oven Drift Sentinel/i).first()).toBeVisible({ timeout: 10000 });

    // --------------------------------------------------------------------------
    // Step 4: Optical Inspection & Rework Station
    // --------------------------------------------------------------------------
    const reworkTab = page.getByRole('button', { name: /06 \/\/ REWORK KIOSK/i });
    await expect(reworkTab).toBeVisible();
    await reworkTab.click();

    // Verify Rework Station mounts
    await expect(page.getByText(/Cleanroom PCBA Rework Kiosk/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/PANEL BARCODE|TECHNICIAN|SUPERVISOR/i).first()).toBeVisible({ timeout: 10000 });

    // --------------------------------------------------------------------------
    // Step 5: Unit Genealogy Tree Lookup & Recall Containment (Task U-02 / G-11)
    // --------------------------------------------------------------------------
    const genealogyTab = page.getByRole('button', { name: /03 \/\/ GENEALOGY/i });
    await expect(genealogyTab).toBeVisible();
    await genealogyTab.click();

    // Verify Traceability Cockpit mounts
    await expect(page.getByText(/As-Built Genealogy & Containment Recall Station/i)).toBeVisible({ timeout: 10000 });

    // Click preset search button for PNL-260901-0042
    const panelPreset = page.getByRole('button', { name: /PNL-260901-0042/i }).first();
    await expect(panelPreset).toBeVisible();
    await panelPreset.click();

    // Wait for genealogy data rendering
    await expect(page.getByText(/PNL-260901-0042/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/GENEALOGY|RECALL|BATCH/i).first()).toBeVisible({ timeout: 10000 });

    // --------------------------------------------------------------------------
    // Step 6: Session Termination & Operator Lockout Cleanup
    // --------------------------------------------------------------------------
    await lockBtn.click();
    await expect(page.getByRole('button', { name: /OPERATOR SIGN-IN/i })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('header')).not.toContainText('OP-01');
  });
});
