#!/bin/bash

echo "🔧 Applying deduplication fix to index.js..."
echo ""

# Backup first
if [ -f index.js ]; then
    cp index.js index.js.backup-dedupe-$(date +%s)
    echo "✅ Backup created: index.js.backup-dedupe-$(date +%s)"
else
    echo "❌ index.js not found!"
    exit 1
fi

# Check if deduplicator already exists
if grep -q "LogDeduplicator" index.js; then
    echo "⚠️  Deduplicator class already exists in index.js"
    echo "   Skipping addition..."
else
    # Add deduplicator class after the config require
    echo "📝 Adding LogDeduplicator class..."
    
    # Find the line with "const config = require"
    LINE_NUM=$(grep -n "const config = require" index.js | head -1 | cut -d: -f1)
    
    if [ -n "$LINE_NUM" ]; then
        # Insert after the config line
        sed -i "${LINE_NUM}a\\
\\
// ============================================\\
// LOG DEDUPLICATION SYSTEM\\
// ============================================\\
class LogDeduplicator {\\
    constructor() {\\
        this.recentLogs = new Map();\\
        this.timeout = 2000; // 2 second window\\
    }\\
\\
    isDuplicate(key) {\\
        const now = Date.now();\\
        const lastLog = this.recentLogs.get(key);\\
        \\
        if (lastLog && (now - lastLog) < this.timeout) {\\
            console.log('🔇 Skipping duplicate log:', key.substring(0, 50));\\
            return true;\\
        }\\
        \\
        this.recentLogs.set(key, now);\\
        \\
        // Clean up old entries\\
        if (this.recentLogs.size > 100) {\\
            const cutoff = now - this.timeout;\\
            for (const [k, v] of this.recentLogs.entries()) {\\
                if (v < cutoff) this.recentLogs.delete(k);\\
            }\\
        }\\
        \\
        return false;\\
    }\\
}\\
\\
const logDeduplicator = new LogDeduplicator();" index.js
        
        echo "✅ Deduplicator class added!"
    else
        echo "❌ Could not find 'const config = require' line"
        exit 1
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Deduplicator class has been added to index.js"
echo ""
echo "⚠️  NEXT STEPS (MANUAL):"
echo ""
echo "1. Find your event listeners in index.js:"
echo "   - client.on('guildBanAdd', ...)"
echo "   - client.on('guildBanRemove', ...)"
echo "   - client.on('guildMemberUpdate', ...)"
echo ""
echo "2. Add deduplication check at the START of each:"
echo ""
echo "   const dedupKey = \`ban_\${ban.user.id}_\${Date.now()}\`;"
echo "   if (logDeduplicator.isDuplicate(dedupKey)) return;"
echo ""
echo "3. Restart your bot:"
echo "   pm2 restart discord-logger-bot"
echo ""
echo "📋 See fix-double-logging-complete.js for full examples"
