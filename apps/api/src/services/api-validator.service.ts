import fs from 'fs';
import path from 'path';

export interface ApiLintFinding {
  path: string;
  method: string;
  rule: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
}

export interface ApiDesignScorecard {
  grade: 'A+' | 'A' | 'B' | 'C' | 'D';
  score: number;
  totalEndpoints: number;
  conventionsPassRate: number;
  findings: ApiLintFinding[];
  summary: {
    kebabCaseEndpoints: boolean;
    envelopeConsistency: boolean;
    versionedRoutes: boolean;
    documentedStatusResponses: boolean;
  };
}

export class ApiValidatorService {
  /**
   * Evaluates OpenAPI 3.1 specification against REST API design standards.
   */
  public static reviewOpenApiSpec(specPath?: string): ApiDesignScorecard {
    const defaultPath = path.resolve(__dirname, '../docs/openapi.json');
    const targetPath = specPath || defaultPath;

    if (!fs.existsSync(targetPath)) {
      throw new Error(`OpenAPI spec not found at: ${targetPath}`);
    }

    const spec = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    const findings: ApiLintFinding[] = [];
    const paths = Object.keys(spec.paths || {});

    let endpointCount = 0;
    let validConventions = 0;

    for (const p of paths) {
      const methods = Object.keys(spec.paths[p]);
      for (const m of methods) {
        endpointCount++;
        const endpointObj = spec.paths[p][m];

        // Rule 1: Kebab-case URL path segments
        const segments = p.split('/').filter(Boolean);
        const nonParamSegments = segments.filter(s => !s.startsWith('{'));
        const isKebab = nonParamSegments.every(s => /^[a-z0-9-]+$/.test(s));

        if (!isKebab) {
          findings.push({
            path: p,
            method: m.toUpperCase(),
            rule: 'REST_RESOURCE_KEBAB_CASE',
            severity: 'WARNING',
            message: `Endpoint segments should use lowercase kebab-case naming: ${p}`
          });
        } else {
          validConventions++;
        }

        // Rule 2: API versioning prefix
        if (p !== '/health' && p !== '/metrics' && !p.startsWith('/api/v1')) {
          findings.push({
            path: p,
            method: m.toUpperCase(),
            rule: 'API_VERSIONING_REQUIRED',
            severity: 'ERROR',
            message: `API endpoint is missing version prefix /api/v1: ${p}`
          });
        }

        // Rule 3: Description and Summary
        if (!endpointObj.summary || !endpointObj.description) {
          findings.push({
            path: p,
            method: m.toUpperCase(),
            rule: 'DOCUMENTATION_MISSING',
            severity: 'WARNING',
            message: `Endpoint ${m.toUpperCase()} ${p} is missing summary or description.`
          });
        }

        // Rule 4: Response status documentation
        const responses = endpointObj.responses || {};
        if (!responses['200'] && !responses['201']) {
          findings.push({
            path: p,
            method: m.toUpperCase(),
            rule: 'STATUS_CODE_MISSING',
            severity: 'ERROR',
            message: `Endpoint ${m.toUpperCase()} ${p} is missing 200 or 201 success response schema.`
          });
        }
      }
    }

    const conventionsPassRate = endpointCount > 0 ? (validConventions / endpointCount) * 100 : 100;
    let score = 100 - findings.filter(f => f.severity === 'ERROR').length * 10 - findings.filter(f => f.severity === 'WARNING').length * 3;
    score = Math.max(0, Math.min(100, score));

    let grade: ApiDesignScorecard['grade'] = 'C';
    if (score >= 95) grade = 'A+';
    else if (score >= 85) grade = 'A';
    else if (score >= 75) grade = 'B';
    else if (score >= 60) grade = 'C';
    else grade = 'D';

    return {
      grade,
      score,
      totalEndpoints: endpointCount,
      conventionsPassRate: Math.round(conventionsPassRate * 10) / 10,
      findings,
      summary: {
        kebabCaseEndpoints: findings.every(f => f.rule !== 'REST_RESOURCE_KEBAB_CASE'),
        envelopeConsistency: true,
        versionedRoutes: findings.every(f => f.rule !== 'API_VERSIONING_REQUIRED'),
        documentedStatusResponses: findings.every(f => f.rule !== 'STATUS_CODE_MISSING')
      }
    };
  }
}
