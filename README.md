
# Eddie Bot - Discord Logger & Utilities

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd eddie-bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create your config file:**
   ```bash
   cp config.example.json config.json
   ```

4. **Edit `config.json` with your details:**
   - Replace `YOUR_BOT_TOKEN_HERE` with your Discord bot token
   - Replace all channel IDs with your server's channel IDs
   - Replace webhook URL with your Discord webhook

5. **Get your bot token:**
   - Go to https://discord.com/developers/applications
   - Create a new application
   - Go to "Bot" section
   - Copy the token

6. **Get channel IDs:**
   - Enable Developer Mode in Discord (Settings → Advanced)
   - Right-click any channel → Copy ID

7. **Run the bot:**
   ```bash
   node index.js
   ```

## Features
- Comprehensive Discord logging
- Steam sale monitoring
- Claude token tracking
- Invite tracking
- Role approval system

## Configuration
All configuration is done in `config.json` (not tracked in Git).

## Quick Start

1. Copy the example config:
   ```bash
   cp config.example.json config.json
   ```

2. Edit `config.json` and replace:
   - `YOUR_BOT_TOKEN_HERE` → Your Discord bot token
   - All `*_CHANNEL_ID` → Your Discord channel IDs
   - `YOUR_DISCORD_WEBHOOK_URL_HERE` → Your webhook URL (optional)

3. Run the bot:
   ```bash
   npm install
   node index.js