const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const flash = require('express-flash');
const path = require('path');

class Dashboard {
    constructor(client, mongoLogger, config) {
        this.client = client;
        this.mongoLogger = mongoLogger;
        this.config = config;
        this.app = express();
        this.port = config.dashboard.port || 3000;
        
        this.adminPasswordHash = bcrypt.hashSync(config.dashboard.adminPassword, 10);
        
        this.setupMiddleware();
        this.setupPassport();
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
                maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
            }
        }));
        
        this.app.use(flash());
        this.app.use(passport.initialize());
        this.app.use(passport.session());
        
        this.app.use(express.static('public'));
        this.app.set('view engine', 'ejs');
        this.app.set('views', path.join(__dirname, 'views'));
        
        // Make user available to all templates
        this.app.use((req, res, next) => {
            res.locals.user = req.user;
            res.locals.success = req.flash('success');
            res.locals.error = req.flash('error');
            next();
        });
    }

    setupPassport() {
        if (!this.config.dashboard.oauth || !this.config.dashboard.oauth.enabled) {
            console.log('⚠️ Discord OAuth disabled');
            return;
        }

        const oauthConfig = this.config.dashboard.oauth;
        
        passport.serializeUser((user, done) => {
            done(null, user.id);
        });

        passport.deserializeUser(async (id, done) => {
            try {
                const user = await this.client.users.fetch(id);
                done(null, {
                    id: user.id,
                    username: user.username,
                    discriminator: user.discriminator,
                    avatar: user.displayAvatarURL(),
                    tag: user.tag,
                    isAdmin: oauthConfig.adminUserIds.includes(user.id)
                });
            } catch (error) {
                done(error, null);
            }
        });

        passport.use(new DiscordStrategy({
            clientID: oauthConfig.clientId,
            clientSecret: oauthConfig.clientSecret,
            callbackURL: oauthConfig.callbackUrl,
            scope: ['identify', 'guilds']
        }, async (accessToken, refreshToken, profile, done) => {
            try {
                const isAdmin = oauthConfig.adminUserIds.includes(profile.id);
                
                if (!isAdmin) {
                    return done(null, false, { message: 'Unauthorized - Admin access required' });
                }
                
                return done(null, {
                    id: profile.id,
                    username: profile.username,
                    discriminator: profile.discriminator,
                    avatar: profile.avatar ? 
                        `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : 
                        'https://cdn.discordapp.com/embed/avatars/0.png',
                    tag: `${profile.username}#${profile.discriminator}`,
                    isAdmin: true
                });
            } catch (error) {
                return done(error, null);
            }
        }));
    }

    requireAuth(req, res, next) {
        // Allow both OAuth and password login
        if (req.isAuthenticated() || (req.session && req.session.passwordAuth)) {
            return next();
        }
        res.redirect('/login');
    }

    requireAdmin(req, res, next) {
        if (req.user?.isAdmin || req.session?.passwordAuth) {
            return next();
        }
        req.flash('error', 'Admin access required');
        res.redirect('/login');
    }

    setupRoutes() {
        // ============================================
        // AUTH ROUTES
        // ============================================
        
        // Login page
        this.app.get('/login', (req, res) => {
            if (req.isAuthenticated() || req.session.passwordAuth) {
                return res.redirect('/');
            }
            res.render('login', { 
                error: null,
                oauthEnabled: this.config.dashboard.oauth?.enabled || false
            });
        });

        // Password login (fallback)
        this.app.post('/login', async (req, res) => {
            const { password } = req.body;
            
            if (bcrypt.compareSync(password, this.adminPasswordHash)) {
                req.session.passwordAuth = true;
                req.session.user = { username: 'Admin', isAdmin: true };
                res.redirect('/');
            } else {
                res.render('login', { 
                    error: 'Invalid password',
                    oauthEnabled: this.config.dashboard.oauth?.enabled || false
                });
            }
        });

        // Discord OAuth routes
        if (this.config.dashboard.oauth?.enabled) {
            this.app.get('/auth/discord', 
                passport.authenticate('discord', { scope: ['identify', 'guilds'] })
            );

            this.app.get('/auth/callback',
                passport.authenticate('discord', { 
                    failureRedirect: '/login',
                    failureFlash: true
                }),
                (req, res) => {
                    req.flash('success', `Welcome back, ${req.user.username}!`);
                    res.redirect('/');
                }
            );
        }

        // Logout
        this.app.get('/logout', (req, res) => {
            req.logout(() => {});
            req.session.destroy();
            res.redirect('/login');
        });

        // ============================================
        // DASHBOARD HOME
        // ============================================
        
        this.app.get('/', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = await this.mongoLogger.getStats();
                const recentMessages = await this.mongoLogger.getRecentMessages(50);
                
                res.render('dashboard', {
                    client: this.client,
                    stats: stats || {},
                    recentMessages: recentMessages || []
                });
            } catch (error) {
                console.error('Dashboard error:', error);
                req.flash('error', 'Error loading dashboard');
                res.redirect('/login');
            }
        });

        // ============================================
        // MESSAGES PAGE
        // ============================================
        
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

        // ============================================
        // DELETED MESSAGES PAGE
        // ============================================
        
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

        // ============================================
        // USER PROFILE PAGE
        // ============================================
        
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

        // ============================================
        // INVITE TRACKING PAGE
        // ============================================
        
        this.app.get('/invites', this.requireAuth.bind(this), async (req, res) => {
            try {
                const inviteStats = await this.getInviteLeaderboard();
                const recentInvites = await this.getRecentInvites(50);
                
                res.render('invites', {
                    client: this.client,
                    inviteStats: inviteStats,
                    recentInvites: recentInvites
                });
            } catch (error) {
                console.error('Invites page error:', error);
                req.flash('error', 'Error loading invites');
                res.redirect('/');
            }
        });

        // ============================================
        // MEMBERS PAGE
        // ============================================
        
        this.app.get('/members', this.requireAuth.bind(this), async (req, res) => {
            try {
                const eventType = req.query.type || 'all';
                const page = parseInt(req.query.page) || 1;
                const limit = 50;
                const skip = (page - 1) * limit;
                
                let query = {};
                if (eventType !== 'all') {
                    query.eventType = eventType;
                }
                
                const [events, totalEvents] = await Promise.all([
                    this.mongoLogger.db.collection('members')
                        .find(query)
                        .sort({ timestamp: -1 })
                        .skip(skip)
                        .limit(limit)
                        .toArray(),
                    this.mongoLogger.db.collection('members').countDocuments(query)
                ]);
                
                const totalPages = Math.ceil(totalEvents / limit);
                
                res.render('members', {
                    client: this.client,
                    events,
                    eventType,
                    currentPage: page,
                    totalPages
                });
            } catch (error) {
                console.error('Members page error:', error);
                req.flash('error', 'Error loading members');
                res.redirect('/');
            }
        });

        // ============================================
        // MODERATION PAGE
        // ============================================
        
        this.app.get('/moderation', this.requireAuth.bind(this), async (req, res) => {
            try {
                const actionType = req.query.type || 'all';
                const page = parseInt(req.query.page) || 1;
                const limit = 50;
                const skip = (page - 1) * limit;
                
                let query = {};
                if (actionType !== 'all') {
                    query.actionType = actionType;
                }
                
                const [actions, totalActions, stats] = await Promise.all([
                    this.mongoLogger.db.collection('moderation')
                        .find(query)
                        .sort({ timestamp: -1 })
                        .skip(skip)
                        .limit(limit)
                        .toArray(),
                    this.mongoLogger.db.collection('moderation').countDocuments(query),
                    this.getModerationStats()
                ]);
                
                const totalPages = Math.ceil(totalActions / limit);
                
                res.render('moderation', {
                    client: this.client,
                    actions,
                    stats,
                    actionType,
                    currentPage: page,
                    totalPages
                });
            } catch (error) {
                console.error('Moderation page error:', error);
                req.flash('error', 'Error loading moderation log');
                res.redirect('/');
            }
        });

        // ============================================
        // ATTACHMENTS PAGE
        // ============================================
        
        this.app.get('/attachments', this.requireAuth.bind(this), async (req, res) => {
            try {
                const fileType = req.query.type || 'all';
                const page = parseInt(req.query.page) || 1;
                const limit = 50;
                const skip = (page - 1) * limit;
                
                let query = {};
                if (fileType !== 'all') {
                    if (fileType === 'image') {
                        query.contentType = /^image\//;
                    } else if (fileType === 'video') {
                        query.contentType = /^video\//;
                    } else if (fileType === 'audio') {
                        query.contentType = /^audio\//;
                    } else if (fileType === 'other') {
                        query.contentType = { $not: /^(image|video|audio)\// };
                    }
                }
                
                const [attachments, totalAttachments, stats] = await Promise.all([
                    this.mongoLogger.db.collection('attachments')
                        .find(query)
                        .sort({ timestamp: -1 })
                        .skip(skip)
                        .limit(limit)
                        .toArray(),
                    this.mongoLogger.db.collection('attachments').countDocuments(query),
                    this.getAttachmentStats()
                ]);
                
                const totalPages = Math.ceil(totalAttachments / limit);
                
                res.render('attachments', {
                    client: this.client,
                    attachments,
                    stats,
                    fileType,
                    currentPage: page,
                    totalPages
                });
            } catch (error) {
                console.error('Attachments page error:', error);
                req.flash('error', 'Error loading attachments');
                res.redirect('/');
            }
        });

        // ============================================
        // VOICE PAGE
        // ============================================
        
        this.app.get('/voice', this.requireAuth.bind(this), async (req, res) => {
            try {
                const actionType = req.query.type || 'all';
                const page = parseInt(req.query.page) || 1;
                const limit = 50;
                const skip = (page - 1) * limit;
                
                let query = {};
                if (actionType !== 'all') {
                    query.actionType = actionType;
                }
                
                const [events, totalEvents] = await Promise.all([
                    this.mongoLogger.db.collection('voice')
                        .find(query)
                        .sort({ timestamp: -1 })
                        .skip(skip)
                        .limit(limit)
                        .toArray(),
                    this.mongoLogger.db.collection('voice').countDocuments(query)
                ]);
                
                const totalPages = Math.ceil(totalEvents / limit);
                
                res.render('voice', {
                    client: this.client,
                    events,
                    actionType,
                    currentPage: page,
                    totalPages
                });
            } catch (error) {
                console.error('Voice page error:', error);
                req.flash('error', 'Error loading voice activity');
                res.redirect('/');
            }
        });

        // ============================================
        // ANALYTICS PAGE
        // ============================================
        
        this.app.get('/analytics', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = await this.mongoLogger.getServerAnalytics();
                
                res.render('analytics', {
                    client: this.client,
                    stats: stats || {}
                });
            } catch (error) {
                console.error('Analytics page error:', error);
                req.flash('error', 'Error loading analytics');
                res.redirect('/');
            }
        });

        // ============================================
        // CUSTOM COMMANDS PAGE
        // ============================================
        
        this.app.get('/commands', this.requireAuth.bind(this), async (req, res) => {
            try {
                const commands = await this.mongoLogger.db.collection('customCommands')
                    .find({})
                    .sort({ trigger: 1 })
                    .toArray();
                
                res.render('commands', {
                    client: this.client,
                    commands: commands || []
                });
            } catch (error) {
                console.error('Commands page error:', error);
                req.flash('error', 'Error loading commands');
                res.redirect('/');
            }
        });

        // Create custom command
        this.app.post('/commands/create', this.requireAdmin.bind(this), async (req, res) => {
            try {
                const { trigger, response, enabled, cooldown } = req.body;
                
                const command = {
                    trigger: trigger.toLowerCase(),
                    response: response,
                    enabled: enabled === 'on',
                    cooldown: parseInt(cooldown) || 0,
                    createdBy: req.user?.id || 'admin',
                    createdAt: new Date(),
                    uses: 0
                };
                
                await this.mongoLogger.db.collection('customCommands').insertOne(command);
                
                req.flash('success', `Command "${trigger}" created!`);
                res.redirect('/commands');
            } catch (error) {
                console.error('Create command error:', error);
                req.flash('error', 'Error creating command');
                res.redirect('/commands');
            }
        });

        // Delete custom command
        this.app.post('/commands/delete/:id', this.requireAdmin.bind(this), async (req, res) => {
            try {
                const { ObjectId } = require('mongodb');
                await this.mongoLogger.db.collection('customCommands')
                    .deleteOne({ _id: new ObjectId(req.params.id) });
                
                req.flash('success', 'Command deleted');
                res.redirect('/commands');
            } catch (error) {
                console.error('Delete command error:', error);
                req.flash('error', 'Error deleting command');
                res.redirect('/commands');
            }
        });

        // Toggle command status
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
                
                res.json({ success: true, enabled: !command.enabled });
            } catch (error) {
                console.error('Toggle command error:', error);
                res.json({ success: false, error: error.message });
            }
        });

        // ============================================
        // EXECUTE COMMANDS FROM DASHBOARD
        // ============================================
        
        this.app.post('/execute', this.requireAdmin.bind(this), async (req, res) => {
            try {
                const { command, channelId } = req.body;
                
                if (!command || !channelId) {
                    return res.json({ success: false, error: 'Missing command or channel' });
                }
                
                const channel = await this.client.channels.fetch(channelId);
                if (!channel || !channel.isTextBased()) {
                    return res.json({ success: false, error: 'Invalid channel' });
                }
                
                // Log the command execution
                await this.mongoLogger.db.collection('commandExecutions').insertOne({
                    command: command,
                    channelId: channelId,
                    executedBy: req.user?.id || 'admin',
                    executedAt: new Date()
                });
                
                // Send the command as bot
                await channel.send(command);
                
                res.json({ success: true, message: 'Command executed' });
            } catch (error) {
                console.error('Execute command error:', error);
                res.json({ success: false, error: error.message });
            }
        });

        // Get channels for command execution
        this.app.get('/api/channels', this.requireAuth.bind(this), async (req, res) => {
            try {
                const guild = this.client.guilds.cache.first();
                const channels = guild.channels.cache
                    .filter(c => c.isTextBased())
                    .map(c => ({
                        id: c.id,
                        name: c.name,
                        type: c.type
                    }));
                
                res.json({ success: true, channels });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        // ============================================
        // API - STATS
        // ============================================
        
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

    // ============================================
    // HELPER METHODS
    // ============================================
    
    async getInviteLeaderboard() {
        try {
            const inviteData = await this.mongoLogger.db.collection('members').aggregate([
                { 
                    $match: { 
                        eventType: 'join',
                        'inviteData.inviterId': { $exists: true }
                    }
                },
                {
                    $group: {
                        _id: '$inviteData.inviterId',
                        inviter: { $first: '$inviteData.inviter' },
                        totalInvites: { $sum: 1 },
                        members: { 
                            $push: { 
                                userId: '$userId', 
                                userName: '$userName',
                                timestamp: '$timestamp' 
                            } 
                        }
                    }
                },
                { $sort: { totalInvites: -1 } },
                { $limit: 50 }
            ]).toArray();
            
            return inviteData;
        } catch (error) {
            console.error('Error getting invite leaderboard:', error);
            return [];
        }
    }

    async getRecentInvites(limit = 50) {
        try {
            const recentInvites = await this.mongoLogger.db.collection('members')
                .find({ 
                    eventType: 'join',
                    'inviteData.code': { $exists: true }
                })
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();
            
            return recentInvites;
        } catch (error) {
            console.error('Error getting recent invites:', error);
            return [];
        }
    }

    async getModerationStats() {
        try {
            const last7Days = new Date(Date.now() - 7 * 86400000);
            
            const [totalBans, totalMutes, recentActions] = await Promise.all([
                this.mongoLogger.db.collection('moderation').countDocuments({ actionType: 'ban' }),
                this.mongoLogger.db.collection('moderation').countDocuments({ 
                    actionType: { $in: ['mute', 'timeout'] } 
                }),
                this.mongoLogger.db.collection('moderation').countDocuments({ 
                    timestamp: { $gte: last7Days } 
                })
            ]);
            
            return { totalBans, totalMutes, recentActions };
        } catch (error) {
            console.error('Error getting moderation stats:', error);
            return { totalBans: 0, totalMutes: 0, recentActions: 0 };
        }
    }

    async getAttachmentStats() {
        try {
            const [statsArray] = await Promise.all([
                this.mongoLogger.db.collection('attachments').aggregate([
                    {
                        $group: {
                            _id: null,
                            totalAttachments: { $sum: 1 },
                            totalSize: { $sum: '$size' },
                            imageCount: {
                                $sum: {
                                    $cond: [{ $regexMatch: { input: '$contentType', regex: /^image\// } }, 1, 0]
                                }
                            }
                        }
                    }
                ]).toArray()
            ]);
            
            return statsArray[0] || { totalAttachments: 0, totalSize: 0, imageCount: 0 };
        } catch (error) {
            console.error('Error getting attachment stats:', error);
            return { totalAttachments: 0, totalSize: 0, imageCount: 0 };
        }
    }

    start() {
        this.app.listen(this.port, () => {
            console.log(`🌐 Dashboard running at http://localhost:${this.port}`);
            if (this.config.dashboard.oauth?.enabled) {
                console.log(`🔐 Discord OAuth enabled`);
            }
        });
    }
}

module.exports = Dashboard;