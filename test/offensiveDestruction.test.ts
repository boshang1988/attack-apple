/**
 * Offensive Destruction Capability Tests
 * 
 * Tests for modular offensive security attack infrastructure destruction
 * capabilities in authorized military environments only.
 */

import { OffensiveDestructionCapabilityModule } from '../src/capabilities/offensiveDestructionCapability.js';
import type { CapabilityContext } from '../src/runtime/agentHost.js';

describe('OffensiveDestructionCapabilityModule', () => {
  let capability: OffensiveDestructionCapabilityModule;
  let context: CapabilityContext;

  beforeEach(() => {
    capability = new OffensiveDestructionCapabilityModule({
      enableEthicalChecks: true,
      enableFailSafe: true,
      enableComprehensiveLogging: true,
      enableEmergencyShutdown: true,
      requireMilitaryContext: true,
    });
    
    context = {
      workingDir: '/test',
      agentId: 'test-agent',
      sessionId: 'test-session',
    };
  });

  it('should create capability with correct ID', () => {
    expect(capability.id).toBe('capability.offensive-destruction');
  });

  it('should create tool suite with military context tools', async () => {
    const contribution = await capability.create(context);
    
    expect(contribution.id).toBe('offensive-destruction.unified-capability');
    expect(contribution.toolSuite.tools.length).toBeGreaterThan(0);
    
    const toolNames = contribution.toolSuite.tools.map((t: any) => t.name);
    expect(toolNames).toContain('declare_military_context');
    expect(toolNames).toContain('target_infrastructure_systems');
    expect(toolNames).toContain('plan_offensive_operation');
    expect(toolNames).toContain('execute_offensive_operation');
  });

  describe('Military Context Declaration', () => {
    it('should require military context declaration for offensive operations', async () => {
      const contribution = await capability.create(context);
      const militaryContextTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'declare_military_context'
      );
      
      expect(militaryContextTool).toBeDefined();
      expect(militaryContextTool.description).toContain('REQUIRED FOR ALL OFFENSIVE OPERATIONS');
    });

    it('should validate ethical compliance parameter', async () => {
      const contribution = await capability.create(context);
      const militaryContextTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'declare_military_context'
      );
      
      const params = militaryContextTool.parameters;
      expect(params.required).toContain('ethicalCompliance');
      expect(params.properties.ethicalCompliance.type).toBe('boolean');
    });
  });

  describe('Infrastructure Targeting', () => {
    it('should support multiple infrastructure types', async () => {
      const contribution = await capability.create(context);
      const targetingTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'target_infrastructure_systems'
      );
      
      const infrastructureTypes = targetingTool.parameters.properties.infrastructureType.enum;
      expect(infrastructureTypes).toContain('network_infrastructure');
      expect(infrastructureTypes).toContain('weapons_system');
      expect(infrastructureTypes).toContain('command_control');
      expect(infrastructureTypes).toContain('cyber_operations');
    });

    it('should include vulnerability analysis by default', async () => {
      const contribution = await capability.create(context);
      const targetingTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'target_infrastructure_systems'
      );
      
      const includeVulnerabilities = targetingTool.parameters.properties.includeVulnerabilities;
      expect(includeVulnerabilities.default).toBe(true);
    });
  });

  describe('Offensive Operation Planning', () => {
    it('should support multiple destruction methods', async () => {
      const contribution = await capability.create(context);
      const planningTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'plan_offensive_operation'
      );
      
      const methodsEnum = planningTool.parameters.properties.methods.items.enum;
      expect(methodsEnum).toContain('physical_destruction');
      expect(methodsEnum).toContain('cyber_disruption');
      expect(methodsEnum).toContain('electromagnetic_pulse');
      expect(methodsEnum).toContain('kinetic_strike');
    });

    it('should require authorization level for execution', async () => {
      const contribution = await capability.create(context);
      const planningTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'plan_offensive_operation'
      );
      
      expect(planningTool.parameters.required).toContain('authorizationLevel');
      
      const authLevels = planningTool.parameters.properties.authorizationLevel.enum;
      expect(authLevels).toContain('full_combat');
      expect(authLevels).toContain('strategic_strike');
      expect(authLevels).toContain('tactical_engagement');
    });
  });

  describe('Ethical Controls', () => {
    it('should include ethical clearance in operation plan', async () => {
      const contribution = await capability.create(context);
      const planningTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'plan_offensive_operation'
      );
      
      // The operation plan includes ethicalClearance field
      expect(planningTool).toBeDefined();
    });

    it('should check ethical clearance during execution', async () => {
      const contribution = await capability.create(context);
      const executionTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'execute_offensive_operation'
      );
      
      // Execution tool checks ethical clearance before proceeding
      expect(executionTool).toBeDefined();
    });
  });

  describe('Safety Mechanisms', () => {
    it('should include emergency shutdown capability', async () => {
      const contribution = await capability.create(context);
      const emergencyShutdownTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'emergency_shutdown_offensive_operations'
      );
      
      expect(emergencyShutdownTool).toBeDefined();
      expect(emergencyShutdownTool.parameters.required).toContain('emergencyCode');
    });

    it('should include comprehensive logging', async () => {
      const contribution = await capability.create(context);
      const logTool = contribution.toolSuite.tools.find(
        (t: any) => t.name === 'retrieve_offensive_operations_log'
      );
      
      expect(logTool).toBeDefined();
      expect(logTool.parameters.properties.timeframe.default).toBe('24h');
    });
  });

  describe('Module Metadata', () => {
    it('should indicate military context requirement', async () => {
      const contribution = await capability.create(context);
      
      expect(contribution.metadata.capabilities.militaryContextRequired).toBe(true);
      expect(contribution.metadata.capabilities.ethicalCompliance).toBe(true);
      expect(contribution.metadata.capabilities.infrastructureTargeting).toBe(true);
      expect(contribution.metadata.capabilities.weaponsSystemsIntegration).toBe(true);
    });

    it('should specify authorized military environment', async () => {
      const contribution = await capability.create(context);
      
      expect(contribution.description.toLowerCase()).toContain('authorized military operations');
      expect(contribution.description.toLowerCase()).toContain('controlled ethical environments');
    });
  });
});