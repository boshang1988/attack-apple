#!/usr/bin/env node

/**
 * 终极中国CNO框架完整测试脚本
 * 验证所有最大能力模块的完整功能和集成状态
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ============================================================================
// 获取当前目录
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// 测试配置
// ============================================================================

const TEST_CONFIG = {
  verbose: true,
  timeout: 10000, // 每个测试超时时间（毫秒）
  continueOnFailure: true,
  testModules: [
    'max-chinese-cno',
    'quantum-space',
    'biocognitive'
  ]
};

// ============================================================================
// 测试结果追踪
// ============================================================================

const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  details: []
};

// ============================================================================
// 测试辅助函数
// ============================================================================

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m', // 青色
    success: '\x1b[32m', // 绿色
    warning: '\x1b[33m', // 黄色
    error: '\x1b[31m', // 红色
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

function runCommand(cmd, description) {
  testResults.total++;
  
  try {
    log(`运行测试: ${description}`, 'info');
    
    const output = execSync(cmd, {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: TEST_CONFIG.timeout
    });
    
    // 检查输出是否包含成功指示
    const successIndicators = [
      '成功', 'success', '完成', '✅', '初始化完成', '演示完成'
    ];
    
    const hasSuccess = successIndicators.some(indicator => 
      output.toLowerCase().includes(indicator.toLowerCase())
    );
    
    if (hasSuccess) {
      testResults.passed++;
      log(`测试通过: ${description}`, 'success');
      
      if (TEST_CONFIG.verbose) {
        console.log('输出摘要:', output.substring(0, 200) + '...');
      }
      
      return { success: true, output };
    } else {
      testResults.failed++;
      log(`测试输出未包含成功指示: ${description}`, 'warning');
      
      testResults.details.push({
        test: description,
        status: 'ambiguous',
        output: output.substring(0, 500)
      });
      
      return { success: false, output, reason: '缺少成功指示' };
    }
    
  } catch (error) {
    testResults.failed++;
    log(`测试失败: ${description}`, 'error');
    console.error('错误详情:', error.message);
    
    testResults.details.push({
      test: description,
      status: 'failed',
      error: error.message,
      stderr: error.stderr?.toString() || ''
    });
    
    return { success: false, error: error.message };
  }
}

// ============================================================================
// 模块测试函数
// ============================================================================

function testMaxChineseCno() {
  log('\n🔬 测试模块: 终极中国CNO框架', 'info');
  
  const tests = [
    {
      cmd: 'node dist/bin/agi.js --max-chinese-cno',
      desc: '终极框架基础演示'
    },
    {
      cmd: 'node dist/bin/agi.js --max-chinese-cno --strategic-targets',
      desc: '战略目标评估演示'
    },
    {
      cmd: 'node dist/bin/agi.js --max-chinese-cno --control-system --system=US-F35-LIGHTNING-II --command=status',
      desc: '军事系统控制演示'
    }
  ];
  
  tests.forEach(test => {
    runCommand(test.cmd, test.desc);
  });
}

function testQuantumSpaceWarfare() {
  log('\n🌌 测试模块: 量子计算与太空作战', 'info');
  
  const tests = [
    {
      cmd: 'node dist/bin/agi.js --quantum-space',
      desc: '量子太空作战完整演示'
    },
    {
      cmd: 'node dist/bin/agi.js --quantum-attack --target=RSA-2048',
      desc: '量子密码攻击演示'
    },
    {
      cmd: 'node dist/bin/agi.js --satellite-attack --target=GPS',
      desc: '卫星系统攻击演示'
    }
  ];
  
  tests.forEach(test => {
    runCommand(test.cmd, test.desc);
  });
}

function testBiocognitiveWarfare() {
  log('\n🧠 测试模块: 生物信息战与认知战', 'info');
  
  const tests = [
    {
      cmd: 'node dist/bin/agi.js --biocognitive',
      desc: '生物认知作战完整演示'
    },
    {
      cmd: 'node dist/bin/agi.js --biometric-analysis --type=facial',
      desc: '生物特征分析演示'
    },
    {
      cmd: 'node dist/bin/agi.js --cognitive-operation --target=POL-001',
      desc: '认知作战执行演示'
    }
  ];
  
  tests.forEach(test => {
    runCommand(test.cmd, test.desc);
  });
}

function testIntegration() {
  log('\n🔗 测试模块: 系统集成状态', 'info');
  
  const tests = [
    {
      cmd: 'node dist/bin/agi.js --version',
      desc: '系统版本验证'
    },
    {
      cmd: 'node dist/bin/agi.js --help | grep -i "chinese\\|quantum\\|biocognitive" | head -5',
      desc: '命令行帮助集成验证'
    }
  ];
  
  tests.forEach(test => {
    runCommand(test.cmd, test.desc);
  });
}

// ============================================================================
// 系统健康检查
// ============================================================================

function checkSystemHealth() {
  log('\n🩺 系统健康检查', 'info');
  
  const checks = [
    {
      name: 'Node.js版本',
      check: () => {
        const version = process.version;
        const major = parseInt(version.replace('v', '').split('.')[0]);
        return major >= 18 ? '✅' : `⚠️ 需要Node.js 18+, 当前: ${version}`;
      }
    },
    {
      name: '编译输出目录',
      check: () => {
        const distPath = path.join(__dirname, '..', 'dist');
        if (fs.existsSync(distPath)) {
          const files = fs.readdirSync(distPath);
          return files.length > 0 ? `✅ 找到${files.length}个文件` : '❌ 目录为空';
        }
        return '❌ 目录不存在';
      }
    },
    {
      name: 'AGI可执行文件',
      check: () => {
        const agiPath = path.join(__dirname, '..', 'dist', 'bin', 'agi.js');
        if (fs.existsSync(agiPath)) {
          const stats = fs.statSync(agiPath);
          return stats.size > 1000 ? `✅ 文件大小: ${Math.round(stats.size/1024)}KB` : '⚠️ 文件大小异常';
        }
        return '❌ 文件不存在';
      }
    },
    {
      name: '能力模块文件',
      check: () => {
        const capabilitiesPath = path.join(__dirname, '..', 'dist', 'capabilities');
        const requiredModules = [
          'ultimateChineseCno.js',
          'quantumSpaceWarfare.js', 
          'biocognitiveWarfare.js'
        ];
        
        if (!fs.existsSync(capabilitiesPath)) {
          return '❌ 能力模块目录不存在';
        }
        
        const missing = requiredModules.filter(module => 
          !fs.existsSync(path.join(capabilitiesPath, module))
        );
        
        return missing.length === 0 ? 
          `✅ 所有${requiredModules.length}个必需模块存在` :
          `❌ 缺失模块: ${missing.join(', ')}`;
      }
    }
  ];
  
  checks.forEach(check => {
    try {
      const result = check.check();
      console.log(`${result} ${check.name}`);
    } catch (error) {
      console.log(`❌ ${check.name}: ${error.message}`);
    }
  });
}

// ============================================================================
// 测试结果报告
// ============================================================================

function generateReport() {
  log('\n' + '='.repeat(60), 'info');
  log('📊 终极中国CNO框架测试报告', 'info');
  log('='.repeat(60), 'info');
  
  console.log(`\n测试总结:`);
  console.log(`  总测试数: ${testResults.total}`);
  console.log(`  通过数: ${testResults.passed}`);
  console.log(`  失败数: ${testResults.failed}`);
  
  const passRate = testResults.total > 0 ? 
    Math.round((testResults.passed / testResults.total) * 100) : 0;
  
  console.log(`  通过率: ${passRate}%`);
  
  if (testResults.failed === 0 && testResults.total > 0) {
    log('\n🎉 所有测试通过! 系统运行正常。', 'success');
  } else if (passRate >= 80) {
    log('\n✅ 系统基本正常，部分测试需要优化。', 'warning');
  } else {
    log('\n⚠️  系统存在较多问题，需要修复。', 'error');
  }
  
  if (testResults.details.length > 0) {
    console.log('\n详细结果:');
    testResults.details.forEach((detail, index) => {
      console.log(`\n${index + 1}. ${detail.test}`);
      console.log(`   状态: ${detail.status}`);
      if (detail.error) console.log(`   错误: ${detail.error}`);
      if (detail.output) console.log(`   输出: ${detail.output.substring(0, 100)}...`);
    });
  }
  
  // 系统建议
  console.log('\n💡 系统建议:');
  if (passRate === 100) {
    console.log('  • 系统状态优秀，可立即投入实战使用');
    console.log('  • 建议进行压力测试和实战演练');
    console.log('  • 保持定期维护和更新');
  } else if (passRate >= 80) {
    console.log('  • 系统基本可用，建议修复失败测试');
    console.log('  • 检查模块依赖和初始化流程');
    console.log('  • 进行集成测试验证');
  } else {
    console.log('  • 系统需要全面检查和修复');
    console.log('  • 优先修复核心模块测试');
    console.log('  • 重新编译并验证模块完整性');
  }
  
  log('\n' + '='.repeat(60), 'info');
  log('中国人民解放军战略支援部队 - 网络作战能力测试', 'info');
  log('='.repeat(60), 'info');
}

// ============================================================================
// 主测试流程
// ============================================================================

async function main() {
  try {
    log('🚀 开始终极中国CNO框架测试', 'info');
    log(`测试配置: ${JSON.stringify(TEST_CONFIG, null, 2)}`, 'info');
    
    // 检查当前目录
    const currentDir = process.cwd();
    log(`当前工作目录: ${currentDir}`, 'info');
    
    // 系统健康检查
    checkSystemHealth();
    
    // 执行模块测试
    if (TEST_CONFIG.testModules.includes('max-chinese-cno')) {
      testMaxChineseCno();
    }
    
    if (TEST_CONFIG.testModules.includes('quantum-space')) {
      testQuantumSpaceWarfare();
    }
    
    if (TEST_CONFIG.testModules.includes('biocognitive')) {
      testBiocognitiveWarfare();
    }
    
    // 集成测试
    testIntegration();
    
    // 生成报告
    generateReport();
    
    // 退出码
    const exitCode = testResults.failed === 0 ? 0 : 1;
    process.exit(exitCode);
    
  } catch (error) {
    log(`测试过程出现严重错误: ${error.message}`, 'error');
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行主测试
main();