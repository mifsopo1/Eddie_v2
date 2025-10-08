const { MongoClient } = require('mongodb');

class MongoDBLogger {
    constructor(config) {
        this.uri = config.mongodb.uri;
        this.dbName = config.mongodb.database;
        this.client = null;
        this.db = null;
        this.connected = false;
    }

    async connect() {
        try {
            this.client = await MongoClient.connect(this.uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true
            });
            this.db = this.client.db(this.dbName);
            this.connected = true;
            
            await this.createIndexes();
            console.log('✅ MongoDB connected successfully');
            return true;
        } catch (error) {
            console.error('❌ MongoDB connection failed:', error);
            this.connected = false;
            return false;
        }
    }

    async createIndexes() {
        try {
            await this.db.collection('messages').createIndexes([
                { key: { userId: 1, timestamp: -1 } },
                { key: { channelId: 1, timestamp: -1 } },
                { key: { messageId: 1 } },
                { key: { timestamp: -1 } },
                { key: { eventType: 1, timestamp: -1 } }
            ]);

            await this.db.collection('members').createIndexes([
                { key: { userId: 1, timestamp: -1 } },
                { key: { eventType: 1, timestamp: -1 } },
                { key: { 'inviteData.code': 1 } },
                { key: { timestamp: -1 } }
            ]);

            await this.db.collection('moderation').createIndexes([
                { key: { targetUserId: 1, timestamp: -1 } },
                { key: { moderatorId: 1, timestamp: -1 } },
                { key: { actionType: 1, timestamp: -1 } },
                { key: { timestamp: -1 } }
            ]);

            await this.db.collection('voice').createIndexes([
                { key: { userId: 1, timestamp: -1 } },
                { key: { channelId: 1, timestamp: -1 } },
                { key: { timestamp: -1 } }
            ]);

            await this.db.collection('attachments').createIndexes([
                { key: { messageId: 1 } },
                { key: { userId: 1, timestamp: -1 } },
                { key: { timestamp: -1 } }
            ]);

            console.log('✅ MongoDB indexes created');
        } catch (error) {
            console.error('❌ Error creating indexes:', error);
        }
    }

    async logMessageCreate(message) {
        if (!this.connected) return;
        
        try {
            const doc = {
                eventType: 'create',
                messageId: message.id,
                userId: message.author.id,
                userName: message.author.tag,
                userAvatar: message.author.displayAvatarURL(),
                channelId: message.channel.id,
                channelName: message.channel.name,
                guildId: message.guild.id,
                guildName: message.guild.name,
                content: message.content,
                attachmentCount: message.attachments.size,
                embedCount: message.embeds.length,
                timestamp: new Date(message.createdTimestamp)
            };

            await this.db.collection('messages').insertOne(doc);

            if (message.attachments.size > 0) {
                await this.logAttachments(message);
            }
        } catch (error) {
            console.error('Error logging message create:', error);
        }
    }

    async logMessageDelete(message) {
        if (!this.connected) return;
        
        try {
            const doc = {
                eventType: 'delete',
                messageId: message.id,
                userId: message.author?.id || 'Unknown',
                userName: message.author?.tag || 'Unknown',
                userAvatar: message.author?.displayAvatarURL({ size: 128 }) || null, // ← ADD THIS
                channelId: message.channel.id,
                channelName: message.channel.name,
                guildId: message.guild.id,
                guildName: message.guild.name,
                content: message.content || '[Content not cached]',
                attachmentCount: message.attachments?.size || 0,
                embedCount: message.embeds?.length || 0,
                originalTimestamp: message.createdTimestamp ? new Date(message.createdTimestamp) : null,
                deletedTimestamp: new Date()
            };

            await this.db.collection('messages').insertOne(doc);
        } catch (error) {
            console.error('Error logging message delete:', error);
        }
    }

    async logMessageUpdate(oldMessage, newMessage) {
        if (!this.connected) return;
        if (oldMessage.content === newMessage.content) return;
        
        try {
            const doc = {
                eventType: 'edit',
                messageId: newMessage.id,
                userId: newMessage.author.id,
                userName: newMessage.author.tag,
                userAvatar: newMessage.author.displayAvatarURL(),
                channelId: newMessage.channel.id,
                channelName: newMessage.channel.name,
                guildId: newMessage.guild.id,
                guildName: newMessage.guild.name,
                contentBefore: oldMessage.content,
                contentAfter: newMessage.content,
                messageUrl: newMessage.url,
                timestamp: new Date()
            };

            await this.db.collection('messages').insertOne(doc);
        } catch (error) {
            console.error('Error logging message update:', error);
        }
    }

    async logAttachments(message) {
        if (!this.connected) return;
        
        try {
            const attachments = message.attachments.map(att => ({
                attachmentId: att.id,
                messageId: message.id,
                userId: message.author.id,
                userName: message.author.tag,
                channelId: message.channel.id,
                channelName: message.channel.name,
                guildId: message.guild.id,
                filename: att.name,
                url: att.url,
                proxyUrl: att.proxyUrl,
                size: att.size,
                contentType: att.contentType,
                width: att.width,
                height: att.height,
                timestamp: new Date(message.createdTimestamp)
            }));

            if (attachments.length > 0) {
                await this.db.collection('attachments').insertMany(attachments);
            }
        } catch (error) {
            console.error('Error logging attachments:', error);
        }
    }

    async logMemberJoin(member, inviteData) {
        if (!this.connected) return;
        
        try {
            const doc = {
                eventType: 'join',
                userId: member.id,
                userName: member.user.tag,
                userAvatar: member.user.displayAvatarURL(),
                isBot: member.user.bot,
                accountCreated: member.user.createdAt,
                accountAgeMs: Date.now() - member.user.createdTimestamp,
                accountAgeDays: Math.floor((Date.now() - member.user.createdTimestamp) / 86400000),
                inviteData: inviteData || null,
                guildId: member.guild.id,
                guildName: member.guild.name,
                memberCount: member.guild.memberCount,
                timestamp: new Date()
            };

            await this.db.collection('members').insertOne(doc);
        } catch (error) {
            console.error('Error logging member join:', error);
        }
    }

    async logMemberLeave(member) {
        if (!this.connected) return;
        
        try {
            const joinData = await this.db.collection('members').findOne({
                userId: member.id,
                eventType: 'join',
                guildId: member.guild.id
            }, { sort: { timestamp: -1 } });

            const doc = {
                eventType: 'leave',
                userId: member.id,
                userName: member.user.tag,
                userAvatar: member.user.displayAvatarURL(),
                roles: member.roles.cache.map(r => ({ id: r.id, name: r.name })),
                joinedAt: member.joinedAt,
                timeInServer: member.joinedAt ? Date.now() - member.joinedAt.getTime() : null,
                inviteData: joinData?.inviteData || null,
                guildId: member.guild.id,
                guildName: member.guild.name,
                memberCount: member.guild.memberCount,
                timestamp: new Date()
            };

            await this.db.collection('members').insertOne(doc);
        } catch (error) {
            console.error('Error logging member leave:', error);
        }
    }

    async logModerationAction(action) {
        if (!this.connected) return;
        
        try {
            const doc = {
                actionType: action.type,
                targetUserId: action.targetUserId,
                targetUserName: action.targetUserName,
                targetUserAvatar: action.targetUserAvatar,
                moderatorId: action.moderatorId,
                moderatorName: action.moderatorName,
                reason: action.reason,
                duration: action.duration,
                evidence: action.evidence,
                guildId: action.guildId,
                guildName: action.guildName,
                timestamp: new Date()
            };

            await this.db.collection('moderation').insertOne(doc);
        } catch (error) {
            console.error('Error logging moderation action:', error);
        }
    }

    async logBan(ban, reason) {
        if (!this.connected) return;
        
        try {
            const doc = {
                actionType: 'ban',
                targetUserId: ban.user.id,
                targetUserName: ban.user.tag,
                targetUserAvatar: ban.user.displayAvatarURL(),
                reason: reason || ban.reason || 'No reason provided',
                guildId: ban.guild.id,
                guildName: ban.guild.name,
                timestamp: new Date()
            };

            await this.db.collection('moderation').insertOne(doc);
        } catch (error) {
            console.error('Error logging ban:', error);
        }
    }

    async logUnban(ban) {
        if (!this.connected) return;
        
        try {
            const doc = {
                actionType: 'unban',
                targetUserId: ban.user.id,
                targetUserName: ban.user.tag,
                targetUserAvatar: ban.user.displayAvatarURL(),
                guildId: ban.guild.id,
                guildName: ban.guild.name,
                timestamp: new Date()
            };

            await this.db.collection('moderation').insertOne(doc);
        } catch (error) {
            console.error('Error logging unban:', error);
        }
    }

    async logRoleUpdate(oldMember, newMember, type, roles) {
        if (!this.connected) return;
        
        try {
            const doc = {
                eventType: `role_${type}`,
                userId: newMember.id,
                userName: newMember.user.tag,
                userAvatar: newMember.user.displayAvatarURL(),
                roles: roles.map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
                guildId: newMember.guild.id,
                guildName: newMember.guild.name,
                timestamp: new Date()
            };

            await this.db.collection('members').insertOne(doc);
        } catch (error) {
            console.error('Error logging role update:', error);
        }
    }

    async logVoiceStateUpdate(oldState, newState, action) {
        if (!this.connected) return;
        
        try {
            const doc = {
                actionType: action,
                userId: newState.member.id,
                userName: newState.member.user.tag,
                userAvatar: newState.member.user.displayAvatarURL(),
                channelId: newState.channel?.id || oldState.channel?.id,
                channelName: newState.channel?.name || oldState.channel?.name,
                oldChannelId: oldState.channel?.id,
                oldChannelName: oldState.channel?.name,
                newChannelId: newState.channel?.id,
                newChannelName: newState.channel?.name,
                guildId: newState.guild.id,
                guildName: newState.guild.name,
                timestamp: new Date()
            };

            await this.db.collection('voice').insertOne(doc);
        } catch (error) {
            console.error('Error logging voice state:', error);
        }
    }

    async getRecentMessages(limit = 100) {
        if (!this.connected) return [];
        return await this.db.collection('messages')
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    async getUserMessages(userId, limit = 100) {
        if (!this.connected) return [];
        return await this.db.collection('messages')
            .find({ userId })
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
    }

    async getDeletedMessages(hours = 24) {
        if (!this.connected) return [];
        const since = new Date(Date.now() - (hours * 60 * 60 * 1000));
        return await this.db.collection('messages')
            .find({
                eventType: 'delete',
                deletedTimestamp: { $gte: since }
            })
            .sort({ deletedTimestamp: -1 })
            .toArray();
    }

    async getModerationHistory(userId) {
        if (!this.connected) return [];
        return await this.db.collection('moderation')
            .find({ targetUserId: userId })
            .sort({ timestamp: -1 })
            .toArray();
    }

    async getStats() {
        if (!this.connected) return null;
        
        try {
            const [
                totalMessages,
                totalMembers,
                totalModActions,
                recentMessages,
                recentJoins,
                recentDeletes
            ] = await Promise.all([
                this.db.collection('messages').countDocuments(),
                this.db.collection('members').countDocuments({ eventType: 'join' }),
                this.db.collection('moderation').countDocuments(),
                this.db.collection('messages').countDocuments({
                    timestamp: { $gte: new Date(Date.now() - 86400000) }
                }),
                this.db.collection('members').countDocuments({
                    eventType: 'join',
                    timestamp: { $gte: new Date(Date.now() - 86400000) }
                }),
                this.db.collection('messages').countDocuments({
                    eventType: 'delete',
                    deletedTimestamp: { $gte: new Date(Date.now() - 86400000) }
                })
            ]);

            return {
                totalMessages,
                totalMembers,
                totalModActions,
                last24h: {
                    messages: recentMessages,
                    joins: recentJoins,
                    deletes: recentDeletes
                }
            };
        } catch (error) {
            console.error('Error getting stats:', error);
            return null;
        }
    }

    async close() {
        if (this.client) {
            await this.client.close();
            this.connected = false;
            console.log('MongoDB connection closed');
        }
    }

        // ===== ANALYTICS METHODS =====
    
    async getServerAnalytics() {
        if (!this.connected) return null;
        
        try {
            const now = new Date();
            const last24h = new Date(now - 86400000);
            const last7d = new Date(now - 7 * 86400000);
            const last30d = new Date(now - 30 * 86400000);
            
            const [
                // Message stats
                totalMessages,
                messages24h,
                messages7d,
                messages30d,
                
                // Member stats
                totalJoins,
                joins24h,
                joins7d,
                leaves7d,
                
                // Activity stats
                activeUsers24h,
                activeUsers7d,
                
                // Channel stats
                channelActivity,
                
                // Attachment stats
                totalAttachments,
                attachments24h,
                imageAttachments,
                
                // Voice stats
                voiceActivity24h,
                
                // Moderation stats
                totalBans,
                totalMutes,
                recentModerationActions
                
            ] = await Promise.all([
                // Messages
                this.db.collection('messages').countDocuments({ eventType: 'create' }),
                this.db.collection('messages').countDocuments({ eventType: 'create', timestamp: { $gte: last24h } }),
                this.db.collection('messages').countDocuments({ eventType: 'create', timestamp: { $gte: last7d } }),
                this.db.collection('messages').countDocuments({ eventType: 'create', timestamp: { $gte: last30d } }),
                
                // Members
                this.db.collection('members').countDocuments({ eventType: 'join' }),
                this.db.collection('members').countDocuments({ eventType: 'join', timestamp: { $gte: last24h } }),
                this.db.collection('members').countDocuments({ eventType: 'join', timestamp: { $gte: last7d } }),
                this.db.collection('members').countDocuments({ eventType: 'leave', timestamp: { $gte: last7d } }),
                
                // Activity
                this.db.collection('messages').distinct('userId', { eventType: 'create', timestamp: { $gte: last24h } }),
                this.db.collection('messages').distinct('userId', { eventType: 'create', timestamp: { $gte: last7d } }),
                
                // Channels
                this.db.collection('messages').aggregate([
                    { $match: { eventType: 'create', timestamp: { $gte: last7d } } },
                    { $group: { _id: '$channelId', channelName: { $first: '$channelName' }, count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 10 }
                ]).toArray(),
                
                // Attachments
                this.db.collection('attachments').countDocuments(),
                this.db.collection('attachments').countDocuments({ timestamp: { $gte: last24h } }),
                this.db.collection('attachments').countDocuments({ contentType: /^image\// }),
                
                // Voice
                this.db.collection('voice').countDocuments({ timestamp: { $gte: last24h } }),
                
                // Moderation
                this.db.collection('moderation').countDocuments({ actionType: 'ban' }),
                this.db.collection('moderation').countDocuments({ actionType: { $in: ['mute', 'timeout'] } }),
                this.db.collection('moderation').countDocuments({ timestamp: { $gte: last7d } })
            ]);
            
            return {
                messages: {
                    total: totalMessages,
                    last24h: messages24h,
                    last7d: messages7d,
                    last30d: messages30d,
                    avgPerDay: Math.round(messages30d / 30)
                },
                members: {
                    totalJoins: totalJoins,
                    joins24h: joins24h,
                    joins7d: joins7d,
                    leaves7d: leaves7d,
                    netGrowth7d: joins7d - leaves7d
                },
                activity: {
                    activeUsers24h: activeUsers24h.length,
                    activeUsers7d: activeUsers7d.length
                },
                channels: {
                    topChannels: channelActivity
                },
                attachments: {
                    total: totalAttachments,
                    last24h: attachments24h,
                    images: imageAttachments
                },
                voice: {
                    activity24h: voiceActivity24h
                },
                moderation: {
                    totalBans: totalBans,
                    totalMutes: totalMutes,
                    recent7d: recentModerationActions
                }
            };
        } catch (error) {
            console.error('Error getting server analytics:', error);
            return null;
        }
    }
    
    async getTopUsers(timeframe = 7, limit = 10) {
        if (!this.connected) return [];
        
        try {
            const daysAgo = new Date(Date.now() - (timeframe * 86400000));
            
            const topUsers = await this.db.collection('messages').aggregate([
                { 
                    $match: { 
                        eventType: 'create',
                        timestamp: { $gte: daysAgo }
                    }
                },
                {
                    $group: {
                        _id: '$userId',
                        userName: { $first: '$userName' },
                        userAvatar: { $first: '$userAvatar' },
                        messageCount: { $sum: 1 },
                        channels: { $addToSet: '$channelId' }
                    }
                },
                {
                    $project: {
                        userId: '$_id',
                        userName: 1,
                        userAvatar: 1,
                        messageCount: 1,
                        channelCount: { $size: '$channels' }
                    }
                },
                { $sort: { messageCount: -1 } },
                { $limit: limit }
            ]).toArray();
            
            return topUsers;
        } catch (error) {
            console.error('Error getting top users:', error);
            return [];
        }
    }
    
    async getInviteStats() {
        if (!this.connected) return [];
        
        try {
            const inviteStats = await this.db.collection('members').aggregate([
                { 
                    $match: { 
                        eventType: 'join',
                        'inviteData.code': { $exists: true }
                    }
                },
                {
                    $group: {
                        _id: '$inviteData.code',
                        inviter: { $first: '$inviteData.inviter' },
                        inviterId: { $first: '$inviteData.inviterId' },
                        uses: { $sum: 1 },
                        members: { $push: { id: '$userId', name: '$userName', timestamp: '$timestamp' } }
                    }
                },
                { $sort: { uses: -1 } },
                { $limit: 20 }
            ]).toArray();
            
            return inviteStats;
        } catch (error) {
            console.error('Error getting invite stats:', error);
            return [];
        }
    }
    
    async getMessageTimeline(days = 7) {
        if (!this.connected) return [];
        
        try {
            const daysAgo = new Date(Date.now() - (days * 86400000));
            
            const timeline = await this.db.collection('messages').aggregate([
                { 
                    $match: { 
                        eventType: 'create',
                        timestamp: { $gte: daysAgo }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]).toArray();
            
            return timeline;
        } catch (error) {
            console.error('Error getting message timeline:', error);
            return [];
        }
    }
    
    async getAttachmentStats() {
        if (!this.connected) return null;
        
        try {
            const [
                totalSize,
                byType,
                topUploaders
            ] = await Promise.all([
                // Total size
                this.db.collection('attachments').aggregate([
                    { $group: { _id: null, totalSize: { $sum: '$size' } } }
                ]).toArray(),
                
                // By content type
                this.db.collection('attachments').aggregate([
                    {
                        $group: {
                            _id: '$contentType',
                            count: { $sum: 1 },
                            totalSize: { $sum: '$size' }
                        }
                    },
                    { $sort: { count: -1 } },
                    { $limit: 10 }
                ]).toArray(),
                
                // Top uploaders
                this.db.collection('attachments').aggregate([
                    {
                        $group: {
                            _id: '$userId',
                            userName: { $first: '$userName' },
                            count: { $sum: 1 },
                            totalSize: { $sum: '$size' }
                        }
                    },
                    { $sort: { count: -1 } },
                    { $limit: 10 }
                ]).toArray()
            ]);
            
            return {
                totalSize: totalSize[0]?.totalSize || 0,
                byType: byType,
                topUploaders: topUploaders
            };
        } catch (error) {
            console.error('Error getting attachment stats:', error);
            return null;
        }
    }
    
    async getNewAccountJoins(daysOld = 7) {
        if (!this.connected) return [];
        
        try {
            const joins = await this.db.collection('members').aggregate([
                { 
                    $match: { 
                        eventType: 'join',
                        accountAgeDays: { $lte: daysOld }
                    }
                },
                { $sort: { timestamp: -1 } },
                { $limit: 50 }
            ]).toArray();
            
            return joins;
        } catch (error) {
            console.error('Error getting new account joins:', error);
            return [];
        }
    }
}

module.exports = MongoDBLogger;
