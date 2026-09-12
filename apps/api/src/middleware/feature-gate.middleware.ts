import { Request, Response, NextFunction } from 'express';
import { getFeatureFlags, FeatureFlags } from '@mes/shared';

export function featureGate(flagName: keyof FeatureFlags) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const flags = getFeatureFlags();
    if (!flags[flagName]) {
      res.status(403).json({
        error: 'FEATURE_DISABLED',
        message: `Feature module ${flagName} is disabled in this environment.`
      });
      return;
    }
    next();
  };
}
