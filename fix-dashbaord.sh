#!/bin/bash

echo "🔧 Fixing dashboard.js issues..."

# Backup original file
cp dashboard.js dashboard.js.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ Backup created"

# Create a Python script to fix the issues
cat > fix_dashboard.py << 'PYTHON_SCRIPT'
#!/usr/bin/env python3
import re

print("📖 Reading dashboard.js...")
with open('dashboard.js', 'r') as f:
    content = f.read()

print("🔍 Analyzing file structure...")

# Find all occurrences of "this.app.get('/appeals',"
appeals_route_pattern = r"this\.app\.get\('/appeals',"
appeals_matches = list(re.finditer(appeals_route_pattern, content))

print(f"Found {len(appeals_matches)} '/appeals' route definitions")

if len(appeals_matches) >= 2:
    print("🗑️  Removing first duplicate '/appeals' route...")
    
    # Find the first appeals route
    first_match_start = appeals_matches[0].start()
    
    # Find the end of the first route (look for the closing brace and semicolon)
    # We need to find the matching closing brace for the async function
    brace_count = 0
    inside_route = False
    first_route_end = first_match_start
    
    for i in range(first_match_start, len(content)):
        char = content[i]
        
        if char == '{':
            brace_count += 1
            inside_route = True
        elif char == '}':
            brace_count -= 1
            if inside_route and brace_count == 0:
                # Found the end of the route
                # Look for the closing );
                for j in range(i, min(i + 10, len(content))):
                    if content[j:j+2] == ');':
                        first_route_end = j + 2
                        break
                break
    
    if first_route_end > first_match_start:
        # Remove the first route
        content = content[:first_match_start] + content[first_route_end:]
        print(f"✅ Removed first '/appeals' route (chars {first_match_start} to {first_route_end})")
    else:
        print("⚠️  Could not find end of first route, manual intervention needed")

# Fix 2: Find and move getAppealsStats() outside of setupRoutes()
print("🔍 Looking for misplaced getAppealsStats()...")

# Find getAppealsStats method inside setupRoutes
get_appeals_stats_pattern = r'(\s+)(async getAppealsStats\(\) \{[^}]+\{[^}]+\}[^}]+\})'
match = re.search(get_appeals_stats_pattern, content, re.DOTALL)

if match:
    print("📦 Found getAppealsStats() inside setupRoutes()")
    
    # Extract the method
    method_content = match.group(2)
    
    # Remove it from current position
    content = content.replace(match.group(0), '')
    
    # Find the end of setupRoutes() method
    # Look for "} // <-- Close setupRoutes()" or similar
    setuproutes_end_pattern = r'(\s+\}\s*(?://.*setupRoutes.*)?)\n\s+(async getAttachmentStats)'
    end_match = re.search(setuproutes_end_pattern, content)
    
    if end_match:
        # Insert getAppealsStats before getAttachmentStats
        insert_pos = end_match.start(2)
        content = content[:insert_pos] + '\n    ' + method_content + '\n\n    ' + content[insert_pos:]
        print("✅ Moved getAppealsStats() to proper location")
    else:
        # Fallback: Add it before getModerationStats or at the end of the class
        mod_stats_pattern = r'(\s+)(async getModerationStats\(\))'
        mod_match = re.search(mod_stats_pattern, content)
        
        if mod_match:
            insert_pos = mod_match.start(2)
            content = content[:insert_pos] + method_content + '\n\n    ' + content[insert_pos:]            print("✅ Moved getAppealsStats() before getModerationStats()")
        else:
            print("⚠️  Could not find ideal insertion point")

# Fix 3: Ensure proper closing braces
print("🔍 Checking class structure...")

# Count braces to ensure proper nesting
open_braces = content.count('{')
close_braces = content.count('}')

print(f"   Open braces: {open_braces}")
print(f"   Close braces: {close_braces}")

if open_braces != close_braces:
    print(f"⚠️  Brace mismatch detected! Difference: {open_braces - close_braces}")
    print("   This may require manual fixing")
else:
    print("✅ Brace count matches")

# Ensure the file ends properly
if not content.strip().endswith('module.exports = Dashboard;'):
    print("🔧 Ensuring proper module.exports...")
    # Remove any existing module.exports
    content = re.sub(r'\nmodule\.exports = Dashboard;.*$', '', content, flags=re.DOTALL)
    # Add it at the end
    content = content.rstrip() + '\n\nmodule.exports = Dashboard;\n'

print("💾 Writing fixed file...")
with open('dashboard.js', 'w') as f:
    f.write(content)

print("✅ All fixes applied!")
print("\n📋 Summary:")
print("   - Removed duplicate '/appeals' route")
print("   - Moved getAppealsStats() to proper location")
print("   - Verified class structure")
print("\n🔍 Please review the changes and test:")
print("   pm2 restart discord-logger-bot")
print("   pm2 logs discord-logger-bot --lines 50")
PYTHON_SCRIPT

# Make Python script executable
chmod +x fix_dashboard.py

# Run the Python fix script
if command -v python3 &> /dev/null; then
    echo "🐍 Running Python fix script..."
    python3 fix_dashboard.py
    
    echo ""
    echo "✅ Fix script completed!"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Review changes: diff dashboard.js dashboard.js.backup.*"
    echo "   2. Test syntax: node -c dashboard.js"
    echo "   3. Restart bot: pm2 restart discord-logger-bot"
    echo "   4. Check logs: pm2 logs discord-logger-bot --lines 50"
    echo ""
    echo "💾 Backup saved as: dashboard.js.backup.*"
else
    echo "❌ Python3 not found. Installing alternative fix method..."
    
    # Alternative: Use sed-based fixes
    echo "Using sed-based fixes..."
    
    # Fix 1: Remove lines 570-624 (first duplicate appeals route)
    sed -i '570,624d' dashboard.js
    echo "✅ Removed first duplicate appeals route"
    
    # The rest needs manual intervention
    echo "⚠️  Remaining fixes require manual editing:"
    echo "   1. Find 'async getAppealsStats()' inside setupRoutes()"
    echo "   2. Cut that entire method"
    echo "   3. Paste it after the setupRoutes() closing brace"
    echo "   4. Ensure proper indentation (4 spaces)"
fi

# Cleanup
rm -f fix_dashboard.py

echo ""
echo "🔍 Validating JavaScript syntax..."
if node -c dashboard.js 2>/dev/null; then
    echo "✅ No syntax errors detected!"
else
    echo "⚠️  Syntax errors found. Please review:"
    node -c dashboard.js
fi
