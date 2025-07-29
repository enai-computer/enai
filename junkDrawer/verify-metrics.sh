#!/bin/bash

echo "=== Enai Codebase Metrics Verification ==="
echo ""

# Lines of code
echo "1. Lines of Code Analysis:"
echo "TypeScript/TSX files:"
find . -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v dist | grep -v .next | xargs wc -l | tail -1

echo ""
echo "JavaScript files:"
find . -name "*.js" | grep -v node_modules | grep -v dist | grep -v .next | xargs wc -l | tail -1

# File count
echo ""
echo "2. File Count:"
echo "Total TS/TSX/JS files: $(find . \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) | grep -v node_modules | grep -v dist | wc -l)"

# Service analysis
echo ""
echo "3. Service Architecture:"
echo "Services extending BaseService: $(grep -r "extends BaseService" services/ | wc -l)"
echo "Total service files: $(find services/ -name "*.ts" | wc -l)"

# Test coverage
echo ""
echo "4. Test Files:"
echo "Test files: $(find . -name "*.test.ts" -o -name "*.spec.ts" | grep -v node_modules | wc -l)"
echo "Service test files: $(find services/ -name "*.test.ts" -o -name "*.spec.ts" | wc -l)"
echo "Model test files: $(find models/ -name "*.test.ts" -o -name "*.spec.ts" | wc -l)"

# Git metrics
echo ""
echo "5. Git Activity:"
echo "Commits in last 30 days: $(git log --since='30 days ago' --oneline | wc -l)"
echo "Commits in last 6 months: $(git log --since='6 months ago' --oneline | wc -l)"
echo "Commits in last 7 days: $(git log --since='7 days ago' --oneline | wc -l)"

# Complexity indicators
echo ""
echo "6. Complexity Indicators:"
echo "TypeScript interfaces/types: $(grep -r "interface\|type" shared/types/ | wc -l)"
echo "Async functions: $(grep -r "async" --include="*.ts" --include="*.tsx" | wc -l)"
echo "Try-catch blocks: $(grep -r "try {" --include="*.ts" --include="*.tsx" | wc -l)"

# Dependencies
echo ""
echo "7. Dependencies:"
echo "Production dependencies: $(cat package.json | jq '.dependencies | length')"
echo "Dev dependencies: $(cat package.json | jq '.devDependencies | length')"

# Code quality
echo ""
echo "8. Code Quality Indicators:"
echo "TODO comments: $(grep -r "TODO" --include="*.ts" --include="*.tsx" | wc -l)"
echo "Any types: $(grep -r ": any" --include="*.ts" --include="*.tsx" | wc -l)"
echo "Console.log statements: $(grep -r "console.log" --include="*.ts" --include="*.tsx" | wc -l)"

echo ""
echo "=== Verification Complete ==="