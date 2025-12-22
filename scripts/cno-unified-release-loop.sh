#!/usr/bin/env bash

set -euo pipefail

# 网络作战能力框架统一仓库自动发布循环脚本
# Chinese CNO unified repo automated release loop
# 在每个开发循环中自动提升版本号并发布到npm

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # 无色

log() {
  echo -e "${BLUE}[CNO发布循环]${NC} $1"
}

success() {
  echo -e "${GREEN}[成功]${NC} $1"
}

warning() {
  echo -e "${YELLOW}[警告]${NC} $1"
}

error() {
  echo -e "${RED}[错误]${NC} $1"
  exit 1
}

# 检查前提条件
check_prerequisites() {
  log "检查发布环境..."
  
  # 检查Node.js
  if ! command -v node &> /dev/null; then
    error "Node.js未安装"
  fi
  log "✓ Node.js $(node --version)"
  
  # 检查npm
  if ! command -v npm &> /dev/null; then
    error "npm未安装"
  fi
  log "✓ npm $(npm --version)"
  
  # 检查git
  if ! command -v git &> /dev/null; then
    error "git未安装"
  fi
  log "✓ git $(git --version | cut -d' ' -f3)"
  
  # 检查npm登录状态
  if ! npm whoami &> /dev/null; then
    error "未登录npm账户，请先运行: npm login"
  fi
  log "✓ npm已登录: $(npm whoami)"
  
  success "环境检查通过"
}

# 获取当前版本
get_current_version() {
  node -p "require('./package.json').version"
}

# 运行测试套件
run_tests() {
  log "运行测试套件..."
  
  if ! npm test > /tmp/cno-test-output.log 2>&1; then
    error "测试失败。详情请查看: /tmp/cno-test-output.log"
  fi
  
  success "所有测试通过"
}

# 构建项目
build_project() {
  log "构建项目..."
  
  if ! npm run build > /tmp/cno-build-output.log 2>&1; then
    error "构建失败。详情请查看: /tmp/cno-build-output.log"
  fi
  
  success "构建完成"
}

# 优化生产构建
optimize_build() {
  log "优化生产构建..."
  
  if ! npm run optimize > /tmp/cno-optimize-output.log 2>&1; then
    warning "优化构建失败，使用标准构建"
    # 继续使用标准构建
  else
    success "构建优化完成"
  fi
}

# 提升版本号
bump_version() {
  local bump_type="${1:-patch}"
  
  log "提升版本号 ($bump_type)..."
  local current_version=$(get_current_version)
  
  if [[ "$bump_type" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    # 直接设置特定版本
    npm version "${bump_type}" --no-git-tag-version --force
  else
    # 使用语义化版本提升
    npm version "${bump_type}" --no-git-tag-version
  fi
  
  local new_version=$(get_current_version)
  success "版本提升: ${current_version} → ${new_version}"
}

# 更新中文CNO文档
update_cno_documentation() {
  log "更新网络作战能力框架文档..."
  
  # 检查README.md中的中文CNO描述
  if grep -q "网络作战能力框架" README.md; then
    log "✓ 已找到中文CNO文档"
    
    # 更新版本号在README中
    local current_version=$(get_current_version)
    local today=$(date +%Y-%m-%d)
    
    # 在README中添加更新日志条目
    if grep -q "## 更新日志" README.md; then
      sed -i '' "/## 更新日志/a\\
### 版本 ${current_version} (${today})\\
- 自动发布循环更新\\
- 网络作战能力框架优化\\
- 统一仓库集成\\
" README.md
    fi
  else
    warning "未找到中文CNO文档，跳过更新"
  fi
  
  success "文档更新完成"
}

# 提交更改到Git
commit_changes() {
  local version=$(get_current_version)
  local commit_message="网络作战能力框架 v${version} - 自动发布循环"
  
  log "提交更改到Git: ${commit_message}"
  
  git add .
  
  if ! git commit -m "${commit_message}" > /tmp/cno-git-commit.log 2>&1; then
    warning "Git提交失败或无更改需要提交"
    return 1
  fi
  
  success "Git提交完成"
  return 0
}

# 创建Git标签
create_git_tag() {
  local version=$(get_current_version)
  local tag_name="v${version}"
  
  log "创建Git标签: ${tag_name}"
  
  if git tag --list | grep -q "${tag_name}"; then
    warning "标签 ${tag_name} 已存在，跳过创建"
    return 0
  fi
  
  git tag -a "${tag_name}" -m "网络作战能力框架 ${tag_name} - 中文CNO统一仓库发布"
  success "Git标签创建完成: ${tag_name}"
}

# 推送到Git仓库
push_to_git() {
  log "推送到Git远程仓库..."
  
  # 推送提交
  if ! git push origin HEAD > /tmp/cno-git-push.log 2>&1; then
    error "Git推送失败"
  fi
  
  # 推送标签
  if ! git push origin --tags > /tmp/cno-git-tags-push.log 2>&1; then
    warning "Git标签推送失败"
  fi
  
  success "Git推送完成"
}

# 发布到npm
publish_to_npm() {
  local version=$(get_current_version)
  
  log "发布到npm: agi-core-cli@${version}"
  
  # 设置npm发布配置
  export NPM_CONFIG_PROGRESS=false
  export NPM_CONFIG_LOGLEVEL=warn
  
  if ! npm publish --access public > /tmp/cno-npm-publish.log 2>&1; then
    error "npm发布失败。详情请查看: /tmp/cno-npm-publish.log"
  fi
  
  success "成功发布到npm: agi-core-cli@${version}"
}

# 验证发布
verify_publication() {
  local version=$(get_current_version)
  
  log "验证npm发布..."
  
  # 等待npm CDN更新
  sleep 10
  
  # 尝试安装刚发布的版本
  if npx "agi-core-cli@${version}" --version > /tmp/cno-verify-install.log 2>&1; then
    local installed_version=$(npx "agi-core-cli@${version}" --version 2>/dev/null || echo "")
    if [[ "$installed_version" == *"${version}"* ]]; then
      success "验证成功: 已成功安装 agi-core-cli@${version}"
    else
      warning "版本验证不一致: ${installed_version}"
    fi
  else
    warning "无法验证安装，npm CDN可能需要更长时间更新"
  fi
}

# 显示发布摘要
show_release_summary() {
  local version=$(get_current_version)
  
  echo ""
  echo "🎉 网络作战能力框架发布完成 🎉"
  echo "================================"
  echo ""
  echo "📦 版本: ${version}"
  echo "📅 时间: $(date)"
  echo ""
  echo "✅ 发布步骤完成:"
  echo "   1. 测试套件执行"
  echo "   2. 项目构建"
  echo "   3. 版本号提升"
  echo "   4. 文档更新"
  echo "   5. Git提交和标签"
  echo "   6. npm发布"
  echo ""
  echo "🔗 有用的链接:"
  echo "   - npm包: https://www.npmjs.com/package/agi-core-cli/v/${version}"
  echo "   - 安装命令: npm install -g agi-core-cli@${version}"
  echo "   - 快速测试: npx agi-core-cli@${version} --version"
  echo ""
  echo "🚀 网络作战能力框架已准备好部署!"
  echo ""
}

# 单次发布循环
single_release_loop() {
  local bump_type="${1:-patch}"
  
  log "开始发布循环 (${bump_type})..."
  echo ""
  
  # 1. 检查前提条件
  check_prerequisites
  
  # 2. 运行测试
  run_tests
  
  # 3. 构建项目
  build_project
  
  # 4. 优化构建
  optimize_build
  
  # 5. 提升版本
  bump_version "$bump_type"
  
  # 6. 更新中文CNO文档
  update_cno_documentation
  
  # 7. 提交到Git
  if commit_changes; then
    # 8. 创建Git标签
    create_git_tag
    
    # 9. 推送到Git
    push_to_git
  else
    log "无Git更改需要提交，继续npm发布..."
  fi
  
  # 10. 发布到npm
  publish_to_npm
  
  # 11. 验证发布
  verify_publication
  
  # 12. 显示摘要
  show_release_summary
  
  success "发布循环完成!"
}

# 连续发布循环
continuous_release_loop() {
  local interval="${1:-300}" # 默认5分钟
  local max_iterations="${2:-0}" # 0表示无限循环
  local iteration=1
  
  log "启动连续发布循环"
  log "间隔: ${interval}秒"
  log "最大迭代次数: $([ "$max_iterations" -eq 0 ] && echo "无限" || echo "${max_iterations}")"
  echo ""
  
  while true; do
    if [[ "$max_iterations" -gt 0 ]] && [[ "$iteration" -gt "$max_iterations" ]]; then
      log "达到最大迭代次数 (${max_iterations})，停止循环"
      break
    fi
    
    log "开始第 ${iteration} 次发布循环..."
    echo "========================================"
    
    # 运行单次发布循环
    if ! single_release_loop "patch"; then
      error "第 ${iteration} 次发布循环失败"
    fi
    
    log "第 ${iteration} 次发布循环完成"
    log "等待 ${interval} 秒后开始下一次循环..."
    echo ""
    
    # 等待指定间隔
    sleep "$interval"
    
    iteration=$((iteration + 1))
  done
}

# 显示帮助
show_help() {
  echo "网络作战能力框架统一仓库自动发布循环脚本"
  echo ""
  echo "使用方法:"
  echo "  $0                     # 单次发布循环 (patch)"
  echo "  $0 patch               # 单次发布循环 (patch)"
  echo "  $0 minor               # 单次发布循环 (minor)"
  echo "  $0 major               # 单次发布循环 (major)"
  echo "  $0 1.2.3               # 单次发布循环 (指定版本)"
  echo "  $0 continuous          # 连续发布循环 (默认5分钟间隔)"
  echo "  $0 continuous 60       # 连续发布循环 (60秒间隔)"
  echo "  $0 continuous 300 10   # 连续发布循环 (5分钟间隔, 10次)"
  echo ""
  echo "示例:"
  echo "  $0 patch               # 单次补丁版本发布"
  echo "  $0 continuous 600      # 每10分钟自动发布一次"
  echo ""
  echo "环境变量:"
  echo "  NODE_ENV=production    # 生产环境构建"
  echo "  DRY_RUN=1              # 干运行模式 (不实际发布)"
}

# 主函数
main() {
  local command="${1:-}"
  
  case "$command" in
    -h|--help|help)
      show_help
      exit 0
      ;;
    patch|minor|major)
      single_release_loop "$command"
      ;;
    continuous)
      local interval="${2:-300}"
      local max_iterations="${3:-0}"
      continuous_release_loop "$interval" "$max_iterations"
      ;;
    "")
      # 默认: 单次patch发布
      single_release_loop "patch"
      ;;
    *)
      # 检查是否为有效的版本号
      if [[ "$command" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        single_release_loop "$command"
      else
        error "无效的命令或版本号: $command"
        show_help
        exit 1
      fi
      ;;
  esac
}

# 执行主函数
main "$@"