#!/usr/bin/env node

/**
 * 最大能力中国网络作战框架 - 最终验证脚本
 * 验证所有核心模块和命令行接口的完整功能
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// 验证配置
// ============================================================================

const VERIFICATION_CONFIG = {
  verbose: true,
  maxTimeout: 15000,
  requiredModules: [
    'ultimateChineseCno.js',
    'quantumSpaceWarfare.js',
    'biocognitiveWarfare.js'
  ],
  testCommands: [
    {
      cmd: 'node dist/bin/agi.js --max-chinese-cno',
      desc: '终极中国CNO框架演示',
      expectedKeywords: ['成功', '完成', '演示', '初始化']
    },
    {
      cmd: 'node dist/bin/agi.js --max-chinese-cno --strategic-targets',
      desc: '战略目标评估',
      expectedKeywords: ['目标', '评估', '成功', '价值']
    },
    {
      cmd: 'node dist/bin/agi.js --max-chinese-cno --control-system --system=US-F35-LIGHTNING-II --command=status',
      desc: '军事系统控制',
      expectedKeywords: ['控制', '成功', '执行', 'F-35']
    },
    {
      cmd: 'node dist/bin/agi.js --quantum-space',
      desc: '量子太空作战演示',
      expectedKeywords: ['量子', '太空', '演示', '完成']
    },
    {
      cmd: 'node dist/bin/agi.js --biocognitive',
      desc: '生物认知作战演示',
      expectedKeywords: ['生物', '认知', '演示', '完成']
    },
    {
      cmd: 'node dist/bin/agi.js --help',
      desc: '命令行帮助集成验证',
      expectedKeywords: ['Chinese CNO Framework', 'Quantum & Space Warfare', 'Biocognitive Warfare', '--max-chinese-cno', '--quantum-space', '--biocognitive']
    }
  ]
};

// ============================================================================
// 验证结果追踪
// ============================================================================

const verificationResults = {
  totalTests: 0,
  passed: 0,
  failed: 0,
  warnings: 0,
  details: []
};

// ============================================================================
// 日志函数
// ============================================================================

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',
    success: '\x1b[32m',
    warning: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
  };
  
  const prefix = {
    info: '[INFO]',
    success: '[✅]',
    warning: '[⚠️]',
    error: '[❌]'
  };
  
  console.log(`${colors[type]}${prefix[type]} ${message}${colors.reset}`);
}

// ============================================================================
// 系统完整性检查
// ============================================================================

function checkSystemIntegrity() {
  log('\n🛡️  系统完整性检查', 'info');
  
  const checks = [
    {
      name: '编译输出目录',
      check: () => {
        const distPath = path.join(process.cwd(), 'dist');
        if (!fs.existsSync(distPath)) {
          return { status: 'failed', message: 'dist目录不存在，请先运行 npm run build' };
        }
        
        const files = fs.readdirSync(distPath);
        if (files.length === 0) {
          return { status: 'failed', message: 'dist目录为空' };
        }
        
        return { status: 'passed', message: `找到${files.length}个文件` };
      }
    },
    {
      name: 'AGI可执行文件',
      check: () => {
        const agiPath = path.join(process.cwd(), 'dist', 'bin', 'agi.js');
        if (!fs.existsSync(agiPath)) {
          return { status: 'failed', message: 'agi.js可执行文件不存在' };
        }
        
        const stats = fs.statSync(agiPath);
        if (stats.size < 1000) {
          return { status: 'warning', message: `文件大小异常: ${stats.size}字节` };
        }
        
        return { status: 'passed', message: `文件大小: ${Math.round(stats.size/1024)}KB` };
      }
    },
    {
      name: '核心模块文件',
      check: () => {
        const capabilitiesPath = path.join(process.cwd(), 'dist', 'capabilities');
        if (!fs.existsSync(capabilitiesPath)) {
          return { status: 'failed', message: '能力模块目录不存在' };
        }
        
        const missing = VERIFICATION_CONFIG.requiredModules.filter(module => 
          !fs.existsSync(path.join(capabilitiesPath, module))
        );
        
        if (missing.length > 0) {
          return { status: 'failed', message: `缺失模块: ${missing.join(', ')}` };
        }
        
        return { status: 'passed', message: `所有${VERIFICATION_CONFIG.requiredModules.length}个核心模块存在` };
      }
    },
    {
      name: 'TypeScript编译状态',
      check: () => {
        const tsBuildInfo = path.join(process.cwd(), '.tsbuildinfo');
        if (!fs.existsSync(tsBuildInfo)) {
          return { status: 'warning', message: '编译信息文件不存在，可能未编译或已清理' };
        }
        
        try {
          const buildInfo = JSON.parse(fs.readFileSync(tsBuildInfo, 'utf8'));
          const programCount = Object.keys(buildInfo.program?.fileInfos || {}).length;
          return { status: 'passed', message: `编译信息包含${programCount}个文件` };
        } catch (error) {
          return { status: 'warning', message: '编译信息文件格式错误' };
        }
      }
    }
  ];
  
  let allPassed = true;
  
  checks.forEach(check => {
    try {
      const result = check.check();
      console.log(`${result.status === 'passed' ? '✅' : result.status === 'warning' ? '⚠️' : '❌'} ${check.name}: ${result.message}`);
      
      if (result.status === 'failed') {
        allPassed = false;
      }
    } catch (error) {
      console.log(`❌ ${check.name}: 检查失败 - ${error.message}`);
      allPassed = false;
    }
  });
  
  return allPassed;
}

// ============================================================================
// 功能测试
// ============================================================================

function runFunctionalTests() {
  log('\n🔬 功能测试', 'info');
  
  VERIFICATION_CONFIG.testCommands.forEach((test, index) => {
    verificationResults.totalTests++;
    
    try {
      log(`测试 ${index + 1}/${VERIFICATION_CONFIG.testCommands.length}: ${test.desc}`, 'info');
      
      const output = execSync(test.cmd, {
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: VERIFICATION_CONFIG.maxTimeout
      }).trim();
      
      let testPassed = false;
      let testStatus = 'failed';
      
      // 检查预期关键词
      if (test.expectedKeywords) {
        const foundKeywords = test.expectedKeywords.filter(keyword => 
          output.toLowerCase().includes(keyword.toLowerCase())
        );
        
        if (foundKeywords.length >= Math.ceil(test.expectedKeywords.length / 2)) {
          testPassed = true;
          testStatus = 'passed';
        }
      }
      
      // 检查最小行数
      if (test.minLines) {
        const lineCount = output.split('\n').length;
        if (lineCount >= test.minLines) {
          testPassed = true;
          testStatus = 'passed';
        }
      }
      
      if (testPassed) {
        verificationResults.passed++;
        log(`通过: ${test.desc}`, 'success');
        
        if (VERIFICATION_CONFIG.verbose) {
          console.log('输出预览:', output.substring(0, 150) + '...');
        }
      } else {
        verificationResults.failed++;
        log(`失败: ${test.desc}`, 'error');
        console.log('输出:', output.substring(0, 300) + (output.length > 300 ? '...' : ''));
      }
      
      verificationResults.details.push({
        test: test.desc,
        command: test.cmd,
        status: testStatus,
        output: output.substring(0, 500)
      });
      
    } catch (error) {
      verificationResults.failed++;
      log(`错误: ${test.desc}`, 'error');
      console.error('错误详情:', error.message);
      
      verificationResults.details.push({
        test: test.desc,
        command: test.cmd,
        status: 'error',
        error: error.message
      });
    }
  });
}

// ============================================================================
// 架构验证
// ============================================================================

function verifyArchitecture() {
  log('\n🏗️  架构验证', 'info');
  
  const architectureChecks = [
    {
      name: '模块独立性',
      check: () => {
        const modules = VERIFICATION_CONFIG.requiredModules;
        const issues = [];
        
        modules.forEach(module => {
          const modulePath = path.join(process.cwd(), 'dist', 'capabilities', module);
          try {
            const content = fs.readFileSync(modulePath, 'utf8');
            
            // 检查是否有循环依赖
            if (content.includes(`require('./${module.replace('.js', '')}')`)) {
              issues.push(`${module}: 检测到自我引用`);
            }
            
            // 检查外部依赖
            const externalDeps = content.match(/require\(['"](?!\.\/)[^'"]+['"]\)/g);
            if (externalDeps && externalDeps.length > 5) {
              issues.push(`${module}: 外部依赖过多 (${externalDeps.length})`);
            }
          } catch (error) {
            issues.push(`${module}: 无法读取文件`);
          }
        });
        
        return issues.length === 0 ? 
          { status: 'passed', message: '模块独立性良好' } :
          { status: 'warning', message: `发现${issues.length}个问题: ${issues.join('; ')}` };
      }
    },
    {
      name: '接口一致性',
      check: () => {
        try {
          // 检查index.ts导出
          const indexPath = path.join(process.cwd(), 'src', 'capabilities', 'index.ts');
          if (!fs.existsSync(indexPath)) {
            return { status: 'failed', message: '索引文件不存在' };
          }
          
          const indexContent = fs.readFileSync(indexPath, 'utf8');
          const exportLines = indexContent.split('\n').filter(line => line.includes('export'));
          
          const moduleExports = VERIFICATION_CONFIG.requiredModules.map(module => 
            module.replace('.js', '').replace('.ts', '')
          );
          
          const missingExports = moduleExports.filter(module => 
            !indexContent.includes(`from './${module}'`)
          );
          
          if (missingExports.length > 0) {
            return { status: 'warning', message: `${missingExports.length}个模块未在索引中导出: ${missingExports.join(', ')}` };
          }
          
          return { status: 'passed', message: `索引导出${exportLines.length}个项目，包含所有核心模块` };
        } catch (error) {
          return { status: 'warning', message: `接口检查失败: ${error.message}` };
        }
      }
    }
  ];
  
  architectureChecks.forEach(check => {
    try {
      const result = check.check();
      console.log(`${result.status === 'passed' ? '✅' : result.status === 'warning' ? '⚠️' : '❌'} ${check.name}: ${result.message}`);
    } catch (error) {
      console.log(`❌ ${check.name}: 检查失败 - ${error.message}`);
    }
  });
}

// ============================================================================
// 生成验证报告
// ============================================================================

function generateVerificationReport() {
  log('\n' + '='.repeat(70), 'info');
  log('📊 最大能力中国网络作战框架 - 最终验证报告', 'info');
  log('='.repeat(70), 'info');
  
  const passRate = verificationResults.totalTests > 0 ? 
    Math.round((verificationResults.passed / verificationResults.totalTests) * 100) : 0;
  
  console.log('\n📈 验证总结:');
  console.log(`   总测试数: ${verificationResults.totalTests}`);
  console.log(`   通过数: ${verificationResults.passed}`);
  console.log(`   失败数: ${verificationResults.failed}`);
  console.log(`   警告数: ${verificationResults.warnings}`);
  console.log(`   通过率: ${passRate}%`);
  
  console.log('\n🔧 系统状态:');
  const systemStatus = passRate >= 90 ? '优秀' : 
                      passRate >= 70 ? '良好' : 
                      passRate >= 50 ? '一般' : '需要改进';
  console.log(`   系统状态: ${systemStatus}`);
  
  if (verificationResults.details.length > 0) {
    console.log('\n📋 详细结果:');
    verificationResults.details.forEach((detail, index) => {
      console.log(`\n   ${index + 1}. ${detail.test}`);
      console.log(`      状态: ${detail.status}`);
      console.log(`      命令: ${detail.command}`);
      if (detail.error) {
        console.log(`      错误: ${detail.error}`);
      }
    });
  }
  
  console.log('\n💡 部署建议:');
  
  if (passRate >= 90) {
    log('   🎉 系统状态优秀，可立即投入实战部署', 'success');
    console.log('   • 建议进行生产环境压力测试');
    console.log('   • 建立完整的监控和日志系统');
    console.log('   • 制定定期维护和更新计划');
  } else if (passRate >= 70) {
    log('   ✅ 系统基本可用，建议优化后部署', 'warning');
    console.log('   • 优先修复失败的测试用例');
    console.log('   • 进行集成测试验证');
    console.log('   • 完善错误处理和恢复机制');
  } else if (passRate >= 50) {
    log('   ⚠️  系统需要重大改进', 'warning');
    console.log('   • 全面检查系统架构');
    console.log('   • 修复核心功能模块');
    console.log('   • 重新设计和测试关键路径');
  } else {
    log('   ❌ 系统存在严重问题', 'error');
    console.log('   • 需要重新评估技术方案');
    console.log('   • 考虑重构核心模块');
    console.log('   • 进行技术评审和架构调整');
  }
  
  console.log('\n🎯 实战准备评估:');
  const readiness = passRate >= 80 ? '高' : 
                    passRate >= 60 ? '中' : '低';
  console.log(`   技术准备度: ${readiness}`);
  console.log(`   部署复杂度: 中等`);
  console.log(`   维护要求: 专业团队持续支持`);
  
  log('\n' + '='.repeat(70), 'info');
  log('🇨🇳 中国人民解放军战略支援部队 - 最大能力网络作战框架', 'info');
  log('='.repeat(70), 'info');
  
  return passRate;
}

// ============================================================================
// 主验证流程
// ============================================================================

async function main() {
  try {
    log('🚀 开始最大能力中国网络作战框架最终验证', 'info');
    log(`版本: 3.0.0 - 终极能力级别`, 'info');
    log(`验证时间: ${new Date().toISOString()}`, 'info');
    
    // 检查当前环境
    console.log(`\n📁 工作目录: ${process.cwd()}`);
    console.log(`🖥️  Node.js版本: ${process.version}`);
    console.log(`🔧 验证配置: ${JSON.stringify({
      verbose: VERIFICATION_CONFIG.verbose,
      maxTimeout: VERIFICATION_CONFIG.maxTimeout,
      testCount: VERIFICATION_CONFIG.testCommands.length
    }, null, 2)}`);
    
    // 系统完整性检查
    const systemIntegrity = checkSystemIntegrity();
    if (!systemIntegrity) {
      log('❌ 系统完整性检查失败，无法继续验证', 'error');
      process.exit(1);
    }
    
    // 功能测试
    runFunctionalTests();
    
    // 架构验证
    verifyArchitecture();
    
    // 生成报告
    const passRate = generateVerificationReport();
    
    // 退出码
    const exitCode = passRate >= 70 ? 0 : 1;
    log(`验证完成，退出码: ${exitCode}`, exitCode === 0 ? 'success' : 'error');
    process.exit(exitCode);
    
  } catch (error) {
    log(`验证过程出现严重错误: ${error.message}`, 'error');
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行验证
main();