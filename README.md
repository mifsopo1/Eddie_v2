# Eddie Bot - Discord Logger & Utilities

Comprehensive Discord logging bot with MongoDB persistence and web dashboard.

## 🚀 Features

### Core Logging
- 💬 **Message Logging** - Create, edit, delete events
- 👥 **Member Tracking** - Joins, leaves, role changes with invite tracking
- 🔊 **Voice Activity** - Join, leave, switch channel events
- 📎 **Attachment Preservation** - Save attachments before deletion
- 🔨 **Moderation Actions** - Bans, unbans, mutes with full history
- 🎫 **Invite Tracking** - Track who invited each member

### Anti-Spam System
- 🛡️ **Cross-Channel Detection** - Detects duplicate content across channels
- ⚡ **Rapid Message Detection** - Identifies message flooding
- 🔇 **Auto-Mute** - Automatically mutes spammers
- 📋 **Manual Review** - Moderator buttons to ban or unmute
- 📎 **Attachment Backup** - Saves spam attachments before deletion

### Web Dashboard
- 📊 **Real-time Stats** - Message counts, member activity, mod actions
- 🔍 **Message Search** - Search by user, content, or channel
- 🗑️ **Deleted Messages** - View deleted messages with time filters
- 👤 **User Profiles** - Full history of messages, joins, mod actions
- 🔐 **Secure Login** - Password-protected admin panel

### Additional Features
- 🎮 **Steam Sale Monitor** - Track game sales and post alerts
- 🤖 **Claude Token Tracker** - Monitor AI usage and costs
- ⚙️ **Custom Commands** - Extensible command system

---

## 📦 Installation

### Prerequisites
- Node.js 18+ 
- MongoDB (local or MongoDB Atlas)
- Discord Bot Token

### Quick Setup

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd discord-logger-bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up MongoDB:**
   
   **Option A: Docker (Local)**
   ```bash
   docker run -d \
     --name mongodb \
     --restart unless-stopped \
     -p 27017:27017 \
     -v /path/to/data:/data/db \
     -e MONGO_INITDB_ROOT_USERNAME=discord_bot \
     -e MONGO_INITDB_ROOT_PASSWORD=your_password \
     mongo:latest
   ```
   
   **Option B: MongoDB Atlas (Cloud)**
   - Go to https://mongodb.com/cloud/atlas
   - Create free M0 cluster
   - Get connection string

4. **Configure the bot:**
   ```bash
   cp config.example.json config.json
   nano config.json
   ```
   
   Update these values:
   - `token` - Your Discord bot token
   - `mongodb.uri` - Your MongoDB connection string
   - `mongodb.database` - Database name (e.g., "discord_logs")
   - `dashboard.adminPassword` - Dashboard login password
   - `dashboard.sessionSecret` - Random string for session encryption
   - `logChannels.*` - Your Discord channel IDs
   - `antiSpam.exemptRoles` - Role IDs that bypass spam detection

5. **Start the bot:**
   ```bash
   node index.js
   ```
   
   Or with PM2:
   ```bash
   pm2 start index.js --name discord-logger-bot
   pm2 save
   ```

6. **Access the dashboard:**
   ```
   http://localhost:3000
   ```
   Or: `http://YOUR_SERVER_IP:3000`

---

## 🔧 Configuration

### MongoDB Settings

**Local MongoDB:**
```json
{
  "mongodb": {
    "enabled": true,
    "uri": "mongodb://discord_bot:password@localhost:27017/discord_logs?authSource=admin",
    "database": "discord_logs"
  }
}
```

**MongoDB Atlas (Cloud):**
```json
{
  "mongodb": {
    "enabled": true,
    "uri": "mongodb+srv://username:password@cluster.mongodb.net/discord_logs?retryWrites=true&w=majority",
    "database": "discord_logs"
  }
}
```

### Dashboard Settings

```json
{
  "dashboard": {
    "enabled": true,
    "port": 3000,
    "adminPassword": "YourSecurePassword123!",
    "sessionSecret": "random-secret-string-xyz789"
  }
}
```

### Anti-Spam Configuration

```json
{
  "antiSpam": {
    "enabled": true,
    "messageThreshold": 5,        // Messages before triggering
    "timeWindow": 10000,          // Time window (ms)
    "crossChannelThreshold": 2,   // Channels before triggering
    "crossChannelTime": 30000,    // Cross-channel time window (ms)
    "exemptRoles": [              // Roles that bypass detection
      "MODERATOR_ROLE_ID",
      "ADMIN_ROLE_ID"
    ],
    "autoUnmute": true
  }
}
```

---

## 📊 Dashboard Features

### Main Dashboard
- Total messages logged
- Total members joined
- Moderation actions count
- Recent activity (24h)
- Live message feed

### Messages Page
- Paginated message history
- Filter by type (create/edit/delete)
- Search functionality
- Jump to user profile

### Deleted Messages
- Time range filtering (1h to 1 month)
- Original timestamp preservation
- Attachment information
- Content recovery

### User Profile
- Complete message history
- Moderation action timeline
- Member join/leave events
- Invite tracking data
- Role change history

---

## 🛡️ Anti-Spam System

### Detection Types

1. **Cross-Channel Spam**
   - Detects identical content posted in multiple channels
   - Triggers after 2+ channels within 30 seconds
   
2. **Rapid Messages**
   - Detects message flooding
   - Triggers after 5+ messages in 10 seconds

3. **Identical Spam**
   - Detects repeated identical messages
   - Checks content, attachments, embeds, stickers

### Auto-Moderation Actions

1. **Collect Evidence**
   - Downloads all attachments (< 8MB)
   - Saves message content
   - Tracks affected channels

2. **Mute User**
   - Applies "Muted" role automatically
   - Removes send permissions

3. **Delete Spam**
   - Removes all spam messages
   - Preserves evidence in mod channel

4. **Notify Moderators**
   - Posts detailed report with:
     - User info & account age
     - Invite tracking data
     - Deleted message samples
     - Attachment previews
     - Ban/Unmute buttons

### Manual Review

Moderators can:
- ✅ **Unmute** - If false positive
- 🔨 **Ban** - If confirmed spam

---

## 📁 Project Structure

```
discord-logger-bot/
├── index.js                 # Main bot file
├── mongodb-logger.js        # MongoDB logging handler
├── dashboard.js             # Express dashboard server
├── commands.js              # Command handler
├── steamSaleMonitor.js      # Steam sale tracking
├── claudeTokenTracker.js    # AI usage tracker
├── config.example.json      # Example configuration
├── package.json             # Dependencies
├── views/                   # EJS templates
│   ├── login.ejs
│   ├── dashboard.ejs
│   ├── messages.ejs
│   ├── deleted.ejs
│   ├── user.ejs
│   └── partials/
│       └── header.ejs
└── public/                  # Static files
    └── css/
        └── style.css
```

---

## 🔐 Security Notes

1. **Never commit `config.json`** - Contains sensitive tokens
2. **Use strong passwords** - For dashboard and MongoDB
3. **Secure MongoDB** - Use authentication and restrict access
4. **HTTPS recommended** - For production dashboard access
5. **Regular backups** - MongoDB data should be backed up

---

## 🐛 Troubleshooting

### Bot won't start
```bash
# Check logs
pm2 logs discord-logger-bot

# Verify config.json syntax
node -c config.json

# Test MongoDB connection
mongosh "mongodb://discord_bot:password@localhost:27017"
```

### Dashboard not accessible
```bash
# Check if port 3000 is open
sudo ufw allow 3000

# Check if dashboard is running
sudo netstat -tlnp | grep 3000

# Check bot logs
pm2 logs discord-logger-bot
```

### MongoDB connection failed
```bash
# Check if MongoDB is running
docker ps | grep mongodb

# Check MongoDB logs
docker logs mongodb

# Test connection
docker exec -it mongodb mongosh -u discord_bot -p password
```

---

## 📝 License

MIT License - See LICENSE file for details

---

## 🤝 Contributing

Pull requests are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 💡 Support

For issues, questions, or suggestions:
- Open a GitHub issue
- Check existing issues first
- Provide logs and config (redact sensitive info)

---

## 🔄 Updates

To update the bot:

```bash
git pull origin main
npm install
pm2 restart discord-logger-bot
```

---

## 📊 MongoDB Collections

The bot creates these collections:

- `messages` - All message events (create/edit/delete)
- `members` - Member joins/leaves/role changes
- `moderation` - Ban/unban/mute actions
- `voice` - Voice channel activity
- `attachments` - File metadata
- `sessions` - Dashboard sessions

---

## ⚙️ Environment Variables (Alternative Config)

You can also use environment variables:

```bash
DISCORD_TOKEN=your_token
MONGODB_URI=mongodb://...
DASHBOARD_PASSWORD=your_password
```

---

From Mifsopo and Claude AI Made with ❤️ for Discord server management
