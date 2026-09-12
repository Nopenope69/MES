import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Track C: DevOps, Packaging & Factory-Edge Deployment Suite', () => {
  const rootDir = path.resolve(__dirname, '../../..');

  it('provides a hardened multi-stage Dockerfile for the MES API', () => {
    const dockerfilePath = path.join(rootDir, 'apps/api/Dockerfile');
    expect(fs.existsSync(dockerfilePath)).toBe(true);

    const content = fs.readFileSync(dockerfilePath, 'utf-8');
    expect(content).toMatch(/FROM node:(20|22)-alpine AS builder/);
    expect(content).toMatch(/FROM node:(20|22)-alpine AS runner/);
    expect(content).toContain('EXPOSE 4000 30040');
    expect(content).toContain('dumb-init');
    expect(content).toContain('USER mesuser');
    expect(content).toContain('HEALTHCHECK');
    expect(content).toContain('CMD ["node", "apps/api/dist/server.js"]');
  });

  it('provides a hardened multi-stage Dockerfile and Nginx configuration for the MES Web UI', () => {
    const dockerfilePath = path.join(rootDir, 'apps/web/Dockerfile');
    const nginxConfPath = path.join(rootDir, 'apps/web/nginx.conf');

    expect(fs.existsSync(dockerfilePath)).toBe(true);
    expect(fs.existsSync(nginxConfPath)).toBe(true);

    const dockerContent = fs.readFileSync(dockerfilePath, 'utf-8');
    expect(dockerContent).toMatch(/FROM node:(20|22)-alpine AS builder/);
    expect(dockerContent).toContain('FROM nginx:1.27-alpine AS runner');
    expect(dockerContent).toContain('COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf');
    expect(dockerContent).toContain('EXPOSE 80');
    expect(dockerContent).toContain('HEALTHCHECK');

    const nginxContent = fs.readFileSync(nginxConfPath, 'utf-8');
    expect(nginxContent).toContain('gzip on;');
    expect(nginxContent).toContain('try_files $uri $uri/ /index.html;');
    expect(nginxContent).toContain('location /api/ {');
    expect(nginxContent).toContain('proxy_pass http://mes-api:4000;');
  });

  it('configures factory-edge docker-compose orchestration with healthchecks', () => {
    const composePath = path.join(rootDir, 'docker-compose.yml');
    expect(fs.existsSync(composePath)).toBe(true);

    const content = fs.readFileSync(composePath, 'utf-8');
    expect(content).toContain('mes-api:');
    expect(content).toContain('mes-web:');
    expect(content).toContain('postgres:');
    expect(content).toContain('adminer:');
    expect(content).toContain('"4000:4000"');
    expect(content).toContain('"30040:30040"');
    expect(content).toContain('"3000:80"');
    expect(content).toContain('healthcheck:');
  });

  it('configures CI pipeline template with matrix testing and container verification', () => {
    const ciPath = fs.existsSync(path.join(rootDir, 'deploy/ci/ci.yml'))
      ? path.join(rootDir, 'deploy/ci/ci.yml')
      : path.join(rootDir, '.github/workflows/ci.yml');
    expect(fs.existsSync(ciPath)).toBe(true);

    const content = fs.readFileSync(ciPath, 'utf-8');
    expect(content).toContain('test-and-lint:');
    expect(content).toContain('matrix:');
    expect(content).toContain('node-version: [20.x, 22.x]');
    expect(content).toContain('npm ci');
    expect(content).toContain('npm run build');
    expect(content).toContain('npm test');
    expect(content).toContain('docker-build-verify:');
    expect(content).toContain('security-audit:');
  });

  it('scaffolds a complete Helm Chart for factory-edge Kubernetes deployments', () => {
    const chartDir = path.join(rootDir, 'deploy/helm/smt-mes');
    expect(fs.existsSync(path.join(chartDir, 'Chart.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'values.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'templates/_helpers.tpl'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'templates/deployment-api.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'templates/deployment-web.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'templates/service-api.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'templates/service-web.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'templates/ingress.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'templates/configmap.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'templates/pvc.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, 'templates/networkpolicy.yaml'))).toBe(true);

    const chartYaml = fs.readFileSync(path.join(chartDir, 'Chart.yaml'), 'utf-8');
    expect(chartYaml).toContain('name: smt-mes');
    expect(chartYaml).toContain('version: 0.2.0');

    const serviceApi = fs.readFileSync(path.join(chartDir, 'templates/service-api.yaml'), 'utf-8');
    expect(serviceApi).toContain('name: fuji-tcp');
    expect(serviceApi).toContain('protocol: TCP');

    const networkPolicy = fs.readFileSync(path.join(chartDir, 'templates/networkpolicy.yaml'), 'utf-8');
    expect(networkPolicy).toContain('kind: NetworkPolicy');
    expect(networkPolicy).toContain('allowFujiSubnet');
  });

  it('defines Kubernetes Operator CRD and sample manifest for SMT production lines', () => {
    const crdPath = path.join(rootDir, 'deploy/k8s/crd/smtlines.mes.antigravity.io.yaml');
    const samplePath = path.join(rootDir, 'deploy/k8s/samples/smtline-dixon-01.yaml');

    expect(fs.existsSync(crdPath)).toBe(true);
    expect(fs.existsSync(samplePath)).toBe(true);

    const crdContent = fs.readFileSync(crdPath, 'utf-8');
    expect(crdContent).toContain('name: smtlines.mes.antigravity.io');
    expect(crdContent).toContain('kind: SmtLine');
    expect(crdContent).toContain('placementMachineType');
    expect(crdContent).toContain('ratedCph');
    expect(crdContent).toContain('qualityGates');

    const sampleContent = fs.readFileSync(samplePath, 'utf-8');
    expect(sampleContent).toContain('kind: SmtLine');
    expect(sampleContent).toContain('name: dixon-smt-line-01');
    expect(sampleContent).toContain('lineCode: "LINE-01"');
    expect(sampleContent).toContain('ratedCph: 75000');
  });
});
