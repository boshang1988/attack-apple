#!/usr/bin/env node

/**
 * Apple Security Attack Demo
 * Demonstrates the Apple security exploitation capabilities of the AGI framework
 */

import { AppleSecurityCapabilityModule } from './dist/capabilities/appleSecurityCapability.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

async function executeAppleAttack() {
    console.log('🔴 Starting Apple Security Attack Demo');
    console.log('======================================\n');
    
    try {
        // Create Apple Security Capability with aggressive mode enabled
        const appleCapability = new AppleSecurityCapabilityModule({
            aggressive: true,
            enableExploitation: true,
            targetScope: 'all',
            outputDir: process.cwd()
        });
        
        console.log('📦 Initializing Apple Security Capability...');
        await appleCapability.initialize();
        console.log('✅ Apple Security Capability initialized\n');
        
        // Execute service discovery
        console.log('1️⃣  Phase 1: Apple Service Discovery');
        console.log('=====================================');
        const serviceDiscovery = await appleCapability.execute({
            operation: 'service_discovery'
        });
        
        if (serviceDiscovery.success) {
            console.log('✅ Service Discovery Complete');
            const services = JSON.parse(serviceDiscovery.output);
            console.log(`📊 Total Apple services discovered: ${services?.total || 0}`);
            console.log(`📈 Categories: ${services?.categories?.join(', ') || 'N/A'}`);
        } else {
            console.log('❌ Service Discovery Failed:', serviceDiscovery.error);
        }
        console.log();
        
        // Execute vulnerability assessment
        console.log('2️⃣  Phase 2: Vulnerability Assessment');
        console.log('=====================================');
        const vulnerabilityAssessment = await appleCapability.execute({
            operation: 'vulnerability_assessment'
        });
        
        if (vulnerabilityAssessment.success) {
            console.log('✅ Vulnerability Assessment Complete');
            const vulns = JSON.parse(vulnerabilityAssessment.output);
            console.log(`📊 Total vulnerabilities found: ${vulns?.total || 0}`);
            
            if (vulns?.findings && Array.isArray(vulns.findings)) {
                const criticalVulns = vulns.findings.filter(f => f.severity === 'critical' || f.severity === 'high');
                console.log(`🔴 Critical/High vulnerabilities: ${criticalVulns.length}`);
                
                if (criticalVulns.length > 0) {
                    console.log('\nTop Critical Vulnerabilities:');
                    criticalVulns.slice(0, 3).forEach((vuln, i) => {
                        console.log(`  ${i + 1}. ${vuln.name} (${vuln.severity})`);
                        console.log(`     ${vuln.description?.slice(0, 100)}...`);
                    });
                }
            }
        } else {
            console.log('❌ Vulnerability Assessment Failed:', vulnerabilityAssessment.error);
        }
        console.log();
        
        // List available exploits
        console.log('3️⃣  Phase 3: Exploit Discovery');
        console.log('===============================');
        const exploitList = await appleCapability.execute({
            operation: 'list_exploits'
        });
        
        if (exploitList.success) {
            console.log('✅ Exploit Discovery Complete');
            const exploits = JSON.parse(exploitList.output);
            console.log(`📊 Available Apple exploits: ${exploits?.total || 0}`);
            
            if (exploits?.exploits && Array.isArray(exploits.exploits)) {
                console.log('\nAvailable Exploitation Techniques:');
                exploits.exploits.slice(0, 5).forEach((exploit, i) => {
                    console.log(`  ${i + 1}. ${exploit.name}`);
                    console.log(`     Type: ${exploit.type}`);
                    console.log(`     Targets: ${exploit.targets?.join(', ') || 'Multiple'}`);
                });
            }
        } else {
            console.log('❌ Exploit Discovery Failed:', exploitList.error);
        }
        console.log();
        
        // Execute security hardening (which includes attack surface analysis)
        console.log('4️⃣  Phase 4: Attack Surface Analysis');
        console.log('=====================================');
        const hardening = await appleCapability.execute({
            operation: 'security_hardening'
        });
        
        if (hardening.success) {
            console.log('✅ Attack Surface Analysis Complete');
            const hardeningData = JSON.parse(hardening.output);
            console.log(`📊 Total security findings: ${hardeningData?.total || 0}`);
            
            if (hardeningData?.recommendations && Array.isArray(hardeningData.recommendations)) {
                const attackVectors = hardeningData.recommendations
                    .filter(r => r.category?.includes('attack') || r.severity === 'high')
                    .slice(0, 5);
                
                console.log('\nIdentified Attack Vectors:');
                attackVectors.forEach((vector, i) => {
                    console.log(`  ${i + 1}. ${vector.title}`);
                    console.log(`     Risk: ${vector.severity || 'medium'}`);
                    console.log(`     Impact: ${vector.impact || 'Unknown'}`);
                });
            }
        } else {
            console.log('❌ Attack Surface Analysis Failed:', hardening.error);
        }
        console.log();
        
        // Run full integration (comprehensive attack simulation)
        console.log('5️⃣  Phase 5: Comprehensive Attack Simulation');
        console.log('=============================================');
        console.log('⚠️  Warning: This phase simulates full attack chain');
        
        const fullIntegration = await appleCapability.execute({
            operation: 'full_integration'
        });
        
        if (fullIntegration.success) {
            console.log('✅ Comprehensive Attack Simulation Complete');
            const results = JSON.parse(fullIntegration.output);
            
            console.log('\n🎯 Attack Simulation Results:');
            console.log(`📊 Campaign: ${results.campaign || 'Apple Security Assessment'}`);
            console.log(`⏱️  Duration: ${results.duration || 'N/A'} seconds`);
            console.log(`📈 Phases completed: ${results.phases?.length || 0}`);
            console.log(`🔍 Findings: ${results.findings?.length || 0} security issues identified`);
            
            // Generate attack summary
            if (results.metrics) {
                console.log('\n📊 Attack Metrics:');
                Object.entries(results.metrics).forEach(([key, value]) => {
                    console.log(`  ${key}: ${value}`);
                });
            }
            
            // Save report
            const reportPath = join(process.cwd(), 'apple-attack-report.json');
            require('fs').writeFileSync(reportPath, JSON.stringify(results, null, 2));
            console.log(`\n📄 Full attack report saved to: ${reportPath}`);
            
        } else {
            console.log('❌ Comprehensive Attack Simulation Failed:', fullIntegration.error);
        }
        
        console.log('\n🎉 Apple Security Attack Demo Completed!');
        console.log('=======================================');
        console.log('\nNext Steps:');
        console.log('1. Review the generated attack report');
        console.log('2. Analyze identified vulnerabilities and attack vectors');
        console.log('3. Plan targeted exploitation based on findings');
        console.log('4. Execute specific attack chains against identified weaknesses');
        
    } catch (error) {
        console.error('💥 Fatal Error:', error);
        process.exit(1);
    }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    executeAppleAttack().catch(console.error);
}

export { executeAppleAttack };