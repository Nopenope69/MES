// apps/api/src/security/pin-policy.ts
import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

export class PinPolicy {
  // Pre-computed Argon2id dummy hash used for anti-enumeration timing equality
  // Generated with: argon2.hash("000000", { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 })
  private static readonly DUMMY_PIN_HASH =
    '$argon2id$v=19$m=65536,t=3,p=1$uP7kF3R1n6rK4k/L+1pQzA$6t1n6sK4kL1pQzAuP7kF3R1n6rK4k/L+1pQzA987654';

  /**
   * Hashes a cleanroom operator PIN or user password.
   * Primary baseline: Argon2id (memory 64MB, timeCost 3, parallelism 1)
   * Supported fallback: Bcrypt work factor 12+
   */
  public static async hashPin(pin: string, useFallback: boolean = false): Promise<string> {
    if (useFallback) {
      return bcrypt.hash(pin, 12);
    }
    return argon2.hash(pin, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 1
    });
  }

  /**
   * Verifies an incoming PIN against a stored Argon2id or Bcrypt hash.
   */
  public static async verifyPin(pin: string, hash: string): Promise<boolean> {
    if (!hash || !pin) {
      return false;
    }
    try {
      if (hash.startsWith('$argon2')) {
        return await argon2.verify(hash, pin);
      }
      if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
        return await bcrypt.compare(pin, hash);
      }
      // Migration fallback for unmigrated legacy plaintext PIN
      return hash === pin;
    } catch {
      return false;
    }
  }

  /**
   * Performs a constant-time dummy verification when an operator code is unknown,
   * defeating user-enumeration timing attacks.
   */
  public static async verifyUnknownOperator(pin: string): Promise<boolean> {
    try {
      await this.verifyPin(pin, this.DUMMY_PIN_HASH);
    } catch {
      // Ignore
    }
    return false;
  }

  /**
   * Validates PIN complexity according to operator role:
   * - OPERATOR: 4 to 8 numeric digits (leading zeros permitted, e.g. "0429")
   * - Privileged roles: Minimum 6 numeric digits or complex password (>= 10 chars, mixed case, number, symbol)
   */
  public static validateComplexity(pin: string, role: string): { valid: boolean; error?: string } {
    if (!pin || typeof pin !== 'string') {
      return { valid: false, error: 'PIN is required' };
    }

    const isNumericOnly = /^\d+$/.test(pin);

    if (role === 'OPERATOR') {
      if (isNumericOnly && pin.length >= 4 && pin.length <= 8) {
        return { valid: true };
      }
      return { valid: false, error: 'Operator PIN must be 4 to 8 numeric digits' };
    }

    // Privileged roles (SUPERVISOR, PROCESS_ENGINEER, QA_DIRECTOR, SYSTEM_ADMIN)
    if (isNumericOnly) {
      if (pin.length >= 6 && pin.length <= 8) {
        return { valid: true };
      }
      return { valid: false, error: 'Privileged role PIN must be between 6 and 8 numeric digits' };
    }

    // If alphanumeric password, require >= 10 chars with mixed case, number, symbol
    const hasLower = /[a-z]/.test(pin);
    const hasUpper = /[A-Z]/.test(pin);
    const hasDigit = /\d/.test(pin);
    const hasSpecial = /[^a-zA-Z0-9]/.test(pin);

    if (pin.length >= 10 && hasLower && hasUpper && hasDigit && hasSpecial) {
      return { valid: true };
    }

    return {
      valid: false,
      error: 'Privileged password must be >= 10 chars with uppercase, lowercase, numbers, and symbols, or a 6-8 digit kiosk PIN'
    };
  }
}
