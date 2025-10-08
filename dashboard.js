const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const path = require('path');
const ejs = require('ejs');

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
        
        // EJS Configuration - Complete rewrite
        const viewsPath = path.join(__dirname, 'views');
        this.app.set('view engine', 'ejs');
        this.app.set('views', viewsPath);
        
        // Remove any custom engine and let Express use EJS defaults
        // But we need to pass includeFile function manually
        this.app.use((req, res, next) => {
            const originalRender = res.render;
            res.render = function(view, options, callback) {
                options = options || {};
                options.filename = path.join(viewsPath, view + '.ejs');
                options.includeFile = ejs.includeFile;
                return originalRender.call(this, view, options, callback);
            };
            next();
        });
    }

    requireAuth(req, res, next) {
        if (req.session && req.session.authenticated) {
            return next();
        }
        res.redirect('/login');
    }

    setupRoutes() {
        // Login page
        this.app.get('/login', (req, res) => {
            if (req.session.authenticated) {
                return res.redirect('/');
            }
            res.render('login', { error: null });
        });

        // Login POST
        this.app.post('/login', async (req, res) => {
            const { password } = req.body;
            
            if (bcrypt.compareSync(password, this.adminPasswordHash)) {
                req.session.authenticated = true;
                res.redirect('/');
            } else {
                res.render('login', { error: 'Invalid password' });
            }
        });

        // Logout
        this.app.get('/logout', (req, res) => {
            req.session.destroy();
            res.redirect('/login');
        });

        // Dashboard home
        this.app.get('/', this.requireAuth.bind(this), async (req, res) => {
            try {
                console.log('=== Dashboard Access ===');
                console.log('MongoDB connected:', this.mongoLogger?.connected);
                
                // Check if MongoDB is connected
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.status(500).send(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <title>MongoDB Not Connected</title>
                            <style>
                                body { 
                                    font-family: Arial, sans-serif; 
                                    max-width: 800px; 
                                    margin: 50px auto; 
                                    padding: 20px;
                                    background: #1e1e1e;
                                    color: #e0e0e0;
                                }
                                h1 { color: #ed4245; }
                                .error-box {
                                    background: #2c2c2c;
                                    border: 2px solid #ed4245;
                                    padding: 20px;
                                    border-radius: 10px;
                                    margin: 20px 0;
                                }
                                a {
                                    display: inline-block;
                                    padding: 10px 20px;
                                    background: #5865f2;
                                    color: white;
                                    text-decoration: none;
                                    border-radius: 5px;
                                    margin-top: 20px;
                                }
                            </style>
                        </head>
                        <body>
                            <h1>⚠️ MongoDB Not Connected</h1>
                            <div class="error-box">
                                <p>The bot is running but MongoDB is not connected.</p>
                                <p><strong>Possible causes:</strong></p>
                                <ul>
                                    <li>MongoDB container is not running</li>
                                    <li>Wrong connection credentials in config.json</li>
                                    <li>MongoDB failed to start</li>
                                </ul>
                                <p><strong>To fix:</strong></p>
                                <ol>
                                    <li>Check if MongoDB is running: <code>sudo docker ps | grep mongodb</code></li>
                                    <li>Check bot logs: <code>pm2 logs discord-logger-bot</code></li>
                                    <li>Verify config.json has correct MongoDB URI</li>
                                    <li>Restart bot: <code>pm2 restart discord-logger-bot</code></li>
                                </ol>
                            </div>
                            <a href="/logout">Logout</a>
                        </body>
                        </html>
                    `);
                }
                
                // Get stats with fallback
                console.log('Getting stats...');
                let stats = await this.mongoLogger.getStats();
                console.log('Stats received:', stats ? 'Yes' : 'No');
                
                if (!stats) {
                    console.log('Creating default stats');
                    stats = {
                        totalMessages: 0,
                        totalMembers: 0,
                        totalModActions: 0,
                        last24h: {
                            messages: 0,
                            joins: 0,
                            deletes: 0
                        }
                    };
                }
                
                // Get recent messages with fallback
                console.log('Getting recent messages...');
                let recentMessages = await this.mongoLogger.getRecentMessages(50);
                console.log('Recent messages count:', recentMessages?.length || 0);
                
                if (!recentMessages) {
                    console.log('Setting recentMessages to empty array');
                    recentMessages = [];
                }
                
                console.log('Rendering dashboard view');
                res.render('dashboard', {
                    client: this.client,
                    stats: stats,
                    recentMessages: recentMessages
                });
                console.log('Dashboard rendered successfully');
                
            } catch (error) {
                console.error('Dashboard error:', error);
                res.status(500).send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Dashboard Error</title>
                        <style>
                            body { 
                                font-family: Arial, sans-serif; 
                                max-width: 1200px; 
                                margin: 50px auto; 
                                padding: 20px;
                                background: #1e1e1e;
                                color: #e0e0e0;
                            }
                            h1 { color: #ed4245; }
                            .error-box {
                                background: #2c2c2c;
                                border: 2px solid #ed4245;
                                padding: 20px;
                                border-radius: 10px;
                                margin: 20px 0;
                            }
                            pre {
                                background: #1a1a1a;
                                padding: 15px;
                                border-radius: 5px;
                                overflow-x: auto;
                                color: #ff6b6b;
                            }
                            a {
                                display: inline-block;
                                padding: 10px 20px;
                                background: #5865f2;
                                color: white;
                                text-decoration: none;
                                border-radius: 5px;
                                margin-top: 20px;
                            }
                        </style>
                    </head>
                    <body>
                        <h1>❌ Dashboard Error</h1>
                        <div class="error-box">
                            <p><strong>Error Message:</strong></p>
                            <p>${error.message}</p>
                            <p><strong>Stack Trace:</strong></p>
                            <pre>${error.stack}</pre>
                        </div>
                        <a href="/logout">Logout</a>
                        <a href="/" style="background: #43b581; margin-left: 10px;">Retry</a>
                    </body>
                    </html>
                `);
            }
        });

        // Messages page
        this.app.get('/messages', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.status(500).send('MongoDB not connected. <a href="/">Go back</a>');
                }
                
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
                const totalPages = Math.ceil(totalMessages / limit) || 1;
                
                res.render('messages', {
                    messages: messages || [],
                    currentPage: page,
                    totalPages: totalPages,
                    client: this.client
                });
            } catch (error) {
                console.error('Messages page error:', error);
                res.status(500).send(`
                    <h1>Error Loading Messages</h1>
                    <p>${error.message}</p>
                    <pre>${error.stack}</pre>
                    <a href="/">Go back</a>
                `);
            }
        });

        // Deleted messages page
        this.app.get('/deleted', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.status(500).send('MongoDB not connected. <a href="/">Go back</a>');
                }
                
                const hours = parseInt(req.query.hours) || 24;
                const messages = await this.mongoLogger.getDeletedMessages(hours);
                
                res.render('deleted', {
                    messages: messages || [],
                    hours: hours,
                    client: this.client
                });
            } catch (error) {
                console.error('Deleted messages error:', error);
                res.status(500).send(`
                    <h1>Error Loading Deleted Messages</h1>
                    <p>${error.message}</p>
                    <pre>${error.stack}</pre>
                    <a href="/">Go back</a>
                `);
            }
        });

        // User lookup page
        this.app.get('/user/:userId', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.status(500).send('MongoDB not connected. <a href="/">Go back</a>');
                }
                
                const userId = req.params.userId;
                
                const [messages, moderationHistory, memberData] = await Promise.all([
                    this.mongoLogger.getUserMessages(userId, 200).catch(() => []),
                    this.mongoLogger.getModerationHistory(userId).catch(() => []),
                    this.mongoLogger.db.collection('members').find({ userId }).sort({ timestamp: -1 }).toArray().catch(() => [])
                ]);
                
                let discordUser = null;
                try {
                    discordUser = await this.client.users.fetch(userId);
                } catch (e) {
                    console.log('Could not fetch user from Discord:', userId);
                }
                
                res.render('user', {
                    userId: userId,
                    discordUser: discordUser,
                    messages: messages || [],
                    moderationHistory: moderationHistory || [],
                    memberData: memberData || [],
                    client: this.client
                });
            } catch (error) {
                console.error('User lookup error:', error);
                res.status(500).send(`
                    <h1>Error Loading User Data</h1>
                    <p>${error.message}</p>
                    <pre>${error.stack}</pre>
                    <a href="/">Go back</a>
                `);
            }
        });

        // Members page
        this.app.get('/members', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.status(500).send('MongoDB not connected. <a href="/">Go back</a>');
                }
                
                const recentJoins = await this.mongoLogger.db.collection('members')
                    .find({ eventType: 'join' })
                    .sort({ timestamp: -1 })
                    .limit(100)
                    .toArray();
                
                const recentLeaves = await this.mongoLogger.db.collection('members')
                    .find({ eventType: 'leave' })
                    .sort({ timestamp: -1 })
                    .limit(100)
                    .toArray();
                
                res.render('members', {
                    recentJoins: recentJoins || [],
                    recentLeaves: recentLeaves || [],
                    client: this.client
                });
            } catch (error) {
                console.error('Members page error:', error);
                res.status(500).send(`
                    <h1>Error Loading Members</h1>
                    <p>${error.message}</p>
                    <a href="/">Go back</a>
                `);
            }
        });

        // Moderation page
        this.app.get('/moderation', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.status(500).send('MongoDB not connected. <a href="/">Go back</a>');
                }
                
                const actions = await this.mongoLogger.db.collection('moderation')
                    .find({})
                    .sort({ timestamp: -1 })
                    .limit(100)
                    .toArray();
                
                res.render('moderation', {
                    actions: actions || [],
                    client: this.client
                });
            } catch (error) {
                console.error('Moderation page error:', error);
                res.status(500).send(`
                    <h1>Error Loading Moderation Logs</h1>
                    <p>${error.message}</p>
                    <a href="/">Go back</a>
                `);
            }
        });

        // Attachments page
        this.app.get('/attachments', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.status(500).send('MongoDB not connected. <a href="/">Go back</a>');
                }
                
                const attachments = await this.mongoLogger.db.collection('attachments')
                    .find({})
                    .sort({ timestamp: -1 })
                    .limit(100)
                    .toArray();
                
                res.render('attachments', {
                    attachments: attachments || [],
                    client: this.client
                });
            } catch (error) {
                console.error('Attachments page error:', error);
                res.status(500).send(`
                    <h1>Error Loading Attachments</h1>
                    <p>${error.message}</p>
                    <a href="/">Go back</a>
                `);
            }
        });

        // Voice activity page
        this.app.get('/voice', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.status(500).send('MongoDB not connected. <a href="/">Go back</a>');
                }
                
                const voiceActivity = await this.mongoLogger.db.collection('voice')
                    .find({})
                    .sort({ timestamp: -1 })
                    .limit(200)
                    .toArray();
                
                res.render('voice', {
                    voiceActivity: voiceActivity || [],
                    client: this.client
                });
            } catch (error) {
                console.error('Voice activity error:', error);
                res.status(500).send(`
                    <h1>Error Loading Voice Activity</h1>
                    <p>${error.message}</p>
                    <a href="/">Go back</a>
                `);
            }
        });

        // Search API endpoint
        this.app.get('/api/search', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.json({ success: false, error: 'MongoDB not connected' });
                }
                
                const { query, type } = req.query;
                
                let results = [];
                
                if (type === 'user') {
                    results = await this.mongoLogger.db.collection('messages')
                        .find({
                            $or: [
                                { userId: query },
                                { userName: { $regex: query, $options: 'i' } }
                            ]
                        })
                        .sort({ timestamp: -1 })
                        .limit(100)
                        .toArray();
                } else if (type === 'content') {
                    results = await this.mongoLogger.db.collection('messages')
                        .find({
                            content: { $regex: query, $options: 'i' }
                        })
                        .sort({ timestamp: -1 })
                        .limit(100)
                        .toArray();
                }
                
                res.json({ success: true, results: results || [] });
            } catch (error) {
                console.error('Search error:', error);
                res.json({ success: false, error: error.message });
            }
        });

        // Stats API endpoint
        this.app.get('/api/stats', this.requireAuth.bind(this), async (req, res) => {
            try {
                if (!this.mongoLogger || !this.mongoLogger.connected) {
                    return res.json({ success: false, error: 'MongoDB not connected' });
                }
                
                const stats = await this.mongoLogger.getStats();
                res.json({ success: true, stats: stats || {} });
            } catch (error) {
                console.error('Stats API error:', error);
                res.json({ success: false, error: error.message });
            }
        });

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                mongodb: this.mongoLogger?.connected || false,
                uptime: process.uptime(),
                timestamp: Date.now()
            });
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