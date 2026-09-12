// packages/shared/src/config/features.ts

export interface FeatureFlags {
  ENABLE_AGV: boolean;
  ENABLE_PREDICTIVE_QUALITY: boolean;
  ENABLE_CHAOS_ENGINEERING: boolean;
  ENABLE_PRINTER_AUTO_TUNE: boolean;
}

export const DEFAULT_FEATURE_FLAGS: Readonly<FeatureFlags> = {
  ENABLE_AGV: false,
  ENABLE_PREDICTIVE_QUALITY: false,
  ENABLE_CHAOS_ENGINEERING: false,
  ENABLE_PRINTER_AUTO_TUNE: false
};

/**
 * Resolves active feature flags based on process.env configuration.
 * Production defaults are strictly false.
 * In 'test' mode, defaults to true unless explicitly overridden to allow full test suite coverage.
 */
export function getFeatureFlags(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): FeatureFlags {
  const isTest = env.NODE_ENV === 'test';
  return {
    ENABLE_AGV: env.ENABLE_AGV !== undefined ? env.ENABLE_AGV === 'true' : (isTest ? true : DEFAULT_FEATURE_FLAGS.ENABLE_AGV),
    ENABLE_PREDICTIVE_QUALITY: env.ENABLE_PREDICTIVE_QUALITY !== undefined ? env.ENABLE_PREDICTIVE_QUALITY === 'true' : (isTest ? true : DEFAULT_FEATURE_FLAGS.ENABLE_PREDICTIVE_QUALITY),
    ENABLE_CHAOS_ENGINEERING: env.ENABLE_CHAOS_ENGINEERING !== undefined ? env.ENABLE_CHAOS_ENGINEERING === 'true' : (isTest ? true : DEFAULT_FEATURE_FLAGS.ENABLE_CHAOS_ENGINEERING),
    ENABLE_PRINTER_AUTO_TUNE: env.ENABLE_PRINTER_AUTO_TUNE !== undefined ? env.ENABLE_PRINTER_AUTO_TUNE === 'true' : (isTest ? true : DEFAULT_FEATURE_FLAGS.ENABLE_PRINTER_AUTO_TUNE)
  };
}
