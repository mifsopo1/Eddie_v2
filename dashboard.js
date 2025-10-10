const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const flash = require('express-flash');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

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
        
        // Make user and flash messages available to all templates
        this.app.use((req, res, next) => {
            // Pass Discord OAuth user OR null for password auth
            if (req.user) {
                res.locals.user = req.user;
            } else {
                res.locals.user = null;
            }
            
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
    // PUBLIC ROUTES (NO AUTH REQUIRED)
    // ============================================
    
    // Public Appeal Submission Page
    this.app.get('/submit-appeal', async (req, res) => {
        res.render('submit-appeal', {
            client: this.client,
            user: req.user || null,
            page: 'submit-appeal'
        });
    });
    // Public Appeal Submission Page
this.app.get('/submit-appeal', async (req, res) => {
    res.render('submit-appeal', {
        client: this.client,
        user: req.user || null,
        page: 'submit-appeal'
    });
});

// POST: Handle Appeal Submission (PUBLIC - NO AUTH REQUIRED)
this.app.post('/submit-appeal', express.json(), async (req, res) => {
    try {
        console.log('📝 Appeal submission received:', req.body);
        
        const { userId, reason, explanation } = req.body;
        
        // Validate required fields
        if (!userId || !reason || !explanation) {
            return res.json({ 
                success: false, 
                error: 'All fields are required' 
            });
        }
        
        // Check if user already has a pending appeal
        const existingAppeal = await this.mongoLogger.db.collection('appeals')
            .findOne({ 
                userId: userId,
                status: { $in: ['pending', 'reviewing'] }
            });
        
        if (existingAppeal) {
            return res.json({ 
                success: false, 
                error: 'You already have a pending appeal' 
            });
        }
        
        // Try to fetch user info from Discord
        let userName = 'Unknown User';
        let userAvatar = 'https://cdn.discordapp.com/embed/avatars/0.png';
        
        try {
            const user = await this.client.users.fetch(userId);
            userName = user.tag;
            userAvatar = user.displayAvatarURL();
        } catch (e) {
            console.log('⚠️ Could not fetch user from Discord:', e.message);
        }
        
        // Create the appeal
        const appeal = {
            userId: userId,
            userName: userName,
            userAvatar: userAvatar,
            status: 'pending',
            appeal: {
                reason: reason,
                explanation: explanation,
                submittedAt: new Date()
            },
            response: {
                message: null,
                respondedAt: null,
                respondedBy: null
            },
            history: [{
                action: 'submitted',
                by: userName,
                message: 'Appeal submitted',
                timestamp: new Date()
            }]
        };
        
        const result = await this.mongoLogger.db.collection('appeals').insertOne(appeal);
        
        console.log('✅ Appeal created with ID:', result.insertedId);
        
        res.json({ 
            success: true, 
            message: 'Appeal submitted successfully!',
            appealId: result.insertedId.toString()
        });
    } catch (error) {
        console.error('❌ Appeal submission error:', error);
        res.json({ 
            success: false, 
            error: 'Failed to submit appeal. Please try again.' 
        });
    }
});
        // ============================================
        // AUTH ROUTES
        // ============================================
        
        this.app.get('/login', (req, res) => {
            if (req.isAuthenticated() || req.session.passwordAuth) {
                return res.redirect('/');
            }
            res.render('login', { 
                error: null,
                oauthEnabled: this.config.dashboard.oauth?.enabled || false
            });
        });

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
                
                const { execSync } = require('child_process');
                let diskSpace = null;
                try {
                    const output = execSync('df -h /var/lib/jenkins/discord-logger-bot | tail -1').toString();
                    const parts = output.split(/\s+/);
                    diskSpace = {
                        total: parts[1],
                        used: parts[2],
                        available: parts[3],
                        percentage: parts[4]
                    };
                } catch (error) {
                    console.error('Error getting disk space:', error);
                }
                
                res.render('dashboard', {
    client: this.client,
    stats: stats || {},
    recentMessages: recentMessages || [],
    diskSpace: diskSpace,
    page: 'dashboard'  // <-- This line is critical!
});
            } catch (error) {
                console.error('Dashboard error:', error);
                req.flash('error', 'Error loading dashboard');
                res.redirect('/login');
            }
        });

// ============================================
// COMMAND SETTINGS ROUTES
// ============================================

// Command Settings Page
this.app.get('/commands/settings', this.requireAuth.bind(this), async (req, res) => {
    try {
        const fs = require('fs');
        
        // Load command settings from file
        let commandSettings = {};
        if (fs.existsSync('command-settings.json')) {
            commandSettings = JSON.parse(fs.readFileSync('command-settings.json', 'utf8'));
        }

        // Load server settings
        let serverSettings = {};
        if (fs.existsSync('server-settings.json')) {
            serverSettings = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
        }

        // List of commands that support customization
        const customizableCommands = [
            { name: 'kick', description: 'Kick a member from the server', category: 'Moderation' },
            { name: 'ban', description: 'Ban a member from the server', category: 'Moderation' },
            { name: 'mute', description: 'Mute a member', category: 'Moderation' },
            { name: 'unmute', description: 'Unmute a member', category: 'Moderation' },
            { name: 'warn', description: 'Warn a member', category: 'Moderation' },
            { name: 'unban', description: 'Unban a user', category: 'Moderation' }
        ];

        // Get server channels for logging
        const guild = this.client.guilds.cache.first();
        const channels = guild ? Array.from(guild.channels.cache.values())
            .filter(c => c.isTextBased() && c.type !== 4)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name)) : [];

        res.render('command-settings', {
            client: this.client,
            customizableCommands,
            commandSettings,
            serverSettings,
            channels,
            bot: this.client.user,
            guilds: this.client.guilds.cache.map(g => ({
                id: g.id,
                name: g.name,
                icon: g.iconURL()
            })),
            page: 'commands'
        });
    } catch (error) {
        console.error('Error loading command settings:', error);
        res.status(500).send('Error loading command settings');
    }
});

// Save Command Settings
this.app.post('/commands/settings', this.requireAuth.bind(this), express.json(), async (req, res) => {
    try {
        const fs = require('fs');
        const { command, settings } = req.body;

        // Load existing settings
        let commandSettings = {};
        if (fs.existsSync('command-settings.json')) {
            commandSettings = JSON.parse(fs.readFileSync('command-settings.json', 'utf8'));
        }

        // Update settings for the command
        if (settings === null) {
            // Reset command to defaults
            delete commandSettings[command];
        } else {
            commandSettings[command] = {
                ...commandSettings[command],
                ...settings
            };
            
            // Merge messages if they exist
            if (settings.messages && commandSettings[command].messages) {
                commandSettings[command].messages = {
                    ...commandSettings[command].messages,
                    ...settings.messages
                };
            }
        }

        // Save to file
        fs.writeFileSync('command-settings.json', JSON.stringify(commandSettings, null, 2));

        res.json({ success: true, message: 'Settings saved successfully!' });
    } catch (error) {
        console.error('Error saving command settings:', error);
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});

// Save Server Settings (NEW)
this.app.post('/commands/server-settings', this.requireAuth.bind(this), express.json(), async (req, res) => {
    try {
        const fs = require('fs');
        const { settings } = req.body;

        // Load existing settings
        let serverSettings = {};
        if (fs.existsSync('server-settings.json')) {
            serverSettings = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
        }

        // Merge new settings
        serverSettings = { ...serverSettings, ...settings };

        // Save to file
        fs.writeFileSync('server-settings.json', JSON.stringify(serverSettings, null, 2));

        res.json({ success: true, message: 'Server settings saved successfully!' });
    } catch (error) {
        console.error('Error saving server settings:', error);
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});

// ============================================
// MESSAGES PAGE
// ============================================

this.app.get('/messages', this.requireAuth.bind(this), async (req, res) => {
    try {
        let page = parseInt(req.query.page) || 1;
        const limit = 100;
        
        // Get filter parameters
        const selectedChannel = req.query.channel || '';
        const selectedUser = req.query.user || '';
        const targetMessageId = req.query.message || ''; // For jumping to specific message
        
        // Build query with filters
        let query = {};
        if (selectedChannel) query.channelId = selectedChannel;
        if (selectedUser) query.userId = selectedUser;
        
        // If targeting a specific message, find which page it's on
        if (targetMessageId && selectedChannel) {
            const messagesBeforeTarget = await this.mongoLogger.db.collection('messages')
                .countDocuments({
                    ...query,
                    timestamp: { 
                        $gt: (await this.mongoLogger.db.collection('messages')
                            .findOne({ messageId: targetMessageId }))?.timestamp 
                    }
                });
            
            if (messagesBeforeTarget !== null) {
                page = Math.floor(messagesBeforeTarget / limit) + 1;
            }
        }
        
        const skip = (page - 1) * limit;
        
        // Fetch messages with filters
        const messages = await this.mongoLogger.db.collection('messages')
            .find(query)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();
        
        const totalMessages = await this.mongoLogger.db.collection('messages').countDocuments(query);
        const totalPages = Math.ceil(totalMessages / limit);
        
        // Get all unique channels for dropdown
        const channels = await this.mongoLogger.db.collection('messages')
            .aggregate([
                { $group: { _id: '$channelId', name: { $first: '$channelName' } } },
                { $project: { id: '$_id', name: 1, _id: 0 } },
                { $sort: { name: 1 } }
            ])
            .toArray();
        
        // Get all unique users for dropdown
        const users = await this.mongoLogger.db.collection('messages')
            .aggregate([
                { $group: { _id: '$userId', username: { $first: '$userName' } } },
                { $project: { id: '$_id', username: 1, _id: 0 } },
                { $sort: { username: 1 } }
            ])
            .toArray();
        
        // Get names for display tags
        let channelName = '';
        let userName = '';
        if (selectedChannel) {
            const channel = channels.find(c => c.id === selectedChannel);
            channelName = channel ? channel.name : selectedChannel;
        }
        if (selectedUser) {
            const user = users.find(u => u.id === selectedUser);
            userName = user ? user.username : selectedUser;
        }
        
        res.render('messages', {
            messages,
            currentPage: page,
            totalPages,
            channels,
            users,
            selectedChannel,
            selectedUser,
            channelName,
            userName,
            client: this.client,
            page: 'messages',
            user: req.user
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
            client: this.client,
            page: 'deleted'
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
                    client: this.client,
                    page: 'user'
                });
            } catch (error) {
                console.error('User lookup error:', error);
                res.status(500).send('Error loading user data');
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
                    totalPages,
                    page: 'members'
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
                    totalPages,
                    page: 'moderation'
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
                    totalPages,
                    page: 'attachments'
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
        
        this.app.get('/voice', async (req, res) => {
            try {
                const action = req.query.action || 'all';
                
                let filter = {};
                
                // Filter by action type if not 'all'
                if (action !== 'all') {
                    filter.actionType = action;  // Changed from 'action' to 'actionType'
                }
                
                const activities = await this.mongoLogger.db.collection('voice')  // Changed from 'voiceActivity' to 'voice'
                    .find(filter)
                    .sort({ timestamp: -1 })
                    .limit(100)
                    .toArray();
                
                // Map the data to match what the template expects
                const mappedActivities = activities.map(a => ({
                    ...a,
                    action: a.actionType  // Add 'action' field for template compatibility
                }));
                
                res.render('voice', {
                    page: 'voice',
                    client: this.client,
                    user: req.user,
                    activities: mappedActivities,
                    action: action
                });
            } catch (error) {
                console.error('Error loading voice activity:', error);
                res.status(500).send('Error loading voice activity');
            }
        });

        // ============================================
        // INVITES PAGE
        // ============================================
        
        // ============================================
// INVITES PAGE
// ============================================

this.app.get('/invites', this.requireAuth.bind(this), async (req, res) => {
    console.log('🎫 INVITES ROUTE HIT!');
    console.log('🔐 Authenticated:', req.isAuthenticated());
    console.log('🔐 Password auth:', req.session?.passwordAuth);
    console.log('👤 User:', req.user);
    
    try {
        const selectedCode = req.query.code || ''; // NEW: Get code filter
        
        // Get invite leaderboard with additional data
        let inviteStats = await this.mongoLogger.db.collection('members')
            .aggregate([
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
                        inviterId: { $first: '$inviteData.inviterId' }, // NEW: Get inviter ID
                        uses: { $sum: 1 }
                    }
                },
                {
                    $sort: { uses: -1 }
                },
                {
                    $limit: 20
                }
            ]).toArray();
        
        // NEW: Fetch avatars for top inviters
        for (let stat of inviteStats) {
            try {
                if (stat.inviterId) {
                    const user = await this.client.users.fetch(stat.inviterId).catch(() => null);
                    if (user) {
                        stat.inviterAvatar = user.displayAvatarURL();
                    }
                }
            } catch (e) {
                console.log('Could not fetch user avatar:', e.message);
            }
        }
        
        // Get recent invites (filtered by code if provided)
        let inviteQuery = { 
            eventType: 'join',
            'inviteData.code': { $exists: true }
        };
        
        // NEW: Filter by specific code if requested
        if (selectedCode) {
            inviteQuery['inviteData.code'] = selectedCode;
        }
        
        const recentInvites = await this.mongoLogger.db.collection('members')
            .find(inviteQuery)
            .sort({ timestamp: -1 })
            .limit(50)
            .toArray();
        
        res.render('invites', {
            client: this.client,
            user: req.user,
            inviteStats: inviteStats,
            recentInvites: recentInvites,
            selectedCode: selectedCode, // NEW: Pass to template
            page: 'invites'
        });
    } catch (error) {
        console.error('Invites page error:', error);
        req.flash('error', 'Error loading invites');
        res.redirect('/');
    }
});

        // ============================================
        // ANALYTICS PAGE

        // ============================================
        // ANALYTICS PAGE
        // ============================================
        
        this.app.get('/analytics', this.requireAuth.bind(this), async (req, res) => {
    try {
        if (!this.mongoLogger || !this.mongoLogger.connected) {
            return res.status(500).send('MongoDB not connected. <a href="/">Go back</a>');
        }
        
        let analytics = {};
        let topUsers = [];
        let inviteStats = [];
        let timeline = [];
        let attachmentStats = {};
        let newAccounts = [];
        let diskSpace = null;
        
        try { 
            analytics = await this.mongoLogger.getServerAnalytics() || {}; 
            console.log('📊 Analytics:', analytics);
        } catch (e) {
            console.error('Error getting analytics:', e);
        }
        
        try { 
            topUsers = await this.mongoLogger.getTopUsers(7, 15) || []; 
            console.log('👥 Top users:', topUsers.length);
        } catch (e) {
            console.error('Error getting top users:', e);
        }
        
        try { 
            inviteStats = await this.mongoLogger.getInviteStats() || []; 
            console.log('🎫 Invite stats:', inviteStats.length);
        } catch (e) {
            console.error('Error getting invite stats:', e);
        }
        
        try { 
            timeline = await this.mongoLogger.getMessageTimeline(14) || []; 
            console.log('📈 Timeline:', timeline.length, 'days');
        } catch (e) {
            console.error('Error getting timeline:', e);
        }
        
        try { 
            attachmentStats = await this.getAttachmentStats() || {}; 
            console.log('📎 Attachment stats:', attachmentStats);
        } catch (e) {
            console.error('Error getting attachment stats:', e);
        }
        
        try { 
            newAccounts = await this.mongoLogger.getNewAccountJoins(7) || []; 
            console.log('⚠️ New accounts:', newAccounts.length);
        } catch (e) {
            console.error('Error getting new accounts:', e);
        }
        
        // Get disk space
        try {
            const { execSync } = require('child_process');
            const output = execSync('df -h /var/lib/jenkins/discord-logger-bot | tail -1').toString();
            const parts = output.split(/\s+/);
            diskSpace = {
                total: parts[1],
                used: parts[2],
                available: parts[3],
                percentage: parts[4]
            };
            console.log('💾 Disk space:', diskSpace);
        } catch (error) {
            console.error('Error getting disk space:', error);
        }
        
        res.render('analytics', {
            analytics,
            topUsers,
            inviteStats,
            timeline,
            attachmentStats,
            newAccounts,
            diskSpace,
            client: this.client,
            page: 'analytics'
        });
    } catch (error) {
        console.error('Analytics page error:', error);
        res.status(500).send(`Error Loading Analytics: ${error.message}`);
    }
});


// ALL COMMANDS PAGE (Built-in + Custom)
// ============================================

this.app.get('/commands/all', this.requireAuth.bind(this), async (req, res) => {
    try {
        // Get custom commands from MongoDB
        const customCommands = await this.mongoLogger.db.collection('customCommands')
            .find({})
            .sort({ category: 1, name: 1 })
            .toArray();
        
        // Get command states from MongoDB
        const commandStates = await this.mongoLogger.db.collection('commandStates')
            .find({})
            .toArray();
        
        // Convert to Map for easy lookup
        const stateMap = new Map(commandStates.map(s => [s.commandName, s.enabled]));
        
        // Define all built-in commands with their info
        const builtInCommands = [
            // Fun Commands
            { name: 'ping', category: 'fun', description: 'Check bot latency', type: 'builtin', defaultEnabled: true },
            { name: 'coinflip', category: 'fun', description: 'Flip a coin', type: 'builtin', defaultEnabled: true },
            { name: 'roll', category: 'fun', description: 'Roll dice (e.g., !roll 2d6)', type: 'builtin', defaultEnabled: true },
            { name: '8ball', category: 'fun', description: 'Ask the magic 8-ball', type: 'builtin', defaultEnabled: true },
            { name: 'rps', category: 'fun', description: 'Rock Paper Scissors', type: 'builtin', defaultEnabled: true },
            
            // Info Commands
            { name: 'serverinfo', category: 'info', description: 'Display server information', type: 'builtin', defaultEnabled: true },
            { name: 'userinfo', category: 'info', description: 'Display user information', type: 'builtin', defaultEnabled: true },
            { name: 'avatar', category: 'info', description: 'Show user avatar', type: 'builtin', defaultEnabled: true },
            { name: 'invite', category: 'info', description: 'Get bot invite link', type: 'builtin', defaultEnabled: true },
            
            // Utility Commands
            { name: 'help', category: 'utility', description: 'Show command list', type: 'builtin', defaultEnabled: true },
            { name: 'commands', category: 'utility', description: 'List all commands', type: 'builtin', defaultEnabled: true },
            
            // Moderation Commands
            { name: 'clear', category: 'moderation', description: 'Clear messages (requires permissions)', type: 'builtin', defaultEnabled: true },
            { name: 'kick', category: 'moderation', description: 'Kick a member (requires permissions)', type: 'builtin', defaultEnabled: true },
            { name: 'ban', category: 'moderation', description: 'Ban a member (requires permissions)', type: 'builtin', defaultEnabled: true },
            { name: 'mute', category: 'moderation', description: 'Mute a member (requires permissions)', type: 'builtin', defaultEnabled: true },
            { name: 'unmute', category: 'moderation', description: 'Unmute a member (requires permissions)', type: 'builtin', defaultEnabled: true },
        ];
        
        // Add enabled state to built-in commands
        builtInCommands.forEach(cmd => {
            cmd.enabled = stateMap.has(cmd.name) ? stateMap.get(cmd.name) : cmd.defaultEnabled;
        });
        
        // Add type and enabled state to custom commands
        customCommands.forEach(cmd => {
            cmd.type = 'custom';
            // Custom commands use their own enabled field
        });
        
        // Combine all commands
        const allCommands = [...builtInCommands, ...customCommands];
        
        // Group by category
        const commandsByCategory = {
            fun: [],
            info: [],
            utility: [],
            moderation: [],
            general: [],
            custom: []
        };
        
        allCommands.forEach(cmd => {
            const category = cmd.category || 'general';
            if (commandsByCategory[category]) {
                commandsByCategory[category].push(cmd);
            } else {
                commandsByCategory.custom.push(cmd);
            }
        });
        
        res.render('commands-all', {
            client: this.client,
            commandsByCategory,
            page: 'commands'
        });
    } catch (error) {
        console.error('All commands page error:', error);
        req.flash('error', 'Error loading commands');
        res.redirect('/commands');
    }
});

this.app.get('/commands', this.requireAdmin.bind(this), async (req, res) => {
    try {
        // Get custom commands from MongoDB
        const customCommands = await this.mongoLogger.db
            .collection('customCommands')
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        console.log('🔍 Custom commands:', customCommands.length);
        console.log('🔍 CommandHandler exists?', !!this.client.commandHandler);
        console.log('🔍 Commands Map exists?', !!this.client.commandHandler?.commands);

        // Get built-in commands
        const builtInCommands = [];
        
        if (this.client.commandHandler?.commands) {
            console.log('🔍 Commands Map size:', this.client.commandHandler.commands.size);
            
            for (const [name, cmd] of this.client.commandHandler.commands) {
                let category = 'general';
                if (cmd.category) {
                    category = cmd.category.toLowerCase();
                }
                
                const categoryMap = {
                    'utilities': 'utility',
                    'information': 'info',
                    'mod': 'moderation',
                    'moderate': 'moderation',
                    'entertainment': 'fun'
                };
                
                category = categoryMap[category] || category;
                
                builtInCommands.push({
                    name: name,
                    description: cmd.description || 'No description',
                    category: category,
                    enabled: cmd.enabled !== false,
                    trigger: name,
                    triggerType: 'command',
                    responseType: 'builtin',
                    uses: 0,
                    type: 'builtin',
                    _id: `builtin_${name}`
                });
            }
        }

        console.log('🔍 Built-in commands:', builtInCommands.length);
        
        // Combine both arrays
        const allCommands = [...customCommands, ...builtInCommands];

        // *** FIX: Get roles from Discord guild ***
        const guild = this.client.guilds.cache.first();
        const roles = guild ? Array.from(guild.roles.cache.values())
            .filter(r => r.name !== '@everyone')
            .map(role => ({
                id: role.id,
                name: role.name,
                color: role.hexColor,
                position: role.position
            }))
            .sort((a, b) => b.position - a.position) : [];

        console.log(`✅ Total commands to display: ${allCommands.length}`);
        console.log(`✅ Total roles available: ${roles.length}`);

        res.render('commands', { 
            commands: allCommands,
            roles: roles,  // *** ADD THIS LINE ***
            client: this.client,
            user: req.user,
            page: 'commands',
            messages: {
                success: req.flash('success'),
                error: req.flash('error')
            }
        });
    } catch (error) {
        console.error('❌ Commands page error:', error);
        req.flash('error', 'Error loading commands');
        res.redirect('/');
    }
});

// ============================================
// COMMANDS PAGE (main page showing custom commands)
// ============================================


// Command Settings Route
// Command Settings Page
this.app.get('/commands/settings', this.requireAuth.bind(this), async (req, res) => {
    try {
        const fs = require('fs');
        
        // Load command settings from file
        let commandSettings = {};
        if (fs.existsSync('command-settings.json')) {
            commandSettings = JSON.parse(fs.readFileSync('command-settings.json', 'utf8'));
        }

        // Load server settings
        let serverSettings = {};
        if (fs.existsSync('server-settings.json')) {
            serverSettings = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
        }

        // List of commands that support customization
        const customizableCommands = [
            { name: 'kick', description: 'Kick a member from the server', category: 'Moderation' },
            { name: 'ban', description: 'Ban a member from the server', category: 'Moderation' },
            { name: 'mute', description: 'Mute a member', category: 'Moderation' },
            { name: 'unmute', description: 'Unmute a member', category: 'Moderation' },
            { name: 'warn', description: 'Warn a member', category: 'Moderation' },
            { name: 'unban', description: 'Unban a user', category: 'Moderation' }
        ];

        // Get server channels for logging
        const guild = this.client.guilds.cache.first();
        const channels = guild ? Array.from(guild.channels.cache.values())
            .filter(c => c.isTextBased() && c.type !== 4)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name)) : [];

        res.render('command-settings', {
            client: this.client,  // ← Changed from client to this.client
            customizableCommands,
            commandSettings,
            serverSettings,
            channels,
            bot: this.client.user,
            guilds: this.client.guilds.cache.map(g => ({
                id: g.id,
                name: g.name,
                icon: g.iconURL()
            })),
            page: 'commands'
        });
    } catch (error) {
        console.error('Error loading command settings:', error);
        res.status(500).send('Error loading command settings');
    }
});

// Save Command Settings Route
this.app.post('/commands/settings', this.requireAuth.bind(this), express.json(), async (req, res) => {
    try {
        const fs = require('fs');
        const { command, settings } = req.body;

        // Load existing settings
        let commandSettings = {};
        if (fs.existsSync('command-settings.json')) {
            commandSettings = JSON.parse(fs.readFileSync('command-settings.json', 'utf8'));
        }

        // Update settings for the command
        if (settings === null) {
            // Reset command to defaults
            delete commandSettings[command];
        } else {
            commandSettings[command] = {
                ...commandSettings[command],
                ...settings
            };
            
            // Merge messages if they exist
            if (settings.messages && commandSettings[command].messages) {
                commandSettings[command].messages = {
                    ...commandSettings[command].messages,
                    ...settings.messages
                };
            }
        }

        // Save to file
        fs.writeFileSync('command-settings.json', JSON.stringify(commandSettings, null, 2));

        res.json({ success: true, message: 'Settings saved successfully!' });
    } catch (error) {
        console.error('Error saving command settings:', error);
        res.status(500).json({ success: false, message: 'Failed to save settings' });
    }
});



// Toggle built-in command
this.app.post('/commands/toggle-builtin/:name', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const commandName = req.params.name;
        
        // Get current state
        const currentState = await this.mongoLogger.db.collection('commandStates')
            .findOne({ commandName });
        
        const newState = currentState ? !currentState.enabled : false;
        
        // Update or insert state
        await this.mongoLogger.db.collection('commandStates').updateOne(
            { commandName },
            { 
                $set: { 
                    commandName,
                    enabled: newState,
                    updatedAt: new Date()
                } 
            },
            { upsert: true }
        );
        
        res.json({ success: true, enabled: newState });
    } catch (error) {
        console.error('Toggle builtin command error:', error);
        res.json({ success: false, error: error.message });
    }
});


        // ============================================
        // COMMAND ACTIONS
        // ============================================
        
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
        
        // Send the command directly to the channel
        await channel.send(command);
        
        res.json({ success: true, message: `Command executed in #${channel.name}` });
    } catch (error) {
        console.error('Execute command error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ============================================
// STICKY MESSAGES ROUTES
// ============================================

this.app.post('/commands/sticky/create', this.requireAdmin.bind(this), async (req, res) => {
    try {
        console.log('📌 Creating sticky message:', req.body);
        
        const { channelId, message, threshold, enabled } = req.body;
        
        if (!channelId || !message) {
            console.log('❌ Missing channelId or message');
            return res.json({ success: false, error: 'Channel and message are required' });
        }
        
        // Verify channel exists
        const channel = await this.client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            console.log('❌ Channel not found:', channelId);
            return res.json({ success: false, error: 'Channel not found' });
        }
        
        if (!channel.isTextBased()) {
            console.log('❌ Channel is not text-based');
            return res.json({ success: false, error: 'Channel must be a text channel' });
        }
        
        const stickyMessage = {
            channelId: channelId,
            channelName: channel.name,
            message: message,
            threshold: parseInt(threshold) || 10,
            enabled: enabled === true || enabled === 'on',
            messageId: null, // Will be set when first posted
            messageCount: 0, // Track messages since last repost
            repostCount: 0,
            createdAt: new Date(),
            createdBy: req.user?.username || 'Admin'
        };
        
        console.log('💾 Saving to database:', stickyMessage);
        
        const result = await this.mongoLogger.db.collection('stickyMessages').insertOne(stickyMessage);
        
        console.log('✅ Sticky message created with ID:', result.insertedId);
        
        // Optionally send the initial sticky message
        if (enabled) {
            try {
                const sentMessage = await channel.send(message);
                console.log('📤 Initial sticky message sent:', sentMessage.id);
                
                // Update with the message ID
                await this.mongoLogger.db.collection('stickyMessages').updateOne(
                    { _id: result.insertedId },
                    { $set: { messageId: sentMessage.id } }
                );
            } catch (sendError) {
                console.error('Failed to send initial sticky message:', sendError);
            }
        }
        
        req.flash('success', 'Sticky message created!');
        res.json({ success: true, id: result.insertedId.toString() });
    } catch (error) {
        console.error('❌ Create sticky message error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Get all sticky messages
this.app.get('/commands/sticky/list', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const stickyMessages = await this.mongoLogger.db.collection('stickyMessages')
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
        
        console.log('📋 Found', stickyMessages.length, 'sticky messages');
        res.json({ success: true, stickyMessages });
    } catch (error) {
        console.error('Get sticky messages error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Toggle sticky message on/off
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
        
        console.log('🔄 Toggled sticky message:', req.params.id, 'to', !sticky.enabled);
        res.json({ success: true, enabled: !sticky.enabled });
    } catch (error) {
        console.error('Toggle sticky error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Get single sticky message for editing
this.app.get('/commands/sticky/get/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const sticky = await this.mongoLogger.db.collection('stickyMessages')
            .findOne({ _id: new ObjectId(req.params.id) });
        
        if (!sticky) {
            return res.json({ success: false, error: 'Sticky message not found' });
        }
        
        res.json({ success: true, sticky });
    } catch (error) {
        console.error('Get sticky error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Update sticky message
this.app.post('/commands/sticky/edit/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const { channelId, message, threshold, enabled } = req.body;
        
        if (!channelId || !message) {
            return res.json({ success: false, error: 'Channel and message are required' });
        }
        
        // Get channel name
        const channel = await this.client.channels.fetch(channelId).catch(() => null);
        
        const updateData = {
            channelId,
            channelName: channel ? channel.name : null,
            message,
            threshold: parseInt(threshold) || 10,
            enabled: enabled === true || enabled === 'on',
            updatedAt: new Date()
        };
        
        await this.mongoLogger.db.collection('stickyMessages')
            .updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: updateData }
            );
        
        console.log('✏️ Updated sticky message:', req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Update sticky error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Delete sticky message
this.app.delete('/commands/sticky/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const result = await this.mongoLogger.db.collection('stickyMessages')
            .deleteOne({ _id: new ObjectId(req.params.id) });
        
        console.log('🗑️ Deleted sticky message:', req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete sticky error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ============================================
// AUTOMOD RULESETS ROUTES (YAGPDB-style)
// ============================================

this.app.post('/commands/ruleset/create', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { 
            name, 
            description, 
            triggerType,
            triggerConfig,
            actionType,
            actionConfig,
            priority,
            excludedRoles,
            excludedChannels,
            whitelistedDomains
        } = req.body;
        
        if (!name || !triggerType || !actionType) {
            return res.json({ success: false, error: 'Name, trigger type, and action type are required' });
        }
        
        const ruleset = {
            name: name,
            description: description || '',
            enabled: true,
            priority: priority || 'medium', // high, medium, low
            
            // Trigger configuration
            trigger: {
                type: triggerType, // spam, links, words, mentions, caps, attachments
                config: triggerConfig || {}
                // Examples:
                // spam: { messageCount: 5, timeWindow: 3 }
                // links: { blockDiscordInvites: true, blockUrls: true }
                // words: { bannedWords: ['word1', 'word2'], caseSensitive: false }
                // mentions: { maxMentions: 5 }
                // caps: { percentage: 70, minLength: 10 }
            },
            
            // Action configuration
            action: {
                type: actionType, // delete, warn, timeout, kick, ban
                config: actionConfig || {}
                // Examples:
                // timeout: { duration: 300 } (seconds)
                // warn: { message: 'Custom warning message' }
                // delete: { notifyUser: true }
            },
            
            // Exclusions
            exclusions: {
                roles: excludedRoles || [],
                channels: excludedChannels || []
            },
            
            // Whitelist (for link filters)
            whitelist: whitelistedDomains || [],
            
            // Stats
            stats: {
                triggered: 0,
                lastTriggered: null
            },
            
            createdAt: new Date(),
            createdBy: req.user?.username || 'Admin',
            updatedAt: new Date()
        };
        
        const result = await this.mongoLogger.db.collection('automodRulesets').insertOne(ruleset);
        
        req.flash('success', 'AutoMod ruleset created!');
        res.json({ success: true, id: result.insertedId });
    } catch (error) {
        console.error('Create ruleset error:', error);
        res.json({ success: false, error: error.message });
    }
});

this.app.get('/commands/ruleset/list', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const rulesets = await this.mongoLogger.db.collection('automodRulesets')
            .find({})
            .sort({ priority: -1, createdAt: -1 })
            .toArray();
        
        res.json({ success: true, rulesets });
    } catch (error) {
        console.error('Get rulesets error:', error);
        res.json({ success: false, error: error.message });
    }
});

this.app.post('/commands/ruleset/edit/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const { 
            name, 
            description, 
            triggerType,
            triggerConfig,
            actionType,
            actionConfig,
            priority,
            excludedRoles,
            excludedChannels,
            whitelistedDomains
        } = req.body;
        
        await this.mongoLogger.db.collection('automodRulesets')
            .updateOne(
                { _id: new ObjectId(req.params.id) },
                { 
                    $set: { 
                        name,
                        description,
                        priority,
                        trigger: {
                            type: triggerType,
                            config: triggerConfig
                        },
                        action: {
                            type: actionType,
                            config: actionConfig
                        },
                        exclusions: {
                            roles: excludedRoles || [],
                            channels: excludedChannels || []
                        },
                        whitelist: whitelistedDomains || [],
                        updatedAt: new Date()
                    } 
                }
            );
        
        req.flash('success', 'Ruleset updated!');
        res.json({ success: true });
    } catch (error) {
        console.error('Update ruleset error:', error);
        res.json({ success: false, error: error.message });
    }
});

this.app.post('/commands/ruleset/toggle/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const ruleset = await this.mongoLogger.db.collection('automodRulesets')
            .findOne({ _id: new ObjectId(req.params.id) });
        
        await this.mongoLogger.db.collection('automodRulesets')
            .updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { enabled: !ruleset.enabled } }
            );
        
        res.json({ success: true, enabled: !ruleset.enabled });
    } catch (error) {
        console.error('Toggle ruleset error:', error);
        res.json({ success: false, error: error.message });
    }
});

this.app.delete('/commands/ruleset/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        await this.mongoLogger.db.collection('automodRulesets')
            .deleteOne({ _id: new ObjectId(req.params.id) });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Delete ruleset error:', error);
        res.json({ success: false, error: error.message });
    }
});

// Increment ruleset trigger count (called by the bot when a rule triggers)
this.app.post('/commands/ruleset/trigger/:id', async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        
        await this.mongoLogger.db.collection('automodRulesets')
            .updateOne(
                { _id: new ObjectId(req.params.id) },
                { 
                    $inc: { 'stats.triggered': 1 },
                    $set: { 'stats.lastTriggered': new Date() }
                }
            );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Trigger ruleset error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ============================================
// BULK ACTIONS ROUTES
// ============================================

this.app.post('/commands/bulk/toggle', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { enable, category } = req.body;
        
        let query = {};
        if (category && category !== 'all') {
            query.category = category;
        }
        
        await this.mongoLogger.db.collection('customCommands')
            .updateMany(query, { $set: { enabled: enable } });
        
        req.flash('success', `Commands ${enable ? 'enabled' : 'disabled'}!`);
        res.json({ success: true });
    } catch (error) {
        console.error('Bulk toggle error:', error);
        res.json({ success: false, error: error.message });
    }
});

this.app.post('/commands/bulk/delete-disabled', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const result = await this.mongoLogger.db.collection('customCommands')
            .deleteMany({ enabled: false });
        
        req.flash('success', `Deleted ${result.deletedCount} disabled commands`);
        res.json({ success: true, deleted: result.deletedCount });
    } catch (error) {
        console.error('Bulk delete error:', error);
        res.json({ success: false, error: error.message });
    }
});

this.app.post('/commands/bulk/category', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { category, action, value } = req.body;
        
        if (!category) {
            return res.json({ success: false, error: 'Category required' });
        }
        
        let update = {};
        if (action === 'enable') {
            update = { $set: { enabled: true } };
        } else if (action === 'disable') {
            update = { $set: { enabled: false } };
        } else if (action === 'delete') {
            const result = await this.mongoLogger.db.collection('customCommands')
                .deleteMany({ category });
            return res.json({ success: true, deleted: result.deletedCount });
        }
        
        const result = await this.mongoLogger.db.collection('customCommands')
            .updateMany({ category }, update);
        
        res.json({ success: true, modified: result.modifiedCount });
    } catch (error) {
        console.error('Bulk category action error:', error);
        res.json({ success: false, error: error.message });
    }
});

this.app.post('/commands/bulk/roles', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { commandIds, requiredRoles, exemptRoles, action } = req.body;
        const { ObjectId } = require('mongodb');
        
        if (!commandIds || !Array.isArray(commandIds)) {
            return res.json({ success: false, error: 'Command IDs array required' });
        }
        
        const objectIds = commandIds.map(id => new ObjectId(id));
        
        let update = {};
        if (action === 'add') {
            if (requiredRoles) update.$addToSet = { requiredRoles: { $each: requiredRoles } };
            if (exemptRoles) update.$addToSet = { ...update.$addToSet, exemptRoles: { $each: exemptRoles } };
        } else if (action === 'set') {
            if (requiredRoles !== undefined) update.$set = { requiredRoles };
            if (exemptRoles !== undefined) update.$set = { ...update.$set, exemptRoles };
        } else if (action === 'remove') {
            if (requiredRoles) update.$pull = { requiredRoles: { $in: requiredRoles } };
            if (exemptRoles) update.$pull = { ...update.$pull, exemptRoles: { $in: exemptRoles } };
        }
        
        const result = await this.mongoLogger.db.collection('customCommands')
            .updateMany({ _id: { $in: objectIds } }, update);
        
        res.json({ success: true, modified: result.modifiedCount });
    } catch (error) {
        console.error('Bulk roles error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ============================================
// PROTECTION SETTINGS ROUTES
// ============================================

this.app.get('/commands/protection/settings', this.requireAdmin.bind(this), async (req, res) => {
    try {
        let settings = await this.mongoLogger.db.collection('settings')
            .findOne({ type: 'commandProtection' });
        
        if (!settings) {
            settings = {
                type: 'commandProtection',
                rateLimit: {
                    enabled: true,
                    commandsPerMinute: 5,
                    cooldownSeconds: 3
                },
                spamPrevention: {
                    enabled: true,
                    autoTimeout: true,
                    logAbuse: true
                }
            };
        }
        
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Get protection settings error:', error);
        res.json({ success: false, error: error.message });
    }
});

this.app.post('/commands/protection/settings', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { rateLimit, spamPrevention } = req.body;
        
        await this.mongoLogger.db.collection('settings')
            .updateOne(
                { type: 'commandProtection' },
                { 
                    $set: { 
                        rateLimit,
                        spamPrevention,
                        updatedAt: new Date()
                    } 
                },
                { upsert: true }
            );
        
        req.flash('success', 'Protection settings saved!');
        res.json({ success: true });
    } catch (error) {
        console.error('Save protection settings error:', error);
        res.json({ success: false, error: error.message });
    }
});

// ============================================
// CHANNEL-SPECIFIC RESPONSES ROUTES
// ============================================

this.app.post('/commands/channel-response/create', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { commandId, channelId, response } = req.body;
        const { ObjectId } = require('mongodb');
        
        await this.mongoLogger.db.collection('customCommands')
            .updateOne(
                { _id: new ObjectId(commandId) },
                { 
                    $set: { 
                        [`channelResponses.${channelId}`]: response 
                    } 
                }
            );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Create channel response error:', error);
        res.json({ success: false, error: error.message });
    }
});

        this.app.post('/commands/create', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const triggers = req.body.trigger.split(',').map(t => t.trim().toLowerCase());
        
        // Get role arrays from form
        let requiredRoles = [];
        let exemptRoles = [];
        
        if (req.body.requiredRoles) {
            requiredRoles = Array.isArray(req.body.requiredRoles) 
                ? req.body.requiredRoles 
                : [req.body.requiredRoles];
        }
        
        if (req.body.exemptRoles) {
            exemptRoles = Array.isArray(req.body.exemptRoles) 
                ? req.body.exemptRoles 
                : [req.body.exemptRoles];
        }
        
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
            requiredRoles: requiredRoles,
            exemptRoles: exemptRoles,
            createdBy: req.user?.id || 'admin',
            createdAt: new Date(),
            uses: 0
        };
        
        await this.mongoLogger.db.collection('customCommands').insertOne(command);
        req.flash('success', `Command "${req.body.name}" created!`);
        res.redirect('/commands');
    } catch (error) {
        console.error('Create command error:', error);
        req.flash('error', 'Error creating command');
        res.redirect('/commands');
    }
});

        // Get single command (API) - FIXED
this.app.get('/api/commands/:id', async (req, res) => {
    // Check authentication without redirect
    if (!req.session?.authenticated && !req.isAuthenticated()) {
        return res.json({ success: false, error: 'Not authenticated' });
    }
    
    try {
        const { ObjectId } = require('mongodb');
        const command = await this.mongoLogger.db.collection('customCommands')
            .findOne({ _id: new ObjectId(req.params.id) });
        
        if (!command) {
            return res.json({ success: false, error: 'Command not found' });
        }
        
        res.json({ success: true, command });
    } catch (error) {
        console.error('Get command error:', error);
        res.json({ success: false, error: error.message });
    }
});
// Add this route in your dashboard.js setupRoutes() method
this.app.get('/api/automod/rulesets/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const ruleset = await this.mongoLogger.db.collection('automodRulesets')
            .findOne({ _id: new ObjectId(req.params.id) });
        
        if (!ruleset) {
            return res.json({ success: false, error: 'Ruleset not found' });
        }
        
        res.json({ success: true, ruleset });
    } catch (error) {
        console.error('Get ruleset error:', error);
        res.json({ success: false, error: error.message });
    }
});
// Update command
this.app.post('/commands/edit/:id', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const triggers = req.body.trigger.split(',').map(t => t.trim().toLowerCase());
        
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
        
        // Add embed fields if response type is embed
        if (req.body.responseType === 'embed') {
            updateData.embedTitle = req.body.embedTitle || '';
            updateData.embedDescription = req.body.embedDescription || '';
            updateData.embedColor = req.body.embedColor || '#5865f2';
            updateData.embedFooter = req.body.embedFooter || '';
        }
        
        // Add reaction emoji if applicable
        if (req.body.responseType === 'react' || req.body.responseType === 'multiple') {
            updateData.reactionEmoji = req.body.reactionEmoji || '';
        }
        
        await this.mongoLogger.db.collection('customCommands')
            .updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: updateData }
            );
        
        req.flash('success', `Command "${req.body.name}" updated!`);
        res.redirect('/commands');
    } catch (error) {
        console.error('Update command error:', error);
        req.flash('error', 'Error updating command');
        res.redirect('/commands');
    }
});

        this.app.get('/commands/delete/:id', this.requireAdmin.bind(this), async (req, res) => {
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
                res.json({ success: false, error: error.message });
            }
        });

        // ============================================
        // API ROUTES
        // ============================================
        
        this.app.get('/api/channels', this.requireAuth.bind(this), async (req, res) => {
            try {
                const guild = this.client.guilds.cache.first();
                if (!guild) return res.json({ success: false, error: 'No guild found' });
                
                await guild.channels.fetch();
                const channels = guild.channels.cache
                    .filter(c => c.isTextBased() && c.type !== 4)
                    .map(c => ({ id: c.id, name: c.name, type: c.type, position: c.position }))
                    .sort((a, b) => a.position - b.position);
                
                res.json({ success: true, channels });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        this.app.get('/api/roles', this.requireAuth.bind(this), async (req, res) => {
            try {
                const guild = this.client.guilds.cache.first();
                if (!guild) return res.json({ success: false, error: 'No guild found' });
                
                await guild.roles.fetch();
                const roles = guild.roles.cache
                    .filter(r => r.name !== '@everyone')
                    .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
                    .sort((a, b) => b.position - a.position);
                
                res.json({ success: true, roles });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

        this.app.get('/api/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                const stats = await this.mongoLogger.getStats();
                res.json({ success: true, stats });
            } catch (error) {
                res.json({ success: false, error: error.message });
            }
        });

// ============================================
// APPEALS ROUTES
// ============================================

// Public landing page for appeals
this.app.get('/appeals', async (req, res) => {
    // Check if user is admin
    const isAdmin = req.user?.isAdmin || req.session?.passwordAuth;
    
    if (!isAdmin) {
        // Show public landing page for non-admins
        return res.render('appeals-public', {
            client: this.client,
            user: req.user || null,
            page: 'appeals'
        });
    }
    
    // Admin dashboard for reviewing appeals
    try {
        const status = req.query.status || 'all';
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        
        let query = {};
        if (status !== 'all') {
            query.status = status;
        }
        
        const [appeals, totalAppeals, stats] = await Promise.all([
            this.mongoLogger.db.collection('appeals')
                .find(query)
                .sort({ 'appeal.submittedAt': -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            this.mongoLogger.db.collection('appeals').countDocuments(query),
            this.getAppealsStats()
        ]);
        
        const totalPages = Math.ceil(totalAppeals / limit);
        
        res.render('appeals', {
            client: this.client,
            appeals,
            stats,
            status,
            currentPage: page,
            totalPages,
            page: 'appeals'
        });
    } catch (error) {
        console.error('Appeals page error:', error);
        req.flash('error', 'Error loading appeals');
        res.redirect('/');
    }
});

// Check appeal status by User ID (Public) - MOVED BEFORE DYNAMIC ROUTE
this.app.get('/appeals/status', async (req, res) => {
    try {
        const userId = req.query.userId;
        
        if (!userId) {
            req.flash('error', 'User ID is required');
            return res.redirect('/appeals');
        }
        
        const appeals = await this.mongoLogger.db.collection('appeals')
            .find({ userId: userId })
            .sort({ 'appeal.submittedAt': -1 })
            .toArray();
        
        res.render('appeal-status', {
            client: this.client,
            appeals,
            userId: userId,
            user: req.user || null,
            page: 'appeal-status'
        });
    } catch (error) {
        console.error('Appeal status error:', error);
        req.flash('error', 'Error loading appeal status');
        res.redirect('/appeals');
    }
});

// View individual appeal details (Admin) - KEPT AFTER STATIC ROUTES
this.app.get('/appeals/:appealId', this.requireAuth.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const appealId = req.params.appealId;
        
        // Validate ObjectId format
        if (!ObjectId.isValid(appealId)) {
            req.flash('error', 'Invalid appeal ID');
            return res.redirect('/appeals');
        }
        
        // Fetch the appeal
        const appeal = await this.mongoLogger.db.collection('appeals')
            .findOne({ _id: new ObjectId(appealId) });
        
        if (!appeal) {
            req.flash('error', 'Appeal not found');
            return res.redirect('/appeals');
        }
        
        // Try to fetch the user from Discord
        let discordUser = null;
        try {
            discordUser = await this.client.users.fetch(appeal.userId);
        } catch (e) {
            console.log('Could not fetch user from Discord');
        }
        
        // Fetch related moderation actions
        const moderationHistory = await this.mongoLogger.db.collection('moderation')
            .find({ targetUserId: appeal.userId })
            .sort({ timestamp: -1 })
            .limit(10)
            .toArray();
        
        res.render('appeal-detail', {
            client: this.client,
            appeal,
            discordUser,
            moderationHistory,
            page: 'appeals'
        });
    } catch (error) {
        console.error('Appeal detail error:', error);
        req.flash('error', 'Error loading appeal');
        res.redirect('/appeals');
    }
});

// Update appeal status (Admin action)
this.app.post('/appeals/:appealId/update', this.requireAdmin.bind(this), async (req, res) => {
    try {
        const { ObjectId } = require('mongodb');
        const { status, response } = req.body;
        const appealId = req.params.appealId;
        
        // Validate ObjectId format
        if (!ObjectId.isValid(appealId)) {
            req.flash('error', 'Invalid appeal ID');
            return res.redirect('/appeals');
        }
        
        const updateData = {
            status: status,
            'response.message': response,
            'response.respondedAt': new Date(),
            'response.respondedBy': req.user?.username || 'Admin'
        };
        
        // Add to history
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
        
        // Try to DM the user about the decision
        const appeal = await this.mongoLogger.db.collection('appeals')
            .findOne({ _id: new ObjectId(appealId) });
        
        if (appeal) {
            try {
                const user = await this.client.users.fetch(appeal.userId);
                
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
}

async getAttachmentStats() {
    try {
        const totalAttachments = await this.mongoLogger.db.collection('attachments').countDocuments();
        const sizeResult = await this.mongoLogger.db.collection('attachments').aggregate([
            { $group: { _id: null, totalSize: { $sum: '$size' } } }
        ]).toArray();
        const totalSize = sizeResult.length > 0 ? sizeResult[0].totalSize : 0;
        const byType = await this.mongoLogger.db.collection('attachments').aggregate([
            { $group: { _id: '$contentType', count: { $sum: 1 }, totalSize: { $sum: '$size' } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]).toArray();
        const imageCount = await this.mongoLogger.db.collection('attachments').countDocuments({ contentType: /^image\// });
        return { total: totalAttachments, totalSize: totalSize, byType: byType, imageCount: imageCount };
    } catch (error) {
        return { total: 0, totalSize: 0, byType: [], imageCount: 0 };
    }
}

async getAppealsStats() {
    try {
        const [total, pending, reviewing, approved, denied] = await Promise.all([
            this.mongoLogger.db.collection('appeals').countDocuments(),
            this.mongoLogger.db.collection('appeals').countDocuments({ status: 'pending' }),
            this.mongoLogger.db.collection('appeals').countDocuments({ status: 'reviewing' }),
            this.mongoLogger.db.collection('appeals').countDocuments({ status: 'approved' }),
            this.mongoLogger.db.collection('appeals').countDocuments({ status: 'denied' })
        ]);
        
        return { total, pending, reviewing, approved, denied };
    } catch (error) {
        console.error('Error getting appeals stats:', error);
        return { total: 0, pending: 0, reviewing: 0, approved: 0, denied: 0 };
    }
}

async getModerationStats() {
    try {
        const last7Days = new Date(Date.now() - 7 * 86400000);
        const [totalBans, totalMutes, recentActions] = await Promise.all([
            this.mongoLogger.db.collection('moderation').countDocuments({ actionType: 'ban' }),
            this.mongoLogger.db.collection('moderation').countDocuments({ actionType: { $in: ['mute', 'timeout'] } }),
            this.mongoLogger.db.collection('moderation').countDocuments({ timestamp: { $gte: last7Days } })
        ]);
        return { totalBans, totalMutes, recentActions };
    } catch (error) {
        return { totalBans: 0, totalMutes: 0, recentActions: 0 };
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