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
