const { Client, GatewayIntentBits, EmbedBuilder, AuditLogEvent, ChannelType, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');
const config = require('./config.json');

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

// Create command handler AFTER client
const CommandHandler = require('./commands');
const commandHandler = new CommandHandler(client, config);

// Store log channels
const logChannels = {};

// Store server invites
const serverInvites = new Map();

// Store member invites
const memberInvites = new Map();
const memberInvitesFile = 'member-invites.json';

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
    CROSS_CHANNEL_TIME: config.antiSpam?.crossChannelTime || 15000,
    MUTE_DURATION: config.antiSpam?.muteDuration || 3600000,
    DELETE_THRESHOLD: config.antiSpam?.deleteThreshold || 10,
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
    
    // Check for cross-channel posting (same content in 2+ channels)
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
    if (userData.muted) {
        console.log(`User ${message.author.tag} already muted, skipping`);
        return;
    }
    
    try {
        // IMMEDIATELY MUTE THE USER
        let mutedRole = message.guild.roles.cache.find(r => r.name === 'Muted');
        
        if (!mutedRole) {
            console.log('Creating Muted role...');
            mutedRole = await message.guild.roles.create({
                name: 'Muted',
                color: '#808080',
                permissions: [],
                reason: 'Auto-spam protection'
            });
            
            // Set permissions for all channels
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
        
        // Apply mute
        await member.roles.add(mutedRole);
        userData.muted = true;
        console.log(`🔇 Muted ${message.author.tag}`);
        
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
                value: '<@&1425260355420160100> Please review: **Ban** or **Unmute**?',
                inline: false
            });
            
            embed.setTimestamp();
            embed.setFooter({ text: 'Auto-moderation: User muted, awaiting review' });
            
            // Create action buttons
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
            
            // Send with ping
            await logChannels.moderation.send({
                content: `<@&1425260355420160100> Cross-channel spam detected - User has been **muted**. Please review:`,
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
                    const urlList = attachmentUrls.map(att => 
                        `${att.name}: ${att.url}`
                    ).join('\n');
                    
                    await logChannels.moderation.send({
                        content: `⚠️ Could not re-upload files, here are the original URLs:\n\`\`\`${urlList.slice(0, 1900)}\`\`\``
                    });
                }
            } else if (attachmentUrls.length > 0) {
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
    
    // Count total users across all servers
    let totalUsers = 0;
    client.guilds.cache.forEach(guild => {
        totalUsers += guild.memberCount;
    });
    console.log(`👥 Total Users: ${totalUsers.toLocaleString()}`);
    console.log(`⚙️ Node Version: ${process.version}`);
    console.log(`📦 Discord.js Version: ${require('discord.js').version}`);
    console.log('='.repeat(50));
    
    // Load member invites
    loadMemberInvites();
    
    // Get log channels
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
    
    // 🆕 LINK LOG CHANNELS TO COMMAND HANDLER
    commandHandler.setLogChannels(logChannels);
    
    // Cache invites for all guilds
    console.log('\n🔗 Caching invites...');
    for (const guild of client.guilds.cache.values()) {
        const invites = await guild.invites.fetch();
        serverInvites.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses])));
        console.log(`  ✓ ${guild.name}: ${invites.size} invites`);
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Bot is ready and monitoring!');
    console.log('='.repeat(50) + '\n');
    
    // Send startup notification if enabled
    if (config.startupNotification && config.startupNotification.enabled) {
        const notifChannel = await client.channels.fetch(config.startupNotification.channelId).catch(() => null);
        if (notifChannel) {
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
                .setThumbnail(client.user.displayAvatarURL())
                .setTimestamp()
                .setFooter({ text: 'System Status' });
            
            await notifChannel.send({ embeds: [embed] });
            console.log(`✓ Startup notification sent to #${notifChannel.name}\n`);
        }
    }
});

// Message Create Event
client.on('messageCreate', async message => {
    // ===== COMMAND HANDLER - MUST BE FIRST =====
    if (!message.author.bot && message.guild) {
        await commandHandler.handleCommand(message);
    }
    
    // ===== EXISTING CODE BELOW =====
    if (message.author.bot) return;
    if (!message.guild) return;

    // Log attachments to dedicated channel (batched)
    if (message.attachments.size > 0 && logChannels.attachments) {
        const userId = message.author.id;
        
        // Check if we already have pending attachments for this user
        if (!pendingAttachments.has(userId)) {
            pendingAttachments.set(userId, {
                messages: [],
                timeout: null
            });
        }
        
        const userAttachments = pendingAttachments.get(userId);
        
        // Add this message's attachments to the pending list
        userAttachments.messages.push({
            message: message,
            timestamp: Date.now()
        });
        
        // Clear existing timeout if there is one
        if (userAttachments.timeout) {
            clearTimeout(userAttachments.timeout);
        }
        
        // Set new timeout to batch attachments
        userAttachments.timeout = setTimeout(async () => {
            try {
                const attachmentData = pendingAttachments.get(userId);
                if (!attachmentData || attachmentData.messages.length === 0) {
                    pendingAttachments.delete(userId);
                    return;
                }
                
                // Collect all attachments from all messages
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
                
                // Create batched embed
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
                        `**Total Size:** ${(totalSize / 1024 / 1024).toFixed(2)} MB`
                    )
                    .setTimestamp(attachmentData.messages[0].timestamp);
                
                // Add file details
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
                
                // Set thumbnail to first image if available
                const firstImage = allAttachments.find(attData => 
                    attData.attachment.contentType?.startsWith('image/')
                );
                if (firstImage) {
                    embed.setThumbnail(firstImage.attachment.url);
                }
                
                // Add account age warning if needed
                const accountAge = Date.now() - firstMsg.author.createdTimestamp;
                if (accountAge < 604800000) { // 7 days
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
                
                // Send the batched log
                await logChannels.attachments.send({ embeds: [embed] });
                
                // If there are images, send them in a follow-up message (up to 10)
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
                        // If sending fails, just send the URLs
                        const urlList = images.map((attData, i) => `${i + 1}. [${attData.attachment.name}](${attData.attachment.url})`
                        ).join('\n');
                        await logChannels.attachments.send({
                            content: `**Images from ${firstMsg.author.tag}** (URLs):\n${urlList}`
                        });
                    }
                }
                
                // Clean up
                pendingAttachments.delete(userId);
                
            } catch (error) {
                console.error('Error logging batched attachments:', error);
                pendingAttachments.delete(userId);
            }
        }, 3000); // 3 second delay to batch multiple uploads
    }

    // Check for spam if anti-spam is enabled
    if (config.antiSpam && config.antiSpam.enabled) {
        // Skip exempt roles
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
            // Check if we've already reported this user recently (prevent duplicate embeds)
            const userId = message.author.id;
            const lastReport = spamReportCooldown.get(userId);
            const now = Date.now();
            
            if (!lastReport || (now - lastReport) > 30000) { // 30 second cooldown between reports
                console.log(`🚨 Spam detected from ${message.author.tag}: ${spamData.reason}`);
                spamReportCooldown.set(userId, now);
                
                // Wait a moment to collect all messages before processing
                setTimeout(async () => {
                    await handleSpammer(message, spamData);
                    spamReportCooldown.delete(userId); // Clear cooldown after handling
                }, 2000); // 2 second delay to collect all spam messages
            } else {
                console.log(`⏳ Spam cooldown active for ${message.author.tag}, skipping duplicate report`);
            }
        }
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
                        deleteMessageSeconds: 60 * 60 * 24
                    });
                    
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
                // UNMUTE - Not spam
                if (!member) {
                    await interaction.editReply({
                        content: '❌ User is no longer in the server.',
                    });
                    return;
                }
                
                try {
                    // Remove mute role
                    const mutedRole = guild.roles.cache.find(r => r.name === 'Muted');
                    if (mutedRole && member.roles.cache.has(mutedRole.id)) {
                        await member.roles.remove(mutedRole);
                        console.log(`🔊 Unmuted ${member.user.tag}`);
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
                    
                    // Notify the user
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
            
            // Update the message
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

// Member Join Event
client.on('guildMemberAdd', async member => {
    if (!logChannels.member) return;
    
    try {
        // Get current invites
        const newInvites = await member.guild.invites.fetch();
        const oldInvites = serverInvites.get(member.guild.id);
        
        // Find which invite was used
        let usedInvite = null;
        for (const [code, uses] of newInvites) {
            const oldUses = oldInvites?.get(code) || 0;
            if (uses > oldUses) {
                usedInvite = newInvites.get(code);
                break;
            }
        }
        
        // Update stored invites
        serverInvites.set(member.guild.id, new Map(newInvites.map(invite => [invite.code, invite.uses])));
        
        // Store member invite data
        if (usedInvite) {
            memberInvites.set(member.id, {
                code: usedInvite.code,
                inviter: usedInvite.inviter?.username || 'Unknown',
                inviterId: usedInvite.inviter?.id || 'Unknown',
                uses: usedInvite.uses,
                maxUses: usedInvite.maxUses,
                timestamp: Date.now(),
                guildId: member.guild.id
            });
            saveMemberInvites();
        }
        
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Member Joined')
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'User', value: `${member.user.tag}\n<@${member.id}>`, inline: true },
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Member Count', value: member.guild.memberCount.toString(), inline: true }
            );
        
        if (usedInvite) {
            embed.addFields({
                name: 'Invited By',
                value: `${usedInvite.inviter?.tag || 'Unknown'}\nCode: \`${usedInvite.code}\`\nUses: ${usedInvite.uses}${usedInvite.maxUses ? `/${usedInvite.maxUses}` : ''}`,
                inline: false
            });
        }
        
        embed.setTimestamp();
        embed.setFooter({ text: `ID: ${member.id}` });
        
        await logChannels.member.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error logging member join:', error);
    }
});

// Member Leave Event
client.on('guildMemberRemove', async member => {
    if (!logChannels.member) return;
    
    try {
        const memberInviteData = memberInvites.get(member.id);
        
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Member Left')
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

// Message Delete Event
client.on('messageDelete', async message => {
    if (!logChannels.message) return;
    if (message.author?.bot) return;
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#ff6b6b')
            .setTitle('Message Deleted')
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
            const attachmentList = message.attachments.map(a => a.name).join(', ');
            embed.addFields({
                name: 'Attachments',
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
            .setTitle('Bulk Message Delete')
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
        const embed = new EmbedBuilder()
            .setColor('#ffd93d')
            .setTitle('Message Edited')
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
        // User joined a voice channel
        if (!oldState.channel && newState.channel) {
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🔊 Joined Voice Channel')
                .addFields(
                    { name: 'User', value: `${newState.member.user.tag}\n<@${newState.member.id}>`, inline: true },
                    { name: 'Channel', value: newState.channel.name, inline: true }
                )
                .setTimestamp();
            
            await logChannels.voice.send({ embeds: [embed] });
        }
        
        // User left a voice channel
        else if (oldState.channel && !newState.channel) {
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🔇 Left Voice Channel')
                .addFields(
                    { name: 'User', value: `${oldState.member.user.tag}\n<@${oldState.member.id}>`, inline: true },
                    { name: 'Channel', value: oldState.channel.name, inline: true }
                )
                .setTimestamp();
            
            await logChannels.voice.send({ embeds: [embed] });
        }
        
        // User switched voice channels
        else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
            const embed = new EmbedBuilder()
                .setColor('#ffd93d')
                .setTitle('↔️ Switched Voice Channel')
                .addFields(
                    { name: 'User', value: `${newState.member.user.tag}\n<@${newState.member.id}>`, inline: true },
                    { name: 'From', value: oldState.channel.name, inline: true },
                    { name: 'To', value: newState.channel.name, inline: true }
                )
                .setTimestamp();
            
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
        
        // Check for added roles
        const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
        if (addedRoles.size > 0) {
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('Role Added')
                .addFields(
                    { name: 'User', value: `${newMember.user.tag}\n<@${newMember.id}>`, inline: true },
                    { name: 'Roles Added', value: addedRoles.map(r => r.name).join(', '), inline: true }
                )
                .setTimestamp();
            
            await logChannels.role.send({ embeds: [embed] });
        }
        
        // Check for removed roles
        const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
        if (removedRoles.size > 0) {
            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('Role Removed')
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
            .setTitle('Channel Created')
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
            .setTitle('Channel Deleted')
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
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Member Unbanned')
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
        // Update cached invites
        const guildInvites = serverInvites.get(invite.guild.id) || new Map();
        guildInvites.set(invite.code, invite.uses || 0);
        serverInvites.set(invite.guild.id, guildInvites);
        
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('Invite Created')
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
        // Update cached invites
        const guildInvites = serverInvites.get(invite.guild.id);
        if (guildInvites) {
            guildInvites.delete(invite.code);
        }
        
        const embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Invite Deleted')
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

client.login(config.token);