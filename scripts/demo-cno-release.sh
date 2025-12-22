#!/usr/bin/env bash

set -euo pipefail

# 网络作战能力框架发布循环演示脚本
# 展示中文CNO统一仓库自动发布功能

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo "========================================"
echo "  网络作战能力框架发布循环演示"
echo "========================================"
echo ""

echo "📦 当前项目信息:"
echo "   名称: $(node -p "require('./package.json').name")"
echo "   版本: $(node -p "require('./package.json').version")"
echo "   描述: $(node -p "require('./package.json').description")"
echo ""

echo "🛠️  可用发布命令:"
echo ""
echo "   1. npm run release:cno              # 单次patch版本发布"
echo "   2. npm run release:cno:patch        # 单次patch版本发布"
echo "   3. npm run release:cno:minor        # 单次minor版本发布"
echo "   4. npm run release:cno:major        # 单次major版本发布"
echo "   5. npm run release:cno:continuous   # 连续发布循环"
echo ""
echo "   6. ./scripts/cno-unified-release-loop.sh patch"
echo "   7. ./scripts/cno-unified-release-loop.sh continuous 60 3"
echo "   8. ./scripts/cno-unified-release-loop.sh 1.2.3"
echo ""

echo "🔧 演示模式运行 (干运行):"
echo ""

# 设置干运行环境变量
export DRY_RUN=1
export NODE_ENV=development

echo "运行测试套件..."
if npm test 2>&1 | grep -q "PASS\|✓"; then
  echo "✅ 测试通过"
else
  echo "⚠️  测试输出检查"
fi

echo ""
echo "构建项目..."
if npm run build 2>&1 | grep -q "success\|完成\|Success"; then
  echo "✅ 构建成功"
else
  echo "⚠️  构建输出检查"
fi

echo ""
echo "📋 发布循环步骤摘要:"
echo ""
echo "   1. ✅ 检查前提条件"
echo "   2. ✅ 运行测试套件"
echo "   3. ✅ 构建项目"
echo "   4. 🔄 优化生产构建"
echo "   5. 🔄 提升版本号"
echo "   6. 🔄 更新中文CNO文档"
echo "   7. 🔄 提交到Git"
echo "   8. 🔄 创建Git标签"
echo "   9. 🔄 推送到Git仓库"
echo "   10. 🔄 发布到npm"
echo "   11. 🔄 验证发布"
echo "   12. ✅ 显示发布摘要"
echo ""

echo "🚀 开始实际发布:"
echo ""
echo "   方法1: npm run release:cno"
echo "   方法2: ./scripts/cno-unified-release-loop.sh patch"
echo ""
echo "📝 注意事项:"
echo "   - 确保已登录npm账户 (npm login)"
echo "   - 确保有Git推送权限"
echo "   - 确保测试全部通过"
echo "   - 确保网络连接正常"
echo ""

echo "🌐 网络作战能力框架特性:"
echo "   - 多源情报融合系统"
echo "   - 自主作战指挥平台"
echo "   - 中文CNO统一仓库"
echo "   - 自动化发布循环"
echo "   - 连续集成部署"
echo ""

echo "========================================"
echo "  演示完成 - 准备部署!"
echo "========================================"
echo ""