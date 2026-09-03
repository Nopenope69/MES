export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock implements Clock {
  private currentTime: Date;

  constructor(initialTime?: Date | string) {
    this.currentTime = initialTime ? new Date(initialTime) : new Date('2026-09-04T08:00:00.000Z');
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  setTime(time: Date | string): void {
    this.currentTime = new Date(time);
  }

  advanceMinutes(minutes: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + minutes * 60 * 1000);
  }

  advanceSeconds(seconds: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + seconds * 1000);
  }

  advanceHours(hours: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + hours * 3600 * 1000);
  }
}
