// ============================================
// FIX DOUBLE LOGGING ISSUE
// ============================================

/*
The issue is likely:
1. Both audit log AND your manual moderation logging are triggering
2. Or event listeners are being registered multiple times

Here's how to fix it:
*/

// SOLUTION 1: Add a debounce/deduplication system
class LogDeduplicator {
    constructor() {
        this.recentLogs = new Map();
        this.timeout = 2000; // 2 second window
    }

    isDuplicate(key) {
        const now = Date.now();
        const lastLog = this.recentLogs.get(key);
        
        if (lastLog && (now - lastLog) < this.timeout) {
            return true; // Duplicate within timeout window
        }
        
        this.recentLogs.set(key, now);
        
        // Clean up old entries
        if (this.recentLogs.size > 100) {
            const cutoff = now - this.timeout;
            for (const [k, v] of this.recentLogs.entries()) {
                if (v < cutoff) {
                    this.recentLogs.delete(k);
                }
            }
        }
        
        return false;
    }
}

// Add this to your index.js at the top
const logDeduplicator = new LogDeduplicator();

// ============================================
// SOLUTION 2: Check your index.js for duplicate listeners
// ============================================

/*
Look for these patterns in your index.js:

BAD (causes doubles):
client.on('guildBanAdd', async (ban) => { ... });
client.on('guildBanAdd', async (ban) => { ... }); // <- DUPLICATE!

GOOD (only once):
client.once('ready', () => {
    client.on('guildBanAdd', async (ban) => { ... });
});
*/

// ============================================
// SOLUTION 3: Add deduplication to your logging functions
// ============================================

// Replace your existing moderation logging with this version:

async function logModerationAction(action, dedupKey = null) {
    // Create unique key for deduplication
    const key = dedupKey || `${action.type}_${action.targetUserId}_${action.moderatorId}_${Date.now()}`;
    
    if (logDeduplicator.isDuplicate(key)) {
        console.log('🔇 Skipping duplicate log:', key);
        return;
    }
    
    // Log to MongoDB
    if (mongoLogger && mongoLogger.connected) {
        await mongoLogger.logModerationAction(action);
    }
    
    // Log to Discord channel
    const modChannel = await client.channels.fetch(config.logChannels.moderation).catch(() => null);
    if (!modChannel) return;
    
    // ... rest of your logging code
}

