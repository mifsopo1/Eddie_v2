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

