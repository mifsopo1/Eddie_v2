const { Client, GatewayIntentBits, EmbedBuilder, AuditLogEvent, ChannelType } = require('discord.js');
const config = require('./config.json');
const SteamSaleMonitor = require('./steamSaleMonitor');
const ClaudeTokenTracker = require('./claudeTokenTracker');
const fs = require('fs');

// Global variables
const roleUpdateQueue = new Map(); // userId -> { timeout, oldRoles, newRoles, timestamp }

// ADD THE RATE LIMITING HERE:
const MESSAGE_RATE_LIMIT = 5; // messages per interval
const RATE_LIMIT_INTERVAL = 10000; // 10 seconds
const userMessageTimestamps = new Map(); // userId -> array of timestamps

function checkRateLimit(userId) {
    const now = Date.now();
    const timestamps = userMessageTimestamps.get(userId) || [];
    
    // Remove timestamps older than the interval
    const recentTimestamps = timestamps.filter(time => now - time < RATE_LIMIT_INTERVAL);
    
    if (recentTimestamps.length >= MESSAGE_RATE_LIMIT) {
        return false; // Rate limited
    }
    
    // Add current timestamp
    recentTimestamps.push(now);
    userMessageTimestamps.set(userId, recentTimestamps);
    return true; // Not rate limited
}

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
            { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
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
            { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
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
            { name: 'Author', value: message.author ? `${message.author.tag} (${message.author.id})` : 'Unknown', inline: true },
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
    // Handle attachment logging for ALL messages (including bots)
    if (message.attachments.size > 0 || message.embeds.length > 0 || message.stickers.size > 0) {
        // Don't log messages from these bots (prevents infinite loop)
        const excludedBots = ['1422775949505724477', '1418807658307129505', '1414884959042146324'];
        if (excludedBots.includes(message.author.id)) return;
        
        const attachmentChannel = logChannels.attachments;
        if (attachmentChannel) {
            const embed = new EmbedBuilder()
                .setColor(message.author.bot ? '#ff6b6b' : '#3498db')// Red for bots
                .setTitle(message.author.bot ? '🤖 Bot Attachment/Media' : '📎 New Attachment/Media')
                .setAuthor({
                    name: `${message.author.tag}${message.author.bot ? ' [BOT]' : ''}`,
                    iconURL: message.author.displayAvatarURL()
                })
                .addFields(
                    { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
                    { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                    { name: 'Message', value: `[Jump to Message](${message.url})`, inline: true }
                );
            
            // Add bot warning if it's a bot account
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
                text: `Message ID: ${message.id}`
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
    
// Continue with command handling (keep the bot check here)
if (message.author.bot) return;

// ========== RATE LIMITING (NEW) ==========
const isAdmin = message.member?.permissions.has('Administrator');
const bypassRoleIds = ['623527426630221858', '803634927496986625', '1414893215726960640', '645744514576809984', '676494810995228684', '700870935124901988', '676507746706784286'];
const hasBypassRole = message.member?.roles.cache.some(role => bypassRoleIds.includes(role.id));

if (!isAdmin && !hasBypassRole && !checkRateLimit(message.author.id)) {
    // User is rate limited - silently ignore
    return;
}
    // ========== END RATE LIMITING ==========
    
    if (message.content === '!test' && isAdmin) {
        await message.reply('Bot is working and you have admin!');
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
                
                // Calculate costs
                const inputCost = (todayUsage.input / 1000000) * 3.00;
                const outputCost = (todayUsage.output / 1000000) * 15.00;
                const totalCost = inputCost + outputCost;
                
                // Get recent conversations (last 5)
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
                
                // Lifetime stats
                embed.addFields({
                    name: '🌍 Lifetime Total',
                    value: `**${data.totalTokens.toLocaleString()}** tokens across all time\n` +
                           `**${data.conversations.length}** total conversations logged`,
                    inline: false
                });
                
                // Add usage warnings
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
    
    // Check if user already has a pending update
    if (roleUpdateQueue.has(userId)) {
        const existing = roleUpdateQueue.get(userId);
        
        // Clear the existing timeout
        clearTimeout(existing.timeout);
        
        // Update the roles (merge new changes)
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
        
        // Set new timeout
        const timeout = setTimeout(() => {
            sendRoleUpdateLog(newMember, existing);
            roleUpdateQueue.delete(userId);
        }, 20000); // 20 seconds
        
        existing.timeout = timeout;
        roleUpdateQueue.set(userId, existing);
        
    } else {
        // Create new queue entry
        const queueEntry = {
            timeout: null,
            oldRoles: new Map(oldRoles.filter(r => r.id !== newMember.guild.id)), // Exclude @everyone
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
        }, 20000); // 20 seconds
        
        queueEntry.timeout = timeout;
        roleUpdateQueue.set(userId, queueEntry);
    }
});

async function sendRoleUpdateLog(member, queueEntry) {
    const { oldRoles, newRoles, timestamp } = queueEntry;
    const addedRoles = newRoles.added;
    const removedRoles = newRoles.removed;
    
    // Calculate current roles (old roles + added - removed)
    const currentRoles = new Map(oldRoles);
    addedRoles.forEach((role, id) => currentRoles.set(id, role));
    removedRoles.forEach((role, id) => currentRoles.delete(id));
    
    const embed = new EmbedBuilder()
        .setColor('#9932cc')
        .setTitle('Member Roles Updated')
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            { name: 'Member', value: `${member.user.tag} (${member.id})`, inline: true },
            { name: 'Total Changes', value: `${addedRoles.size + removedRoles.size}`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        );
    
    // Try to fetch who made the changes
    try {
        const fetchedLogs = await member.guild.fetchAuditLogs({
            limit: 10, // Get more logs since there might be multiple role changes
            type: AuditLogEvent.MemberRoleUpdate
        });
        
        // Find all role updates for this user in the last 25 seconds
        const relevantLogs = fetchedLogs.entries.filter(log => 
            log.target.id === member.id && 
            (Date.now() - log.createdTimestamp) < 25000
        );
        
        if (relevantLogs.size > 0) {
            // Get unique executors
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
            
            // Set thumbnail to first executor
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
    
    // Show roles BEFORE changes
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
    
    // Show added roles
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
    
    // Show removed roles
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
    
    // Show current roles AFTER changes
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
    
    // Add member join info if available
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
    
    // Add time range for changes
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
    
    // Track all possible changes
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
    
    // Check for permission overwrites changes
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
    
    // Fetch audit logs to see who made the change
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
            
            // Add extra spacing field for alignment
            embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
        }
    } catch (error) {
        console.error('Error fetching channel update logs:', error);
    }
    
    // Add all changes as separate fields
    changes.forEach(change => {
        // Handle long values (like topics)
        const oldValue = change.old.length > 1024 ? change.old.slice(0, 1021) + '...' : change.old;
        const newValue = change.new.length > 1024 ? change.new.slice(0, 1021) + '...' : change.new;
        
        embed.addFields({
            name: `🔄 ${change.field}`,
            value: `**Before:** ${oldValue}\n**After:** ${newValue}`,
            inline: false
        });
    });
    
    // Add summary at the bottom
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
            { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
            { name: 'Account Created', value: `<t:${Math.floor(ban.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }
        );
    
    try {
        const fetchedLogs = await ban.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberBanAdd
        });
        const banLog = fetchedLogs.entries.first();
        
        if (banLog && banLog.target.id === ban.user.id) {
            embed.addFields({
                name: 'Banned By',
                value: `${banLog.executor.tag}`,
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
            { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: true },
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
                value: unbanLog.executor.tag,
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



client.login(config.token);