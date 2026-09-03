import net from 'net';
import { FUJI_FRAMING } from '@mes/shared';

/**
 * Fuji Nexim SMT Line Simulator.
 * Emulates a real Fuji NXT III / AIMEX machine connected to the MES Gateway.
 */
export class FujiSmtSimulator {
  private client: net.Socket | null = null;
  private seqId = 1000;
  private isConnected = false;

  private nextSeq(): number {
    this.seqId = (this.seqId + 1) % 999999;
    return this.seqId;
  }

  private sendFrame(command: string, ...fields: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.isConnected) {
        return reject(new Error('Simulator not connected'));
      }

      const seq = this.nextSeq();
      const bodyStr = [command, seq.toString(), ...fields].join('\t');
      const bodyBuf = Buffer.from(bodyStr, 'utf-8');
      const totalLen = 1 + bodyBuf.length + 1; // STX + body + ETX

      const frame = Buffer.alloc(FUJI_FRAMING.HEADER_SIZE + totalLen);
      frame.writeUInt32BE(totalLen, 0);
      frame[4] = FUJI_FRAMING.STX;
      bodyBuf.copy(frame, 5);
      frame[frame.length - 1] = FUJI_FRAMING.ETX;

      this.client.write(frame);
      resolve(bodyStr);
    });
  }

  public connect(port = 30040, host = '127.0.0.1'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = new net.Socket();
      this.client.connect(port, host, async () => {
        this.isConnected = true;
        console.log(`[Fuji Simulator] Connected to MES Gateway at ${host}:${port}`);

        // 1. Initial Handshake: SETEV
        await this.sendFrame('SETEV', 'NXT01', 'MCSTATECHANGE,1\rPRODSTARTED,1\rPRODCOMPLETED,1\rLOADCOMP,1');
        // 2. Start Notifications: STARTEV
        await this.sendFrame('STARTEV', 'NXT01');

        resolve();
      });

      this.client.on('data', (data) => {
        const str = data.toString('utf-8');
        if (str.includes('KEEPALIVE')) {
          this.sendFrame('KEEPALIVE_ACK');
        }
      });

      this.client.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Simulates producing a single PCB panel (start -> complete).
   */
  public async simulatePanelCycle(panelNo: number, cycleTimeSeconds = 18.2): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

    // 1. Production Start
    await this.sendFrame(
      'PRODSTARTED',
      timestamp,
      'LINE01',
      'NXT01',
      '1', // Module 1
      '1', // Lane 1
      '0', // Product mode
      'PROG-SM-METER-TOP-REV4',
      panelNo.toString()
    );

    // 2. Wait simulated cycle time (shortened for testing)
    await new Promise(r => setTimeout(r, 100));

    // 3. Production Completed II
    await this.sendFrame(
      'PRODCOMPLETEII',
      timestamp,
      'LINE01',
      'NXT01',
      '1', // Module 1
      '1', // Lane 1
      '0', // Product Mode
      'PROG-SM-METER-TOP-REV4',
      panelNo.toString(),
      '4', // 4 blocks per panel
      '0', // 0 skips
      '0x00', // Skip bitmask
      cycleTimeSeconds.toString()
    );
  }

  /**
   * Simulates an operator splicing a reel at slot 1.
   */
  public async simulateReelSplice(slotNo: number, partNo: string, newReelId: string): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    await this.sendFrame(
      'CHANGECOMPII',
      timestamp,
      'LINE01',
      'NXT01',
      '1', // Module 1
      '1', // NumList = 1
      '1', // SeqNo = 1
      slotNo.toString(),
      partNo,
      'FID-W08F-01',
      'REEL-OLD',
      newReelId,
      '10000'
    );
  }

  /**
   * Simulates a parts drop error (PDERROR) on a feeder slot.
   */
  public async simulatePickError(
    slotNo: number, 
    feederId: string, 
    partNo: string, 
    nozzleId = 'NOZZLE-01', 
    errorCode = 'VISION_ERROR'
  ): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    await this.sendFrame(
      'PDERROR',
      timestamp,
      'LINE01',
      'NXT01',
      '1', // Module
      '1', // Stage
      slotNo.toString(),
      feederId,
      partNo,
      nozzleId,
      'HEAD-01',
      errorCode,
      'SUB-01'
    );
  }

  /**
   * Simulates a machine state transition (e.g. 5=Run, 6=Stop, 8=Wait Parts).
   */
  public async simulateStateChange(prevStatus: number, currStatus: number): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    await this.sendFrame(
      'MCSTATECHANGE',
      timestamp,
      'LINE01',
      'NXT01',
      '1',
      prevStatus.toString(),
      currStatus.toString()
    );
  }

  public disconnect(): void {
    if (this.client) {
      this.client.end();
      this.isConnected = false;
    }
  }
}

if (require.main === module) {
  const sim = new FujiSmtSimulator();
  console.log('[Fuji Simulator] Connecting to MES Fuji Gateway on port 30040...');
  sim.connect().then(async () => {
    console.log('[Fuji Simulator] Connected! Simulating live factory floor events:');
    
    // 1. Machine transition: IDLE (3) -> RUNNING (5)
    console.log('[1/4] Sending MCSTATECHANGE: Fuji NXT III transitioned to RUNNING');
    await sim.simulateStateChange(3, 5);

    // 2. Stream board placement completions
    for (let i = 1; i <= 3; i++) {
      await new Promise(r => setTimeout(r, 600));
      const panelNo = 142 + i;
      console.log(`[2/4] Sending PRODCOMPLETEII: Board #${panelNo} placement completed (Cycle: 18.24s, 4 blocks)`);
      await sim.simulatePanelCycle(panelNo, 18.24);
    }

    // 3. Simulate optical pick error on Slot 3
    await new Promise(r => setTimeout(r, 600));
    console.log('[3/4] Sending PDERROR: Feeder Slot 3 Nozzle misfire recorded in error pareto');
    await sim.simulatePickError(3, 'FID-W08F-03', 'STM32F401RET6', 'NZ-0402-01', 'VISION_FIDUCIAL_FAIL');

    // 4. Simulate component reel splice on Slot 1
    await new Promise(r => setTimeout(r, 600));
    console.log('[4/4] Sending CHANGECOMPII: Feeder Slot 1 spliced with new reel REEL-MUR-SPLICE-99');
    await sim.simulateReelSplice(1, 'C0402-100NF-16V', 'REEL-MUR-SPLICE-99');

    await new Promise(r => setTimeout(r, 500));
    console.log('[Fuji Simulator] Sequence complete. All frames ingested and projected into MES.');
    sim.disconnect();
    process.exit(0);
  }).catch((err) => {
    console.error('[Fuji Simulator] Error:', err);
    process.exit(1);
  });
}
