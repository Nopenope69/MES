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
        // Log received ACKs
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
      `1\t${slotNo}\t${partNo}\tFID-W08F-01\tREEL-OLD\t${newReelId}\t10000`
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
