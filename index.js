const { Client, GatewayIntentBits, EmbedBuilder, AuditLogEvent, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const config = require('./config.json');

// Safety check - prevent using example config
if (config.token === 'YOUR_BOT_TOKEN_HERE') {
    console.error('❌ ERROR: Please copy config.example.json to config.json and add your bot token!');
    console.error('Run: cp config.example.json config.json');
    console.error('Then edit config.json with your Discord bot token and channel IDs.');
    process.exit(1);
}

// Check for placeholder channel IDs
const hasPlaceholders = Object.values(config.logChannels).some(id => 
    id.includes('CHANNEL_ID') || id === ''
);

if (hasPlaceholders) {
    console.error('❌ ERROR: Please replace all placeholder channel IDs in config.json');
    console.error('Enable Developer Mode in Discord, then right-click channels to copy their IDs.');
    process.exit(1);
}

const SteamSaleMonitor = require('./steamSaleMonitor');
const ClaudeTokenTracker = require('./claudeTokenTracker');
const fs = require('fs');

// Global variables--
const roleUpdateQueue = new Map();

// Anti-spam configuration with fallback to defaults
const SPAM_CONFIG = config.antiSpam || {};
const SPAM_THRESHOLDS = {
    ENABLED: SPAM_CONFIG.enabled !== false,
    MESSAGE_COUNT: SPAM_CONFIG.messageThreshold || 5,
    TIME_WINDOW: SPAM_CONFIG.timeWindow || 10000,
    CROSS_CHANNEL_COUNT: SPAM_CONFIG.crossChannelThreshold || 3,
    CROSS_CHANNEL_TIME: SPAM_CONFIG.crossChannelTime || 15000,
    MUTE_DURATION: SPAM_CONFIG.muteDuration || 3600000,
    DELETE_THRESHOLD: SPAM_CONFIG.deleteThreshold || 10,
    AUTO_UNMUTE: SPAM_CONFIG.autoUnmute !== false,
    EXEMPT_ROLES: SPAM_CONFIG.exemptRoles || []
};

const userSpamTracking = new Map();
const MESSAGE_RATE_LIMIT = 5;
const RATE_LIMIT_INTERVAL = 10000;
const userMessageTimestamps = new Map();

function checkRateLimit(userId) {
    const now = Date.now();
    const timestamps = userMessageTimestamps.get(userId) || [];
    
    const recentTimestamps = timestamps.filter(time => now - time < RATE_LIMIT_INTERVAL);
    
    if (recentTimestamps.length >= MESSAGE_RATE_LIMIT) {
        return false;
    }
    
    recentTimestamps.push(now);
    userMessageTimestamps.set(userId, recentTimestamps);
    return true;
}

function trackSpamBehavior(message) {
    const userId = message.author.id;
    const now = Date.now();
    
    if (!userSpamTracking.has(userId)) {
        userSpamTracking.set(userId, {
            messages: [],
            channels: new Set(),
            muted: false,
            warnings: 0,
            contentHashes: new Map() // Track content across channels
        });
    }
    
    const userData = userSpamTracking.get(userId);
    
    // Create a simple hash of the message content
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
    
    // Clean old messages (keep last 15 seconds for cross-channel detection)
    userData.messages = userData.messages.filter(msg => 
        now - msg.timestamp < SPAM_THRESHOLDS.CROSS_CHANNEL_TIME
    );
    
    const recentChannels = new Set(
        userData.messages.map(msg => msg.channelId)
    );
    userData.channels = recentChannels;
    
    // NEW: Check for cross-channel posting (same content in 2+ channels)
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
    
    // Check if any content appears in 2+ channels
    for (const [hash, data] of contentChannelMap.entries()) {
        if (data.channels.size >= 2) { // Changed from 3 to 2
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
    
    // Keep existing rapid message detection
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
    
    // Keep existing identical spam detection
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

// Add this new helper function after trackSpamBehavior
function createContentHash(message) {
    // Create a simple hash based on:
    // 1. Message content (trimmed and lowercased)
    // 2. Attachment names and sizes
    // 3. Embed URLs
    
    let hashString = message.content.toLowerCase().trim();
    
    // Add attachment info to hash
    if (message.attachments.size > 0) {
        const attachmentInfo = message.attachments.map(a => 
            `${a.name}:${a.size}:${a.contentType}`
        ).join('|');
        hashString += `|ATT:${attachmentInfo}`;
    }
    
    // Add embed info to hash
    if (message.embeds.length > 0) {
        const embedInfo = message.embeds.map(e => 
            `${e.url}:${e.title}:${e.description?.slice(0, 50)}`
        ).join('|');
        hashString += `|EMB:${embedInfo}`;
    }
    
    // Add sticker info to hash
    if (message.stickers.size > 0) {
        const stickerInfo = message.stickers.map(s => s.id).join('|');
        hashString += `|STK:${stickerInfo}`;
    }
    
    // Simple hash function (for matching, not cryptographic security)
    let hash = 0;
    for (let i = 0; i < hashString.length; i++) {
        const char = hashString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    
    return hash.toString();
}

async function handleSpammer(message, spamData) {
    const member = message.member;
    if (!member) return;
    
    // Skip admins/mods
    if (member.permissions.has('Administrator') || member.permissions.has('ModerateMembers')) {
        return;
    }
    
    const userData = userSpamTracking.get(message.author.id);
    
    try {
        // Collect attachment URLs AND download them BEFORE deleting messages
        const attachmentUrls = [];
        const attachmentFiles = [];
        
        console.log('📎 Collecting attachments before deletion...');
        
        for (const msg of spamData.messages) {
            try {
                const channel = message.guild.channels.cache.get(msg.channelId);
                if (channel) {
                    const targetMessage = await channel.messages.fetch(msg.messageId).catch(() => null);
                    if (targetMessage && targetMessage.attachments.size > 0) {
                        for (const att of targetMessage.attachments.values()) {
                            attachmentUrls.push({
                                url: att.url,
                                name: att.name,
                                size: att.size,
                                contentType: att.contentType,
                                channelId: msg.channelId
                            });
                            
                            // If small enough, download it NOW (before deletion)
                            if (att.size < 8388608) { // 8MB limit
                                try {
                                    console.log(`⬇️ Downloading ${att.name} (${(att.size / 1024).toFixed(2)} KB)...`);
                                    const response = await fetch(att.url);
                                    const buffer = await response.arrayBuffer();
                                    
                                    attachmentFiles.push({
                                        attachment: Buffer.from(buffer),
                                        name: att.name
                                    });
                                    console.log(`✅ Downloaded ${att.name}`);
                                } catch (downloadError) {
                                    console.error(`❌ Failed to download ${att.name}:`, downloadError);
                                    // Fall back to URL if download fails
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching message for attachments:', error);
            }
        }
        
        console.log(`📦 Collected ${attachmentFiles.length} files to re-upload`);
        
        // NOW delete the messages (after we've downloaded attachments)
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
        
        // Log to moderation channel WITH attachments and buttons
        if (logChannels.moderation) {
            const embed = new EmbedBuilder()
                .setColor('#ff9900')
                .setTitle('🗑️ Cross-Channel Spam Deleted')
                .setThumbnail(message.author.displayAvatarURL())
                .addFields(
                    { name: 'User', value: `<@${message.author.id}>\n${message.author.tag} (${message.author.id})`, inline: true },
                    { name: 'Spam Type', value: getSpamReasonText(spamData.reason), inline: true },
                    { name: 'Messages Deleted', value: deletedCount.toString(), inline: true }
                );
            
            if (spamData.channels) {
                embed.addFields({
                    name: 'Channels Affected',
                    value: Array.from(deletedChannels).map(c => `#${c}`).join(', ') || 'Unknown',
                    inline: false
                });
            }
            
            // Account info
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
            
            // Sample of deleted content
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
            
            // Add attachment info if any
            if (attachmentUrls.length > 0) {
                const attachmentInfo = attachmentUrls.slice(0, 5).map(att => {
                    const size = (att.size / 1024).toFixed(2);
                    return `📎 **${att.name}** (${size} KB) - <#${att.channelId}>`;
                }).join('\n');
                
                embed.addFields({
                    name: `📎 Attachments (${attachmentUrls.length} total)`,
                    value: attachmentInfo.slice(0, 1024),
                    inline: false
                });
                
                // Set first image as embed thumbnail if available
                const firstImage = attachmentUrls.find(att => 
                    att.contentType?.startsWith('image/')
                );
                if (firstImage) {
                    embed.setImage(firstImage.url);
                }
            }
            
            embed.addFields({
                name: '⚠️ Action Required',
                value: '<@&645744514576809984> Please review and take action',
                inline: false
            });
            
            embed.setTimestamp();
            embed.setFooter({ text: 'Auto-moderation: Awaiting review' });
            
            // Create action buttons
            const banButton = new ButtonBuilder()
                .setCustomId(`ban_${message.author.id}`)
                .setLabel('Confirmed Spam - BAN User')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔨');
            
            const ignoreButton = new ButtonBuilder()
                .setCustomId(`ignore_${message.author.id}`)
                .setLabel('Not Spam - Restore Access')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅');
            
            const row = new ActionRowBuilder()
                .addComponents(banButton, ignoreButton);
            
            // Send with ping
            const alertMessage = await logChannels.moderation.send({
                content: `<@&645744514576809984> Cross-channel spam detected - requires review`,
                embeds: [embed],
                components: [row]
            });
            
            // Re-upload the actual attachment files
            if (attachmentFiles.length > 0) {
                try {
                    const attachmentChannelMap = new Map();
                    attachmentUrls.forEach(att => {
                        if (!attachmentChannelMap.has(att.name)) {
                            attachmentChannelMap.set(att.name, []);
                        }
                        const channel = message.guild.channels.cache.get(att.channelId);
                        if (channel) {
                            attachmentChannelMap.get(att.name).push(channel.name);
                        }
                    });
                    
                    const fileDetails = Array.from(attachmentChannelMap.entries()).map(([name, channels]) => {
                        return `**${name}**\nPosted in: ${channels.join(', ')}`;
                    }).join('\n\n');
                    
                    console.log(`📤 Uploading ${attachmentFiles.length} files...`);
                    await logChannels.moderation.send({
                        content: `**📦 Deleted Files from ${message.author.tag}:**\n\n${fileDetails.slice(0, 1900)}`,
                        files: attachmentFiles
                    });
                    console.log(`✅ Successfully uploaded ${attachmentFiles.length} files`);
                } catch (error) {
                    console.error('❌ Error re-uploading attachments:', error);
                    // If re-upload fails, at least send the URLs
                    const urlList = attachmentUrls.map(att => 
                        `${att.name}: ${att.url}`
                    ).join('\n');
                    
                    await logChannels.moderation.send({
                        content: `⚠️ Could not re-upload files, here are the original URLs:\n\`\`\`${urlList.slice(0, 1900)}\`\`\``
                    });
                }
            } else if (attachmentUrls.length > 0) {
                // Had attachments but couldn't download them
                const urlList = attachmentUrls.map(att => 
                    `${att.name} (${(att.size / 1024).toFixed(2)} KB): ${att.url}`
                ).join('\n');
                
                await logChannels.moderation.send({
                    content: `⚠️ Attachments were too large or couldn't be downloaded. Original URLs:\n\`\`\`${urlList.slice(0, 1900)}\`\`\``
                });
            }
        }
        
        // Warn the user via DM
        try {
            await message.author.send({
                embeds: [new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('⚠️ Cross-Channel Posting Detected')
                    .setDescription(`Your messages were automatically deleted in **${message.guild.name}**`)
                    .addFields(
                        { name: 'Reason', value: 'Posting the same content in multiple channels', inline: false },
                        { name: 'Messages Deleted', value: deletedCount.toString(), inline: true },
                        { name: 'Channels', value: Array.from(deletedChannels).join(', '), inline: true }
                    )
                    .addFields({
                        name: '💡 Tip',
                        value: 'Please post your content in only one appropriate channel. Cross-posting is considered spam.\n\n⚠️ Your case is under review by moderators.',
                        inline: false
                    })
                    .setTimestamp()
                ]
            });
        } catch (error) {
            console.log(`Could not DM ${message.author.tag} about deleted messages`);
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

setInterval(() => {
    const now = Date.now();
    for (const [userId, userData] of userSpamTracking.entries()) {
        userData.messages = userData.messages.filter(msg => 
            now - msg.timestamp < SPAM_THRESHOLDS.CROSS_CHANNEL_TIME
        );
        
        if (userData.messages.length === 0 && !userData.muted) {
            userSpamTracking.delete(userId);
        }
    }
}, 300000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildModeration
    ],
    partials: ['MESSAGE', 'CHANNEL', 'REACTION']
});

const invites = new Map();
const memberInvites = new Map();

const logChannels = {
    member: null,
    message: null,
    voice: null,
    role: null,
    channel: null,
    invite: null,
    moderation: null,
    attachments: null
};

let saleMonitor;
let claudeTracker;

function loadMemberInvites() {
    try {
        if (fs.existsSync('member-invites.json')) {
            const data = JSON.parse(fs.readFileSync('member-invites.json', 'utf8'));
            Object.entries(data).forEach(([userId, inviteData]) => {
                memberInvites.set(userId, inviteData);
            });
            console.log(`Loaded ${memberInvites.size} member invite records`);
        }
    } catch (error) {
        console.error('Error loading member-invites.json:', error);
    }
}

function saveMemberInvites() {
    try {
        const data = Object.fromEntries(memberInvites);
        fs.writeFileSync('member-invites.json', JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving member-invites.json:', error);
    }
}

client.once('ready', async () => {
    console.log(`${client.user.tag} is online!`);
    
    loadMemberInvites();
    
    // Send startup notification to Discord
    if (config.startupNotification?.enabled && config.startupNotification?.channelId) {
        try {
            const notificationChannel = client.channels.cache.get(config.startupNotification.channelId);
            if (notificationChannel) {
                const startupEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🟢 Bot Started Successfully')
                    .setDescription(`**${client.user.tag}** is now online and ready!`)
                    .addFields(
                        { name: '🕐 Started At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                        { name: '📊 Servers', value: client.guilds.cache.size.toString(), inline: true },
                        { name: '👥 Total Users', value: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0).toString(), inline: true },
                        { name: '🔧 Node Version', value: process.version, inline: true },
                        { name: '📦 Discord.js', value: require('discord.js').version, inline: true },
                        { name: '💾 Memory', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`, inline: true }
                    )
                    .setThumbnail(client.user.displayAvatarURL())
                    .setTimestamp()
                    .setFooter({ text: 'System Status' });
                
                // Add enabled features
                const features = [];
                if (logChannels.member) features.push('✅ Member Logging');
                if (logChannels.message) features.push('✅ Message Logging');
                if (logChannels.voice) features.push('✅ Voice Logging');
                if (logChannels.role) features.push('✅ Role Logging');
                if (logChannels.channel) features.push('✅ Channel Logging');
                if (logChannels.moderation) features.push('✅ Moderation Logging');
                if (logChannels.attachments) features.push('✅ Attachment Logging');
                if (SPAM_THRESHOLDS.ENABLED) features.push('🛡️ Anti-Spam Protection');
                if (saleMonitor) features.push('🎮 Steam Sale Monitor');
                if (claudeTracker) features.push('🤖 Claude Token Tracker');
                
                if (features.length > 0) {
                    startupEmbed.addFields({
                        name: '🎯 Active Features',
                        value: features.join('\n'),
                        inline: false
                    });
                }
                
                await notificationChannel.send({ embeds: [startupEmbed] });
                console.log('✅ Startup notification sent to Discord');
            } else {
                console.log('⚠️ Startup notification channel not found');
            }
        } catch (error) {
            console.error('❌ Error sending startup notification:', error);
        }
    }
    
    const statuses = [
        { name: 'the streets', type: 3 },
        { name: 'customers', type: 2 },
        { name: 'drug deals', type: 3 },
        { name: 'the competition', type: 5 }
    ];

    let i = 0;
    setInterval(() => {
        client.user.setPresence({
            status: 'online',
            activities: [statuses[i]]
        });
        i = (i + 1) % statuses.length;
    }, 10000);

    for (const [key, channelId] of Object.entries(config.logChannels)) {
        if (channelId) {
            const channel = client.channels.cache.get(channelId);
            if (channel) {
                logChannels[key] = channel;
                console.log(`${key} logs -> #${channel.name}`);
            }
        }
    }
    
    client.guilds.cache.forEach(async (guild) => {
        try {
            const guildInvites = await guild.invites.fetch();
            invites.set(guild.id, new Map(guildInvites.map(invite => [invite.code, invite.uses])));
            console.log(`Cached ${guildInvites.size} invites for ${guild.name}`);
        } catch (error) {
            console.log(`Could not fetch invites for ${guild.name}`);
        }
    });

    if (config.saleChannelId) {
        saleMonitor = new SteamSaleMonitor(client, config);
        await saleMonitor.start();
    } else {
        console.log('Sale monitoring disabled');
    }

    if (config.claudeWebhook) {
        claudeTracker = new ClaudeTokenTracker(client, config.claudeWebhook);
        console.log('✅ Claude token tracker initialized');
    }
});

client.on('guildMemberAdd', async (member) => {
    try {
        if (fs.existsSync('pending-approvals.json')) {
            const pendingApprovals = JSON.parse(fs.readFileSync('pending-approvals.json'));
            
            if (pendingApprovals[member.id]) {
                const roleIds = pendingApprovals[member.id];
                
                for (const roleId of roleIds) {
                    const role = member.guild.roles.cache.get(roleId);
                    if (role) {
                        await member.roles.add(role);
                        console.log(`Auto-assigned ${role.name} to ${member.user.tag}`);
                    }
                }
                
                delete pendingApprovals[member.id];
                fs.writeFileSync('pending-approvals.json', JSON.stringify(pendingApprovals, null, 2));
            }
        }
    } catch (error) {
        console.error('Error auto-assigning roles:', error);
    }
    
    if (!logChannels.member) return;
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('Member Joined')
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `<@${member.id}>\n${member.user.tag} (${member.id})`, inline: true }, // Made clickable
            { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'Member Count', value: member.guild.memberCount.toString(), inline: true }
        )
        .setTimestamp();
    
    try {
        const newInvites = await member.guild.invites.fetch();
        const oldInvites = invites.get(member.guild.id) || new Map();
        const usedInvite = newInvites.find(invite => {
            const oldUses = oldInvites.get(invite.code) || 0;
            return invite.uses > oldUses;
        });
        
        if (usedInvite) {
            embed.addFields({
                name: 'Invite Used',
                value: `Code: \`${usedInvite.code}\`\nCreated by: ${usedInvite.inviter?.tag || 'Unknown'}\nUses: ${usedInvite.uses}/${usedInvite.maxUses || '∞'}`,
                inline: false
            });
            
            memberInvites.set(member.id, {
                code: usedInvite.code,
                inviter: usedInvite.inviter?.tag || 'Unknown',
                inviterId: usedInvite.inviter?.id || null,
                uses: usedInvite.uses,
                maxUses: usedInvite.maxUses || 0,
                timestamp: Date.now(),
                guildId: member.guild.id
            });
            
            saveMemberInvites();
        }
        
        invites.set(member.guild.id, new Map(newInvites.map(inv => [inv.code, inv.uses])));
    } catch (error) {
        console.error('Error tracking invite:', error);
    }
    
    logChannels.member.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async (member) => {
    if (!logChannels.member) return;
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Member Left')
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `<@${member.id}>\n${member.user.tag} (${member.id})`, inline: true }, // Made clickable
            { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'Member Count', value: member.guild.memberCount.toString(), inline: true }
        );
    
    let wasKicked = false;
    let wasBanned = false;
    
    try {
        const kickLogs = await member.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberKick
        });
        const kickLog = kickLogs.entries.first();
        
        if (kickLog && kickLog.target.id === member.id && (Date.now() - kickLog.createdTimestamp) < 5000) {
            wasKicked = true;
            embed.setColor('#ff6600');
            embed.setTitle('Member Kicked');
        }
        
        const banLogs = await member.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberBanAdd
        });
        const banLog = banLogs.entries.first();
        
        if (banLog && banLog.target.id === member.id && (Date.now() - banLog.createdTimestamp) < 5000) {
            wasBanned = true;
            embed.setColor('#8b0000');
            embed.setTitle('Member Banned');
        }
    } catch (error) {
        console.error('Error fetching moderation logs:', error);
    }
    
    if (member.joinedTimestamp) {
        const joinDate = `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`;
        const durationMs = Date.now() - member.joinedTimestamp;
        const days = Math.floor(durationMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        
        embed.addFields(
            { name: 'Joined Server', value: joinDate, inline: true },
            { name: 'Time in Server', value: `${days}d ${hours}h`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        );
    }
    
    const userRoles = member.roles?.cache?.filter(r => r.id !== member.guild.id);
    if (userRoles && userRoles.size > 0) {
        embed.addFields({
            name: 'Roles',
            value: userRoles.map(r => r.name).join(', '),
            inline: false
        });
    }
    
    const memberInviteData = memberInvites.get(member.id);
    if (memberInviteData) {
        embed.addFields({
            name: 'Invite Used',
            value: `Code: \`${memberInviteData.code}\`\nCreated by: ${memberInviteData.inviter}\nUses: ${memberInviteData.uses}/${memberInviteData.maxUses || '∞'}`,
            inline: false
        });
    }
    
    if (wasKicked) {
        try {
            const kickLogs = await member.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.MemberKick
            });
            const kickLog = kickLogs.entries.first();
            
            if (kickLog && kickLog.target.id === member.id) {
                embed.addFields({
                    name: 'Kicked By',
                    value: `${kickLog.executor.tag}\nReason: ${kickLog.reason || 'No reason provided'}`,
                    inline: false
                });
            }
        } catch (error) {
            console.error('Error fetching kick details:', error);
        }
    }
    
    if (wasBanned) {
        try {
            const banLogs = await member.guild.fetchAuditLogs({
                limit: 1,
                type: AuditLogEvent.MemberBanAdd
            });
            const banLog = banLogs.entries.first();
            
            if (banLog && banLog.target.id === member.id) {
                embed.addFields({
                    name: 'Banned By',
                    value: `${banLog.executor.tag}\nReason: ${banLog.reason || 'No reason provided'}`,
                    inline: false
                });
            }
        } catch (error) {
            console.error('Error fetching ban details:', error);
        }
    }
    
    embed.setTimestamp();
    
    try {
        await logChannels.member.send({ embeds: [embed] });
        
        if (memberInviteData) {
            memberInvites.delete(member.id);
            saveMemberInvites();
        }
    } catch (error) {
        console.error('Error sending leave log:', error);
    }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!logChannels.message || newMessage.author.bot || !oldMessage.content || !newMessage.content) return;
    if (oldMessage.content === newMessage.content) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ffa500')
        .setTitle('Message Edited')
        .setAuthor({ name: newMessage.author.tag, iconURL: newMessage.author.displayAvatarURL() })
        .addFields(
            { name: 'Channel', value: `<#${newMessage.channel.id}>`, inline: true },
            { name: 'Message Link', value: `[Jump to Message](${newMessage.url})`, inline: true },
            { name: 'Before', value: oldMessage.content.slice(0, 1024) || 'Empty', inline: false },
            { name: 'After', value: newMessage.content.slice(0, 1024) || 'Empty', inline: false }
        )
        .setTimestamp();
    
    logChannels.message.send({ embeds: [embed] });
});

client.on('messageDelete', async (message) => {
    if (!logChannels.message || message.author?.bot) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Message Deleted')
        .addFields(
            { name: 'Author', value: message.author ? `<@${message.author.id}>\n${message.author.tag} (${message.author.id})` : 'Unknown', inline: true }, // Made clickable
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Message ID', value: message.id, inline: true }
        );
    
    if (message.content) {
        embed.addFields({
            name: 'Content',
            value: message.content.slice(0, 1024) || 'No text content',
            inline: false
        });
    }
    
    if (message.attachments.size > 0) {
        const attachmentList = message.attachments.map(a => {
            const size = (a.size / 1024).toFixed(2);
            return `**${a.name}** (${size} KB)\n[Original URL](${a.url})`;
        }).join('\n\n');
        
        embed.addFields({
            name: `📎 Attachments (${message.attachments.size})`,
            value: attachmentList.slice(0, 1024),
            inline: false
        });
        
        const firstImage = message.attachments.find(a => 
            a.contentType?.startsWith('image/')
        );
        if (firstImage) {
            embed.setImage(firstImage.url);
        }
    }
    
    if (message.embeds.length > 0) {
        const embedInfo = message.embeds.map((e, i) => {
            let info = `**Embed ${i + 1}**\n`;
            if (e.title) info += `Title: ${e.title}\n`;
            if (e.description) info += `Description: ${e.description.slice(0, 100)}...\n`;
            if (e.url) info += `URL: ${e.url}\n`;
            if (e.image) info += `Image: [Link](${e.image.url})\n`;
            return info;
        }).join('\n');
        
        embed.addFields({
            name: `📰 Embeds (${message.embeds.length})`,
            value: embedInfo.slice(0, 1024),
            inline: false
        });
    }
    
    if (message.stickers.size > 0) {
        const stickerList = message.stickers.map(s => 
            `**${s.name}** (${s.format})`
        ).join(', ');
        
        embed.addFields({
            name: '🎨 Stickers',
            value: stickerList,
            inline: false
        });
    }
    
    if (message.createdTimestamp) {
        embed.addFields({
            name: 'Created',
            value: `<t:${Math.floor(message.createdTimestamp / 1000)}:F>`,
            inline: true
        });
    }
    
    const memberInviteData = memberInvites.get(message.author?.id);
    if (memberInviteData) {
        embed.addFields({
            name: '📋 Author Join Info',
            value: `Joined: <t:${Math.floor(memberInviteData.timestamp / 1000)}:R>\n` +
                   `Invite: \`${memberInviteData.code}\` by ${memberInviteData.inviter}`,
            inline: false
        });
    }
    
    try {
        const fetchedLogs = await message.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MessageDelete
        });
        const deletionLog = fetchedLogs.entries.first();
        
        if (deletionLog && deletionLog.target.id === message.author?.id && (Date.now() - deletionLog.createdTimestamp) < 5000) {
            embed.addFields({
                name: '🛡️ Deleted By',
                value: `${deletionLog.executor.tag}`,
                inline: true
            });
            
            if (deletionLog.reason) {
                embed.addFields({
                    name: 'Reason',
                    value: deletionLog.reason,
                    inline: true
                });
            }
        }
    } catch (error) {
        console.error('Error fetching deletion logs:', error);
    }
    
    embed.setTimestamp();
    
    if (message.author) {
        embed.setAuthor({
            name: message.author.tag,
            iconURL: message.author.displayAvatarURL()
        });
    }
    
    logChannels.message.send({ embeds: [embed] });
});

client.on('messageCreate', async (message) => {
    // ========== SPAM DETECTION ==========
    if (SPAM_THRESHOLDS.ENABLED && !message.author.bot && message.guild) {
        const hasExemptRole = message.member?.roles.cache.some(role => 
            SPAM_THRESHOLDS.EXEMPT_ROLES.includes(role.id)
        );
        
        if (!hasExemptRole) {
            const spamData = trackSpamBehavior(message);
            
            if (spamData.isSpam) {
                console.log(`🚨 Spam detected from ${message.author.tag}: ${spamData.reason}`);
                await handleSpammer(message, spamData);
                return;
            }
        }
    }
    
    // ========== ATTACHMENT LOGGING ==========
if (message.attachments.size > 0 || message.embeds.length > 0 || message.stickers.size > 0) {
    const excludedBots = config.excludedBots || [];
    if (excludedBots.includes(message.author.id)) return;
    
    const attachmentChannel = logChannels.attachments;
    if (attachmentChannel) {
        // Determine what type of content was posted
        let contentType = '';
        let emoji = '';
        
        if (message.attachments.size > 0) {
            const hasImage = message.attachments.some(a => a.contentType?.startsWith('image/'));
            const hasVideo = message.attachments.some(a => a.contentType?.startsWith('video/'));
            const hasAudio = message.attachments.some(a => a.contentType?.startsWith('audio/'));
            
            if (hasImage) {
                contentType = 'Image';
                emoji = '🖼️';
            } else if (hasVideo) {
                contentType = 'Video';
                emoji = '🎥';
            } else if (hasAudio) {
                contentType = 'Audio';
                emoji = '🎵';
            } else {
                contentType = 'File';
                emoji = '📎';
            }
        } else if (message.embeds.length > 0) {
            contentType = 'Embed';
            emoji = '📰';
        } else if (message.stickers.size > 0) {
            contentType = 'Sticker';
            emoji = '🎨';
        }
        
        const embed = new EmbedBuilder()
            .setColor(message.author.bot ? '#ff6b6b' : '#3498db')
            .setTitle(message.author.bot ? `🤖 Bot ${contentType}` : `${emoji} ${contentType} Posted`)
            .setAuthor({
                name: `${message.author.tag}${message.author.bot ? ' [BOT]' : ''}`,
                iconURL: message.author.displayAvatarURL()
            })
            .addFields(
                { name: 'User', value: `<@${message.author.id}>`, inline: true }, // Just clickable mention
                { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                { name: 'Message', value: `[Jump to Message](${message.url})`, inline: true }
            );
        
        if (message.author.bot) {
            embed.addFields({
                name: '⚠️ Bot Account',
                value: 'This message was sent by a bot account',
                inline: false
            });
        }
        
        if (message.content) {
            embed.addFields({
                name: '💬 Message Content',
                value: message.content.slice(0, 1024),
                inline: false
            });
        }
        
        if (message.attachments.size > 0) {
            const attachmentList = message.attachments.map(a => {
                const size = (a.size / 1024).toFixed(2);
                const type = a.contentType || 'unknown';
                return `**${a.name}**\nType: ${type}\nSize: ${size} KB\n[Download](${a.url})`;
            }).join('\n\n');
            
            embed.addFields({
                name: `📎 Attachments (${message.attachments.size})`,
                value: attachmentList.slice(0, 1024),
                inline: false
            });
            
            const firstImage = message.attachments.find(a => 
                a.contentType?.startsWith('image/')
            );
            if (firstImage) {
                embed.setImage(firstImage.url);
            }
        }
        
        if (message.embeds.length > 0) {
            const embedInfo = message.embeds.map((e, i) => {
                let info = `**Embed ${i + 1}**\n`;
                if (e.title) info += `Title: ${e.title}\n`;
                if (e.description) info += `Description: ${e.description.slice(0, 100)}...\n`;
                if (e.url) info += `URL: ${e.url}\n`;
                if (e.image) info += `Image: [Link](${e.image.url})\n`;
                return info;
            }).join('\n');
            
            embed.addFields({
                name: `📰 Embeds (${message.embeds.length})`,
                value: embedInfo.slice(0, 1024),
                inline: false
            });
        }
        
        if (message.stickers.size > 0) {
            const stickerList = message.stickers.map(s => 
                `**${s.name}** (${s.format})`
            ).join(', ');
            
            embed.addFields({
                name: '🎨 Stickers',
                value: stickerList,
                inline: false
            });
        }
        
        embed.setTimestamp();
        embed.setFooter({
            text: `${message.author.tag} (${message.author.id})`
        });
        
        try {
            await attachmentChannel.send({ embeds: [embed] });
            
            const forwardableAttachments = message.attachments.filter(a => a.size < 8388608);
            if (forwardableAttachments.size > 0) {
                await attachmentChannel.send({
                    content: `📦 **Files from ${message.author.tag}${message.author.bot ? ' [BOT]' : ''}:**`,
                    files: forwardableAttachments.map(a => a.url)
                });
            }
        } catch (error) {
            console.error('Error forwarding attachment:', error);
        }
    }
}
    
    // ========== BOT CHECK ==========--
    if (message.author.bot) return;

    // ========== RATE LIMITING ==========
    const isAdmin = message.member?.permissions.has('Administrator');
    const bypassRoleIds = config.rateLimitBypassRoles || [];
    const hasBypassRole = message.member?.roles.cache.some(role => bypassRoleIds.includes(role.id));

    if (!isAdmin && !hasBypassRole && !checkRateLimit(message.author.id)) {
        return;
    }
    // ========== END RATE LIMITING ==========

if (message.content === '!botstatus' && isAdmin) {
    const uptime = Math.floor(client.uptime / 1000);
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    
    // Get git info
    let gitInfo = 'Not available';
    try {
        const { execSync } = require('child_process');
        const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
        const gitMessage = execSync('git log -1 --pretty=%B').toString().trim();
        const gitBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
        gitInfo = `\`${gitHash}\` on \`${gitBranch}\`\n${gitMessage}`;
    } catch (error) {
        gitInfo = 'Git not initialized';
    }
    
    const statusEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('🤖 Bot Status')
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
            { name: '🟢 Status', value: 'Online', inline: true },
            { name: '📊 Servers', value: client.guilds.cache.size.toString(), inline: true },
            { name: '👥 Total Users', value: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0).toString(), inline: true },
            { name: '⏱️ Uptime', value: `${days}d ${hours}h ${minutes}m ${seconds}s`, inline: true },
            { name: '🏓 Ping', value: `${client.ws.ping}ms`, inline: true },
            { name: '💾 Memory', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`, inline: true },
            { name: '🔧 Node.js', value: process.version, inline: true },
            { name: '📦 Discord.js', value: require('discord.js').version, inline: true },
            { name: '🛡️ Anti-Spam', value: SPAM_THRESHOLDS.ENABLED ? 'Enabled' : 'Disabled', inline: true }
        )
        .addFields({
            name: '📝 Current Version',
            value: gitInfo,
            inline: false
        })
        .setTimestamp();
    
    await message.reply({ embeds: [statusEmbed] });
}
    // ========== ANTI-SPAM COMMANDS ==========
    if (message.content === '!spamstats' && isAdmin) {
        const activeTracking = Array.from(userSpamTracking.entries())
            .filter(([, data]) => data.messages.length > 0)
            .sort((a, b) => b[1].messages.length - a[1].messages.length)
            .slice(0, 10);
        
        if (activeTracking.length === 0) {
            return message.reply('No active spam tracking data.');
        }
        
        const embed = new EmbedBuilder()
            .setColor('#ff6600')
            .setTitle('📊 Current Spam Tracking')
            .setDescription(`Monitoring ${userSpamTracking.size} users`)
            .setTimestamp();
        
        activeTracking.forEach(([userId, data]) => {
            const user = message.guild.members.cache.get(userId)?.user.tag || 'Unknown User';
            const status = data.muted ? '🔇 MUTED' : '✅ Active';
            
            embed.addFields({
                name: `${user} ${status}`,
                value: `Messages: ${data.messages.length}\nChannels: ${data.channels.size}`,
                inline: true
            });
        });
        
        await message.reply({ embeds: [embed] });
    }

    if (message.content.startsWith('!unmute ') && isAdmin) {
        const userId = message.content.split(' ')[1];
        const member = message.guild.members.cache.get(userId);
        
        if (!member) {
            return message.reply('User not found in server.');
        }
        
        const mutedRole = message.guild.roles.cache.find(r => r.name === 'Muted');
        if (!mutedRole) {
            return message.reply('No Muted role found.');
        }
        
        try {
            await member.roles.remove(mutedRole);
            
            const userData = userSpamTracking.get(userId);
            if (userData) {
                userData.muted = false;
            }
            
            await message.reply(`✅ Unmuted <@${userId}>`);
            
            if (logChannels.moderation) {
                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🔓 Manual Unmute')
                    .addFields(
                        { name: 'User', value: `${member.user.tag} (${userId})`, inline: true },
                        { name: 'Unmuted By', value: message.author.tag, inline: true }
                    )
                    .setTimestamp();
                
                await logChannels.moderation.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error unmuting:', error);
            await message.reply('Error unmuting user.');
        }
    }

    if (message.content === '!spamhelp' && isAdmin) {
        const helpEmbed = new EmbedBuilder()
            .setColor('#ff6600')
            .setTitle('🛡️ Anti-Spam System Commands')
            .setDescription('Automatic spam detection and protection')
            .addFields(
                { 
                    name: '🔍 Detection Methods',
                    value: '• Rapid messages (5+ in 10s)\n' +
                           '• Cross-channel spam (3+ channels in 15s)\n' +
                           '• Identical message spam\n' +
                           '• New account detection',
                    inline: false
                },
                {
                    name: '⚡ Auto-Actions',
                    value: '• Auto-mute for 1 hour\n' +
                           '• Delete spam messages\n' +
                           '• Log to moderation channel\n' +
                           '• DM notification to user',
                    inline: false
                },
                {
                    name: '🎛️ Commands',
                    value: '`!spamstats` - View current tracking\n' +
                           '`!unmute <user_id>` - Manually unmute\n' +
                           '`!spamhelp` - This message',
                    inline: false
                },
                {
                    name: '⚙️ Settings',
                    value: `Message threshold: ${SPAM_THRESHOLDS.MESSAGE_COUNT}\n` +
                           `Time window: ${SPAM_THRESHOLDS.TIME_WINDOW / 1000}s\n` +
                           `Cross-channel threshold: ${SPAM_THRESHOLDS.CROSS_CHANNEL_COUNT}\n` +
                           `Mute duration: ${SPAM_THRESHOLDS.MUTE_DURATION / 60000}min`,
                    inline: false
                }
            )
            .setFooter({ text: 'Admins and mods are exempt from auto-moderation' });
        
        await message.reply({ embeds: [helpEmbed] });
    }
    
    // ========== BOT COMMANDS ==========
    if (message.content === '!test' && isAdmin) {
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ Bot Status Check')
            .addFields(
                { name: 'Status', value: '🟢 Online', inline: true },
                { name: 'Admin Access', value: '✅ Confirmed', inline: true },
                { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
                { name: 'Uptime', value: `${Math.floor(client.uptime / 1000 / 60)} minutes`, inline: true },
                { name: 'Server', value: message.guild.name, inline: true },
                { name: 'Members', value: message.guild.memberCount.toString(), inline: true }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }

    if (message.content === '!sessionstats' && isAdmin) {
        if (claudeTracker) {
            try {
                const data = JSON.parse(fs.readFileSync('claude-token-usage.json', 'utf8'));
                const today = new Date().toISOString().split('T')[0];
                const todayUsage = data.dailyUsage[today];
                
                if (!todayUsage) {
                    return message.reply('No usage data for today yet!');
                }
                
                const inputCost = (todayUsage.input / 1000000) * 3.00;
                const outputCost = (todayUsage.output / 1000000) * 15.00;
                const totalCost = inputCost + outputCost;
                
                const recentConvos = data.conversations.slice(-5).reverse();
                const convoList = recentConvos.map((c, i) => {
                    const date = new Date(c.date);
                    const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    const totalTokens = c.input + c.output;
                    return `${i + 1}. **${time}** - ${totalTokens.toLocaleString()} tokens\n   ${c.context}`;
                }).join('\n\n');
                
                const embed = new EmbedBuilder()
                    .setColor('#6366f1')
                    .setTitle('💰 Current Session Token Stats')
                    .setDescription(`**Date:** ${today}`)
                    .addFields(
                        {
                            name: '📊 Today\'s Usage',
                            value: `**${todayUsage.total.toLocaleString()}** total tokens\n` +
                                   `Input: ${todayUsage.input.toLocaleString()}\n` +
                                   `Output: ${todayUsage.output.toLocaleString()}\n` +
                                   `Conversations: ${todayUsage.conversations}`,
                            inline: true
                        },
                        {
                            name: '💵 Estimated Cost',
                            value: `**$${totalCost.toFixed(2)}** total\n` +
                                   `Input: $${inputCost.toFixed(2)}\n` +
                                   `Output: $${outputCost.toFixed(2)}`,
                            inline: true
                        },
                        {
                            name: '📈 Token Ratio',
                            value: `${((todayUsage.input / todayUsage.total) * 100).toFixed(1)}% input\n` +
                                   `${((todayUsage.output / todayUsage.total) * 100).toFixed(1)}% output`,
                            inline: true
                        }
                    );
                
                if (recentConvos.length > 0) {
                    embed.addFields({
                        name: '🕐 Recent Conversations',
                        value: convoList.slice(0, 1024),
                        inline: false
                    });
                }
                
                embed.addFields({
                    name: '🌍 Lifetime Total',
                    value: `**${data.totalTokens.toLocaleString()}** tokens across all time\n` +
                           `**${data.conversations.length}** total conversations logged`,
                    inline: false
                });
                
                if (todayUsage.total > 10000000) {
                    embed.addFields({
                        name: '⚠️ High Usage Alert',
                        value: 'You\'ve used over 10M tokens today! Consider reviewing your context size.',
                        inline: false
                    });
                }
                
                embed.setTimestamp();
                embed.setFooter({ 
                    text: 'Claude Sonnet 3.5 • $3/M input • $15/M output' 
                });
                
                await message.reply({ embeds: [embed] });
            } catch (error) {
                console.error('Error reading session stats:', error);
                await message.reply('Error reading session stats file!');
            }
        } else {
            await message.reply('Claude token tracker not initialized!');
        }
    }

    if (message.content.startsWith('!approve') && isAdmin) {
        const args = message.content.split(' ');
        
        if (args.length < 3) {
            return message.reply('Usage: `!approve <user_id> <role_name>`');
        }
        
        const userId = args[1];
        const roleName = args.slice(2).join(' ');
        
        try {
            let member = message.guild.members.cache.get(userId);
            
            if (!member) {
                member = await message.guild.members.fetch(userId).catch(() => null);
            }
            
            const role = message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
            
            if (!role) {
                return message.reply(`Role "${roleName}" not found!`);
            }
            
            if (member) {
                await member.roles.add(role);
                return message.reply(`Assigned ${role.name} to <@${userId}>`);
            } else {
                let pendingApprovals = {};
                
                try {
                    if (fs.existsSync('pending-approvals.json')) {
                        pendingApprovals = JSON.parse(fs.readFileSync('pending-approvals.json'));
                    }
                } catch (error) {
                    console.error('Error reading pending approvals:', error);
                }
                
                if (!pendingApprovals[userId]) {
                    pendingApprovals[userId] = [];
                }
                
                if (!pendingApprovals[userId].includes(role.id)) {
                    pendingApprovals[userId].push(role.id);
                }
                
                fs.writeFileSync('pending-approvals.json', JSON.stringify(pendingApprovals, null, 2));
                
                return message.reply(`User is not in the server. ${role.name} will be assigned when they join.`);
            }
        } catch (error) {
            console.error('Error with approve command:', error);
            return message.reply('Error processing approval.');
        }
    }
    
    // Steam Sale Monitor Commands
    if (message.content === '!checksales' && isAdmin) {
        await message.reply('Checking for sales...');
        if (saleMonitor) {
            await saleMonitor.forceCheck();
            await message.reply('Sale check complete!');
        } else {
            await message.reply('Sale monitor not initialized!');
        }
    }
    
    if (message.content === '!forcesales' && isAdmin) {
        await message.reply('Force posting all tracked games...');
        if (saleMonitor) {
            await saleMonitor.forcePostAll();
            await message.reply('Posted all tracked games!');
        } else {
            await message.reply('Sale monitor not initialized!');
        }
    }
    
    if (message.content === '!listgames' && isAdmin) {
        if (saleMonitor) {
            const gameCount = saleMonitor.gameIds.length;
            await message.reply(`Currently tracking ${gameCount} games.`);
        } else {
            await message.reply('Sale monitor not initialized!');
        }
    }
    
    if (message.content.startsWith('!addgame ') && isAdmin) {
        const appId = message.content.split(' ')[1];
        if (appId && saleMonitor) {
            saleMonitor.addGame(appId);
            await message.reply(`Added Steam App ID ${appId} to monitoring`);
        } else {
            await message.reply('Usage: !addgame <steam_app_id>');
        }
    }
    
    if (message.content.startsWith('!removegame ') && isAdmin) {
        const appId = message.content.split(' ')[1];
        if (appId && saleMonitor) {
            saleMonitor.removeGame(appId);
            await message.reply(`Removed Steam App ID ${appId} from monitoring`);
        } else {
            await message.reply('Usage: !removegame <steam_app_id>');
        }
    }
    
    if (message.content === '!saleshelp' && isAdmin) {
        const helpEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Steam Sale Monitor Commands')
            .setDescription('All commands require Administrator permission')
            .addFields(
                { name: '!checksales', value: 'Check for games currently on sale', inline: false },
                { name: '!forcesales', value: 'Force post ALL tracked games', inline: false },
                { name: '!listgames', value: 'Show how many games are being tracked', inline: false },
                { name: '!addgame <app_id>', value: 'Add a Steam game to monitor', inline: false },
                { name: '!removegame <app_id>', value: 'Remove a game from monitoring', inline: false },
                { name: '!cleargamedata', value: 'Clear tracked game data', inline: false },
                { name: '!saleshelp', value: 'Show this help message', inline: false }
            )
            .setFooter({ text: 'Automatic checks run every hour' });
        await message.reply({ embeds: [helpEmbed] });
    }

    if (message.content === '!cleargamedata' && isAdmin) {
        if (saleMonitor) {
            saleMonitor.clearTrackedData();
            await message.reply('Cleared all tracked game data.');
        } else {
            await message.reply('Sale monitor not initialized!');
        }
    }
    
    // Invite Tracking Commands
    if (message.content === '!invitestats' && isAdmin) {
        const inviterCounts = new Map();
        
        memberInvites.forEach((data) => {
            const inviter = data.inviter;
            inviterCounts.set(inviter, (inviterCounts.get(inviter) || 0) + 1);
        });
        
        const sorted = Array.from(inviterCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        
        if (sorted.length === 0) {
            return message.reply('No invite data available yet!');
        }
        
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Invite Leaderboard')
            .setDescription(`Top inviters (${memberInvites.size} total members tracked)`)
            .setTimestamp();
        
        sorted.forEach(([inviter, count], index) => {
            embed.addFields({
                name: `#${index + 1} ${inviter}`,
                value: `${count} member${count !== 1 ? 's' : ''}`,
                inline: true
            });
        });
        
        await message.reply({ embeds: [embed] });
    }
    
    if (message.content.startsWith('!whoinvited ') && isAdmin) {
        const userId = message.content.split(' ')[1];
        
        if (!userId) {
            return message.reply('Usage: !whoinvited <user_id>');
        }
        
        const inviteData = memberInvites.get(userId);
        
        if (!inviteData) {
            return message.reply('No invite data found for this user.');
        }
        
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Invite Information')
            .addFields(
                { name: 'User ID', value: userId, inline: true },
                { name: 'Invite Code', value: `\`${inviteData.code}\``, inline: true },
                { name: 'Invited By', value: inviteData.inviter, inline: true },
                { name: 'Joined At', value: `<t:${Math.floor(inviteData.timestamp / 1000)}:F>`, inline: false }
            )
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    }
    
    if (message.content === '!invitehelp' && isAdmin) {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Invite Tracking Commands')
            .setDescription('All commands require Administrator permission')
            .addFields(
                { name: '!invitestats', value: 'Show top 10 inviters leaderboard', inline: false },
                { name: '!whoinvited <user_id>', value: 'See which invite a specific user used', inline: false },
                { name: '!invitehelp', value: 'Show this help message', inline: false }
            )
            .setFooter({ text: 'Invite data is saved to member-invites.json' });
        await message.reply({ embeds: [helpEmbed] });
    }

    // Claude Token Tracker Commands
    if (message.content === '!tokenusage' && isAdmin) {
        if (claudeTracker) {
            await claudeTracker.handleTokenUsageCommand(message);
        } else {
            await message.reply('Claude token tracker not initialized!');
        }
    }

    if (message.content === '!optimization' && isAdmin) {
        if (claudeTracker) {
            await claudeTracker.handleOptimizationCommand(message);
        } else {
            await message.reply('Claude token tracker not initialized!');
        }
    }

    if (message.content.startsWith('!logtoken ') && isAdmin) {
        const args = message.content.split(' ');
        if (args.length >= 3 && claudeTracker) {
            const inputTokens = parseInt(args[1]);
            const outputTokens = parseInt(args[2]);
            const context = args.slice(3).join(' ') || 'Manual entry';
            
            if (isNaN(inputTokens) || isNaN(outputTokens)) {
                return message.reply('Input and output tokens must be numbers!');
            }
            
            claudeTracker.logTokenUsage(inputTokens, outputTokens, context);
            await message.reply(`Logged ${(inputTokens + outputTokens).toLocaleString()} tokens`);
        } else if (!claudeTracker) {
            await message.reply('Claude token tracker not initialized!');
        } else {
            await message.reply('Usage: !logtoken <input_tokens> <output_tokens> [context]');
        }
    }

    if (message.content === '!tokenhelp' && isAdmin) {
        const helpEmbed = new EmbedBuilder()
            .setColor('#6366f1')
            .setTitle('Claude Token Tracking Commands')
            .setDescription('All commands require Administrator permission')
            .addFields(
                { name: '!tokenusage', value: 'View 7-day token usage statistics', inline: false },
                { name: '!sessionstats', value: 'View current session/day token usage', inline: false },
                { name: '!optimization', value: 'Get tips to optimize your token usage', inline: false },
                { name: '!logtoken <input> <output> [context]', value: 'Manually log token usage', inline: false },
                { name: '!tokenhelp', value: 'Show this help message', inline: false }
            )
            .addFields({
                name: 'Automatic Features',
                value: 'Daily reports sent to webhook at midnight\nToken usage history saved\nCost calculations included',
                inline: false
            })
            .setFooter({ text: 'Track your Claude API usage and optimize costs' });
        await message.reply({ embeds: [helpEmbed] });
    }
});
client.on('voiceStateUpdate', (oldState, newState) => {
    if (!logChannels.voice) return;
    
    const member = newState.member;
    let embed = null;
    
    if (!oldState.channel && newState.channel) {
        embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Joined Voice Channel')
            .addFields(
                { name: 'User', value: `${member.user.tag}`, inline: true },
                { name: 'Channel', value: `${newState.channel.name}`, inline: true }
            )
            .setTimestamp();
    }
    else if (oldState.channel && !newState.channel) {
        embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Left Voice Channel')
            .addFields(
                { name: 'User', value: `${member.user.tag}`, inline: true },
                { name: 'Channel', value: `${oldState.channel.name}`, inline: true }
            )
            .setTimestamp();
    }
    else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Switched Voice Channel')
            .addFields(
                { name: 'User', value: `${member.user.tag}`, inline: true },
                { name: 'From', value: `${oldState.channel.name}`, inline: true },
                { name: 'To', value: `${newState.channel.name}`, inline: true }
            )
            .setTimestamp();
    }
    
    if (oldState.channel && newState.channel && oldState.channel.id === newState.channel.id) {
        const changes = [];
        
        if (!oldState.mute && newState.mute) changes.push('Server Muted');
        if (oldState.mute && !newState.mute) changes.push('Server Unmuted');
        if (!oldState.deaf && newState.deaf) changes.push('Server Deafened');
        if (oldState.deaf && !newState.deaf) changes.push('Server Undeafened');
        if (!oldState.selfMute && newState.selfMute) changes.push('Self Muted');
        if (oldState.selfMute && !newState.selfMute) changes.push('Self Unmuted');
        if (!oldState.selfDeaf && newState.selfDeaf) changes.push('Self Deafened');
        if (oldState.selfDeaf && !newState.selfDeaf) changes.push('Self Undeafened');
        if (!oldState.streaming && newState.streaming) changes.push('Started Streaming');
        if (oldState.streaming && !newState.streaming) changes.push('Stopped Streaming');
        if (!oldState.selfVideo && newState.selfVideo) changes.push('Camera On');
        if (oldState.selfVideo && !newState.selfVideo) changes.push('Camera Off');
        
        if (changes.length > 0) {
            embed = new EmbedBuilder()
                .setColor('#9932cc')
                .setTitle('Voice State Changed')
                .addFields(
                    { name: 'User', value: `${member.user.tag}`, inline: true },
                    { name: 'Channel', value: `${newState.channel.name}`, inline: true },
                    { name: 'Changes', value: changes.join('\n'), inline: false }
                )
                .setTimestamp();
        }
    }
    
    if (embed) logChannels.voice.send({ embeds: [embed] });
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!logChannels.role) return;
    
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    
    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
    
    if (addedRoles.size === 0 && removedRoles.size === 0) return;
    
    const userId = newMember.id;
    
    if (roleUpdateQueue.has(userId)) {
        const existing = roleUpdateQueue.get(userId);
        
        clearTimeout(existing.timeout);
        
        addedRoles.forEach(role => {
            if (!existing.newRoles.added.has(role.id)) {
                existing.newRoles.added.set(role.id, role);
            }
        });
        
        removedRoles.forEach(role => {
            if (!existing.newRoles.removed.has(role.id)) {
                existing.newRoles.removed.set(role.id, role);
            }
        });
        
        const timeout = setTimeout(() => {
            sendRoleUpdateLog(newMember, existing);
            roleUpdateQueue.delete(userId);
        }, 20000);
        
        existing.timeout = timeout;
        roleUpdateQueue.set(userId, existing);
        
    } else {
        const queueEntry = {
            timeout: null,
            oldRoles: new Map(oldRoles.filter(r => r.id !== newMember.guild.id)),
            newRoles: {
                added: new Map(addedRoles),
                removed: new Map(removedRoles)
            },
            timestamp: Date.now(),
            member: newMember
        };
        
        const timeout = setTimeout(() => {
            sendRoleUpdateLog(newMember, queueEntry);
            roleUpdateQueue.delete(userId);
        }, 20000);
        
        queueEntry.timeout = timeout;
        roleUpdateQueue.set(userId, queueEntry);
    }
});

async function sendRoleUpdateLog(member, queueEntry) {
    const { oldRoles, newRoles, timestamp } = queueEntry;
    const addedRoles = newRoles.added;
    const removedRoles = newRoles.removed;
    
    const currentRoles = new Map(oldRoles);
    addedRoles.forEach((role, id) => currentRoles.set(id, role));
    removedRoles.forEach((role, id) => currentRoles.delete(id));
    
    const embed = new EmbedBuilder()
        .setColor('#9932cc')
        .setTitle('Member Roles Updated')
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            { name: 'Member', value: `<@${member.id}>\n${member.user.tag} (${member.id})`, inline: true }, // Made clickable
            { name: 'Total Changes', value: `${addedRoles.size + removedRoles.size}`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        );
    
    try {
        const fetchedLogs = await member.guild.fetchAuditLogs({
            limit: 10,
            type: AuditLogEvent.MemberRoleUpdate
        });
        
        const relevantLogs = fetchedLogs.entries.filter(log => 
            log.target.id === member.id && 
            (Date.now() - log.createdTimestamp) < 25000
        );
        
        if (relevantLogs.size > 0) {
            const executors = new Set();
            const reasons = new Set();
            
            relevantLogs.forEach(log => {
                executors.add(`${log.executor.tag}`);
                if (log.reason) reasons.add(log.reason);
            });
            
            embed.addFields({
                name: '👤 Changed By',
                value: Array.from(executors).join(', '),
                inline: true
            });
            
            const firstLog = relevantLogs.first();
            embed.setThumbnail(firstLog.executor.displayAvatarURL());
            
            if (reasons.size > 0) {
                embed.addFields({
                    name: '📝 Reason(s)',
                    value: Array.from(reasons).join('\n'),
                    inline: true
                });
            }
            
            embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
        }
    } catch (error) {
        console.error('Error fetching role update logs:', error);
    }
    
    if (oldRoles.size > 0) {
        const rolesList = Array.from(oldRoles.values())
            .sort((a, b) => b.position - a.position)
            .map(r => r.name)
            .join(', ');
        
        embed.addFields({
            name: '🎭 Roles Before Changes',
            value: rolesList.slice(0, 1024) || 'None',
            inline: false
        });
    } else {
        embed.addFields({
            name: '🎭 Roles Before Changes',
            value: 'None',
            inline: false
        });
    }
    
    if (addedRoles.size > 0) {
        const addedList = Array.from(addedRoles.values())
            .sort((a, b) => b.position - a.position)
            .map(r => `${r.name}`)
            .join(', ');
        
        embed.addFields({
            name: `✅ Roles Added (${addedRoles.size})`,
            value: addedList.slice(0, 1024),
            inline: false
        });
    }
    
    if (removedRoles.size > 0) {
        const removedList = Array.from(removedRoles.values())
            .sort((a, b) => b.position - a.position)
            .map(r => `${r.name}`)
            .join(', ');
        
        embed.addFields({
            name: `❌ Roles Removed (${removedRoles.size})`,
            value: removedList.slice(0, 1024),
            inline: false
        });
    }
    
    if (currentRoles.size > 0) {
        const currentList = Array.from(currentRoles.values())
            .sort((a, b) => b.position - a.position)
            .map(r => r.name)
            .join(', ');
        
        embed.addFields({
            name: '🎭 Current Roles',
            value: currentList.slice(0, 1024),
            inline: false
        });
    } else {
        embed.addFields({
            name: '🎭 Current Roles',
            value: 'None',
            inline: false
        });
    }
    
    const memberInviteData = memberInvites.get(member.id);
    if (memberInviteData) {
        embed.addFields({
            name: '📋 Member Join Info',
            value: `Joined: <t:${Math.floor(memberInviteData.timestamp / 1000)}:R>\n` +
                   `Invite: \`${memberInviteData.code}\` by ${memberInviteData.inviter}\n` +
                   `Account Age: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
            inline: false
        });
    }
    
    const timeElapsed = Date.now() - timestamp;
    embed.addFields({
        name: '⏱️ Change Duration',
        value: `${(timeElapsed / 1000).toFixed(1)} seconds`,
        inline: true
    });
    
    embed.setTimestamp();
    embed.setFooter({ 
        text: `User ID: ${member.id}` 
    });
    
    try {
        await logChannels.role.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error sending role update log:', error);
    }
}

client.on('channelCreate', channel => {
    if (!logChannels.channel) return;
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('Channel Created')
        .addFields(
            { name: 'Name', value: channel.name, inline: true },
            { name: 'Type', value: ChannelType[channel.type], inline: true },
            { name: 'ID', value: channel.id, inline: true },
            { name: 'Category', value: channel.parent?.name || 'None', inline: true }
        )
        .setTimestamp();
    
    logChannels.channel.send({ embeds: [embed] });
});

client.on('channelDelete', channel => {
    if (!logChannels.channel) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Channel Deleted')
        .addFields(
            { name: 'Name', value: channel.name, inline: true },
            { name: 'Type', value: ChannelType[channel.type], inline: true },
            { name: 'ID', value: channel.id, inline: true },
            { name: 'Category', value: channel.parent?.name || 'None', inline: true }
        )
        .setTimestamp();
    
    logChannels.channel.send({ embeds: [embed] });
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (!logChannels.channel) return;
    
    const changes = [];
    
    if (oldChannel.name !== newChannel.name) {
        changes.push({
            field: 'Name',
            old: oldChannel.name,
            new: newChannel.name
        });
    }
    
    if (oldChannel.topic !== newChannel.topic) {
        changes.push({
            field: 'Topic',
            old: oldChannel.topic || 'None',
            new: newChannel.topic || 'None'
        });
    }
    
    if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push({
            field: 'NSFW',
            old: oldChannel.nsfw ? 'Yes' : 'No',
            new: newChannel.nsfw ? 'Yes' : 'No'
        });
    }
    
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push({
            field: 'Slowmode',
            old: `${oldChannel.rateLimitPerUser}s`,
            new: `${newChannel.rateLimitPerUser}s`
        });
    }
    
    if (oldChannel.bitrate !== newChannel.bitrate) {
        changes.push({
            field: 'Bitrate',
            old: `${oldChannel.bitrate / 1000}kbps`,
            new: `${newChannel.bitrate / 1000}kbps`
        });
    }
    
    if (oldChannel.userLimit !== newChannel.userLimit) {
        changes.push({
            field: 'User Limit',
            old: oldChannel.userLimit === 0 ? 'Unlimited' : oldChannel.userLimit.toString(),
            new: newChannel.userLimit === 0 ? 'Unlimited' : newChannel.userLimit.toString()
        });
    }
    
    if (oldChannel.parentId !== newChannel.parentId) {
        changes.push({
            field: 'Category',
            old: oldChannel.parent?.name || 'None',
            new: newChannel.parent?.name || 'None'
        });
    }
    
    if (oldChannel.position !== newChannel.position) {
        changes.push({
            field: 'Position',
            old: oldChannel.position.toString(),
            new: newChannel.position.toString()
        });
    }
    
    const oldPerms = oldChannel.permissionOverwrites?.cache;
    const newPerms = newChannel.permissionOverwrites?.cache;
    
    if (oldPerms && newPerms && oldPerms.size !== newPerms.size) {
        changes.push({
            field: 'Permission Overwrites',
            old: `${oldPerms.size} overwrite(s)`,
            new: `${newPerms.size} overwrite(s)`
        });
    }
    
    if (changes.length === 0) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ffa500')
        .setTitle('Channel Updated')
        .addFields(
            { name: 'Channel', value: `<#${newChannel.id}>`, inline: true },
            { name: 'Channel Type', value: ChannelType[newChannel.type] || 'Unknown', inline: true },
            { name: 'Channel ID', value: newChannel.id, inline: true }
        );
    
    try {
        const fetchedLogs = await newChannel.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.ChannelUpdate
        });
        const updateLog = fetchedLogs.entries.first();
        
        if (updateLog && updateLog.target.id === newChannel.id && (Date.now() - updateLog.createdTimestamp) < 5000) {
            embed.addFields({
                name: '👤 Changed By',
                value: `${updateLog.executor.tag} (${updateLog.executor.id})`,
                inline: true
            });
            
            embed.setThumbnail(updateLog.executor.displayAvatarURL());
            
            if (updateLog.reason) {
                embed.addFields({
                    name: '📝 Reason',
                    value: updateLog.reason,
                    inline: true
                });
            }
            
            embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
        }
    } catch (error) {
        console.error('Error fetching channel update logs:', error);
    }
    
    changes.forEach(change => {
        const oldValue = change.old.length > 1024 ? change.old.slice(0, 1021) + '...' : change.old;
        const newValue = change.new.length > 1024 ? change.new.slice(0, 1021) + '...' : change.new;
        
        embed.addFields({
            name: `🔄 ${change.field}`,
            value: `**Before:** ${oldValue}\n**After:** ${newValue}`,
            inline: false
        });
    });
    
    embed.addFields({
        name: '📊 Summary',
        value: `${changes.length} change(s) made to this channel`,
        inline: false
    });
    
    embed.setTimestamp();
    embed.setFooter({ 
        text: `Channel: ${newChannel.name}` 
    });
    
    logChannels.channel.send({ embeds: [embed] });
});

client.on('inviteCreate', invite => {
    if (!logChannels.invite) return;
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('Invite Created')
        .addFields(
            { name: 'Code', value: `\`${invite.code}\``, inline: true },
            { name: 'Channel', value: `<#${invite.channel.id}>`, inline: true },
            { name: 'Created By', value: invite.inviter?.tag || 'Unknown', inline: true },
            { name: 'Max Uses', value: invite.maxUses ? invite.maxUses.toString() : 'Unlimited', inline: true },
            { name: 'Expires', value: invite.expiresTimestamp ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : 'Never', inline: true },
            { name: 'Temporary', value: invite.temporary ? 'Yes' : 'No', inline: true }
        )
        .setTimestamp();
    
    logChannels.invite.send({ embeds: [embed] });
});

client.on('inviteDelete', invite => {
    if (!logChannels.invite) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Invite Deleted')
        .addFields(
            { name: 'Code', value: `\`${invite.code}\``, inline: true },
            { name: 'Channel', value: `<#${invite.channel?.id}>` || 'Unknown', inline: true },
            { name: 'Created By', value: invite.inviter?.tag || 'Unknown', inline: true }
        )
        .setTimestamp();
    
    logChannels.invite.send({ embeds: [embed] });
});

client.on('guildBanAdd', async ban => {
    if (!logChannels.moderation) return;
    
    const embed = new EmbedBuilder()
        .setColor('#8b0000')
        .setTitle('Member Banned')
        .setThumbnail(ban.user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `<@${ban.user.id}>\n${ban.user.tag} (${ban.user.id})`, inline: true }, // Made clickable
            { name: 'Account Created', value: `<t:${Math.floor(ban.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        );
    
    // Try to DM the banned user with appeal form
    try {
        await ban.user.send({
            embeds: [new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('⚠️ You have been banned')
                .setDescription(`You were banned from **${ban.guild.name}**.`)
                .addFields(
                    { 
                        name: '📋 Appeal Your Ban', 
                        value: 'If you believe this ban was unjustified, you can submit an appeal:\n[Click here to submit an appeal form](https://docs.google.com/forms/d/e/1FAIpQLSe8xo6UfTjTGCuc-1VxWx1s-bnGIhUuRDLUNFxWmC7uzUZATw/viewform?usp=dialog)', 
                        inline: false 
                    }
                )
                .setTimestamp()
            ]
        });
        console.log(`✅ Sent ban appeal form to ${ban.user.tag}`);
    } catch (error) {
        console.log(`❌ Could not DM ${ban.user.tag} about their ban (DMs may be closed)`);
    }
    
    try {
        const fetchedLogs = await ban.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberBanAdd
        });
        const banLog = fetchedLogs.entries.first();
        
        if (banLog && banLog.target.id === ban.user.id) {
            embed.addFields({
                name: 'Banned By',
                value: `<@${banLog.executor.id}>\n${banLog.executor.tag}`, // Made clickable
                inline: true
            });
            
            if (banLog.reason) {
                embed.addFields({
                    name: 'Reason',
                    value: banLog.reason,
                    inline: true
                });
            } else {
                embed.addFields({
                    name: 'Reason',
                    value: 'No reason provided',
                    inline: true
                });
            }
            
            embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
        }
    } catch (error) {
        console.error('Error fetching ban logs:', error);
    }
    
    const memberInviteData = memberInvites.get(ban.user.id);
    if (memberInviteData) {
        const joinedAt = memberInviteData.timestamp;
        const timeInServer = Date.now() - joinedAt;
        const days = Math.floor(timeInServer / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeInServer % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        
        embed.addFields(
            { name: 'Joined Server', value: `<t:${Math.floor(joinedAt / 1000)}:R>`, inline: true },
            { name: 'Time in Server', value: `${days}d ${hours}h`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        );
        
        embed.addFields({
            name: 'Invite Used',
            value: `Code: \`${memberInviteData.code}\`\nCreated by: ${memberInviteData.inviter}\nUses: ${memberInviteData.uses}/${memberInviteData.maxUses || '∞'}`,
            inline: false
        });
    }
    
    embed.setTimestamp();
    
    logChannels.moderation.send({ embeds: [embed] });
});

client.on('guildBanRemove', async ban => {
    if (!logChannels.moderation) return;
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('Member Unbanned')
        .setThumbnail(ban.user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `<@${ban.user.id}>\n${ban.user.tag} (${ban.user.id})`, inline: true }, // Made clickable
            { name: 'Account Created', value: `<t:${Math.floor(ban.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        );
    
    try {
        const fetchedLogs = await ban.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberBanRemove
        });
        const unbanLog = fetchedLogs.entries.first();
        
        if (unbanLog && unbanLog.target.id === ban.user.id && (Date.now() - unbanLog.createdTimestamp) < 5000) {
            embed.addFields({
                name: 'Unbanned By',
                value: `<@${unbanLog.executor.id}>\n${unbanLog.executor.tag}`, // Made clickable
                inline: true
            });
            
            if (unbanLog.reason) {
                embed.addFields({
                    name: 'Reason',
                    value: unbanLog.reason,
                    inline: true
                });
            }
        }
    } catch (error) {
        console.error('Error fetching unban logs:', error);
    }
    
    const memberInviteData = memberInvites.get(ban.user.id);
    if (memberInviteData) {
        embed.addFields({
            name: '📋 Original Join Info',
            value: `Joined: <t:${Math.floor(memberInviteData.timestamp / 1000)}:F>\n` +
                   `Invite: \`${memberInviteData.code}\` by ${memberInviteData.inviter}`,
            inline: false
        });
    }
    
    embed.addFields({
        name: 'ℹ️ Note',
        value: 'If this user rejoins, they can be tracked through a new invite',
        inline: false
    });
    
    embed.setTimestamp();
    
    logChannels.moderation.send({ embeds: [embed] });
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', () => {
    console.log('Clearing role update queue...');
    roleUpdateQueue.forEach(entry => clearTimeout(entry.timeout));
    roleUpdateQueue.clear();
    
    console.log('Saving data before shutdown...');
    saveMemberInvites();
    console.log('Data saved. Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Clearing role update queue...');
    roleUpdateQueue.forEach(entry => clearTimeout(entry.timeout));
    roleUpdateQueue.clear();
    
    console.log('Saving data before shutdown...');
    saveMemberInvites();
    console.log('Data saved. Shutting down...');
    process.exit(0);
});


// Enhanced shutdown handlers with Discord notification
async function sendShutdownNotification(reason) {
    if (config.startupNotification?.enabled && config.startupNotification?.channelId) {
        try {
            const notificationChannel = client.channels.cache.get(config.startupNotification.channelId);
            if (notificationChannel) {
                const shutdownEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🔴 Bot Shutting Down')
                    .setDescription(`**${client.user.tag}** is going offline`)
                    .addFields(
                        { name: '⏰ Shutdown Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                        { name: '📊 Reason', value: reason, inline: true },
                        { name: '⏱️ Uptime', value: `${Math.floor(client.uptime / 1000 / 60)} minutes`, inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'System Status' });
                
                await notificationChannel.send({ embeds: [shutdownEmbed] });
                console.log('✅ Shutdown notification sent to Discord');
            }
        } catch (error) {
            console.error('❌ Error sending shutdown notification:', error);
        }
    }
}

process.on('SIGINT', async () => {
    console.log('Clearing role update queue...');
    roleUpdateQueue.forEach(entry => clearTimeout(entry.timeout));
    roleUpdateQueue.clear();
    
    console.log('Saving data before shutdown...');
    saveMemberInvites();
    
    await sendShutdownNotification('Manual shutdown (SIGINT)');
    
    console.log('Data saved. Shutting down...');
    setTimeout(() => process.exit(0), 2000); // Give time for Discord message to send
});

process.on('SIGTERM', async () => {
    console.log('Clearing role update queue...');
    roleUpdateQueue.forEach(entry => clearTimeout(entry.timeout));
    roleUpdateQueue.clear();
    
    console.log('Saving data before shutdown...');
    saveMemberInvites();
    
    await sendShutdownNotification('Process terminated (SIGTERM)');
    
    console.log('Data saved. Shutting down...');
    setTimeout(() => process.exit(0), 2000);
});

// Button interaction handler for spam review
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    const [action, userId] = interaction.customId.split('_');
    
    if (action === 'ban' || action === 'ignore') {
        try {
            // Defer the reply since banning might take a moment
            await interaction.deferReply({ ephemeral: true });
            
            const targetUser = await client.users.fetch(userId).catch(() => null);
            const guild = interaction.guild;
            const member = await guild.members.fetch(userId).catch(() => null);
            
            // Get original embed
            const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
            
            if (action === 'ban') {
                // BAN THE USER
                if (!member) {
                    await interaction.editReply({
                        content: '❌ User is no longer in the server. Cannot ban.',
                    });
                    return;
                }
                
                try {
                    // Try to DM them before banning
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
                    
                    // BAN
                    await member.ban({
                        reason: `Confirmed spam by ${interaction.user.tag} - Cross-channel posting`,
                        deleteMessageSeconds: 60 * 60 * 24 // Delete last 24h of messages
                    });
                    
                    originalEmbed.setColor('#8b0000');
                    originalEmbed.setTitle('🔨 Spam Review - USER BANNED');
                    
                    // Update the action required field
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
                
            } else if (action === 'ignore') {
                // NOT SPAM - Clear and notify
                originalEmbed.setColor('#00ff00');
                originalEmbed.setTitle('✅ Spam Review - Not Spam');
                
                // Update the action required field
                const actionFieldIndex = originalEmbed.data.fields.findIndex(f => f.name === '⚠️ Action Required');
                if (actionFieldIndex !== -1) {
                    originalEmbed.data.fields[actionFieldIndex] = {
                        name: '✅ Resolution',
                        value: `Reviewed by ${interaction.user.tag}\n**Action: Cleared - Not spam**\nUser has been notified.`,
                        inline: false
                    };
                }
                
                originalEmbed.setFooter({ 
                    text: `Cleared by ${interaction.user.tag} (${interaction.user.id}) at ${new Date().toLocaleString()}` 
                });
                originalEmbed.setTimestamp();
                
                // Notify the user
                if (targetUser) {
                    try {
                        await targetUser.send({
                            embeds: [new EmbedBuilder()
                                .setColor('#00ff00')
                                .setTitle('✅ Spam Review Complete')
                                .setDescription(`Your messages in **${guild.name}** have been reviewed by a moderator.`)
                                .addFields(
                                    { name: 'Result', value: 'Not spam - False positive', inline: false },
                                    { name: 'Reviewed By', value: interaction.user.tag, inline: false },
                                    { name: 'Status', value: 'Your account is in good standing', inline: false }
                                )
                                .addFields({
                                    name: '💡 Note',
                                    value: 'While your content wasn\'t spam, please avoid posting the same content in multiple channels to prevent future automatic removals.',
                                    inline: false
                                })
                                .setTimestamp()
                            ]
                        });
                    } catch (error) {
                        console.log(`Could not DM ${targetUser.tag} about review`);
                    }
                }
                
                await interaction.editReply({
                    content: `✅ Marked as **not spam** by ${interaction.user}. User has been notified.`,
                });
            }
            
            // Update the message with new embed and remove buttons
            await interaction.message.edit({
                content: `~~<@&645744514576809984> Cross-channel spam detected - requires review~~ **RESOLVED**`,
                embeds: [originalEmbed],
                components: [] // Remove buttons after action is taken
            });
            
        } catch (error) {
            console.error('Error handling spam review button:', error);
            await interaction.editReply({
                content: `❌ Error processing action: ${error.message}`,
            });
        }
    }
});

client.login(config.token);