import dotenv from 'dotenv';

dotenv.config();

export interface SecretsConfig {
  nodeEnv: 'production' | 'development' | 'test';
  port: number;
  fujiPort: number;
  databaseUrl?: string;
  allowedSubnets: string[];
  jwtSecret: string;
  apiKeySecret: string;
  vaultAddr?: string;
  vaultToken?: string;
  vaultSecretPath?: string;
}

export class SecretsConfigManager {
  private static cachedConfig: SecretsConfig | null = null;

  /**
   * Masks sensitive credentials for secure log output and audit trails.
   */
  public static maskSecret(secret?: string): string {
    if (!secret) return '[EMPTY]';
    if (secret.length <= 8) return '****';
    const prefix = secret.slice(0, 4);
    const suffix = secret.slice(-4);
    return `${prefix}...${suffix} (${secret.length} chars)`;
  }

  /**
   * Validates and loads environment variables according to enterprise security standards.
   * In production mode, rejects weak/default credentials and enforces minimum entropy.
   */
  public static loadConfig(customEnv: Record<string, string | undefined> = process.env): SecretsConfig {
    const nodeEnv = (customEnv.NODE_ENV || 'development') as 'production' | 'development' | 'test';
    const port = parseInt(customEnv.PORT || '4000', 10);
    const fujiPort = parseInt(customEnv.FUJI_PORT || '30040', 10);
    const databaseUrl = customEnv.DATABASE_URL;

    // OT Subnet isolation list
    const rawSubnets = customEnv.SMT_ALLOWED_SUBNET || '127.0.0.1,::1,192.168.10.0/24';
    const allowedSubnets = rawSubnets
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const jwtSecret = customEnv.JWT_SECRET || 'dev-jwt-secret-do-not-use-in-production-min-32chars';
    const apiKeySecret = customEnv.API_KEY_SECRET || 'dev-mes-api-key-secret-2026-strict-hygiene';

    // Strict Production Gate
    if (nodeEnv === 'production') {
      const weakPatterns = [
        'dev',
        'test',
        'default',
        'secret',
        'password',
        'change-me',
        'admin',
        '12345'
      ];

      const isJwtWeak =
        jwtSecret.length < 32 ||
        weakPatterns.some((pattern) => jwtSecret.toLowerCase().includes(pattern));

      if (isJwtWeak) {
        throw new Error(
          '[SECURITY CRITICAL] Weak or default JWT_SECRET detected in production environment! Must be >= 32 characters and high-entropy.'
        );
      }

      const isApiKeyWeak =
        apiKeySecret.length < 32 ||
        weakPatterns.some((pattern) => apiKeySecret.toLowerCase().includes(pattern));

      if (isApiKeyWeak) {
        throw new Error(
          '[SECURITY CRITICAL] Weak or default API_KEY_SECRET detected in production environment! Must be >= 32 characters and high-entropy.'
        );
      }
    }

    const config: SecretsConfig = {
      nodeEnv,
      port,
      fujiPort,
      databaseUrl,
      allowedSubnets,
      jwtSecret,
      apiKeySecret,
      vaultAddr: customEnv.VAULT_ADDR,
      vaultToken: customEnv.VAULT_TOKEN,
      vaultSecretPath: customEnv.VAULT_SECRET_PATH
    };

    this.cachedConfig = config;
    return config;
  }

  /**
   * Returns configured allowed subnets for OT and internal service isolation.
   */
  public static getAllowedSubnets(): string[] {
    const config = this.cachedConfig || this.loadConfig();
    return config.allowedSubnets;
  }

  /**
   * Generates a sanitized security audit report of environment hygiene.
   */
  public static getSanitizedReport(): Record<string, any> {
    const config = this.cachedConfig || this.loadConfig();
    return {
      environment: config.nodeEnv,
      httpPort: config.port,
      fujiPort: config.fujiPort,
      databaseConfigured: Boolean(config.databaseUrl),
      allowedSubnets: config.allowedSubnets,
      jwtSecretMasked: this.maskSecret(config.jwtSecret),
      apiKeySecretMasked: this.maskSecret(config.apiKeySecret),
      vaultConfigured: Boolean(config.vaultAddr && config.vaultToken)
    };
  }
}
