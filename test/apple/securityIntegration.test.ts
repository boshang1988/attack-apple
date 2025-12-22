/**
 * Apple Security Integration Tests
 */

import { AppleSecurityIntegration } from '../../src/core/appleSecurityIntegration.js';
import { AppleSecurityCapabilityModule } from '../../src/capabilities/appleSecurityCapability.js';

describe('Apple Security Integration', () => {
  let integration: AppleSecurityIntegration;

  beforeEach(() => {
    integration = new AppleSecurityIntegration({
      aggressive: false,
      evidencePrefix: 'test-apple-security',
      outputDir: '/tmp'
    });
  });

  describe('Service Discovery', () => {
    it('should load Apple services', () => {
      const services = integration.loadAppleServices();
      expect(services).toBeInstanceOf(Array);
      expect(services.length).toBeGreaterThan(0);
      expect(services[0]).toHaveProperty('name');
      expect(services[0]).toHaveProperty('domain');
      expect(services[0]).toHaveProperty('category');
    });

    it('should categorize services correctly', () => {
      const services = integration.loadAppleServices();
      const categories = new Set(services.map(s => s.category));
      expect(categories.size).toBeGreaterThan(0);
      
      // Should have at least cloud and developer categories
      expect(categories.has('cloud')).toBeTruthy();
      expect(categories.has('developer')).toBeTruthy();
    });
  });

  describe('Vulnerability Assessment', () => {
    it('should load Apple vulnerabilities', () => {
      const vulnerabilities = integration.loadAppleVulnerabilities();
      expect(vulnerabilities).toBeInstanceOf(Array);
      expect(vulnerabilities.length).toBeGreaterThan(0);
      expect(vulnerabilities[0]).toHaveProperty('cve');
      expect(vulnerabilities[0]).toHaveProperty('severity');
      expect(vulnerabilities[0]).toHaveProperty('affected');
    });

    it('should have proper severity levels', () => {
      const vulnerabilities = integration.loadAppleVulnerabilities();
      const severities = new Set(vulnerabilities.map(v => v.severity));
      expect(severities.has('critical')).toBeTruthy();
      expect(severities.has('high')).toBeTruthy();
    });
  });

  describe('Exploit Analysis', () => {
    it('should load Apple exploits', () => {
      const exploits = integration.loadAppleExploits();
      expect(exploits).toBeInstanceOf(Array);
      expect(exploits.length).toBeGreaterThan(0);
      expect(exploits[0]).toHaveProperty('name');
      expect(exploits[0]).toHaveProperty('type');
      expect(exploits[0]).toHaveProperty('method');
    });

    it('should have various exploit types', () => {
      const exploits = integration.loadAppleExploits();
      const types = new Set(exploits.map(e => e.type));
      expect(types.has('ios')).toBeTruthy();
      expect(types.has('macos')).toBeTruthy();
      expect(types.has('web')).toBeTruthy();
    });
  });

  describe('Health Check', () => {
    it('should perform health check', () => {
      const health = AppleSecurityIntegration.quickCheck();
      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('details');
      expect(['healthy', 'degraded', 'unavailable']).toContain(health.status);
    });
  });
});

describe('Apple Security Capability Module', () => {
  let capability: AppleSecurityCapabilityModule;

  beforeEach(() => {
    capability = new AppleSecurityCapabilityModule({
      aggressive: false,
      targetScope: 'services',
      enableExploitation: false,
      enableRemediation: true,
      outputDir: '/tmp'
    });
  });

  it('should create capability module with correct properties', () => {
    expect(capability).toBeInstanceOf(AppleSecurityCapabilityModule);
    expect(capability.id).toBe('apple-security');
    expect(capability.name).toBe('Apple Security Integration');
    expect(capability.description).toContain('Apple security');
  });

  it('should have metadata', () => {
    const metadata = capability.getMetadata();
    expect(metadata).toHaveProperty('id', 'apple-security');
    expect(metadata).toHaveProperty('name', 'Apple Security Integration');
    expect(metadata).toHaveProperty('operations');
    expect(Array.isArray(metadata.operations)).toBeTruthy();
    expect(metadata.operations.length).toBeGreaterThan(0);
  });

  it('should list available operations', () => {
    const metadata = capability.getMetadata();
    const operationIds = metadata.operations.map((op: any) => op.id);
    expect(operationIds).toContain('service_discovery');
    expect(operationIds).toContain('vulnerability_assessment');
    expect(operationIds).toContain('security_hardening');
    expect(operationIds).toContain('health_check');
  });
});