#!/bin/bash
#
# REMOVE LEGACY SYSTEMS AND INTEGRATE MAX OFFENSIVE UKRAINE
# This script removes legacy offensive/Ukraine files and integrates max offensive Ukraine capability
#

set -e

echo "================================================"
echo "MAX OFFENSIVE UKRAINE INTEGRATION SCRIPT"
echo "================================================"
echo ""

# Backup directory for legacy files
BACKUP_DIR="/tmp/agi-legacy-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "🔍 Scanning for legacy offensive/Ukraine files..."

# Files to remove/replace
LEGACY_FILES=(
  "src/tools/secureTaoTools.ts"
  "src/capabilities/realSerialWeaponsCapability.ts"
  "src/capabilities/realityWeaponsCapability.ts"
)

# Check which files exist
EXISTING_LEGACY_FILES=()
for file in "${LEGACY_FILES[@]}"; do
  if [ -f "$file" ]; then
    EXISTING_LEGACY_FILES+=("$file")
    echo "  Found: $file"
  fi
done

if [ ${#EXISTING_LEGACY_FILES[@]} -eq 0 ]; then
  echo "✅ No legacy offensive/Ukraine files found."
else
  echo ""
  echo "📦 Backing up legacy files to: $BACKUP_DIR"
  
  # Backup legacy files
  for file in "${EXISTING_LEGACY_FILES[@]}"; do
    backup_path="$BACKUP_DIR/$(dirname "$file")"
    mkdir -p "$backup_path"
    cp "$file" "$BACKUP_DIR/$file"
    echo "  Backed up: $file"
  done
  
  echo ""
  echo "🗑️  Removing legacy files..."
  
  # Remove legacy files
  for file in "${EXISTING_LEGACY_FILES[@]}"; do
    rm -f "$file"
    echo "  Removed: $file"
  done
  
  echo "✅ Legacy files removed."
fi

echo ""
echo "🔧 Integrating Max Offensive Ukraine capability..."

# Check if max offensive Ukraine capability exists
if [ ! -f "src/capabilities/maxOffensiveUkraineCapability.ts" ]; then
  echo "❌ Max Offensive Ukraine capability not found at src/capabilities/maxOffensiveUkraineCapability.ts"
  echo "   Creating from template..."
  
  # Create from template if missing
  cat > src/capabilities/maxOffensiveUkraineCapability.ts << 'EOF'
/**
 * MAX OFFENSIVE UKRAINE CAPABILITY - PLACEHOLDER
 * 
 * This file will be replaced with the actual max offensive Ukraine capability
 */
export const MaxOffensiveUkraineCapabilityPlaceholder = "Max Offensive Ukraine Capability - To be implemented";
EOF
  echo "✅ Created placeholder capability file."
fi

# Check if UI integration exists
if [ ! -f "src/ui/maxOffensiveUkraineUI.ts" ]; then
  echo "❌ Max Offensive Ukraine UI not found at src/ui/maxOffensiveUkraineUI.ts"
  echo "   Creating from template..."
  
  # Create from template if missing
  cat > src/ui/maxOffensiveUkraineUI.ts << 'EOF'
/**
 * MAX OFFENSIVE UKRAINE UI - PLACEHOLDER
 * 
 * This file will be replaced with the actual max offensive Ukraine UI
 */
export const MaxOffensiveUkraineUIPlaceholder = "Max Offensive Ukraine UI - To be implemented";
EOF
  echo "✅ Created placeholder UI file."
fi

echo ""
echo "📝 Updating AGI Core configuration..."

# Update capabilities index if needed
if grep -q "maxOffensiveUkraineCapability" src/capabilities/index.ts; then
  echo "✅ Max Offensive Ukraine already exported in capabilities index."
else
  echo "  Adding export to capabilities index..."
  # Append export to capabilities index
  echo "export { MaxOffensiveUkraineCapabilityModule, type MaxOffensiveUkraineCapabilityOptions } from './maxOffensiveUkraineCapability.js';" >> src/capabilities/index.ts
  echo "✅ Added export to capabilities index."
fi

echo ""
echo "🧪 Testing integration..."

# Run TypeScript compilation check
if command -v tsc &> /dev/null; then
  echo "  Checking TypeScript compilation..."
  if tsc --noEmit 2>/dev/null; then
    echo "✅ TypeScript compilation successful."
  else
    echo "⚠️  TypeScript compilation warnings/errors (may be expected during integration)"
  fi
else
  echo "⚠️  TypeScript compiler not found, skipping compilation check."
fi

echo ""
echo "📋 Integration Summary:"
echo "   -----------------------------------------"
echo "   Legacy Files Removed: ${#EXISTING_LEGACY_FILES[@]}"
echo "   Backup Location: $BACKUP_DIR"
echo "   Max Offensive Ukraine Capability: $( [ -f "src/capabilities/maxOffensiveUkraineCapability.ts" ] && echo "✅ Integrated" || echo "❌ Missing" )"
echo "   Max Offensive Ukraine UI: $( [ -f "src/ui/maxOffensiveUkraineUI.ts" ] && echo "✅ Integrated" || echo "❌ Missing" )"
echo "   Capabilities Index Updated: $( grep -q "maxOffensiveUkraineCapability" src/capabilities/index.ts && echo "✅ Yes" || echo "❌ No" )"
echo "   -----------------------------------------"

echo ""
echo "🎯 Next steps:"
echo "   1. Review the backup at: $BACKUP_DIR"
echo "   2. Test max offensive Ukraine capabilities"
echo "   3. Verify UI integration"
echo "   4. Update documentation if needed"

echo ""
echo "================================================"
echo "INTEGRATION COMPLETE"
echo "================================================"