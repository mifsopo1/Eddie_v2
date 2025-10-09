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
    // COMMAND SETTINGS ROUTES - ADD THESE HERE
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

            // List of commands that support customization
            const customizableCommands = [
                { name: 'kick', description: 'Kick a member from the server', category: 'Moderation' },
                { name: 'ban', description: 'Ban a member from the server', category: 'Moderation' },
                { name: 'mute', description: 'Mute a member', category: 'Moderation' },
                { name: 'unmute', description: 'Unmute a member', category: 'Moderation' },
                { name: 'warn', description: 'Warn a member', category: 'Moderation' },
                { name: 'unban', description: 'Unban a user', category: 'Moderation' }
            ];

            res.render('command-settings', {
                customizableCommands,
                commandSettings,
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
                    client: this.client,
                    page: 'messages'
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
                    totalPages,
                    page: 'voice'
                });
            } catch (error) {
                console.error('Voice page error:', error);
                req.flash('error', 'Error loading voice activity');
                res.redirect('/');
            }
        });

        // ============================================
        // INVITES PAGE
        // ============================================
        
        this.app.get('/invites', this.requireAuth.bind(this), async (req, res) => {
            try {
                const inviteStats = await this.getInviteLeaderboard();
                const recentInvites = await this.getRecentInvites(50);
                
                res.render('invites', {
                    client: this.client,
                    inviteStats: inviteStats,
                    recentInvites: recentInvites,
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
                
                try { analytics = await this.mongoLogger.getServerAnalytics() || {}; } catch (e) {}
                try { topUsers = await this.mongoLogger.getTopUsers(7, 15) || []; } catch (e) {}
                try { inviteStats = await this.mongoLogger.getInviteStats() || []; } catch (e) {}
                try { timeline = await this.mongoLogger.getMessageTimeline(14) || []; } catch (e) {}
                try { attachmentStats = await this.mongoLogger.getAttachmentStats() || {}; } catch (e) {}
                try { newAccounts = await this.mongoLogger.getNewAccountJoins(7) || []; } catch (e) {}
                
                res.render('analytics', {
                    analytics,
                    topUsers,
                    inviteStats,
                    timeline,
                    attachmentStats,
                    newAccounts,
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
                builtInCommands.push({
                    name: name,
                    description: cmd.description || 'No description',
                    category: cmd.category || 'general',
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

        console.log(`✅ Total commands to display: ${allCommands.length}`);

        res.render('commands', { 
            commands: allCommands,
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
this.app.get('/commands/settings', this.requireAuth.bind(this), async (req, res) => {
    try {
        const fs = require('fs');
        
        // Load command settings from file
        let commandSettings = {};
        if (fs.existsSync('command-settings.json')) {
            commandSettings = JSON.parse(fs.readFileSync('command-settings.json', 'utf8'));
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

        res.render('command-settings', {
            customizableCommands,
            commandSettings,
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
    }

    // ============================================
    // HELPER METHODS
    // ============================================
    
    async getInviteLeaderboard() {
        try {
            return await this.mongoLogger.db.collection('members').aggregate([
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
        } catch (error) {
            console.error('Error getting invite leaderboard:', error);
            return [];
        }
    }

    async getRecentInvites(limit = 50) {
        try {
            return await this.mongoLogger.db.collection('members')
                .find({ 
                    eventType: 'join',
                    'inviteData.code': { $exists: true }
                })
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();
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