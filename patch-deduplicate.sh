#!/bin/bash

echo "🔧 Applying deduplication fix to index.js..."

# Backup first
cp index.js index.js.backup-dedupe-$(date +%s)

# Add deduplicator class at the top (after requires)
sed -i '/const config = require/a \
\
// ============================================\
// LOG DEDUPLICATION SYSTEM\
// ============================================\
class LogDeduplicator {\
    constructor() {\
        this.recentLogs = new Map();\
        this.timeout = 2000; // 2 second window\
    }\
\
    isDuplicate(key) {\
        const now = Date.now();\
        const lastLog = this.recentLogs.get(key);\
        \
        if (lastLog && (now - lastLog) < this.timeout) {\
            console.log("🔇 Skipping duplicate log:", key.substring(0, 50));\
            return true;\
        }\
        \
        this.recentLogs.set(key, now);\
        \
        // Clean up old entries\
        if (this.recentLogs.size > 100) {\
            const cutoff = now - this.timeout;\
            for (const [k, v] of this.recentLogs.entries()) {\
                if (v < cutoff) this.recentLogs.delete(k);\
            }\
        }\
        \
        return false;\
    }\
}\
\
const logDeduplicator = new LogDeduplicator();' index.js

echo "✅ Deduplicator added to index.js"
echo ""
echo "⚠️  IMPORTANT: You still need to manually add deduplication checks"
echo "   to your logging functions. Example:"
echo ""
echo "   // Before logging to Discord:"
echo "   const dedupKey = \`ban_\${ban.user.id}_\${Date.now()}\`;"
echo "   if (logDeduplicator.isDuplicate(dedupKey)) return;"
echo ""
echo "Would you like me to show you where to add these checks? (y/n)"
