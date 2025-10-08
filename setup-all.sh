#!/bin/bash

echo "🚀 Creating all MongoDB + Dashboard files..."

# Create directories
mkdir -p views/partials public/css public/js

# ============================================
# CREATE mongodb-logger.js
# ============================================
cat > mongodb-logger.js << 'EOF'
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
                userAvatar: message.author?.displayAvatarURL() || null,
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
}

module.exports = MongoDBLogger;
EOF

echo "✅ Created mongodb-logger.js"

# ============================================
# CREATE dashboard.js
# ============================================
cat > dashboard.js << 'EOF'
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');

class Dashboard {
    constructor(client, mongoLogger, config) {
        this.client = client;
        this.mongoLogger = mongoLogger;
        this.config = config;
        this.app = express();
        this.port = config.dashboard.port || 3000;
        
        this.adminPasswordHash = bcrypt.hashSync(config.dashboard.adminPassword, 10);
        
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        this.app.use(session({
            secret: this.config.dashboard.sessionSecret,
            resave: false,
            saveUninitialized: false,
            store: MongoStore.create({
                mongoUrl: this.config.mongodb.uri,
                dbName: this.config.mongodb.database,
                collectionName: 'sessions'
            }),
            cookie: {
                maxAge: 1000 * 60 * 60 * 24
            }
        }));
        
        this.app.use(express.static('public'));
        this.app.set('view engine', 'ejs');
        this.app.set('views', './views');
    }

    requireAuth(req, res, next) {
        if (req.session && req.session.authenticated) {
            return next();
        }
        res.redirect('/login');
    }

    setupRoutes() {
        this.app.get('/login', (req, res) => {
            if (req.session.authenticated) {
                return res.redirect('/');
            }
            res.render('login', { error: null });
        });

        this.app.post('/login', async (req, res) => {
            const { password } = req.body;
            
            if (bcrypt.compareSync(password, this.adminPasswordHash)) {
                req.session.authenticated = true;
                res.redirect('/');
            } else {
                res.render('login', { error: 'Invalid password' });
            }
        });

        this.app.get('/logout', (req, res) => {
            req.session.destroy();
            res.redirect('/login');
        });

        this.app.get('/', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = await this.mongoLogger.getStats();
                const recentMessages = await this.mongoLogger.getRecentMessages(50);
                
                res.render('dashboard', {
                    client: this.client,
                    stats,
                    recentMessages
                });
            } catch (error) {
                console.error('Dashboard error:', error);
                res.status(500).send('Error loading dashboard');
            }
        });

        this.app.get('/messages', this.requireAuth.bind(this), async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = 100;
                const skip = (page - 1) * limit;
                
                const messages = await this.mongoLogger.db.collection('messages')
                    .find({})
                    .sort({ timestamp: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();
                
                const totalMessages = await this.mongoLogger.db.collection('messages').countDocuments();
                const totalPages = Math.ceil(totalMessages / limit);
                
                res.render('messages', {
                    messages,
                    currentPage: page,
                    totalPages,
                    client: this.client
                });
            } catch (error) {
                console.error('Messages page error:', error);
                res.status(500).send('Error loading messages');
            }
        });

        this.app.get('/deleted', this.requireAuth.bind(this), async (req, res) => {
            try {
                const hours = parseInt(req.query.hours) || 24;
                const messages = await this.mongoLogger.getDeletedMessages(hours);
                
                res.render('deleted', {
                    messages,
                    hours,
                    client: this.client
                });
            } catch (error) {
                console.error('Deleted messages error:', error);
                res.status(500).send('Error loading deleted messages');
            }
        });

        this.app.get('/user/:userId', this.requireAuth.bind(this), async (req, res) => {
            try {
                const userId = req.params.userId;
                
                const [messages, moderationHistory, memberData] = await Promise.all([
                    this.mongoLogger.getUserMessages(userId, 200),
                    this.mongoLogger.getModerationHistory(userId),
                    this.mongoLogger.db.collection('members').find({ userId }).sort({ timestamp: -1 }).toArray()
                ]);
                
                let discordUser = null;
                try {
                    discordUser = await this.client.users.fetch(userId);
                } catch (e) {
                    console.log('Could not fetch user from Discord');
                }
                
                res.render('user', {
                    userId,
                    discordUser,
                    messages,
                    moderationHistory,
                    memberData,
                    client: this.client
                });
            } catch (error) {
                console.error('User lookup error:', error);
                res.status(500).send('Error loading user data');
            }
        });

        this.app.get('/api/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = await this.mongoLogger.getStats();
                res.json({ success: true, stats });
            } catch (error) {
                console.error('Stats API error:', error);
                res.json({ success: false, error: error.message });
            }
        });
    }

    start() {
        this.app.listen(this.port, () => {
            console.log(`🌐 Dashboard running at http://localhost:${this.port}`);
            console.log(`   Login with password from config.json`);
        });
    }
}

module.exports = Dashboard;
EOF

echo "✅ Created dashboard.js"

# ============================================
# CREATE views/login.ejs
# ============================================
cat > views/login.ejs << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Discord Logger Dashboard</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body class="login-page">
    <div class="login-container">
        <div class="login-box">
            <h1>🔐 Discord Logger</h1>
            <p>Admin Dashboard</p>
            
            <% if (error) { %>
                <div class="error-message"><%= error %></div>
            <% } %>
            
            <form method="POST" action="/login">
                <input type="password" name="password" placeholder="Enter password" required autofocus>
                <button type="submit">Login</button>
            </form>
        </div>
    </div>
</body>
</html>
EOF

echo "✅ Created views/login.ejs"

# ============================================
# CREATE views/partials/header.ejs
# ============================================
cat > views/partials/header.ejs << 'EOF'
<nav class="navbar">
    <div class="nav-brand">
        <h2>🤖 <%= client.user.tag %></h2>
    </div>
    <div class="nav-links">
        <a href="/">Dashboard</a>
        <a href="/messages">Messages</a>
        <a href="/deleted">Deleted</a>
        <a href="/user/search">User Lookup</a>
        <a href="/logout" class="logout">Logout</a>
    </div>
</nav>
EOF

echo "✅ Created views/partials/header.ejs"

# ============================================
# CREATE views/dashboard.ejs
# ============================================
cat > views/dashboard.ejs << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dashboard - Discord Logger</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <%- include('partials/header') %>
    
    <div class="container">
        <h1>📊 Dashboard Overview</h1>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">💬</div>
                <div class="stat-info">
                    <div class="stat-value"><%= stats.totalMessages.toLocaleString() %></div>
                    <div class="stat-label">Total Messages</div>
                    <div class="stat-change">+<%= stats.last24h.messages %> today</div>
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">👥</div>
                <div class="stat-info">
                    <div class="stat-value"><%= stats.totalMembers.toLocaleString() %></div>
                    <div class="stat-label">Total Members Joined</div>
                    <div class="stat-change">+<%= stats.last24h.joins %> today</div>
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">🔨</div>
                <div class="stat-info">
                    <div class="stat-value"><%= stats.totalModActions.toLocaleString() %></div>
                    <div class="stat-label">Moderation Actions</div>
                </div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">🗑️</div>
                <div class="stat-info">
                    <div class="stat-value"><%= stats.last24h.deletes.toLocaleString() %></div>
                    <div class="stat-label">Deleted Messages (24h)</div>
                </div>
            </div>
        </div>
        
        <h2>📝 Recent Messages</h2>
        <div class="messages-container">
            <% recentMessages.forEach(msg => { %>
                <div class="message-item <%= msg.eventType %>">
                    <div class="message-header">
                        <span class="message-type <%= msg.eventType %>"><%= msg.eventType.toUpperCase() %></span>
                        <span class="message-user">
                            <a href="/user/<%= msg.userId %>"><%= msg.userName %></a>
                        </span>
                        <span class="message-channel">#<%= msg.channelName %></span>
                        <span class="message-time"><%= new Date(msg.timestamp).toLocaleString() %></span>
                    </div>
                    <div class="message-content">
                        <%= msg.content || '[No content]' %>
                        <% if (msg.attachmentCount > 0) { %>
                            <span class="attachment-badge">📎 <%= msg.attachmentCount %></span>
                        <% } %>
                    </div>
                </div>
            <% }); %>
        </div>
        
        <div class="view-more">
            <a href="/messages" class="btn btn-primary">View All Messages →</a>
        </div>
    </div>
</body>
</html>
EOF

echo "✅ Created views/dashboard.ejs"

# ============================================
# CREATE views/messages.ejs
# ============================================
cat > views/messages.ejs << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Messages - Discord Logger</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <%- include('partials/header') %>
    
    <div class="container">
        <h1>💬 All Messages</h1>
        
        <div class="messages-container">
            <% messages.forEach(msg => { %>
                <div class="message-item <%= msg.eventType %>">
                    <div class="message-header">
                        <span class="message-type <%= msg.eventType %>"><%= msg.eventType.toUpperCase() %></span>
                        <span class="message-user">
                            <a href="/user/<%= msg.userId %>"><%= msg.userName %></a>
                        </span>
                        <span class="message-channel">#<%= msg.channelName %></span>
                        <span class="message-time"><%= new Date(msg.timestamp).toLocaleString() %></span>
                    </div>
                    <div class="message-content">
                        <%= msg.content || '[No content]' %>
                        <% if (msg.attachmentCount > 0) { %>
                            <span class="attachment-badge">📎 <%= msg.attachmentCount %></span>
                        <% } %>
                    </div>
                </div>
            <% }); %>
        </div>
        
        <div class="pagination">
            <% if (currentPage > 1) { %>
                <a href="?page=<%= currentPage - 1 %>" class="btn">← Previous</a>
            <% } %>
            <span>Page <%= currentPage %> of <%= totalPages %></span>
            <% if (currentPage < totalPages) { %>
                <a href="?page=<%= currentPage + 1 %>" class="btn">Next →</a>
            <% } %>
        </div>
    </div>
</body>
</html>
EOF

echo "✅ Created views/messages.ejs"

# ============================================
# CREATE views/deleted.ejs
# ============================================
cat > views/deleted.ejs << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Deleted Messages - Discord Logger</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <%- include('partials/header') %>
    
    <div class="container">
        <h1>🗑️ Deleted Messages</h1>
        
        <div class="filter-box">
            <label>Time Range:</label>
            <select onchange="window.location='?hours=' + this.value">
                <option value="1" <%= hours === 1 ? 'selected' : '' %>>Last Hour</option>
                <option value="6" <%= hours === 6 ? 'selected' : '' %>>Last 6 Hours</option>
                <option value="24" <%= hours === 24 ? 'selected' : '' %>>Last 24 Hours</option>
                <option value="168" <%= hours === 168 ? 'selected' : '' %>>Last Week</option>
                <option value="720" <%= hours === 720 ? 'selected' : '' %>>Last Month</option>
            </select>
        </div>
        
        <p class="result-count">Found <%= messages.length %> deleted messages</p>
        
        <div class="messages-container">
            <% messages.forEach(msg => { %>
                <div class="message-item deleted">
                    <div class="message-header">
                        <span class="message-type delete">DELETED</span>
                        <span class="message-user">
                            <a href="/user/<%= msg.userId %>"><%= msg.userName %></a>
                        </span>
                        <span class="message-channel">#<%= msg.channelName %></span>
                        <span class="message-time">
                            Deleted: <%= new Date(msg.deletedTimestamp).toLocaleString() %>
                        </span>
                    </div>
                    <div class="message-content">
                        <%= msg.content %>
                        <% if (msg.attachmentCount > 0) { %>
                            <span class="attachment-badge">📎 <%= msg.attachmentCount %> (may be unavailable)</span>
                        <% } %>
                    </div>
                    <% if (msg.originalTimestamp) { %>
                        <div class="message-meta">
                            Originally sent: <%= new Date(msg.originalTimestamp).toLocaleString() %>
                        </div>
                    <% } %>
                </div>
            <% }); %>
        </div>
    </div>
</body>
</html>
EOF

echo "✅ Created views/deleted.ejs"

# ============================================
# CREATE views/user.ejs
# ============================================
cat > views/user.ejs << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User Profile - Discord Logger</title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <%- include('partials/header') %>
    
    <div class="container">
        <div class="user-profile">
            <% if (discordUser) { %>
                <img src="<%= discordUser.displayAvatarURL({ size: 128 }) %>" alt="Avatar" class="user-avatar">
                <div class="user-info">
                    <h1><%= discordUser.tag %></h1>
                    <p>ID: <%= userId %></p>
                    <p>Created: <%= discordUser.createdAt.toLocaleString() %></p>
                    <% if (discordUser.bot) { %>
                        <span class="badge bot">BOT</span>
                    <% } %>
                </div>
            <% } else { %>
                <h1>User <%= userId %></h1>
                <p class="text-muted">User not in cache</p>
            <% } %>
        </div>
        
        <div class="tabs">
            <button class="tab-btn active" onclick="showTab('messages')">Messages (<%= messages.length %>)</button>
            <button class="tab-btn" onclick="showTab('moderation')">Mod History (<%= moderationHistory.length %>)</button>
            <button class="tab-btn" onclick="showTab('member')">Member Data (<%= memberData.length %>)</button>
        </div>
        
        <div id="messages-tab" class="tab-content active">
            <h2>Message History</h2>
            <div class="messages-container">
                <% messages.forEach(msg => { %>
                    <div class="message-item <%= msg.eventType %>">
                        <div class="message-header">
                            <span class="message-type <%= msg.eventType %>"><%= msg.eventType.toUpperCase() %></span>
                            <span class="message-channel">#<%= msg.channelName %></span>
                            <span class="message-time"><%= new Date(msg.timestamp || msg.deletedTimestamp).toLocaleString() %></span>
                        </div>
                        <div class="message-content">
                            <% if (msg.eventType === 'edit') { %>
                                <div class="edit-before">Before: <%= msg.contentBefore %></div>
                                <div class="edit-after">After: <%= msg.contentAfter %></div>
                            <% } else { %>
                                <%= msg.content || '[No content]' %>
                            <% } %>
                        </div>
                    </div>
                <% }); %>
            </div>
        </div>
        
        <div id="moderation-tab" class="tab-content">
            <h2>Moderation History</h2>
            <% if (moderationHistory.length === 0) { %>
                <p class="text-muted">No moderation actions on record</p>
            <% } else { %>
                <div class="mod-actions">
                    <% moderationHistory.forEach(action => { %>
                        <div class="mod-action <%= action.actionType %>">
                            <div class="mod-header">
                                <span class="mod-type"><%= action.actionType.toUpperCase() %></span>
                                <span class="mod-time"><%= new Date(action.timestamp).toLocaleString() %></span>
                            </div>
                            <div class="mod-details">
                                <% if (action.moderatorName) { %>
                                    <p><strong>Moderator:</strong> <%= action.moderatorName %></p>
                                <% } %>
                                <% if (action.reason) { %>
                                    <p><strong>Reason:</strong> <%= action.reason %></p>
                                <% } %>
                            </div>
                        </div>
                    <% }); %>
                </div>
            <% } %>
        </div>
        
        <div id="member-tab" class="tab-content">
            <h2>Member Activity</h2>
            <div class="member-events">
                <% memberData.forEach(event => { %>
                    <div class="member-event <%= event.eventType %>">
                        <div class="event-header">
                            <span class="event-type"><%= event.eventType.toUpperCase().replace('_', ' ') %></span>
                            <span class="event-time"><%= new Date(event.timestamp).toLocaleString() %></span>
                        </div>
                        <div class="event-details">
                            <% if (event.inviteData) { %>
                                <p><strong>Invited by:</strong> <%= event.inviteData.inviter %> (code: <%= event.inviteData.code %>)</p>
                            <% } %>
                            <% if (event.accountAgeDays !== undefined) { %>
                                <p><strong>Account age:</strong> <%= event.accountAgeDays %> days old</p>
                            <% } %>
                        </div>
                    </div>
                <% }); %>
            </div>
        </div>
    </div>
    
    <script>
        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            
            document.getElementById(tabName + '-tab').classList.add('active');
            event.target.classList.add('active');
        }
    </script>
</body>
</html>
EOF

echo "✅ Created views/user.ejs"

# ============================================
# CREATE public/css/style.css
# ============================================
cat > public/css/style.css << 'EOF'
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: #1e1e1e;
    color: #e0e0e0;
    line-height: 1.6;
}

.navbar {
    background: #2c2c2c;
    padding: 1rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
}

.nav-brand h2 {
    color: #5865f2;
}

.nav-links {
    display: flex;
    gap: 1.5rem;
}

.nav-links a {
    color: #b9bbbe;
    text-decoration: none;
    transition: color 0.3s;
}

.nav-links a:hover {
    color: #fff;
}

.nav-links a.logout {
    color: #ed4245;
}

.container {
    max-width: 1400px;
    margin: 2rem auto;
    padding: 0 2rem;
}

.stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1.5rem;
    margin: 2rem 0;
}

.stat-card {
    background: #2c2c2c;
    padding: 1.5rem;
    border-radius: 10px;
    display: flex;
    align-items: center;
    gap: 1rem;
    box-shadow: 0 4px 6px rgba(0,0,0,0.2);
}

.stat-icon {
    font-size: 3rem;
}

.stat-value {
    font-size: 2rem;
    font-weight: bold;
    color: #5865f2;
}

.stat-label {
    color: #b9bbbe;
    font-size: 0.9rem;
}

.stat-change {
    color: #43b581;
    font-size: 0.85rem;
}

.messages-container {
    background: #2c2c2c;
    border-radius: 10px;
    padding: 1rem;
    margin: 1rem 0;
}

.message-item {
    background: #383838;
    padding: 1rem;
    margin-bottom: 0.75rem;
    border-radius: 8px;
    border-left: 4px solid #5865f2;
}

.message-item.delete {
    border-left-color: #ed4245;
    background: #3a2d2d;
}

.message-item.edit {
    border-left-color: #faa61a;
}

.message-header {
    display: flex;
    gap: 1rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
}

.message-type {
    background: #5865f2;
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: bold;
}

.message-type.delete {
    background: #ed4245;
}

.message-type.edit {
    background: #faa61a;
}

.message-user a {
    color: #00b0f4;
    text-decoration: none;
    font-weight: bold;
}

.message-user a:hover {
    text-decoration: underline;
}

.message-channel {
    color: #72767d;
}

.message-time {
    color: #72767d;
    font-size: 0.85rem;
    margin-left: auto;
}

.message-content {
    color: #dcddde;
    padding-left: 1rem;
    word-wrap: break-word;
}

.message-meta {
    color: #72767d;
    font-size: 0.85rem;
    padding-left: 1rem;
    margin-top: 0.5rem;
}

.attachment-badge {
    background: #4e5d94;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
    margin-left: 0.5rem;
}

.login-page {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-container {
    width: 100%;
    max-width: 400px;
    padding: 2rem;
}

.login-box {
    background: #2c2c2c;
    padding: 3rem;
    border-radius: 15px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.4);
    text-align: center;
}

.login-box h1 {
    color: #5865f2;
    margin-bottom: 0.5rem;
}

.login-box input {
    width: 100%;
    padding: 1rem;
    margin: 1rem 0;
    border: 2px solid #40444b;
    background: #383838;
    color: white;
    border-radius: 5px;
    font-size: 1rem;
}

.login-box button {
    width: 100%;
    padding: 1rem;
    background: #5865f2;
    color: white;
    border: none;
    border-radius: 5px;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.3s;
}

.login-box button:hover {
    background: #4752c4;
}

.error-message {
    background: #ed4245;
    color: white;
    padding: 0.75rem;
    border-radius: 5px;
    margin-bottom: 1rem;
}

.btn {
    display: inline-block;
    padding: 0.75rem 1.5rem;
    background: #5865f2;
    color: white;
    text-decoration: none;
    border-radius: 5px;
    transition: background 0.3s;
    border: none;
    cursor: pointer;
}

.btn:hover {
    background: #4752c4;
}

.btn-primary {
    background: #5865f2;
}

.view-more {
    text-align: center;
    margin: 2rem 0;
}

.filter-box {
    background: #2c2c2c;
    padding: 1rem;
    border-radius: 10px;
    margin: 1rem 0;
    display: flex;
    align-items: center;
    gap: 1rem;
}

.filter-box select {
    padding: 0.5rem;
    background: #383838;
    border: 2px solid #40444b;
    color: white;
    border-radius: 5px;
}

.result-count {
    color: #b9bbbe;
    margin: 1rem 0;
}

.pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 1rem;
    margin: 2rem 0;
}

.user-profile {
    background: #2c2c2c;
    padding: 2rem;
    border-radius: 10px;
    display: flex;
    align-items: center;
    gap: 2rem;
    margin: 2rem 0;
}

.user-avatar {
    width: 128px;
    height: 128px;
    border-radius: 50%;
}

.badge.bot {
    background: #5865f2;
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 0.8rem;
}

.text-muted {
    color: #72767d;
}

.tabs {
    display: flex;
    gap: 1rem;
    margin: 2rem 0 1rem 0;
}

.tab-btn {
    padding: 0.75rem 1.5rem;
    background: #2c2c2c;
    color: #b9bbbe;
    border: none;
    border-radius: 5px 5px 0 0;
    cursor: pointer;
    transition: all 0.3s;
}

.tab-btn.active {
    background: #5865f2;
    color: white;
}

.tab-content {
    display: none;
}

.tab-content.active {
    display: block;
}

.mod-actions, .member-events {
    background: #2c2c2c;
    border-radius: 10px;
    padding: 1rem;
}

.mod-action, .member-event {
    background: #383838;
    padding: 1rem;
    margin-bottom: 0.75rem;
    border-radius: 8px;
    border-left: 4px solid #ed4245;
}

.mod-header, .event-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.5rem;
}

.mod-type, .event-type {
    background: #ed4245;
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: bold;
}

.mod-time, .event-time {
    color: #72767d;
    font-size: 0.85rem;
}

.edit-before {
    color: #ed4245;
    padding: 0.5rem;
    background: #3a2d2d;
    border-radius: 4px;
    margin-bottom: 0.5rem;
}

.edit-after {
    color: #43b581;
    padding: 0.5rem;
    background: #2d3a2d;
    border-radius: 4px;
}

@media (max-width: 768px) {
    .nav-links {
        flex-wrap: wrap;
    }
    
    .stats-grid {
        grid-template-columns: 1fr;
    }
    
    .user-profile {
        flex-direction: column;
        text-align: center;
    }
}
EOF

echo "✅ Created public/css/style.css"

echo ""
echo "========================================="
echo "✅ ALL FILES CREATED SUCCESSFULLY!"
echo "========================================="
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. Update your config.json with MongoDB credentials:"
echo "   nano config.json"
echo ""
echo "2. Add these sections to config.json:"
echo '   "mongodb": {'
echo '     "enabled": true,'
echo '     "uri": "mongodb://discord_bot:YOUR_PASSWORD@localhost:27017/discord_logs?authSource=admin",'
echo '     "database": "discord_logs"'
echo '   },'
echo '   "dashboard": {'
echo '     "enabled": true,'
echo '     "port": 3000,'
echo '     "adminPassword": "YourSecurePassword123!",'
echo '     "sessionSecret": "random-secret-xyz789"'
echo '   }'
echo ""
echo "3. Update index.js to integrate MongoDB (see instructions below)"
echo ""
echo "4. Restart your bot:"
echo "   pm2 restart discord-logger-bot"
echo ""
echo "5. Access dashboard at: http://YOUR_VPS_IP:3000"
echo ""
