#!/usr/bin/env -S node --loader ts-node/esm
/**
 * Universal Capability Framework Demo
 * 
 * Demonstrates how to use the Universal Capability Framework to integrate
 * capabilities described in the README into a unified repository-wide source.
 */

import { UniversalCapabilityFramework } from '../src/capabilities/universalCapabilityFramework.js';
import { UniversalCapabilityFactory } from '../src/capabilities/universalCapabilityFramework.js';
import {
  UniversalFilesystemCapability,
  UniversalBashCapability,
  UniversalSearchCapability,
  UniversalEditCapability
} from '../src/capabilities/universalCapabilityFramework.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
  rootDir: process.cwd(),
  debug: true,
  enableEvents: true,
  enableDependencyResolution: true,
  sharedDataDir: '/tmp/agi-universal-framework-demo',
  pluginPatterns: ['**/*.ts', '**/*.js']
};

// ============================================================================
// MAIN DEMO FUNCTION
// ============================================================================

async function runDemo() {
  console.log('🚀 Universal Capability Framework Demo\n');
  console.log('This demo integrates capabilities from the README into a unified framework.');
  console.log('Key capabilities being integrated:');
  console.log('1. Multi-provider AI support');
  console.log('2. True AlphaZero self-play');
  console.log('3. TAO Suite (offensive security)');
  console.log('4. KineticOps (system automation)');
  console.log('5. Enhanced Git');
  console.log('6. Web Tools');
  console.log('7. Bash Tools\n');

  // ==========================================================================
  // 1. INITIALIZE UNIVERSAL FRAMEWORK
  // ==========================================================================
  console.log('📦 Step 1: Initializing Universal Framework...');
  const framework = new UniversalCapabilityFramework(config);
  
  // Register capability types with factory
  UniversalCapabilityFactory.registerCapability('filesystem', UniversalFilesystemCapability);
  UniversalCapabilityFactory.registerCapability('bash', UniversalBashCapability);
  UniversalCapabilityFactory.registerCapability('search', UniversalSearchCapability);
  UniversalCapabilityFactory.registerCapability('edit', UniversalEditCapability);
  
  console.log('✅ Framework initialized');
  console.log(`📁 Shared data directory: ${config.sharedDataDir}`);
  console.log(`🔧 Registered capabilities: ${UniversalCapabilityFactory.listCapabilityTypes().join(', ')}\n`);

  // ==========================================================================
  // 2. CREATE AND ACTIVATE CAPABILITIES
  // ==========================================================================
  console.log('⚡ Step 2: Creating and activating capabilities...');
  
  // Create capabilities using factory
  const fsCapability = UniversalCapabilityFactory.createCapability('filesystem', framework, {
    workingDir: config.rootDir
  });
  
  const bashCapability = UniversalCapabilityFactory.createCapability('bash', framework, {
    workingDir: config.rootDir
  });
  
  const searchCapability = UniversalCapabilityFactory.createCapability('search', framework, {
    workingDir: config.rootDir
  });
  
  const editCapability = UniversalCapabilityFactory.createCapability('edit', framework, {
    workingDir: config.rootDir
  });
  
  if (!fsCapability || !bashCapability || !searchCapability || !editCapability) {
    console.error('❌ Failed to create capabilities');
    return;
  }
  
  // Register capabilities with framework
  await framework.registerCapability(fsCapability, fsCapability.metadata);
  await framework.registerCapability(bashCapability, bashCapability.metadata);
  await framework.registerCapability(searchCapability, searchCapability.metadata);
  await framework.registerCapability(editCapability, editCapability.metadata);
  
  console.log('✅ Capabilities created and registered\n');

  // ==========================================================================
  // 3. ACTIVATE CAPABILITIES (RESOLVE DEPENDENCIES)
  // ==========================================================================
  console.log('🔗 Step 3: Activating capabilities and resolving dependencies...');
  
  try {
    await framework.activateCapability('capability.universal-filesystem');
    await framework.activateCapability('capability.universal-bash');
    await framework.activateCapability('capability.universal-search');
    await framework.activateCapability('capability.universal-edit');
    
    console.log('✅ All capabilities activated');
    
    // Show dependency graph
    const depGraph = framework.getDependencyGraph();
    console.log(`📊 Dependency graph has cycles: ${depGraph.hasCycles}`);
    console.log(`📊 Topological order: ${depGraph.topologicalOrder.join(' -> ')}\n`);
  } catch (error) {
    console.error(`❌ Failed to activate capabilities: ${error}`);
    return;
  }

  // ==========================================================================
  // 4. DEMONSTRATE CROSS-CAPABILITY OPERATIONS
  // ==========================================================================
  console.log('🔄 Step 4: Demonstrating cross-capability operations...');
  
  // Example 1: Filesystem + Search integration
  console.log('📁 Example 1: Filesystem + Search Integration');
  
  try {
    const fsResult = await fsCapability.execute({
      operation: 'list',
      parameters: {
        path: config.rootDir,
        recursive: false
      }
    });
    
    console.log(`📋 Files in ${config.rootDir}: ${fsResult.length} items found`);
    
    // Use search capability to find TypeScript files
    const searchResult = await searchCapability.execute({
      operation: 'search',
      parameters: {
        pattern: '.ts',
        path: config.rootDir
      }
    });
    
    console.log(`🔍 Found TypeScript files: ${searchResult.results.length}\n`);
  } catch (error) {
    console.error(`❌ Cross-capability operation failed: ${error}\n`);
  }

  // Example 2: Bash + Filesystem integration
  console.log('💻 Example 2: Bash + Filesystem Integration');
  
  try {
    // Execute a bash command
    const bashResult = await bashCapability.execute({
      operation: 'execute',
      parameters: {
        command: 'ls -la',
        cwd: config.rootDir
      }
    });
    
    console.log(`📝 Bash command executed: ${bashResult.success ? '✅ Success' : '❌ Failed'}`);
    if (bashResult.success) {
      console.log(`📊 Output length: ${bashResult.output.length} characters`);
    }
    
    // Create a test file using filesystem capability
    const testFilePath = `${config.sharedDataDir}/test-file.txt`;
    await fsCapability.execute({
      operation: 'write',
      parameters: {
        path: testFilePath,
        content: 'Test content created by Universal Framework\n' + new Date().toISOString()
      }
    });
    
    console.log(`📄 Test file created: ${testFilePath}\n`);
  } catch (error) {
    console.error(`❌ Bash + Filesystem integration failed: ${error}\n`);
  }

  // ==========================================================================
  // 5. DEMONSTRATE FRAMEWORK EVENT SYSTEM
  // ==========================================================================
  console.log('📡 Step 5: Demonstrating framework event system...');
  
  // Listen for framework events
  framework.on('log', (event) => {
    if (event.level === 'info') {
      console.log(`   📢 Event: ${event.message}`);
    }
  });
  
  framework.on('capability:activated', (event) => {
    console.log(`   🎯 Capability activated: ${event.capabilityId}`);
  });
  
  framework.on('operation:started', (event) => {
    console.log(`   🚀 Operation started: ${event.operation} (ID: ${event.operationId})`);
  });
  
  // Trigger some operations to generate events
  await framework.executeOperation(
    'demo_operation',
    { test: 'data' },
    ['capability.universal-filesystem', 'capability.universal-bash']
  );
  
  console.log('\n✅ Event system demonstrated\n');

  // ==========================================================================
  // 6. SHOW FRAMEWORK UTILITIES
  // ==========================================================================
  console.log('🛠️  Step 6: Demonstrating shared utilities...');
  
  const utilities = framework.getSharedUtilities();
  const toolRegistry = framework.getToolRegistry();
  
  // Generate operation IDs
  const opId1 = utilities.generateOperationId('demo');
  const opId2 = utilities.generateOperationId('test');
  
  console.log(`   🔑 Generated operation IDs: ${opId1}, ${opId2}`);
  
  // Create operation directory
  const opDir = utilities.createOperationDir(opId1);
  console.log(`   📁 Operation directory created: ${opDir}`);
  
  // Save data to shared storage
  const savedPath = utilities.saveToSharedStorage(opId1, 'demo-data.json', {
    timestamp: new Date().toISOString(),
    framework: 'Universal Capability Framework',
    version: '1.0.0'
  });
  
  console.log(`   💾 Data saved to: ${savedPath}`);
  
  // Read data back
  const readData = utilities.readFromSharedStorage(opId1, 'demo-data.json');
  console.log(`   📖 Data read back: ${readData ? '✅ Success' : '❌ Failed'}`);
  
  // Deep merge example
  const merged = utilities.deepMerge(
    { a: 1, b: { c: 2 } },
    { b: { d: 3 }, e: 4 }
  );
  console.log(`   🧬 Deep merge result keys: ${Object.keys(merged).join(', ')}\n`);

  // ==========================================================================
  // 7. INTEGRATION WITH README CAPABILITIES
  // ==========================================================================
  console.log('📚 Step 7: Integrating README-described capabilities...');
  
  console.log('   🔗 Demonstrating how to integrate:');
  console.log('      • Multi-provider AI support - Can be added as AI capability module');
  console.log('      • True AlphaZero self-play - Can be added as tournament capability');
  console.log('      • TAO Suite - Can be added as security capability');
  console.log('      • KineticOps - Can be added as automation capability');
  console.log('      • Enhanced Git - Can extend filesystem capability');
  console.log('      • Web Tools - Can be added as web capability module');
  console.log('      • Bash Tools - Already integrated via UniversalBashCapability');
  
  console.log('\n   💡 Integration strategy:');
  console.log('      1. Create specialized capability modules for each domain');
  console.log('      2. Register them with UniversalCapabilityFactory');
  console.log('      3. Define dependencies between capabilities');
  console.log('      4. Use framework for cross-capability orchestration');
  console.log('      5. Leverage shared utilities for consistency\n');

  // ==========================================================================
  // 8. CLEANUP AND SUMMARY
  // ==========================================================================
  console.log('🧹 Step 8: Cleanup and summary...');
  
  // List all capabilities
  const capabilities = framework.listCapabilities();
  console.log(`   📋 Total capabilities registered: ${capabilities.length}`);
  
  capabilities.forEach(cap => {
    console.log(`      • ${cap.metadata.id} (${cap.status})`);
  });
  
  console.log('\n🎉 DEMO COMPLETED SUCCESSFULLY!');
  console.log('\n✅ Universal Capability Framework provides:');
  console.log('   • Unified architecture for all AGI capabilities');
  console.log('   • Dependency injection and resolution');
  console.log('   • Event-driven cross-module communication');
  console.log('   • Shared utilities for consistent operations');
  console.log('   • Pluggable architecture for easy extensibility');
  console.log('   • Type-safe implementation with full TypeScript support');
  
  console.log('\n🚀 Ready to integrate additional capabilities from README!');
}

// ============================================================================
// RUN DEMO
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().catch(error => {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  });
}

export default runDemo;