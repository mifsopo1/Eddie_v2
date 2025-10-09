const { Client, GatewayIntentBits, EmbedBuilder, AuditLogEvent, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config.json');
const MongoDBLogger = require('./mongodb-logger');
const Dashboard = require('./dashboard');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildModeration
    ]
});

// MongoDB and Dashboard - INITIALIZE FIRST
let mongoLogger = null;
let dashboard = null;

// Command handler - DECLARE BUT DON'T INITIALIZE YET
const CommandHandler = require('./commands');
let commandHandler = null;  // Changed from const to let, set to null

// Store log channels
const logChannels = {};

// Store server invites
const serverInvites = new Map();

// Store member invites
const memberInvites = new Map();
const memberInvitesFile = 'member-invites.json';

// Store cooldowns in memory for custom commands
const customCommandCooldowns = {
    user: new Map(),
    channel: new Map(),
    server: new Map()
};

// Helper function to get disk space
function getDiskSpace() {
    const { execSync } = require('child_process');
    try {
        const output = execSync('df -h /var/lib/jenkins/discord-logger-bot | tail -1').toString();
        const parts = output.split(/\s+/);
        return {
            total: parts[1],
            used: parts[2],
            available: parts[3],
            percentage: parts[4]
        };
    } catch (error) {
        return {
            total: 'N/A',
            used: 'N/A',
            available: 'N/A',
            percentage: 'N/A'
        };
    }
}

// Attachments directory
const ATTACHMENTS_DIR = '/var/lib/jenkins/discord-logger-bot/saved-attachments';

// Create attachments directory if it doesn't exist
if (!fs.existsSync(ATTACHMENTS_DIR)) {
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    console.log('✅ Created saved-attachments directory');
}

// Helper function to download and save attachment
async function saveAttachment(attachment, userId, messageId) {
    try {
        // Skip files larger than 10MB
        if (attachment.size > 10 * 1024 * 1024) {
            console.log(`⚠️ Skipping large file: ${attachment.name} (${(attachment.size / 1024 / 1024).toFixed(2)} MB)`);
            return null;
        }

        // Create date-based subdirectory
        const date = new Date();
        const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const dateDir = path.join(ATTACHMENTS_DIR, yearMonth);
        
        if (!fs.existsSync(dateDir)) {
            fs.mkdirSync(dateDir, { recursive: true });
        }

        // Sanitize filename and add unique prefix
        const timestamp = Date.now();
        const sanitized = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filename = `${userId}_${messageId}_${timestamp}_${sanitized}`;
        const filepath = path.join(dateDir, filename);

        // Download the file
        const response = await fetch(attachment.url);
        if (!response.ok) {
            console.log(`❌ Failed to download: ${attachment.name} (HTTP ${response.status})`);
            return null;
        }

        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filepath, Buffer.from(buffer));

        console.log(`✅ Saved attachment: ${filename} (${(attachment.size / 1024).toFixed(2)} KB)`);

        return {
            originalName: attachment.name,
            savedPath: filepath,
            relativePath: `${yearMonth}/${filename}`,
            size: attachment.size,
            contentType: attachment.contentType
        };
    } catch (error) {
        console.error(`❌ Error saving attachment ${attachment.name}:`, error.message);
        return null;
    }
}

// Load member invites from file
function loadMemberInvites() {
    try {
        if (fs.existsSync(memberInvitesFile)) {
            const data = JSON.parse(fs.readFileSync(memberInvitesFile, 'utf8'));
            Object.entries(data).forEach(([userId, inviteData]) => {
                memberInvites.set(userId, inviteData);
            });
            console.log(`✅ Loaded ${memberInvites.size} member invite records`);
        }
    } catch (error) {
        console.error('Error loading member invites:', error);
    }
}

function saveMemberInvites() {
    try {
        const data = Object.fromEntries(memberInvites);
        fs.writeFileSync(memberInvitesFile, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving member invites:', error);
    }
}

// Anti-spam tracking
const userSpamTracking = new Map();
const spamReportCooldown = new Map();
const pendingAttachments = new Map();

const SPAM_THRESHOLDS = {
    MESSAGE_COUNT: config.antiSpam?.messageThreshold || 5,
    TIME_WINDOW: config.antiSpam?.timeWindow || 10000,
    CROSS_CHANNEL_COUNT: config.antiSpam?.crossChannelThreshold || 2,
    CROSS_CHANNEL_TIME: config.antiSpam?.crossChannelTime || 30000,
    MUTE_DURATION: config.antiSpam?.muteDuration || 3600000,
    DELETE_THRESHOLD: config.antiSpam?.deleteThreshold || 50,
    AUTO_UNMUTE: config.antiSpam?.autoUnmute !== false
};

function trackSpamBehavior(message) {
    const userId = message.author.id;
    const now = Date.now();
    
    if (!userSpamTracking.has(userId)) {
        userSpamTracking.set(userId, {
            messages: [],
            channels: new Set(),
            muted: false,
            warnings: 0,
            contentHashes: new Map()
        });
    }
    
    const userData = userSpamTracking.get(userId);
    const contentHash = createContentHash(message);
    
    userData.messages.push({
        timestamp: now,
        channelId: message.channel.id,
        messageId: message.id,
        content: message.content,
        contentHash: contentHash,
        hasAttachments: message.attachments.size > 0
    });
    userData.channels.add(message.channel.id);
    
    userData.messages = userData.messages.filter(msg => 
        now - msg.timestamp < SPAM_THRESHOLDS.CROSS_CHANNEL_TIME
    );
    
    const recentChannels = new Set(
        userData.messages.map(msg => msg.channelId)
    );
    userData.channels = recentChannels;
    
    const contentChannelMap = new Map();
    
    userData.messages.forEach(msg => {
        if (!contentChannelMap.has(msg.contentHash)) {
            contentChannelMap.set(msg.contentHash, {
                channels: new Set(),
                messages: []
            });
        }
        
        const hashData = contentChannelMap.get(msg.contentHash);
        hashData.channels.add(msg.channelId);
        hashData.messages.push(msg);
    });
    
    for (const [hash, data] of contentChannelMap.entries()) {
        if (data.channels.size >= 2) {
            return {
                isSpam: true,
                reason: 'cross_channel_duplicate',
                count: data.messages.length,
                channels: data.channels.size,
                messages: data.messages,
                contentHash: hash
            };
        }
    }
    
    const recentMessages = userData.messages.filter(msg => 
        now - msg.timestamp < SPAM_THRESHOLDS.TIME_WINDOW
    );
    
    if (recentMessages.length >= SPAM_THRESHOLDS.MESSAGE_COUNT) {
        return {
            isSpam: true,
            reason: 'rapid_messages',
            count: recentMessages.length,
            messages: userData.messages
        };
    }
    
    const recentContent = recentMessages.map(m => m.content.toLowerCase().trim());
    const uniqueContent = new Set(recentContent);
    if (recentContent.length >= 3 && uniqueContent.size === 1) {
        return {
            isSpam: true,
            reason: 'identical_spam',
            count: recentMessages.length,
            messages: userData.messages
        };
    }
    
    return { isSpam: false };
}

function createContentHash(message) {
    let hashString = message.content.toLowerCase().trim();
    
    if (message.attachments.size > 0) {
        const attachmentInfo = message.attachments.map(a => 
            `${a.name}:${a.size}:${a.contentType}`
        ).join('|');
        hashString += `|ATT:${attachmentInfo}`;
    }
    
    if (message.embeds.length > 0) {
        const embedInfo = message.embeds.map(e => 
            `${e.url}:${e.title}:${e.description?.slice(0, 50)}`
        ).join('|');
        hashString += `|EMB:${embedInfo}`;
    }
    
    if (message.stickers.size > 0) {
        const stickerInfo = message.stickers.map(s => s.id).join('|');
        hashString += `|STK:${stickerInfo}`;
    }
    
    let hash = 0;
    for (let i = 0; i < hashString.length; i++) {
        const char = hashString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    
    return hash.toString();
}

async function handleSpammer(message, spamData) {
    const member = message.member;
    if (!member) return;
    
    if (member.permissions.has('Administrator') || member.permissions.has('ModerateMembers')) {
        return;
    }
    
    const userData = userSpamTracking.get(message.author.id);
    if (userData.muted) {
        console.log(`User ${message.author.tag} already muted, skipping`);
        return;
    }
    
    try {
        let mutedRole = message.guild.roles.cache.find(r => r.name === 'Muted');
        
        if (!mutedRole) {
            console.log('Creating Muted role...');
            mutedRole = await message.guild.roles.create({
                name: 'Muted',
                color: '#808080',
                permissions: [],
                reason: 'Auto-spam protection'
            });
            
            const channels = message.guild.channels.cache;
            for (const [, channel] of channels) {
                if (channel.permissionsFor(message.guild.members.me).has('ManageRoles')) {
                    await channel.permissionOverwrites.create(mutedRole, {
                        SendMessages: false,
                        AddReactions: false,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false,
                        SendMessagesInThreads: false,
                        Speak: false
                    }).catch(console.error);
                }
            }
        }
        
        await member.roles.add(mutedRole);
        userData.muted = true;
        console.log(`🔇 Muted ${message.author.tag}`);
        
        // SAVE ATTACHMENTS LOCALLY BEFORE DELETION
        const savedAttachments = [];
        
        console.log('📎 Downloading and saving spam attachments...');
        
        for (const msg of spamData.messages) {
            try {
                const channel = message.guild.channels.cache.get(msg.channelId);
                if (channel) {
                    const targetMessage = await channel.messages.fetch(msg.messageId).catch(() => null);
                    if (targetMessage && targetMessage.attachments.size > 0) {
                        for (const att of targetMessage.attachments.values()) {
                            const saved = await saveAttachment(att, message.author.id, msg.messageId);
                            if (saved) {
                                savedAttachments.push({
                                    ...saved,
                                    channelId: msg.channelId,
                                    channelName: channel.name,
                                    originalUrl: att.url
                                });
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error saving spam attachment:', error);
            }
        }
        
        console.log(`💾 Saved ${savedAttachments.length} spam attachments to disk`);
        
        // Delete spam messages
        let deletedCount = 0;
        const deletedChannels = new Set();
        
        for (const msg of spamData.messages) {
            try {
                const channel = message.guild.channels.cache.get(msg.channelId);
                if (channel) {
                    const targetMessage = await channel.messages.fetch(msg.messageId).catch(() => null);
                    if (targetMessage) {
                        await targetMessage.delete();
                        deletedCount++;
                        deletedChannels.add(channel.name);
                    }
                }
            } catch (error) {
                console.error('Error deleting spam message:', error);
            }
        }
        
        if (logChannels.moderation) {
            const embed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('🗑️ Cross-Channel Spam Detected & User Muted')
                .setThumbnail(message.author.displayAvatarURL())
                .addFields(
                    { name: 'User', value: `<@${message.author.id}>\n${message.author.tag} (${message.author.id})`, inline: true },
                    { name: 'Spam Type', value: getSpamReasonText(spamData.reason), inline: true },
                    { name: 'Messages Deleted', value: deletedCount.toString(), inline: true },
                    { name: 'Auto-Action', value: '🔇 **User has been MUTED**', inline: false }
                );
            
            if (spamData.channels) {
                embed.addFields({
                    name: 'Channels Affected',
                    value: Array.from(deletedChannels).map(c => `#${c}`).join(', ') || 'Unknown',
                    inline: false
                });
            }
            
            const memberInviteData = memberInvites.get(message.author.id);
            if (memberInviteData) {
                const accountAge = Date.now() - message.author.createdTimestamp;
                
                embed.addFields({
                    name: '📋 Account Info',
                    value: `Created: <t:${Math.floor(message.author.createdTimestamp / 1000)}:R>\n` +
                           `Joined: <t:${Math.floor(memberInviteData.timestamp / 1000)}:R>\n` +
                           `Invite: \`${memberInviteData.code}\` by ${memberInviteData.inviter}`,
                    inline: false
                });
                
                if (accountAge < 86400000) {
                    embed.addFields({
                        name: '⚠️ New Account',
                        value: 'Account is less than 1 day old',
                        inline: false
                    });
                }
            }
            
            const sampleMessages = spamData.messages.slice(0, 2);
            if (sampleMessages.length > 0) {
                const samples = sampleMessages.map((m, i) => {
                    let sample = `${i + 1}. <#${m.channelId}>`;
                    if (m.content) sample += `: ${m.content.slice(0, 100)}`;
                    if (m.hasAttachments) sample += ` 📎`;
                    return sample;
                }).join('\n');
                
                embed.addFields({
                    name: '📝 Deleted Content',
                    value: samples.slice(0, 1024),
                    inline: false
                });
            }
            
            // Show saved attachments info
            if (savedAttachments.length > 0) {
                const attachmentInfo = savedAttachments.slice(0, 5).map((att, i) => {
                    const size = (att.size / 1024).toFixed(2);
                    return `${i + 1}. **${att.originalName}** (${size} KB)\n   📁 Saved: \`${att.relativePath}\``;
                }).join('\n');
                
                embed.addFields({
                    name: `💾 Saved Attachments (${savedAttachments.length} total)`,
                    value: attachmentInfo.slice(0, 1024),
                    inline: false
                });
                
                // Try to show first saved image
                const firstImage = savedAttachments.find(att => 
                    att.contentType?.startsWith('image/')
                );
                if (firstImage) {
                    // Use original Discord URL for embed thumbnail (still accessible for a bit)
                    embed.setImage(firstImage.originalUrl);
                }
            }
            
            embed.addFields({
                name: '⚠️ Action Required',
                value: '<@&1425260355420160100> Please review: **Ban** or **Unmute**?',
                inline: false
            });
            
            embed.setTimestamp();
            embed.setFooter({ text: `Auto-moderation: User muted, ${savedAttachments.length} files saved` });
            
            const banButton = new ButtonBuilder()
                .setCustomId(`ban_${message.author.id}`)
                .setLabel('Confirmed Spam - BAN User')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔨');
            
            const unmutButton = new ButtonBuilder()
                .setCustomId(`unmute_${message.author.id}`)
                .setLabel('Not Spam - UNMUTE User')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅');
            
            const row = new ActionRowBuilder()
                .addComponents(banButton, unmutButton);
            
            await logChannels.moderation.send({
                content: `<@&1425260355420160100> Cross-channel spam detected - User **muted**, ${savedAttachments.length} files **saved**`,
                embeds: [embed],
                components: [row]
            });
            
            // List saved files in a separate message
            if (savedAttachments.length > 0) {
                const fileList = savedAttachments.map((att, i) => {
                    return `${i + 1}. **${att.originalName}**\n` +
                           `   📁 Path: \`${att.relativePath}\`\n` +
                           `   📏 Size: ${(att.size / 1024).toFixed(2)} KB\n` +
                           `   📂 Channel: #${att.channelName}\n` +
                           `   🔗 Original: ${att.originalUrl.slice(0, 50)}...`;
                }).join('\n\n');
                
                await logChannels.moderation.send({
                    content: `**📦 Saved Files List:**\n\`\`\`\n${fileList.slice(0, 1900)}\n\`\`\``
                });
            }
        }
        
        // Log to MongoDB with saved attachment info
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logModerationAction({
                type: 'mute',
                targetUserId: message.author.id,
                targetUserName: message.author.tag,
                targetUserAvatar: message.author.displayAvatarURL(),
                moderatorId: client.user.id,
                moderatorName: 'Auto-Moderation',
                reason: `Cross-channel spam: ${spamData.reason}`,
                duration: SPAM_THRESHOLDS.MUTE_DURATION,
                evidence: `Deleted ${deletedCount} messages, saved ${savedAttachments.length} attachments`,
                savedAttachments: savedAttachments,
                guildId: message.guild.id,
                guildName: message.guild.name
            });
        }
        
        try {
            await message.author.send({
                embeds: [new EmbedBuilder()
                    .setColor('#ff6600')
                    .setTitle('🔇 You have been muted for cross-channel posting')
                    .setDescription(`Your messages were automatically deleted and you have been muted in **${message.guild.name}**`)
                    .addFields(
                        { name: 'Reason', value: 'Posting the same content in multiple channels', inline: false },
                        { name: 'Messages Deleted', value: deletedCount.toString(), inline: true },
                        { name: 'Channels', value: Array.from(deletedChannels).join(', '), inline: true },
                        { name: 'Status', value: '🔇 **MUTED** - Under review', inline: false }
                    )
                    .addFields({
                        name: '⚠️ Important',
                        value: 'Your case is under review by moderators. You will be either unmuted or banned based on their decision.',
                        inline: false
                    })
                    .setTimestamp()
                ]
            });
        } catch (error) {
            console.log(`Could not DM ${message.author.tag} about mute`);
        }
        
    } catch (error) {
        console.error('Error handling cross-channel spam:', error);
    }
}

function getSpamReasonText(reason) {
    const reasons = {
        'rapid_messages': '⚡ Rapid message spam',
        'cross_channel_spam': '🔀 Cross-channel spam',
        'cross_channel_duplicate': '📋 Same content in multiple channels',
        'identical_spam': '📋 Identical message spam'
    };
    return reasons[reason] || 'Unknown spam type';
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    console.log('='.repeat(50));
    console.log(`🤖 Bot: ${client.user.tag}`);
    console.log(`🆔 Bot ID: ${client.user.id}`);
    console.log(`🌐 Servers: ${client.guilds.cache.size}`);
    
    let totalUsers = 0;
    client.guilds.cache.forEach(guild => {
        totalUsers += guild.memberCount;
    });
    console.log(`👥 Total Users: ${totalUsers.toLocaleString()}`);
    console.log(`⚙️ Node Version: ${process.version}`);
    console.log(`📦 Discord.js Version: ${require('discord.js').version}`);
    console.log(`💾 Attachments saved to: ${ATTACHMENTS_DIR}`);
    console.log('='.repeat(50));
    
    // Initialize MongoDB
    if (config.mongodb && config.mongodb.enabled) {
        mongoLogger = new MongoDBLogger(config);
        const connected = await mongoLogger.connect();
        
        if (connected) {
            console.log('✅ MongoDB initialized successfully');
            
            // Initialize CommandHandler AFTER mongoLogger is connected
            commandHandler = new CommandHandler(client, config, mongoLogger);
            client.commandHandler = commandHandler;
            console.log('✅ Command handler initialized');
            
            // Start Dashboard
            if (config.dashboard && config.dashboard.enabled) {
                dashboard = new Dashboard(client, mongoLogger, config);
                dashboard.start();
            }
        } else {
            console.log('⚠️ Bot will continue without MongoDB logging');
        }
    }
    
    loadMemberInvites();
    
    // Link log channels to command handler
    if (commandHandler) {
        commandHandler.setLogChannels(logChannels);
        console.log('✅ Log channels linked to command handler');
    }
    
    console.log('\n📋 Loading log channels...');
    for (const [key, channelId] of Object.entries(config.logChannels)) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel) {
            logChannels[key] = channel;
            console.log(`  ✓ ${key} → #${channel.name}`);
        } else {
            console.log(`  ✗ ${key} → Not found (${channelId})`);
        }
    }
    
    console.log('\n🔗 Caching invites...');
    for (const guild of client.guilds.cache.values()) {
        const invites = await guild.invites.fetch();
        serverInvites.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses])));
        console.log(`  ✓ ${guild.name}: ${invites.size} invites`);
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Bot is ready and monitoring!');
    console.log('='.repeat(50) + '\n');
    
    if (config.startupNotification && config.startupNotification.enabled) {
        const notifChannel = await client.channels.fetch(config.startupNotification.channelId).catch(() => null);
        if (notifChannel) {
            const diskSpace = getDiskSpace();
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🟢 Bot Started Successfully')
                .setDescription(`**${client.user.tag}** is now online and ready!`)
                .addFields(
                    { name: '🕐 Started At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    { name: '📊 Servers', value: client.guilds.cache.size.toString(), inline: true },
                    { name: '👥 Total Users', value: totalUsers.toLocaleString(), inline: true }
                )
                .addFields(
                    { name: '⚙️ Node Version', value: process.version, inline: true },
                    { name: '📦 Discord.js', value: require('discord.js').version, inline: true },
                    { name: '💾 Memory', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`, inline: true }
                )
                .addFields({
                    name: '💾 Attachment Storage',
                    value: `Enabled - Saving to: \`${ATTACHMENTS_DIR}\``,
                    inline: false
                })
                .addFields({
                    name: '💾 Disk Space',
                    value: `Used: ${diskSpace.used} / ${diskSpace.total}\nFree: ${diskSpace.available} (${diskSpace.percentage} used)`,
                    inline: false
                })
                .setThumbnail(client.user.displayAvatarURL())
                .setTimestamp()
                .setFooter({ text: 'System Status' });
            
            await notifChannel.send({ embeds: [embed] });
            console.log(`✓ Startup notification sent to #${notifChannel.name}\n`);
        }
    }
    
    // Status Rotation - Drug Dealer Simulator Theme (MOVED INSIDE ready event)
    const statuses = [
        { name: '👀 Watching the streets', type: ActivityType.Watching },
        { name: '🎮 Competing in the game', type: ActivityType.Competing },
        { name: '💰 Waiting on cash delivery', type: ActivityType.Playing },
        { name: '🚗 Making deliveries', type: ActivityType.Playing },
        { name: '📦 Counting the product', type: ActivityType.Playing },
        { name: `💵 Managing ${totalUsers.toLocaleString()} clients`, type: ActivityType.Watching },
        { name: '🏠 Expanding territory', type: ActivityType.Playing },
        { name: '📊 Tracking profits', type: ActivityType.Watching }
    ];
    
    let currentStatus = 0;
    
    const updateStatus = () => {
        client.user.setPresence({
            activities: [statuses[currentStatus]],
            status: 'online'
        });
        currentStatus = (currentStatus + 1) % statuses.length;
    };
    
    updateStatus(); // Set initial status
    setInterval(updateStatus, 15000); // Rotate every 15 seconds
    console.log('🔄 Status rotation started');
}); // ← This closes the ready event

// Message Create Event (continues below)
client.on('messageCreate', async message => {
    // Ignore bot messages - FIRST
    if (message.author.bot) return;
    if (!message.guild) return;

    // Command handler - handle custom commands
    await commandHandler.handleCommand(message);

    // Save attachments when posted
    if (message.attachments.size > 0) {
        console.log(`📎 Message has ${message.attachments.size} attachment(s) - saving...`);
        for (const attachment of message.attachments.values()) {
            await saveAttachment(attachment, message.author.id, message.id);
        }
    }

    // Log to MongoDB
    if (mongoLogger && mongoLogger.connected) {
        await mongoLogger.logMessageCreate(message);
    }

    // Log attachments to dedicated channel (batched)
    if (message.attachments.size > 0 && logChannels.attachments) {
        const userId = message.author.id;
        
        if (!pendingAttachments.has(userId)) {
            pendingAttachments.set(userId, {
                messages: [],
                timeout: null
            });
        }
        
        const userAttachments = pendingAttachments.get(userId);
        
        userAttachments.messages.push({
            message: message,
            timestamp: Date.now()
        });
        
        if (userAttachments.timeout) {
            clearTimeout(userAttachments.timeout);
        }
        
        userAttachments.timeout = setTimeout(async () => {
            try {
                const attachmentData = pendingAttachments.get(userId);
                if (!attachmentData || attachmentData.messages.length === 0) {
                    pendingAttachments.delete(userId);
                    return;
                }
                
                const allAttachments = [];
                const channels = new Set();
                let totalSize = 0;
                
                for (const msgData of attachmentData.messages) {
                    const msg = msgData.message;
                    channels.add(msg.channel);
                    
                    msg.attachments.forEach(attachment => {
                        allAttachments.push({
                            attachment: attachment,
                            channel: msg.channel,
                            messageUrl: msg.url,
                            timestamp: msgData.timestamp
                        });
                        totalSize += attachment.size;
                    });
                }
                
                const diskSpace = getDiskSpace();
                const firstMsg = attachmentData.messages[0].message;
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setAuthor({
                        name: `${firstMsg.author.tag} uploaded ${allAttachments.length} file(s)`,
                        iconURL: firstMsg.author.displayAvatarURL()
                    })
                    .setDescription(
                        `**User:** <@${firstMsg.author.id}> (${firstMsg.author.id})\n` +
                        `**Channel${channels.size > 1 ? 's' : ''}:** ${Array.from(channels).map(c => `<#${c.id}>`).join(', ')}\n` +
                        `**Total Files:** ${allAttachments.length}\n` +
                        `**Total Size:** ${(totalSize / 1024 / 1024).toFixed(2)} MB\n` +
                        `**💾 Saved to disk:** ${allAttachments.length} file(s)\n` +
                        `**📊 Storage:** ${diskSpace.used} / ${diskSpace.total} (${diskSpace.available} free)`
                    )
                    .setTimestamp(attachmentData.messages[0].timestamp);
                
                const fileList = allAttachments.slice(0, 10).map((attData, index) => {
                    const att = attData.attachment;
                    const size = (att.size / 1024).toFixed(2);
                    const type = att.contentType || 'unknown';
                    return `${index + 1}. **[${att.name}](${attData.messageUrl})** (${size} KB)\n   └ Type: \`${type}\` | Channel: <#${attData.channel.id}>`;
                }).join('\n');

                if (allAttachments.length > 10) {
                    embed.addFields({
                        name: `📎 Files (showing 10 of ${allAttachments.length})`,
                        value: fileList,
                        inline: false
                    });
                    embed.addFields({
                        name: 'Additional Files',
                        value: `...and ${allAttachments.length - 10} more files`,
                        inline: false
                    });
                } else {
                    embed.addFields({
                        name: `📎 Files (${allAttachments.length})`,
                        value: fileList || 'None',
                        inline: false
                    });
                }
                
                const firstImage = allAttachments.find(attData => 
                    attData.attachment.contentType?.startsWith('image/')
                );
                if (firstImage) {
                    embed.setThumbnail(firstImage.attachment.url);
                }
                
                const accountAge = Date.now() - firstMsg.author.createdTimestamp;
                if (accountAge < 604800000) {
                    const ageText = accountAge < 86400000 
                        ? `${Math.floor(accountAge / 3600000)} hours old`
                        : `${Math.floor(accountAge / 86400000)} days old`;
                    
                    embed.addFields({
                        name: '⚠️ New Account',
                        value: `Account created: <t:${Math.floor(firstMsg.author.createdTimestamp / 1000)}:R> (${ageText})`,
                        inline: false
                    });
                    embed.setColor('#ff9900');
                }
                
                await logChannels.attachments.send({ embeds: [embed] });
                
                const images = allAttachments
                    .filter(attData => attData.attachment.contentType?.startsWith('image/'))
                    .slice(0, 10);
                
                if (images.length > 0) {
                    const imageFiles = images.map(attData => attData.attachment.url);
                    
                    try {
                        await logChannels.attachments.send({
                            content: `**Images from ${firstMsg.author.tag}:**`,
                            files: imageFiles
                        });
                    } catch (error) {
                        console.error('Error sending image files:', error);
                        const urlList = images.map((attData, i) => 
                            `${i + 1}. [${attData.attachment.name}](${attData.attachment.url})`
                        ).join('\n');
                        await logChannels.attachments.send({
                            content: `**Images from ${firstMsg.author.tag}** (URLs):\n${urlList}`
                        });
                    }
                }
                
                pendingAttachments.delete(userId);
                
            } catch (error) {
                console.error('Error logging batched attachments:', error);
                pendingAttachments.delete(userId);
            }
        }, 3000);
    }

    // Check for spam if anti-spam is enabled
    if (config.antiSpam && config.antiSpam.enabled) {
        if (message.member && config.antiSpam.exemptRoles) {
            const hasExemptRole = message.member.roles.cache.some(role => 
                config.antiSpam.exemptRoles.includes(role.id)
            );
            if (hasExemptRole) {
                return;
            }
        }
        
        const spamData = trackSpamBehavior(message);
        
        if (spamData.isSpam) {
            const userId = message.author.id;
            const lastReport = spamReportCooldown.get(userId);
            const now = Date.now();
            
            if (!lastReport || (now - lastReport) > 30000) {
                console.log(`🚨 Spam detected from ${message.author.tag}: ${spamData.reason}`);
                spamReportCooldown.set(userId, now);
                
                setTimeout(async () => {
                    await handleSpammer(message, spamData);
                    spamReportCooldown.delete(userId);
                }, 2000);
            } else {
                console.log(`⏳ Spam cooldown active for ${message.author.tag}, skipping duplicate report`);
            }
        }
    }
});

// Message Delete Event
client.on('messageDelete', async message => {
    if (!logChannels.message) return;
    if (message.author?.bot) return;
    
    try {
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logMessageDelete(message);
        }
        
        const embed = new EmbedBuilder()
            .setColor('#ff6b6b')
            .setTitle('🗑️ Message Deleted')
            .addFields(
                { name: 'Author', value: message.author ? `${message.author.tag}\n<@${message.author.id}>` : 'Unknown', inline: true },
                { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                { name: 'Message ID', value: message.id, inline: true }
            );
        
        if (message.content) {
            embed.addFields({
                name: 'Content',
                value: message.content.slice(0, 1024) || 'No content',
                inline: false
            });
        }
        
        if (message.attachments.size > 0) {
            const attachmentList = message.attachments.map(a => `${a.name} (💾 saved locally)`).join(', ');
            embed.addFields({
                name: '📎 Attachments',
                value: attachmentList,
                inline: false
            });
        }
        
        embed.setTimestamp();
        
        await logChannels.message.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging message delete:', error);
    }
});

// Message Bulk Delete Event
client.on('messageDeleteBulk', async messages => {
    if (!logChannels.message) return;
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('🗑️ Bulk Message Delete')
            .setDescription(`${messages.size} messages were deleted`)
            .addFields(
                { name: 'Channel', value: `<#${messages.first()?.channel.id}>`, inline: true },
                { name: 'Count', value: messages.size.toString(), inline: true }
            )
            .setTimestamp();
        
        await logChannels.message.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging bulk delete:', error);
    }
});

// Message Edit Event
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!logChannels.message) return;
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    
    try {
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logMessageUpdate(oldMessage, newMessage);
        }
        
        const embed = new EmbedBuilder()
            .setColor('#ffd93d')
            .setTitle('✏️ Message Edited')
            .addFields(
                { name: 'Author', value: `${newMessage.author.tag}\n<@${newMessage.author.id}>`, inline: true },
                { name: 'Channel', value: `<#${newMessage.channel.id}>`, inline: true },
                { name: 'Message', value: `[Jump to Message](${newMessage.url})`, inline: true }
            );
        
        if (oldMessage.content) {
            embed.addFields({
                name: 'Before',
                value: oldMessage.content.slice(0, 1024) || 'No content',
                inline: false
            });
        }
        
        if (newMessage.content) {
            embed.addFields({
                name: 'After',
                value: newMessage.content.slice(0, 1024) || 'No content',
                inline: false
            });
        }
        
        embed.setTimestamp();
        
        await logChannels.message.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging message edit:', error);
    }
});

// Voice State Update Event
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (!logChannels.voice) return;
    
    try {
        let action = null;
        let embed = null;
        
        if (!oldState.channel && newState.channel) {
            action = 'join';
            embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🔊 Joined Voice Channel')
                .addFields(
                    { name: 'User', value: `${newState.member.user.tag}\n<@${newState.member.id}>`, inline: true },
                    { name: 'Channel', value: newState.channel.name, inline: true }
                )
                .setTimestamp();
        }
        else if (oldState.channel && !newState.channel) {
            action = 'leave';
            embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🔇 Left Voice Channel')
                .addFields(
                    { name: 'User', value: `${oldState.member.user.tag}\n<@${oldState.member.id}>`, inline: true },
                    { name: 'Channel', value: oldState.channel.name, inline: true }
                )
                .setTimestamp();
        }
        else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
            action = 'switch';
            embed = new EmbedBuilder()
                .setColor('#ffd93d')
                .setTitle('↔️ Switched Voice Channel')
                .addFields(
                    { name: 'User', value: `${newState.member.user.tag}\n<@${newState.member.id}>`, inline: true },
                    { name: 'From', value: oldState.channel.name, inline: true },
                    { name: 'To', value: newState.channel.name, inline: true }
                )
                .setTimestamp();
        }
        
        if (embed) {
            // Log to MongoDB
            if (mongoLogger && mongoLogger.connected && action) {
                await mongoLogger.logVoiceStateUpdate(oldState, newState, action);
            }
            
            await logChannels.voice.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Error logging voice state:', error);
    }
});

// Role Update Events
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!logChannels.role) return;
    
    try {
        const oldRoles = oldMember.roles.cache;
        const newRoles = newMember.roles.cache;
        
        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
        if (addedRoles.size > 0) {
            // Log to MongoDB
            if (mongoLogger && mongoLogger.connected) {
                await mongoLogger.logRoleUpdate(oldMember, newMember, 'add', addedRoles);
            }
            
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('➕ Role Added')
                .addFields(
                    { name: 'User', value: `${newMember.user.tag}\n<@${newMember.id}>`, inline: true },
                    { name: 'Roles Added', value: addedRoles.map(r => r.name).join(', '), inline: true }
                )
                .setTimestamp();
            
            await logChannels.role.send({ embeds: [embed] });
        }
        
        const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
        if (removedRoles.size > 0) {
            // Log to MongoDB
            if (mongoLogger && mongoLogger.connected) {
                await mongoLogger.logRoleUpdate(oldMember, newMember, 'remove', removedRoles);
            }
            
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('➖ Role Removed')
                .addFields(
                    { name: 'User', value: `${newMember.user.tag}\n<@${newMember.id}>`, inline: true },
                    { name: 'Roles Removed', value: removedRoles.map(r => r.name).join(', '), inline: true }
                )
                .setTimestamp();
            
            await logChannels.role.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Error logging role update:', error);
    }
});

// Channel Create Event
client.on('channelCreate', async channel => {
    if (!logChannels.channel) return;
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('➕ Channel Created')
            .addFields(
                { name: 'Channel', value: `${channel.name}\n<#${channel.id}>`, inline: true },
                { name: 'Type', value: ChannelType[channel.type], inline: true }
            )
            .setTimestamp();
        
        await logChannels.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging channel create:', error);
    }
});

// Channel Delete Event
client.on('channelDelete', async channel => {
    if (!logChannels.channel) return;
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('🗑️ Channel Deleted')
            .addFields(
                { name: 'Channel', value: channel.name, inline: true },
                { name: 'Type', value: ChannelType[channel.type], inline: true }
            )
            .setTimestamp();
        
        await logChannels.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging channel delete:', error);
    }
});

// Ban Event
client.on('guildBanAdd', async ban => {
    if (!logChannels.moderation) return;
    
    try {
        const memberInviteData = memberInvites.get(ban.user.id);
        
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logBan(ban);
        }
        
        const embed = new EmbedBuilder()
            .setColor('#8b0000')
            .setTitle('🔨 Member Banned')
            .setThumbnail(ban.user.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${ban.user.tag}\n<@${ban.user.id}>`, inline: true },
                { name: 'Reason', value: ban.reason || 'No reason provided', inline: true }
            );
        
        if (memberInviteData) {
            embed.addFields({
                name: 'Invite Info',
                value: `Invited by: ${memberInviteData.inviter}\nCode: \`${memberInviteData.code}\``,
                inline: false
            });
        }
        
        embed.setTimestamp();
        embed.setFooter({ text: `ID: ${ban.user.id}` });
        
        await logChannels.moderation.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging ban:', error);
    }
});

// Unban Event
client.on('guildBanRemove', async ban => {
    if (!logChannels.moderation) return;
    
    try {
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logUnban(ban);
        }
        
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ Member Unbanned')
            .setThumbnail(ban.user.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${ban.user.tag}\n<@${ban.user.id}>`, inline: true }
            )
            .setTimestamp();
        
        await logChannels.moderation.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging unban:', error);
    }
});

// Invite Create Event
client.on('inviteCreate', async invite => {
    if (!logChannels.invite) return;
    
    try {
        const guildInvites = serverInvites.get(invite.guild.id) || new Map();
        guildInvites.set(invite.code, invite.uses || 0);
        serverInvites.set(invite.guild.id, guildInvites);
        
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('📨 Invite Created')
            .addFields(
                { name: 'Code', value: `\`${invite.code}\`\nhttps://discord.gg/${invite.code}`, inline: true },
                { name: 'Created By', value: `${invite.inviter?.tag || 'Unknown'}`, inline: true },
                { name: 'Channel', value: `<#${invite.channel.id}>`, inline: true }
            );
        
        if (invite.maxUses) {
            embed.addFields({ name: 'Max Uses', value: invite.maxUses.toString(), inline: true });
        }
        
        if (invite.maxAge) {
            embed.addFields({ name: 'Expires', value: `<t:${Math.floor((Date.now() + invite.maxAge * 1000) / 1000)}:R>`, inline: true });
        }
        
        embed.setTimestamp();
        
        await logChannels.invite.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging invite create:', error);
    }
});

// Invite Delete Event
client.on('inviteDelete', async invite => {
    if (!logChannels.invite) return;
    
    try {
        const guildInvites = serverInvites.get(invite.guild.id);
        if (guildInvites) {
            guildInvites.delete(invite.code);
        }
        
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('🗑️ Invite Deleted')
            .addFields(
                { name: 'Code', value: `\`${invite.code}\``, inline: true },
                { name: 'Uses', value: invite.uses?.toString() || '0', inline: true }
            )
            .setTimestamp();
        
        await logChannels.invite.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging invite delete:', error);
    }
});

// Member Join Event
client.on('guildMemberAdd', async member => {
    if (!logChannels.member) return;
    
    try {
        console.log(`👤 New member joined: ${member.user.tag} (${member.id})`);
        
        // Fetch current invites
        const newInvites = await member.guild.invites.fetch();
        const oldInvites = serverInvites.get(member.guild.id) || new Map();
        
        console.log(`📊 Comparing invites - Old: ${oldInvites.size}, New: ${newInvites.size}`);
        
        let usedInvite = null;
        
        // Compare invite usage
        for (const [code, invite] of newInvites) {
            const oldUses = oldInvites.get(code) || 0;
            const newUses = invite.uses || 0;
            
            console.log(`🔍 Invite ${code}: Old uses: ${oldUses}, New uses: ${newUses}`);
            
            if (newUses > oldUses) {
                usedInvite = invite;
                console.log(`✅ Found used invite: ${code} by ${invite.inviter?.tag}`);
                break;
            }
        }
        
        // Update stored invites
        serverInvites.set(member.guild.id, new Map(newInvites.map(invite => [invite.code, invite.uses])));
        
        // Create invite data object
        const inviteData = usedInvite ? {
            code: usedInvite.code,
            inviter: usedInvite.inviter?.username || 'Unknown',
            inviterId: usedInvite.inviter?.id || 'Unknown',
            uses: usedInvite.uses,
            maxUses: usedInvite.maxUses,
            timestamp: Date.now(),
            guildId: member.guild.id
        } : {
            code: 'unknown',
            inviter: 'Unknown',
            inviterId: 'Unknown',
            uses: 0,
            maxUses: 0,
            timestamp: Date.now(),
            guildId: member.guild.id
        };
        
        // Save to file
        memberInvites.set(member.id, inviteData);
        saveMemberInvites();
        console.log(`💾 Saved invite data for ${member.user.tag}`);
        
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logMemberJoin(member, inviteData);
        }
        
        // Calculate account age
        const accountAge = Date.now() - member.user.createdTimestamp;
        const accountAgeDays = Math.floor(accountAge / 86400000);
        
        // Create embed
        const embed = new EmbedBuilder()
            .setColor(accountAgeDays < 7 ? '#ff9900' : '#00ff00')
            .setTitle('👋 Member Joined')
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${member.user.tag}\n<@${member.id}>`, inline: true },
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Member Count', value: member.guild.memberCount.toString(), inline: true }
            );
        
        // Add account age warning
        if (accountAgeDays < 7) {
            embed.addFields({
                name: '⚠️ New Account',
                value: `Account is only ${accountAgeDays} day${accountAgeDays === 1 ? '' : 's'} old`,
                inline: false
            });
        }
        
        // Add invite info
        if (usedInvite) {
            embed.addFields({
                name: '📨 Invited By',
                value: `${usedInvite.inviter?.tag || 'Unknown'}\nCode: \`${usedInvite.code}\`\nUses: ${usedInvite.uses}${usedInvite.maxUses ? `/${usedInvite.maxUses}` : ''}`,
                inline: false
            });
        } else {
            embed.addFields({
                name: '📨 Invite Info',
                value: 'Could not determine invite used (may be vanity URL or widget)',
                inline: false
            });
        }
        
        embed.setTimestamp();
        embed.setFooter({ text: `ID: ${member.id}` });
        
        await logChannels.member.send({ embeds: [embed] });
        console.log(`✅ Logged member join to channel`);
    } catch (error) {
        console.error('❌ Error logging member join:', error);
    }
});

// Member Leave Event
client.on('guildMemberRemove', async member => {
    if (!logChannels.member) return;
    
    try {
        const memberInviteData = memberInvites.get(member.id);
        
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logMemberLeave(member);
        }
        
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('👋 Member Left')
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${member.user.tag}\n<@${member.id}>`, inline: true },
                { name: 'Joined Server', value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : 'Unknown', inline: true },
                { name: 'Member Count', value: member.guild.memberCount.toString(), inline: true }
            );
        
        if (memberInviteData) {
            embed.addFields({
                name: 'Originally Invited By',
                value: `${memberInviteData.inviter}\nCode: \`${memberInviteData.code}\``,
                inline: false
            });
        }
        
        embed.setTimestamp();
        embed.setFooter({ text: `ID: ${member.id}` });
        
        await logChannels.member.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging member leave:', error);
    }
});

// Button interaction handler for spam review
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    const [action, userId] = interaction.customId.split('_');
    
    if (action === 'ban' || action === 'unmute') {
        try {
            await interaction.deferReply({ ephemeral: true });
            
            const targetUser = await client.users.fetch(userId).catch(() => null);
            const guild = interaction.guild;
            const member = await guild.members.fetch(userId).catch(() => null);
            
            const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
            
            if (action === 'ban') {
                if (!member) {
                    await interaction.editReply({
                        content: '❌ User is no longer in the server. Cannot ban.',
                    });
                    return;
                }
                
                try {
                    if (targetUser) {
                        try {
                            await targetUser.send({
                                embeds: [new EmbedBuilder()
                                    .setColor('#ff0000')
                                    .setTitle('🔨 You have been banned')
                                    .setDescription(`You have been banned from **${guild.name}** for spam.`)
                                    .addFields(
                                        { name: 'Reason', value: 'Cross-channel spam (Confirmed by moderator)', inline: false },
                                        { name: 'Reviewed By', value: interaction.user.tag, inline: false }
                                    )
                                    .addFields({
                                        name: 'Appeal',
                                        value: 'You can submit an appeal here:\n[Click to submit appeal form](https://docs.google.com/forms/d/e/1FAIpQLSe8xo6UfTjTGCuc-1VxWx1s-bnGIhUuRDLUNFxWmC7uzUZATw/viewform?usp=dialog)',
                                        inline: false
                                    })
                                    .setTimestamp()
                                ]
                            });
                        } catch (dmError) {
                            console.log(`Could not DM ${targetUser.tag} about ban`);
                        }
                    }
                    
                    await member.ban({
                        reason: `Confirmed spam by ${interaction.user.tag} - Cross-channel posting`,
                        deleteMessageSeconds: 60 * 60 * 24
                    });
                    
                    // Log to MongoDB
                    if (mongoLogger && mongoLogger.connected) {
                        await mongoLogger.logBan({ 
                            user: targetUser || { id: userId, tag: 'Unknown' },
                            guild: guild 
                        }, `Confirmed spam by ${interaction.user.tag}`);
                    }
                    
                    originalEmbed.setColor('#8b0000');
                    originalEmbed.setTitle('🔨 Spam Review - USER BANNED');
                    
                    const actionFieldIndex = originalEmbed.data.fields.findIndex(f => f.name === '⚠️ Action Required');
                    if (actionFieldIndex !== -1) {
                        originalEmbed.data.fields[actionFieldIndex] = {
                            name: '🔨 Resolution',
                            value: `Reviewed by ${interaction.user.tag}\n**Action: BANNED**\nReason: Confirmed spam`,
                            inline: false
                        };
                    }
                    
                    originalEmbed.setFooter({ 
                        text: `Banned by ${interaction.user.tag} (${interaction.user.id}) at ${new Date().toLocaleString()}` 
                    });
                    originalEmbed.setTimestamp();
                    
                    await interaction.editReply({
                        content: `🔨 **${targetUser?.tag || 'User'}** has been **BANNED** by ${interaction.user}.`,
                    });
                    
                } catch (banError) {
                    console.error('Error banning user:', banError);
                    await interaction.editReply({
                        content: `❌ Failed to ban user: ${banError.message}`,
                    });
                    return;
                }
                
            } else if (action === 'unmute') {
                if (!member) {
                    await interaction.editReply({
                        content: '❌ User is no longer in the server.',
                    });
                    return;
                }
                
                try {
                    const mutedRole = guild.roles.cache.find(r => r.name === 'Muted');
                    if (mutedRole && member.roles.cache.has(mutedRole.id)) {
                        await member.roles.remove(mutedRole);
                        console.log(`🔊 Unmuted ${member.user.tag}`);
                    }
                    
                    // Log to MongoDB
                    if (mongoLogger && mongoLogger.connected) {
                        await mongoLogger.logModerationAction({
                            type: 'unmute',
                            targetUserId: userId,
                            targetUserName: member.user.tag,
                            targetUserAvatar: member.user.displayAvatarURL(),
                            moderatorId: interaction.user.id,
                            moderatorName: interaction.user.tag,
                            reason: 'Not spam - False positive',
                            guildId: guild.id,
                            guildName: guild.name
                        });
                    }
                    
                    originalEmbed.setColor('#00ff00');
                    originalEmbed.setTitle('✅ Spam Review - Not Spam (Unmuted)');
                    
                    const actionFieldIndex = originalEmbed.data.fields.findIndex(f => f.name === '⚠️ Action Required');
                    if (actionFieldIndex !== -1) {
                        originalEmbed.data.fields[actionFieldIndex] = {
                            name: '✅ Resolution',
                            value: `Reviewed by ${interaction.user.tag}\n**Action: UNMUTED - Not spam**\nUser has been notified.`,
                            inline: false
                        };
                    }
                    
                    originalEmbed.setFooter({ 
                        text: `Unmuted by ${interaction.user.tag} (${interaction.user.id}) at ${new Date().toLocaleString()}` 
                    });
                    originalEmbed.setTimestamp();
                    
                    if (targetUser) {
                        try {
                            await targetUser.send({
                                embeds: [new EmbedBuilder()
                                    .setColor('#00ff00')
                                    .setTitle('✅ You have been unmuted')
                                    .setDescription(`Your mute in **${guild.name}** has been lifted.`)
                                    .addFields(
                                        { name: 'Result', value: 'Not spam - False positive', inline: false },
                                        { name: 'Reviewed By', value: interaction.user.tag, inline: false },
                                        { name: 'Status', value: '✅ You can now post again', inline: false }
                                    )
                                    .addFields({
                                        name: '💡 Note',
                                        value: 'Please avoid posting the same content in multiple channels to prevent future automatic actions.',
                                        inline: false
                                    })
                                    .setTimestamp()
                                ]
                            });
                        } catch (error) {
                            console.log(`Could not DM ${targetUser.tag} about unmute`);
                        }
                    }
                    
                    await interaction.editReply({
                        content: `✅ **${targetUser?.tag || 'User'}** has been **UNMUTED** by ${interaction.user}. Marked as not spam.`,
                    });
                    
                } catch (unmuteError) {
                    console.error('Error unmuting user:', unmuteError);
                    await interaction.editReply({
                        content: `❌ Failed to unmute user: ${unmuteError.message}`,
                    });
                    return;
                }
            }
            
            await interaction.message.edit({
                content: `~~<@&1425260355420160100> Cross-channel spam detected - User has been **muted**. Please review:~~ **RESOLVED**`,
                embeds: [originalEmbed],
                components: []
            });
            
        } catch (error) {
            console.error('Error handling spam review button:', error);
            await interaction.editReply({
                content: `❌ Error processing action: ${error.message}`,
            });
        }
    }
});

// ADVANCED CUSTOM COMMANDS HANDLER
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;
    
    if (!config.customCommands || !config.customCommands.enabled) return;
    
    try {
        const commands = await mongoLogger.db.collection('customCommands')
            .find({ enabled: true })
            .toArray();
        
        if (!commands || commands.length === 0) return;
        
        for (const command of commands) {
            const triggered = checkTrigger(message, command);
            if (!triggered) continue;
            
            if (!checkChannelRestrictions(message, command)) continue;
            if (!checkRoleRestrictions(message, command)) continue;
            
            const cooldownCheck = checkCooldowns(message, command);
            if (!cooldownCheck.allowed) {
                if (cooldownCheck.message) {
                    const reply = await message.reply(cooldownCheck.message);
                    setTimeout(() => reply.delete().catch(() => {}), 5000);
                }
                continue;
            }
            
            if (command.usageLimit > 0 && command.uses >= command.usageLimit) {
                await mongoLogger.db.collection('customCommands')
                    .updateOne(
                        { _id: command._id },
                        { $set: { enabled: false } }
                    );
                continue;
            }
            
            if (command.deleteTrigger) {
                try {
                    await message.delete();
                } catch (error) {
                    console.log('Could not delete trigger message');
                }
            }
            
            await executeCustomCommand(message, command);
            
            await mongoLogger.db.collection('customCommands').updateOne(
                { _id: command._id },
                { $inc: { uses: 1 } }
            );
            
            setCooldowns(message, command);
            break;
        }
        
    } catch (error) {
        console.error('Error executing custom command:', error);
    }
});

function checkTrigger(message, command) {
    const content = command.caseSensitive ? message.content : message.content.toLowerCase();
    const triggers = Array.isArray(command.trigger) ? command.trigger : [command.trigger];
    
    switch (command.triggerType) {
        case 'command':
            const prefix = config.customCommands.prefix || '!';
            if (!content.startsWith(prefix)) return false;
            const cmd = content.slice(prefix.length).split(/\s+/)[0];
            return triggers.includes(command.caseSensitive ? cmd : cmd.toLowerCase());
        
        case 'exact':
            return triggers.some(t => content === (command.caseSensitive ? t : t.toLowerCase()));
        
        case 'contains':
            return triggers.some(t => content.includes(command.caseSensitive ? t : t.toLowerCase()));
        
        case 'startswith':
            return triggers.some(t => content.startsWith(command.caseSensitive ? t : t.toLowerCase()));
        
        case 'regex':
            try {
                return triggers.some(t => new RegExp(t).test(content));
            } catch (error) {
                console.error('Invalid regex:', error);
                return false;
            }
        
        default:
            return false;
    }
}

function checkChannelRestrictions(message, command) {
    if (command.ignoredChannels && command.ignoredChannels.length > 0) {
        if (command.ignoredChannels.includes(message.channel.id)) {
            return false;
        }
    }
    
    if (command.allowedChannels && command.allowedChannels.length > 0) {
        if (!command.allowedChannels.includes('all')) {
            if (!command.allowedChannels.includes(message.channel.id)) {
                return false;
            }
        }
    }
    
    return true;
}

function checkRoleRestrictions(message, command) {
    const member = message.member;
    if (!member) return false;
    
    if (command.ignoredRoles && command.ignoredRoles.length > 0) {
        const hasIgnoredRole = member.roles.cache.some(role => 
            command.ignoredRoles.includes(role.id)
        );
        if (hasIgnoredRole) return false;
    }
    
    if (command.requiredRoles && command.requiredRoles.length > 0) {
        if (!command.requiredRoles.includes('everyone')) {
            const hasRequiredRole = member.roles.cache.some(role => 
                command.requiredRoles.includes(role.id)
            );
            if (!hasRequiredRole) return false;
        }
    }
    
    return true;
}

function checkCooldowns(message, command) {
    const now = Date.now();
    
    if (command.userCooldown > 0) {
        const key = `${command._id}_${message.author.id}`;
        const lastUsed = customCommandCooldowns.user.get(key);
        if (lastUsed) {
            const timeLeft = (command.userCooldown * 1000) - (now - lastUsed);
            if (timeLeft > 0) {
                return {
                    allowed: false,
                    message: `⏰ Please wait ${Math.ceil(timeLeft / 1000)} seconds before using this command again.`
                };
            }
        }
    }
    
    if (command.channelCooldown > 0) {
        const key = `${command._id}_${message.channel.id}`;
        const lastUsed = customCommandCooldowns.channel.get(key);
        if (lastUsed) {
            const timeLeft = (command.channelCooldown * 1000) - (now - lastUsed);
            if (timeLeft > 0) {
                return {
                    allowed: false,
                    message: `⏰ This command is on cooldown in this channel for ${Math.ceil(timeLeft / 1000)} seconds.`
                };
            }
        }
    }
    
    if (command.serverCooldown > 0) {
        const key = `${command._id}_${message.guild.id}`;
        const lastUsed = customCommandCooldowns.server.get(key);
        if (lastUsed) {
            const timeLeft = (command.serverCooldown * 1000) - (now - lastUsed);
            if (timeLeft > 0) {
                return {
                    allowed: false,
                    message: `⏰ This command is on server-wide cooldown for ${Math.ceil(timeLeft / 1000)} seconds.`
                };
            }
        }
    }
    
    return { allowed: true };
}

function setCooldowns(message, command) {
    const now = Date.now();
    
    if (command.userCooldown > 0) {
        const key = `${command._id}_${message.author.id}`;
        customCommandCooldowns.user.set(key, now);
    }
    
    if (command.channelCooldown > 0) {
        const key = `${command._id}_${message.channel.id}`;
        customCommandCooldowns.channel.set(key, now);
    }
    
    if (command.serverCooldown > 0) {
        const key = `${command._id}_${message.guild.id}`;
        customCommandCooldowns.server.set(key, now);
    }
}

async function executeCustomCommand(message, command) {
    try {
        const args = message.content.split(/\s+/).slice(1);
        const variables = {
            '{user}': message.author.username,
            '{user.mention}': `<@${message.author.id}>`,
            '{user.id}': message.author.id,
            '{user.tag}': message.author.tag,
            '{channel}': message.channel.name,
            '{channel.mention}': `<#${message.channel.id}>`,
            '{channel.id}': message.channel.id,
            '{server}': message.guild.name,
            '{membercount}': message.guild.memberCount.toString(),
            '{args}': args.join(' ')
        };
        
        args.forEach((arg, index) => {
            variables[`{args.${index}}`] = arg;
        });
        
        let response = command.response || '';
        
        for (const [key, value] of Object.entries(variables)) {
            response = response.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
        }
        
        switch (command.responseType) {
            case 'text':
            case 'dm':
                const targetChannel = command.responseType === 'dm' || command.dmResponse ? message.author : message.channel;
                const sentMessage = await targetChannel.send(response);
                
                if (command.deleteAfter && command.deleteAfterSeconds > 0) {
                    setTimeout(() => {
                        sentMessage.delete().catch(() => {});
                    }, command.deleteAfterSeconds * 1000);
                }
                break;
            
            case 'embed':
                let embedDesc = command.embedDescription || '';
                for (const [key, value] of Object.entries(variables)) {
                    embedDesc = embedDesc.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
                }
                
                let embedTitle = command.embedTitle || '';
                for (const [key, value] of Object.entries(variables)) {
                    embedTitle = embedTitle.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
                }
                
                const embed = new EmbedBuilder()
                    .setColor(command.embedColor || '#5865f2')
                    .setTitle(embedTitle || 'Custom Command')
                    .setDescription(embedDesc);
                
                if (command.embedFooter) embed.setFooter({ text: command.embedFooter });
                if (command.embedImage) embed.setImage(command.embedImage);
                if (command.embedThumbnail) embed.setThumbnail(command.embedThumbnail);
                
                const embedTarget = command.dmResponse ? message.author : message.channel;
                const embedMessage = await embedTarget.send({ embeds: [embed] });
                
                if (command.deleteAfter && command.deleteAfterSeconds > 0) {
                    setTimeout(() => {
                        embedMessage.delete().catch(() => {});
                    }, command.deleteAfterSeconds * 1000);
                }
                break;
            
            case 'react':
                if (command.reactionEmoji) {
                    await message.react(command.reactionEmoji).catch(() => {
                        console.log('Could not add reaction');
                    });
                }
                break;
            
            case 'multiple':
                if (response) {
                    const multiTarget = command.dmResponse ? message.author : message.channel;
                    await multiTarget.send(response);
                }
                
                if (command.reactionEmoji) {
                    await message.react(command.reactionEmoji).catch(() => {});
                }
                break;
        }
        
    } catch (error) {
        console.error('Error executing custom command:', error);
    }
}

client.login(config.token).then(async () => {
    // Register slash commands
    const { REST, Routes } = require('discord.js');
    
    const commands = [
        {
            name: 'appeal',
            description: 'Submit an appeal for a ban, mute, or warning',
            options: [
                {
                    name: 'type',
                    description: 'Type of punishment to appeal',
                    type: 3, // STRING
                    required: true,
                    choices: [
                        { name: 'Ban', value: 'ban' },
                        { name: 'Mute/Timeout', value: 'mute' },
                        { name: 'Warning', value: 'warn' },
                        { name: 'Other', value: 'other' }
                    ]
                },
                {
                    name: 'reason',
                    description: 'Why should we accept your appeal?',
                    type: 3, // STRING
                    required: true,
                    max_length: 2000
                },
                {
                    name: 'evidence',
                    description: 'Any evidence to support your appeal (links, etc.)',
                    type: 3, // STRING
                    required: false,
                    max_length: 1000
                }
            ]
        }
    ];

    const rest = new REST({ version: '10' }).setToken(config.token);

    try {
        console.log('🔄 Registering /appeal slash command...');
        
        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );
        
        console.log('✅ /appeal command registered successfully!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
});