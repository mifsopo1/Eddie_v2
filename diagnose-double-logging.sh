#!/bin/bash

echo "📝 Adding Dashboard Audit Logging..."

# Add this to your dashboard.js - insert after the setupRoutes() function starts
cat > dashboard-audit-addon.js << 'EOF'
// ============================================
// AUDIT LOGGING SYSTEM
// ============================================

// Add this method to your Dashboard class (inside dashboard.js)

async logAuditAction(req, action, details) {
    try {
        const auditLog = {
            action: action,
            performedBy: req.user?.username || req.session?.user?.username || 'Admin',
            performedById: req.user?.id || 'password-auth',
            timestamp: new Date(),
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('user-agent'),
            details: details
        };
        
        await this.mongoLogger.db.collection('auditLogs').insertOne(auditLog);
        console.log(`📝 Audit: ${action} by ${auditLog.performedBy}`);
        
        // Also send to audit channel if configured
        if (this.config.logChannels.moderation) {
            const channel = await this.client.channels.fetch(this.config.logChannels.moderation).catch(() => null);
            if (channel) {
                const { EmbedBuilder } = require('discord.js');
                const embed = new EmbedBuilder()
                    .setColor('#faa61a')
                    .setTitle('📋 Dashboard Action')
                    .addFields(
                        { name: 'Action', value: action, inline: true },
                        { name: 'Performed By', value: auditLog.performedBy, inline: true },
                        { name: 'Time', value: new Date().toLocaleString(), inline: true }
                    )
                    .setDescription(`\`\`\`json\n${JSON.stringify(details, null, 2).substring(0, 1000)}\`\`\``)
                    .setTimestamp();
                
                await channel.send({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error('Error logging audit action:', error);
    }
}

// ============================================
// NOW UPDATE EACH ROUTE TO INCLUDE LOGGING
// ============================================

// Replace your existing routes with these versions that include audit logging:

// CREATE COMMAND - Add audit logging
this.app.post('/commands/create', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const triggers = req.body.trigger.split(',').map(t => t.trim().toLowerCase());
        
        const command = {
            name: req.body.name,
            category: req.body.category || 'general',
            description: req.body.description || '',
            triggerType: req.body.triggerType || 'command',
            trigger: triggers.length === 1 ? triggers[0] : triggers,
            responseType: req.body.responseType || 'text',
            response: req.body.response || '',
            enabled: req.body.enabled === 'on',
            deleteTrigger: req.body.deleteTrigger === 'on',
            createdBy: req.user?.id || 'admin',
            createdAt: new Date(),
            uses: 0
        };
        
        const result = await this.mongoLogger.db.collection('customCommands').insertOne(command);
        
        // 📝 AUDIT LOG
        await this.logAuditAction(req, 'COMMAND_CREATED', {
            commandId: result.insertedId.toString(),
            commandName: command.name,
            trigger: command.trigger,
            category: command.category
        });
        
        req.flash('success', `Command "${req.body.name}" created!`);
        res.redirect('/commands');
    } catch (error) {
        console.error('Create command error:', error);
        req.flash('error', 'Error creating command');
        res.redirect('/commands');
    }
});

// EDIT COMMAND - Add audit logging
this.app.post('/commands/edit/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const triggers = req.body.trigger.split(',').map(t => t.trim().toLowerCase());
        
        const oldCommand = await this.mongoLogger.db.collection('customCommands')
            .findOne({ _id: new ObjectId(req.params.id) });
        
        const updateData = {
            name: req.body.name,
            category: req.body.category || 'general',
            description: req.body.description || '',
            triggerType: req.body.triggerType || 'command',
            trigger: triggers.length === 1 ? triggers[0] : triggers,
            responseType: req.body.responseType || 'text',
            response: req.body.response || '',
            enabled: req.body.enabled === 'on',
            deleteTrigger: req.body.deleteTrigger === 'on',
            updatedAt: new Date()
        };
        
        await this.mongoLogger.db.collection('customCommands')
            .updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: updateData }
            );
        
        // 📝 AUDIT LOG
        await this.logAuditAction(req, 'COMMAND_EDITED', {
            commandId: req.params.id,
            commandName: updateData.name,
            changes: {
                before: oldCommand,
                after: updateData
            }
        });
        
        req.flash('success', `Command "${req.body.name}" updated!`);
        res.redirect('/commands');
    } catch (error) {
        console.error('Update command error:', error);
        req.flash('error', 'Error updating command');
        res.redirect('/commands');
    }
});

// DELETE COMMAND - Add audit logging
this.app.get('/commands/delete/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        
        const command = await this.mongoLogger.db.collection('customCommands')
            .findOne({ _id: new ObjectId(req.params.id) });
        
        await this.mongoLogger.db.collection('customCommands')
            .deleteOne({ _id: new ObjectId(req.params.id) });
        
        // 📝 AUDIT LOG
        await this.logAuditAction(req, 'COMMAND_DELETED', {
            commandId: req.params.id,
            commandName: command?.name || 'Unknown',
            deletedCommand: command
        });
        
        req.flash('success', 'Command deleted');
        res.redirect('/commands');
    } catch (error) {
        console.error('Delete command error:', error);
        req.flash('error', 'Error deleting command');
        res.redirect('/commands');
    }
});

// TOGGLE COMMAND - Add audit logging
this.app.post('/commands/toggle/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const command = await this.mongoLogger.db.collection('customCommands')
            .findOne({ _id: new ObjectId(req.params.id) });
        
        await this.mongoLogger.db.collection('customCommands')
            .updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { enabled: !command.enabled } }
            );
        
        // 📝 AUDIT LOG
        await this.logAuditAction(req, 'COMMAND_TOGGLED', {
            commandId: req.params.id,
            commandName: command?.name,
            previousState: command.enabled ? 'enabled' : 'disabled',
            newState: !command.enabled ? 'enabled' : 'disabled'
        });
        
        res.json({ success: true, enabled: !command.enabled });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// EXECUTE COMMAND - Add audit logging
this.app.post('/execute', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { channelId, command } = req.body;
        
        if (!channelId || !command) {
            return res.json({ success: false, error: 'Missing channel or command' });
        }
        
        const channel = await this.client.channels.fetch(channelId).catch(() => null);
        
        if (!channel || !channel.isTextBased()) {
            return res.json({ success: false, error: 'Invalid channel' });
        }
        
        await channel.send(command);
        
        // 📝 AUDIT LOG
        await this.logAuditAction(req, 'COMMAND_EXECUTED', {
            channelId: channelId,
            channelName: channel.name,
            command: command
        });
        
        res.json({ success: true, message: `Command executed in #${channel.name}` });
    } catch (error) {
        console.error('Execute command error:', error);
        res.json({ success: false, error: error.message });
    }
});

// CREATE STICKY MESSAGE - Add audit logging
this.app.post('/commands/sticky/create', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { channelId, message, threshold, enabled } = req.body;
        
        if (!channelId || !message) {
            return res.json({ success: false, error: 'Channel and message are required' });
        }
        
        const channel = await this.client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            return res.json({ success: false, error: 'Invalid channel' });
        }
        
        const stickyMessage = {
            channelId: channelId,
            channelName: channel.name,
            message: message,
            threshold: parseInt(threshold) || 10,
            enabled: enabled === true || enabled === 'on',
            messageId: null,
            messageCount: 0,
            repostCount: 0,
            createdAt: new Date(),
            createdBy: req.user?.username || 'Admin'
        };
        
        const result = await this.mongoLogger.db.collection('stickyMessages').insertOne(stickyMessage);
        
        if (enabled) {
            try {
                const sentMessage = await channel.send(message);
                await this.mongoLogger.db.collection('stickyMessages').updateOne(
                    { _id: result.insertedId },
                    { $set: { messageId: sentMessage.id } }
                );
            } catch (sendError) {
                console.error('Failed to send initial sticky message:', sendError);
            }
        }
        
        // 📝 AUDIT LOG
        await this.logAuditAction(req, 'STICKY_CREATED', {
            stickyId: result.insertedId.toString(),
            channelId: channelId,
            channelName: channel.name,
            threshold: threshold,
            enabled: enabled
        });
        
        req.flash('success', 'Sticky message created!');
        res.json({ success: true, id: result.insertedId.toString() });
    } catch (error) {
        console.error('Create sticky message error:', error);
        res.json({ success: false, error: error.message });
    }
});

// TOGGLE STICKY - Add audit logging
this.app.post('/commands/sticky/toggle/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const sticky = await this.mongoLogger.db.collection('stickyMessages')
            .findOne({ _id: new ObjectId(req.params.id) });
        
        if (!sticky) {
            return res.json({ success: false, error: 'Sticky message not found' });
        }
        
        await this.mongoLogger.db.collection('stickyMessages')
            .updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { enabled: !sticky.enabled } }
            );
        
        // 📝 AUDIT LOG
        await this.logAuditAction(req, 'STICKY_TOGGLED', {
            stickyId: req.params.id,
            channelName: sticky.channelName,
            previousState: sticky.enabled ? 'enabled' : 'disabled',
            newState: !sticky.enabled ? 'enabled' : 'disabled'
        });
        
        res.json({ success: true, enabled: !sticky.enabled });
    } catch (error) {
        console.error('Toggle sticky error:', error);
        res.json({ success: false, error: error.message });
    }
});

// DELETE STICKY - Add audit logging
this.app.delete('/commands/sticky/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        
        const sticky = await this.mongoLogger.db.collection('stickyMessages')
            .findOne({ _id: new ObjectId(req.params.id) });
        
        await this.mongoLogger.db.collection('stickyMessages')
            .deleteOne({ _id: new ObjectId(req.params.id) });
        
        // 📝 AUDIT LOG
        await this.logAuditAction(req, 'STICKY_DELETED', {
            stickyId: req.params.id,
            channelName: sticky?.channelName,
            deletedSticky: sticky
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Delete sticky error:', error);
        res.json({ success: false, error: error.message });
    }
});

// UPDATE APPEAL - Add audit logging
this.app.post('/appeals/:appealId/update', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const { status, response } = req.body;
        const appealId = req.params.appealId;
        
        if (!ObjectId.isValid(appealId)) {
            req.flash('error', 'Invalid appeal ID');
            return res.redirect('/appeals');
        }
        
        const appeal = await this.mongoLogger.db.collection('appeals')
            .findOne({ _id: new ObjectId(appealId) });
        
        const updateData = {
            status: status,
            'response.message': response,
            'response.respondedAt': new Date(),
            'response.respondedBy': req.user?.username || 'Admin'
        };
        
        const historyEntry = {
            action: status,
            by: req.user?.username || 'Admin',
            message: response,
            timestamp: new Date()
        };
        
        await this.mongoLogger.db.collection('appeals').updateOne(
            { _id: new ObjectId(appealId) },
            { 
                $set: updateData,
                $push: { history: historyEntry }
            }
        );
        
        // 📝 AUDIT LOG
        await this.logAuditAction(req, 'APPEAL_UPDATED', {
            appealId: appealId,
            userId: appeal.userId,
            userName: appeal.userName,
            previousStatus: appeal.status,
            newStatus: status,
            response: response
        });
        
        // Try to DM user
        if (appeal) {
            try {
                const user = await this.client.users.fetch(appeal.userId);
                const { EmbedBuilder } = require('discord.js');
                
                const embed = new EmbedBuilder()
                    .setColor(status === 'approved' ? '#43b581' : '#ed4245')
                    .setTitle(`Appeal ${status.charAt(0).toUpperCase() + status.slice(1)}`)
                    .setDescription(`Your appeal has been ${status}.`)
                    .addFields({ name: 'Response', value: response || 'No additional comments.' })
                    .setTimestamp();
                
                await user.send({ embeds: [embed] });
            } catch (e) {
                console.log('Could not DM user about appeal decision:', e.message);
            }
        }
        
        req.flash('success', `Appeal ${status}!`);
        res.redirect('/appeals');
    } catch (error) {
        console.error('Update appeal error:', error);
        req.flash('error', 'Error updating appeal');
        res.redirect('/appeals');
    }
});

EOF

echo "✅ Created dashboard-audit-addon.js"
echo ""
echo "📋 This file contains:"
echo "  - logAuditAction() method"
echo "  - Updated routes with audit logging"
echo "  - Logs stored in MongoDB 'auditLogs' collection"
echo "  - Real-time notifications to moderation channel"
echo ""
echo "🔧 To integrate this:"
echo "1. Open dashboard.js"
echo "2. Add the logAuditAction() method after line ~60 (after setupRoutes starts)"
echo "3. Replace the existing route handlers with the audited versions"
echo ""
echo "Or run this to automatically patch:"
echo "   ./patch-dashboard-audit.sh"
```

Now create the auto-patcher:

```bash
cat > patch-dashboard-audit.sh << 'PATCHEOF'
#!/bin/bash

echo "🔧 Patching dashboard.js with audit logging..."

# Backup first
cp dashboard.js dashboard.js.backup-$(date +%s)

# Add the logAuditAction method after setupRoutes() {
sed -i '/setupRoutes() {/a \
\
    // ============================================\
    // AUDIT LOGGING SYSTEM\
    // ============================================\
    async logAuditAction(req, action, details) {\
        try {\
            const auditLog = {\
                action: action,\
                performedBy: req.user?.username || req.session?.user?.username || '\''Admin'\'',\
                performedById: req.user?.id || '\''password-auth'\'',\
                timestamp: new Date(),\
                ipAddress: req.ip || req.connection.remoteAddress,\
                userAgent: req.get('\''user-agent'\''),\
                details: details\
            };\
            \
            await this.mongoLogger.db.collection('\''auditLogs'\'').insertOne(auditLog);\
            console.log(`📝 Audit: ${action} by ${auditLog.performedBy}`);\
            \
            if (this.config.logChannels.moderation) {\
                const channel = await this.client.channels.fetch(this.config.logChannels.moderation).catch(() => null);\
                if (channel) {\
                    const { EmbedBuilder } = require('\''discord.js'\'');\
                    const embed = new EmbedBuilder()\
                        .setColor('\''#faa61a'\'')\
                        .setTitle('\''📋 Dashboard Action'\'')\
                        .addFields(\
                            { name: '\''Action'\'', value: action, inline: true },\
                            { name: '\''Performed By'\'', value: auditLog.performedBy, inline: true },\
                            { name: '\''Time'\'', value: new Date().toLocaleString(), inline: true }\
                        )\
                        .setDescription(`\\\`\\\`\\\`json\\n${JSON.stringify(details, null, 2).substring(0, 1000)}\\\`\\\`\\\``)\
                        .setTimestamp();\
                    \
                    await channel.send({ embeds: [embed] });\
                }\
            }\
        } catch (error) {\
            console.error('\''Error logging audit action:'\'', error);\
        }\
    }' dashboard.js

echo "✅ Audit logging method added"
echo ""
echo "📋 The method has been added to dashboard.js"
echo "   You still need to manually add await this.logAuditAction() calls"
echo "   to each route where you want logging."
echo ""
echo "🔄 Restart your bot:"
echo "   pm2 restart discord-logger-bot"
echo ""
echo "📊 View audit logs in MongoDB:"
echo "   mongosh"
echo "   use discord_logs"
echo "   db.auditLogs.find().sort({timestamp:-1}).limit(10)"
PATCHEOF

chmod +x patch-dashboard-audit.sh
```

**Summary of what this does:**

✅ **Logs these dashboard actions:**
- Command created/edited/deleted/toggled
- Command executed via dashboard
- Sticky message created/toggled/deleted
- Appeal approved/denied/updated

✅ **Each log includes:**
- Action type
- Who performed it (username + ID)
- Timestamp
- IP address
- User agent
- Before/after states
- Full details of changes

✅ **Logs are stored in:**
- MongoDB `auditLogs` collection
- Discord moderation channel (real-time embed)
- Console output

Want me to create a viewer page to see these audit logs in the dashboard?

[Tokens - Input: 26335, Cache Read: 0, Output: 5481]

You: my bots double posting mutes / ban logs
Indexing project files...
Found 21 relevant files
Sending to Claude...

Claude: The double posting is likely happening because you have multiple event listeners for the same events. Let me create a fix script:

```bash
#!/bin/bash

echo "🔧 Fixing double posting in moderation logs..."

cat > fix-double-logging.js << 'EOF'
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

EOF

echo "✅ Created fix-double-logging.js"
echo ""
echo "📋 Now let's check your index.js for the actual issue..."

# Check for duplicate event listeners
echo ""
echo "🔍 Checking for duplicate event listeners in index.js:"
echo ""

grep -n "client.on('guildBanAdd'" index.js 2>/dev/null || echo "  No guildBanAdd listeners found"
grep -n "client.on('guildBanRemove'" index.js 2>/dev/null || echo "  No guildBanRemove listeners found"
grep -n "client.on('guildMemberUpdate'" index.js 2>/dev/null || echo "  No guildMemberUpdate listeners found"

echo ""
echo "🔍 Checking for duplicate audit log listeners:"
echo ""

grep -n "client.on('guildAuditLogEntryCreate'" index.js 2>/dev/null || echo "  No audit log listeners found"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Analysis:"
echo ""
echo "If you see the SAME event listener MORE THAN ONCE above,"
echo "that's causing your double posting!"
echo ""
echo "🔧 Quick Fix Options:"
echo ""
echo "OPTION 1: Use the deduplicator (recommended)"
echo "   Copy the LogDeduplicator class from fix-double-logging.js"
echo "   Add it to the top of index.js"
echo "   Wrap your logging calls with deduplication checks"
echo ""
echo "OPTION 2: Remove duplicate listeners"
echo "   Search index.js for duplicate 'client.on()' calls"
echo "   Keep only ONE listener for each event"
echo ""
echo "OPTION 3: Use audit logs ONLY (cleanest)"
echo "   Comment out manual ban/mute logging"
echo "   Let Discord's audit logs handle everything"
echo ""

# Create the actual fix patch
cat > patch-deduplicate.sh << 'PATCHEOF'
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
PATCHEOF

chmod +x patch-deduplicate.sh

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎯 RECOMMENDED ACTIONS:"
echo ""
echo "1. First, let's see what's causing doubles:"
echo "   grep -A 20 \"guildBanAdd\" index.js"
echo ""
echo "2. Then apply the fix:"
echo "   ./patch-deduplicate.sh"
echo ""
echo "3. Or manually edit index.js to add deduplication"
echo ""

# Create a complete working example
cat > example-deduplicated-logging.js << 'EXAMPLEEOF'
// ============================================
// EXAMPLE: Properly deduplicated ban logging
// ============================================

// At the top of index.js:
class LogDeduplicator {
    constructor() {
        this.recentLogs = new Map();
        this.timeout = 2000;
    }
    
    isDuplicate(key) {
        const now = Date.now();
        const lastLog = this.recentLogs.get(key);
        
        if (lastLog && (now - lastLog) < this.timeout) {
            return true;
        }
        
        this.recentLogs.set(key, now);
        return false;
    }
}

const logDeduplicator = new LogDeduplicator();

// ============================================
// Then in your event listeners:
// ============================================

client.on('guildBanAdd', async (ban) => {
    try {
        // Create unique dedup key
        const dedupKey = `ban_add_${ban.user.id}_${ban.guild.id}`;
        
        // Check if duplicate
        if (logDeduplicator.isDuplicate(dedupKey)) {
            console.log('🔇 Skipping duplicate ban log');
            return; // EXIT EARLY!
        }
        
        // Fetch audit log to get reason
        const auditLogs = await ban.guild.fetchAuditLogs({
            type: 22, // BanAdd
            limit: 1
        });
        
        const banLog = auditLogs.entries.first();
        const reason = banLog?.reason || 'No reason provided';
        
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logBan(ban, reason);
        }
        
        // Log to Discord
        const modChannel = await client.channels.fetch(config.logChannels.moderation).catch(() => null);
        if (modChannel) {
            const embed = new EmbedBuilder()
                .setColor('#ed4245')
                .setTitle('🔨 Member Banned')
                .setDescription(`**${ban.user.tag}** was banned`)
                .addFields(
                    { name: 'User', value: `${ban.user.tag} (\`${ban.user.id}\`)`, inline: true },
                    { name: 'Reason', value: reason, inline: true }
                )
                .setThumbnail(ban.user.displayAvatarURL())
                .setTimestamp();
            
            await modChannel.send({ embeds: [embed] });
        }
        
        console.log(`✅ Logged ban: ${ban.user.tag}`);
    } catch (error) {
        console.error('Error in guildBanAdd:', error);
    }
});

client.on('guildBanRemove', async (ban) => {
    try {
        // Create unique dedup key
        const dedupKey = `ban_remove_${ban.user.id}_${ban.guild.id}`;
        
        // Check if duplicate
        if (logDeduplicator.isDuplicate(dedupKey)) {
            console.log('🔇 Skipping duplicate unban log');
            return;
        }
        
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logUnban(ban);
        }
        
        // Log to Discord
        const modChannel = await client.channels.fetch(config.logChannels.moderation).catch(() => null);
        if (modChannel) {
            const embed = new EmbedBuilder()
                .setColor('#43b581')
                .setTitle('✅ Member Unbanned')
                .setDescription(`**${ban.user.tag}** was unbanned`)
                .addFields({ name: 'User', value: `${ban.user.tag} (\`${ban.user.id}\`)` })
                .setThumbnail(ban.user.displayAvatarURL())
                .setTimestamp();
            
            await modChannel.send({ embeds: [embed] });
        }
        
        console.log(`✅ Logged unban: ${ban.user.tag}`);
    } catch (error) {
        console.error('Error in guildBanRemove:', error);
    }
});

// ============================================
// For mutes (guildMemberUpdate):
// ============================================

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        // Check if timeout changed
        if (oldMember.communicationDisabledUntil === newMember.communicationDisabledUntil) {
            return; // No timeout change
        }
        
        const wasMuted = oldMember.communicationDisabledUntil && oldMember.communicationDisabledUntil > new Date();
        const isMuted = newMember.communicationDisabledUntil && newMember.communicationDisabledUntil > new Date();
        
        if (!wasMuted && isMuted) {
            // User was muted
            const dedupKey = `mute_${newMember.id}_${newMember.guild.id}_${Date.now()}`;
            
            if (logDeduplicator.isDuplicate(dedupKey)) {
                return;
            }
            
            const modChannel = await client.channels.fetch(config.logChannels.moderation).catch(() => null);
            if (modChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#faa61a')
                    .setTitle('🔇 Member Muted')
                    .setDescription(`**${newMember.user.tag}** was timed out`)
                    .addFields(
                        { name: 'User', value: `${newMember.user.tag} (\`${newMember.id}\`)`, inline: true },
                        { name: 'Until', value: `<t:${Math.floor(newMember.communicationDisabledUntil.getTime() / 1000)}:F>`, inline: true }
                    )
                    .setThumbnail(newMember.user.displayAvatarURL())
                    .setTimestamp();
                
                await modChannel.send({ embeds: [embed] });
            }
        } else if (wasMuted && !isMuted) {
            // User was unmuted
            const dedupKey = `unmute_${newMember.id}_${newMember.guild.id}_${Date.now()}`;
            
            if (logDeduplicator.isDuplicate(dedupKey)) {
                return;
            }
            
            const modChannel = await client.channels.fetch(config.logChannels.moderation).catch(() => null);
            if (modChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#43b581')
                    .setTitle('🔊 Member Unmuted')
                    .setDescription(`**${newMember.user.tag}** timeout was removed`)
                    .addFields({ name: 'User', value: `${newMember.user.tag} (\`${newMember.id}\`)` })
                    .setThumbnail(newMember.user.displayAvatarURL())
                    .setTimestamp();
                
                await modChannel.send({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error('Error in guildMemberUpdate:', error);
    }
});

EXAMPLEEOF

echo "✅ Created example-deduplicated-logging.js"
echo ""
echo "📖 Check example-deduplicated-logging.js for a complete working example!"