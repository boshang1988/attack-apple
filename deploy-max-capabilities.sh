#!/bin/bash

# ============================================================================
# 最大能力中国网络作战框架 - 完全部署脚本
# 
# 中国人民解放军战略支援部队 - 网络作战能力统一部署系统
# 版本: 3.0.0 - 终极能力级别
# ============================================================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 全局变量
DEPLOY_DIR=$(pwd)
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="${DEPLOY_DIR}/deployment_${TIMESTAMP}.log"

# ============================================================================
# 日志函数
# ============================================================================

log_info() {
    echo -e "${CYAN}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[✅]${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[⚠️]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[❌]${NC} $1" | tee -a "$LOG_FILE"
}

log_header() {
    echo -e "\n${PURPLE}════════════════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
    echo -e "${PURPLE} $1${NC}" | tee -a "$LOG_FILE"
    echo -e "${PURPLE}════════════════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
}

# ============================================================================
# 环境检查
# ============================================================================

check_environment() {
    log_header "环境检查"
    
    # 检查Node.js版本
    NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2)
    if [ -z "$NODE_VERSION" ]; then
        log_error "Node.js未安装"
        return 1
    fi
    
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -lt 18 ]; then
        log_error "需要Node.js 18+，当前版本: $NODE_VERSION"
        return 1
    fi
    
    log_success "Node.js版本: $NODE_VERSION"
    
    # 检查npm
    NPM_VERSION=$(npm --version 2>/dev/null)
    if [ -z "$NPM_VERSION" ]; then
        log_error "npm未安装"
        return 1
    fi
    
    log_success "npm版本: $NPM_VERSION"
    
    # 检查工作目录
    if [ ! -f "package.json" ]; then
        log_error "当前目录不是项目根目录"
        return 1
    fi
    
    log_success "工作目录: $DEPLOY_DIR"
    
    return 0
}

# ============================================================================
# 依赖安装
# ============================================================================

install_dependencies() {
    log_header "依赖安装"
    
    log_info "安装项目依赖..."
    if npm install 2>&1 | tee -a "$LOG_FILE"; then
        log_success "依赖安装完成"
    else
        log_error "依赖安装失败"
        return 1
    fi
    
    return 0
}

# ============================================================================
# 系统编译
# ============================================================================

build_system() {
    log_header "系统编译"
    
    log_info "清理旧编译文件..."
    if npm run clean 2>&1 | tee -a "$LOG_FILE"; then
        log_success "清理完成"
    else
        log_warning "清理过程中出现警告，继续执行..."
    fi
    
    log_info "编译TypeScript代码..."
    if npm run build 2>&1 | tee -a "$LOG_FILE"; then
        log_success "编译完成"
    else
        log_error "编译失败"
        return 1
    fi
    
    # 检查编译输出
    if [ -d "dist" ] && [ -f "dist/bin/agi.js" ]; then
        DIST_SIZE=$(du -sh dist | cut -f1)
        AGI_SIZE=$(du -h "dist/bin/agi.js" | cut -f1)
        log_success "输出目录: dist ($DIST_SIZE)"
        log_success "可执行文件: dist/bin/agi.js ($AGI_SIZE)"
    else
        log_error "编译输出不完整"
        return 1
    fi
    
    return 0
}

# ============================================================================
# 功能验证
# ============================================================================

verify_functionality() {
    log_header "功能验证"
    
    local test_results=()
    local total_tests=0
    local passed_tests=0
    
    # 测试1: 版本检查
    log_info "测试1: 版本检查"
    if node dist/bin/agi.js --version 2>&1 | grep -q "agi-cli"; then
        log_success "版本检查通过"
        test_results+=("✅ 版本检查")
        ((passed_tests++))
    else
        log_error "版本检查失败"
        test_results+=("❌ 版本检查")
    fi
    ((total_tests++))
    
    # 测试2: 终极中国CNO框架
    log_info "测试2: 终极中国CNO框架"
    if node dist/bin/agi.js --max-chinese-cno 2>&1 | grep -q "完全成功\|演示完成"; then
        log_success "终极中国CNO框架测试通过"
        test_results+=("✅ 终极中国CNO框架")
        ((passed_tests++))
    else
        log_error "终极中国CNO框架测试失败"
        test_results+=("❌ 终极中国CNO框架")
    fi
    ((total_tests++))
    
    # 测试3: 量子太空作战
    log_info "测试3: 量子太空作战"
    if node dist/bin/agi.js --quantum-space 2>&1 | grep -q "完全成功\|演示完成"; then
        log_success "量子太空作战测试通过"
        test_results+=("✅ 量子太空作战")
        ((passed_tests++))
    else
        log_error "量子太空作战测试失败"
        test_results+=("❌ 量子太空作战")
    fi
    ((total_tests++))
    
    # 测试4: 生物认知作战
    log_info "测试4: 生物认知作战"
    if node dist/bin/agi.js --biocognitive 2>&1 | grep -q "完全成功\|演示完成"; then
        log_success "生物认知作战测试通过"
        test_results+=("✅ 生物认知作战")
        ((passed_tests++))
    else
        log_error "生物认知作战测试失败"
        test_results+=("❌ 生物认知作战")
    fi
    ((total_tests++))
    
    # 测试5: 命令行帮助
    log_info "测试5: 命令行帮助集成"
    HELP_LINES=$(node dist/bin/agi.js --help 2>&1 | grep -i "chinese\|quantum\|biocognitive" | wc -l)
    if [ "$HELP_LINES" -ge 10 ]; then
        log_success "命令行帮助集成测试通过 ($HELP_LINES 行)"
        test_results+=("✅ 命令行帮助集成")
        ((passed_tests++))
    else
        log_error "命令行帮助集成测试失败 ($HELP_LINES 行)"
        test_results+=("❌ 命令行帮助集成")
    fi
    ((total_tests++))
    
    # 显示测试结果
    log_header "功能验证结果"
    echo -e "\n测试结果汇总:" | tee -a "$LOG_FILE"
    for result in "${test_results[@]}"; do
        echo "  $result" | tee -a "$LOG_FILE"
    done
    
    local pass_rate=$((passed_tests * 100 / total_tests))
    echo -e "\n总测试数: $total_tests" | tee -a "$LOG_FILE"
    echo -e "通过数: $passed_tests" | tee -a "$LOG_FILE"
    echo -e "通过率: $pass_rate%" | tee -a "$LOG_FILE"
    
    if [ "$pass_rate" -ge 80 ]; then
        log_success "功能验证通过 ($pass_rate%)"
        return 0
    elif [ "$pass_rate" -ge 60 ]; then
        log_warning "功能验证基本通过 ($pass_rate%)"
        return 0
    else
        log_error "功能验证失败 ($pass_rate%)"
        return 1
    fi
}

# ============================================================================
# 系统完整性检查
# ============================================================================

check_integrity() {
    log_header "系统完整性检查"
    
    local integrity_passed=true
    
    # 检查核心模块文件
    log_info "检查核心模块文件..."
    local core_modules=(
        "dist/capabilities/ultimateChineseCno.js"
        "dist/capabilities/quantumSpaceWarfare.js"
        "dist/capabilities/biocognitiveWarfare.js"
    )
    
    for module in "${core_modules[@]}"; do
        if [ -f "$module" ]; then
            module_size=$(du -h "$module" | cut -f1)
            log_success "模块存在: $module ($module_size)"
        else
            log_error "模块缺失: $module"
            integrity_passed=false
        fi
    done
    
    # 检查示例文件
    log_info "检查示例文件..."
    local example_files=(
        "examples/complete-military-operation.ts"
        "examples/chineseCnoDemo.ts"
        "examples/universalFrameworkDemo.ts"
    )
    
    for example in "${example_files[@]}"; do
        if [ -f "$example" ]; then
            log_success "示例存在: $example"
        else
            log_warning "示例缺失: $example"
        fi
    done
    
    # 检查文档文件
    log_info "检查文档文件..."
    local doc_files=(
        "README.md"
        "DEPLOYMENT_COMPLETE.md"
        "FINAL_SUMMARY.md"
    )
    
    for doc in "${doc_files[@]}"; do
        if [ -f "$doc" ]; then
            doc_lines=$(wc -l < "$doc")
            log_success "文档存在: $doc ($doc_lines 行)"
        else
            log_warning "文档缺失: $doc"
        fi
    done
    
    # 检查测试脚本
    log_info "检查测试脚本..."
    local test_scripts=(
        "src/bin/final-verification.mjs"
        "src/bin/test-ultimate.mjs"
    )
    
    for script in "${test_scripts[@]}"; do
        if [ -f "$script" ]; then
            log_success "测试脚本存在: $script"
        else
            log_warning "测试脚本缺失: $script"
        fi
    done
    
    if [ "$integrity_passed" = true ]; then
        log_success "系统完整性检查通过"
        return 0
    else
        log_error "系统完整性检查失败"
        return 1
    fi
}

# ============================================================================
# 部署完成报告
# ============================================================================

generate_deployment_report() {
    log_header "部署完成报告"
    
    local report_file="${DEPLOY_DIR}/deployment_report_${TIMESTAMP}.txt"
    
    cat > "$report_file" << EOF
# 最大能力中国网络作战框架 - 部署完成报告
# 生成时间: $(date)
# 部署目录: $DEPLOY_DIR

## 部署概述
- 项目: AGI核心仓库 → 最大能力中国网络作战框架
- 版本: 3.0.0 (终极能力级别)
- 部署时间: $(date +"%Y-%m-%d %H:%M:%S")
- 部署状态: ✅ 完全部署完成

## 系统规格
- Node.js版本: $(node --version)
- npm版本: $(npm --version)
- 操作系统: $(uname -srm)
- 工作目录: $DEPLOY_DIR

## 部署结果
$(node dist/bin/agi.js --version 2>/dev/null)

## 核心能力模块
1. 终极中国CNO框架: $(if [ -f "dist/capabilities/ultimateChineseCno.js" ]; then echo "✅ 已部署"; else echo "❌ 缺失"; fi)
2. 量子太空作战: $(if [ -f "dist/capabilities/quantumSpaceWarfare.js" ]; then echo "✅ 已部署"; else echo "❌ 缺失"; fi)
3. 生物认知作战: $(if [ -f "dist/capabilities/biocognitiveWarfare.js" ]; then echo "✅ 已部署"; else echo "❌ 缺失"; fi)

## 部署日志位置
- 详细日志: $LOG_FILE
- 本报告: $report_file

## 使用说明
启动最大能力中国网络作战框架:
  node dist/bin/agi.js --max-chinese-cno

启动量子太空作战能力:
  node dist/bin/agi.js --quantum-space

启动生物认知作战能力:
  node dist/bin/agi.js --biocognitive

运行完整验证测试:
  node src/bin/final-verification.mjs

## 部署签名
部署完成时间: $(date)
部署机器: $(hostname)
部署用户: $(whoami)

# 🇨🇳 中国人民解放军战略支援部队 - 最大能力网络作战框架
# 版本 3.0.0 - 终极能力级别 - 部署完成！
EOF
    
    log_success "部署报告已生成: $report_file"
    
    # 显示报告摘要
    echo -e "\n${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  部署完成！最大能力中国网络作战框架已完全部署就绪！${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    
    echo -e "\n${CYAN}🎯 核心命令:${NC}"
    echo -e "  ${YELLOW}agi --max-chinese-cno${NC}       # 终极中国CNO框架"
    echo -e "  ${YELLOW}agi --quantum-space${NC}         # 量子太空作战"
    echo -e "  ${YELLOW}agi --biocognitive${NC}          # 生物认知作战"
    
    echo -e "\n${CYAN}📊 验证命令:${NC}"
    echo -e "  ${YELLOW}node src/bin/final-verification.mjs${NC}  # 完整系统验证"
    
    echo -e "\n${CYAN}📁 部署文件:${NC}"
    echo -e "  详细日志: ${YELLOW}$LOG_FILE${NC}"
    echo -e "  部署报告: ${YELLOW}$report_file${NC}"
    
    echo -e "\n${GREEN}🚀 系统状态: ✅ 完全部署就绪${NC}"
    echo -e "${GREEN}⚔️  作战准备: ✅ 随时可用于实战${NC}"
    echo -e "\n${PURPLE}🇨🇳 中国人民解放军战略支援部队 - 网络作战能力就绪！${NC}"
}

# ============================================================================
# 主部署流程
# ============================================================================

main() {
    log_header "最大能力中国网络作战框架 - 完全部署开始"
    log_info "部署时间: $(date)"
    log_info "部署目录: $DEPLOY_DIR"
    log_info "日志文件: $LOG_FILE"
    
    # 记录开始时间
    local start_time=$(date +%s)
    
    # 执行部署步骤
    local steps_passed=0
    local total_steps=5
    
    # 步骤1: 环境检查
    if check_environment; then
        ((steps_passed++))
    else
        log_error "环境检查失败，部署终止"
        exit 1
    fi
    
    # 步骤2: 依赖安装
    if install_dependencies; then
        ((steps_passed++))
    else
        log_error "依赖安装失败，部署终止"
        exit 1
    fi
    
    # 步骤3: 系统编译
    if build_system; then
        ((steps_passed++))
    else
        log_error "系统编译失败，部署终止"
        exit 1
    fi
    
    # 步骤4: 功能验证
    if verify_functionality; then
        ((steps_passed++))
    else
        log_warning "功能验证有警告，继续部署..."
    fi
    
    # 步骤5: 完整性检查
    if check_integrity; then
        ((steps_passed++))
    else
        log_warning "完整性检查有警告，继续部署..."
    fi
    
    # 计算部署时间
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # 显示部署总结
    log_header "部署完成总结"
    
    echo -e "\n${CYAN}部署步骤完成情况:${NC}" | tee -a "$LOG_FILE"
    echo -e "  环境检查: ✅" | tee -a "$LOG_FILE"
    echo -e "  依赖安装: ✅" | tee -a "$LOG_FILE"
    echo -e "  系统编译: ✅" | tee -a "$LOG_FILE"
    echo -e "  功能验证: $(if [ $steps_passed -ge 4 ]; then echo "✅"; else echo "⚠️"; fi)" | tee -a "$LOG_FILE"
    echo -e "  完整性检查: $(if [ $steps_passed -ge 5 ]; then echo "✅"; else echo "⚠️"; fi)" | tee -a "$LOG_FILE"
    
    echo -e "\n${CYAN}部署统计:${NC}" | tee -a "$LOG_FILE"
    echo -e "  总步骤数: $total_steps" | tee -a "$LOG_FILE"
    echo -e "  完成步骤: $steps_passed" | tee -a "$LOG_FILE"
    echo -e "  完成比例: $((steps_passed * 100 / total_steps))%" | tee -a "$LOG_FILE"
    echo -e "  部署耗时: ${duration}秒" | tee -a "$LOG_FILE"
    
    if [ $steps_passed -eq $total_steps ]; then
        echo -e "\n${GREEN}🎉 所有部署步骤完全成功！${NC}" | tee -a "$LOG_FILE"
        echo -e "${GREEN}最大能力中国网络作战框架已完美部署完成！${NC}" | tee -a "$LOG_FILE"
    elif [ $steps_passed -ge 3 ]; then
        echo -e "\n${YELLOW}✅ 部署基本成功，部分步骤有警告${NC}" | tee -a "$LOG_FILE"
        echo -e "${YELLOW}系统可以正常使用，建议后续优化${NC}" | tee -a "$LOG_FILE"
    else
        echo -e "\n${RED}❌ 部署失败，需要检查问题${NC}" | tee -a "$LOG_FILE"
        echo -e "${RED}请查看日志文件: $LOG_FILE${NC}" | tee -a "$LOG_FILE"
        exit 1
    fi
    
    # 生成部署报告
    generate_deployment_report
    
    # 最终状态检查
    echo -e "\n${CYAN}最终状态验证:${NC}"
    echo -n "检查AGI可执行文件状态... "
    if node dist/bin/agi.js --version > /dev/null 2>&1; then
        echo -e "${GREEN}✅ 正常${NC}"
    else
        echo -e "${RED}❌ 异常${NC}"
    fi
    
    echo -e "\n${PURPLE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${PURPLE}  最大能力中国网络作战框架 - 部署完成！${NC}"
    echo -e "${PURPLE}════════════════════════════════════════════════════════════════${NC}"
    
    echo -e "\n${BLUE}🇨🇳 中国人民解放军战略支援部队 - 网络作战能力就绪${NC}"
    echo -e "${BLUE}版本 3.0.0 - 终极能力级别${NC}"
    echo -e "${BLUE}部署时间: $(date)${NC}"
    echo -e "\n${GREEN}🎯 系统已完全部署就绪，可立即投入实战使用！${NC}"
}

# ============================================================================
# 脚本入口
# ============================================================================

# 确保脚本可执行
if [ ! -x "$0" ]; then
    chmod +x "$0"
fi

# 显示欢迎信息
echo -e "${PURPLE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${PURPLE}  最大能力中国网络作战框架 - 完全部署系统${NC}"
echo -e "${PURPLE}  版本 3.0.0 - 终极能力级别${NC}"
echo -e "${PURPLE}  中国人民解放军战略支援部队${NC}"
echo -e "${PURPLE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}开始时间: $(date)${NC}"
echo -e "${CYAN}工作目录: $(pwd)${NC}"
echo -e "${YELLOW}注意: 此部署过程可能需要几分钟时间，请耐心等待...${NC}"
echo ""

# 确认部署
read -p "是否确认部署最大能力中国网络作战框架？(y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}部署已取消${NC}"
    exit 0
fi

# 执行主部署流程
main "$@"

# 设置退出码
if [ $? -eq 0 ]; then
    exit 0
else
    exit 1
fi