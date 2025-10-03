const { Client, GatewayIntentBits, EmbedBuilder, AuditLogEvent, ChannelType } = require('discord.js');
const config = require('./config.json');
const SteamSaleMonitor = require('./steamSaleMonitor');
const fs = require('fs');
const ClaudeTokenTracker = require('./claudeTokenTracker');

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

// ===== STORAGE MAPS =====
const invites = new Map();
const memberInvites = new Map();

// ===== LOG CHANNELS =====
const logChannels = {
    member: null,
    message: null,
    voice: null,
    role: null,
    channel: null,
    invite: null,
    moderation: null
};

let claudeTracker;
let saleMonitor;
if (config.claudeWebhook) {
    claudeTracker = new ClaudeTokenTracker(client, config.claudeWebhook);
    console.log('✅ Claude token tracker initialized');
} else {
    console.log('⚠️ Claude tracking disabled - no claudeWebhook in config');
}
```

**In the commands section (inside `messageCreate` event):**
```javascript
if (message.content === '!tokenusage' && isAdmin) {
    if (claudeTracker) {
        await claudeTracker.handleTokenUsageCommand(message);
    } else {
        await message.reply('❌ Claude token tracker not initialized!');
    }
}
// ===== HELPER FUNCTIONS =====
function loadMemberInvites() {
    try {
        if (fs.existsSync('member-invites.json')) {
            const data = JSON.parse(fs.readFileSync('member-invites.json', 'utf8'));
            Object.entries(data).forEach(([userId, inviteData]) => {
                memberInvites.set(userId, inviteData);
            });
            console.log(`✅ Loaded ${memberInvites.size} member invite records`);
        }
    } catch (error) {
        console.error('❌ Error loading member-invites.json:', error);
    }
}

function saveMemberInvites() {
    try {
        const data = Object.fromEntries(memberInvites);
        fs.writeFileSync('member-invites.json', JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ Error saving member-invites.json:', error);
    }
}

// ===== BOT READY =====
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    
    loadMemberInvites();
    
    const statuses = [
        { name: '📷 the streets', type: 3 },
        { name: '👨 customers', type: 2 },
        { name: '💊drug deals 💊', type: 3 },
        { name: 'the competition 👀', type: 5 }
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
                console.log(`✅ ${key} logs → #${channel.name}`);
            }
        }
    }
    
    client.guilds.cache.forEach(async (guild) => {
        try {
            const guildInvites = await guild.invites.fetch();
            invites.set(guild.id, new Map(guildInvites.map(invite => [invite.code, invite.uses])));
            console.log(`✅ Cached ${guildInvites.size} invites for ${guild.name}`);
        } catch (error) {
            console.log(`⚠️ Couldn't fetch invites for ${guild.name}`);
        }
    });

    if (config.saleChannelId) {
        saleMonitor = new SteamSaleMonitor(client, config);
        await saleMonitor.start();
    } else {
        console.log('⚠️ Sale monitoring disabled - no saleChannelId in config');
    }
});

// ===== MEMBER JOIN =====
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
                        console.log(`✅ Auto-assigned ${role.name} to ${member.user.tag}`);
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
        .setTitle('👋 Member Joined')
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
                name: '🎫 Invite Used',
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

// ===== MEMBER LEAVE =====
client.on('guildMemberRemove', async (member) => {
    if (!logChannels.member) return;
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('👋 Member Left')
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
            embed.setTitle('🔨 Member Kicked');
        }
        
        const banLogs = await member.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberBanAdd
        });
        const banLog = banLogs.entries.first();
        
        if (banLog && banLog.target.id === member.id && (Date.now() - banLog.createdTimestamp) < 5000) {
            wasBanned = true;
            embed.setColor('#8b0000');
            embed.setTitle('🔨 Member Banned');
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
            name: '👤 Roles',
            value: userRoles.map(r => r.name).join(', '),
            inline: false
        });
    }
    
    const memberInviteData = memberInvites.get(member.id);
    if (memberInviteData) {
        embed.addFields({
            name: '🎫 Invite Used',
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
                    name: '🔨 Kicked By',
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
                    name: '🔨 Banned By',
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

// ===== MESSAGE EDIT =====
client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!logChannels.message || newMessage.author.bot || !oldMessage.content || !newMessage.content) return;
    if (oldMessage.content === newMessage.content) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ffa500')
        .setTitle('✏️ Message Edited')
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

// ===== MESSAGE DELETE =====
client.on('messageDelete', async (message) => {
    if (!logChannels.message || message.author?.bot) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('🗑️ Message Deleted')
        .addFields(
            { name: 'Author', value: message.author ? `${message.author.tag} (${message.author.id})` : 'Unknown', inline: true },
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Content', value: message.content?.slice(0, 1024) || 'No text content', inline: false }
        )
        .setTimestamp();
    
    if (message.attachments.size > 0) {
        embed.addFields({
            name: '📎 Attachments',
            value: message.attachments.map(a => `[${a.name}](${a.url})`).join('\n'),
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
                name: '🔨 Deleted By',
                value: deletionLog.executor.tag,
                inline: true
            });
        }
    } catch (error) {
        console.error('Error fetching deletion logs:', error);
    }
    
    logChannels.message.send({ embeds: [embed] });
});

// ===== VOICE STATE UPDATE =====
client.on('voiceStateUpdate', (oldState, newState) => {
    if (!logChannels.voice) return;
    
    const member = newState.member;
    let embed = null;
    
    if (!oldState.channel && newState.channel) {
        embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🔊 Joined Voice Channel')
            .addFields(
                { name: 'User', value: `${member.user.tag}`, inline: true },
                { name: 'Channel', value: `${newState.channel.name}`, inline: true }
            )
            .setTimestamp();
    }
    else if (oldState.channel && !newState.channel) {
        embed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('🔇 Left Voice Channel')
            .addFields(
                { name: 'User', value: `${member.user.tag}`, inline: true },
                { name: 'Channel', value: `${oldState.channel.name}`, inline: true }
            )
            .setTimestamp();
    }
    else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🔄 Switched Voice Channel')
            .addFields(
                { name: 'User', value: `${member.user.tag}`, inline: true },
                { name: 'From', value: `${oldState.channel.name}`, inline: true },
                { name: 'To', value: `${newState.channel.name}`, inline: true }
            )
            .setTimestamp();
    }
    
    if (oldState.channel && newState.channel && oldState.channel.id === newState.channel.id) {
        const changes = [];
        
        if (!oldState.mute && newState.mute) changes.push('🔇 Server Muted');
        if (oldState.mute && !newState.mute) changes.push('🔊 Server Unmuted');
        if (!oldState.deaf && newState.deaf) changes.push('🔇 Server Deafened');
        if (oldState.deaf && !newState.deaf) changes.push('🔊 Server Undeafened');
        if (!oldState.selfMute && newState.selfMute) changes.push('🤐 Self Muted');
        if (oldState.selfMute && !newState.selfMute) changes.push('🗣️ Self Unmuted');
        if (!oldState.selfDeaf && newState.selfDeaf) changes.push('🙉 Self Deafened');
        if (oldState.selfDeaf && !newState.selfDeaf) changes.push('👂 Self Undeafened');
        if (!oldState.streaming && newState.streaming) changes.push('📡 Started Streaming');
        if (oldState.streaming && !newState.streaming) changes.push('📡 Stopped Streaming');
        if (!oldState.selfVideo && newState.selfVideo) changes.push('📹 Camera On');
        if (oldState.selfVideo && !newState.selfVideo) changes.push('📹 Camera Off');
        
        if (changes.length > 0) {
            embed = new EmbedBuilder()
                .setColor('#9932cc')
                .setTitle('🎙️ Voice State Changed')
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

// ===== ROLE UPDATE =====
client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (!logChannels.role) return;
    
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    
    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));
    
    if (addedRoles.size === 0 && removedRoles.size === 0) return;
    
    const embed = new EmbedBuilder()
        .setColor('#9932cc')
        .setTitle('👤 Member Roles Updated')
        .setThumbnail(newMember.user.displayAvatarURL())
        .addFields(
            { name: 'Member', value: `${newMember.user.tag} (${newMember.id})`, inline: false }
        )
        .setTimestamp();
    
    if (addedRoles.size > 0) {
        embed.addFields({
            name: '✅ Roles Added',
            value: addedRoles.map(r => r.name).join(', '),
            inline: false
        });
    }
    
    if (removedRoles.size > 0) {
        embed.addFields({
            name: '❌ Roles Removed',
            value: removedRoles.map(r => r.name).join(', '),
            inline: false
        });
    }
    
    logChannels.role.send({ embeds: [embed] });
});

// ===== CHANNEL CREATE =====
client.on('channelCreate', channel => {
    if (!logChannels.channel) return;
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('📁 Channel Created')
        .addFields(
            { name: 'Name', value: channel.name, inline: true },
            { name: 'Type', value: ChannelType[channel.type], inline: true },
            { name: 'ID', value: channel.id, inline: true },
            { name: 'Category', value: channel.parent?.name || 'None', inline: true }
        )
        .setTimestamp();
    
    logChannels.channel.send({ embeds: [embed] });
});

// ===== CHANNEL DELETE =====
client.on('channelDelete', channel => {
    if (!logChannels.channel) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('📁 Channel Deleted')
        .addFields(
            { name: 'Name', value: channel.name, inline: true },
            { name: 'Type', value: ChannelType[channel.type], inline: true },
            { name: 'ID', value: channel.id, inline: true },
            { name: 'Category', value: channel.parent?.name || 'None', inline: true }
        )
        .setTimestamp();
    
    logChannels.channel.send({ embeds: [embed] });
});

// ===== CHANNEL UPDATE =====
client.on('channelUpdate', (oldChannel, newChannel) => {
    if (!logChannels.channel) return;
    
    const changes = [];
    
    if (oldChannel.name !== newChannel.name) {
        changes.push(`**Name:** ${oldChannel.name} → ${newChannel.name}`);
    }
    if (oldChannel.topic !== newChannel.topic) {
        changes.push(`**Topic:** ${oldChannel.topic || 'None'} → ${newChannel.topic || 'None'}`);
    }
    if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push(`**NSFW:** ${oldChannel.nsfw} → ${newChannel.nsfw}`);
    }
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push(`**Slowmode:** ${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s`);
    }
    
    if (changes.length === 0) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ffa500')
        .setTitle('📝 Channel Updated')
        .addFields(
            { name: 'Channel', value: `<#${newChannel.id}>`, inline: true },
            { name: 'Changes', value: changes.join('\n'), inline: false }
        )
        .setTimestamp();
    
    logChannels.channel.send({ embeds: [embed] });
});

// ===== INVITE CREATE =====
client.on('inviteCreate', invite => {
    if (!logChannels.invite) return;
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🎫 Invite Created')
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

// ===== INVITE DELETE =====
client.on('inviteDelete', invite => {
    if (!logChannels.invite) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('🎫 Invite Deleted')
        .addFields(
            { name: 'Code', value: `\`${invite.code}\``, inline: true },
            { name: 'Channel', value: `<#${invite.channel?.id}>` || 'Unknown', inline: true },
            { name: 'Created By', value: invite.inviter?.tag || 'Unknown', inline: true }
        )
        .setTimestamp();
    
    logChannels.invite.send({ embeds: [embed] });
});

// ===== BAN ADD =====
client.on('guildBanAdd', async ban => {
    if (!logChannels.moderation) return;
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('🔨 Member Banned')
        .setThumbnail(ban.user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: false },
            { name: 'Reason', value: ban.reason || 'No reason provided', inline: false }
        )
        .setTimestamp();
    
    try {
        const fetchedLogs = await ban.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberBanAdd
        });
        const banLog = fetchedLogs.entries.first();
        
        if (banLog && banLog.target.id === ban.user.id) {
            embed.addFields({
                name: 'Banned By',
                value: banLog.executor.tag,
                inline: true
            });
        }
    } catch (error) {
        console.error('Error fetching ban logs:', error);
    }
    
    logChannels.moderation.send({ embeds: [embed] });
});

// ===== BAN REMOVE =====
client.on('guildBanRemove', async ban => {
    if (!logChannels.moderation) return;
    
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🔓 Member Unbanned')
        .setThumbnail(ban.user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `${ban.user.tag} (${ban.user.id})`, inline: false }
        )
        .setTimestamp();
    
    try {
        const fetchedLogs = await ban.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MemberBanRemove
        });
        const unbanLog = fetchedLogs.entries.first();
        
        if (unbanLog && unbanLog.target.id === ban.user.id) {
            embed.addFields({
                name: 'Unbanned By',
                value: unbanLog.executor.tag,
                inline: true
            });
        }
    } catch (error) {
        console.error('Error fetching unban logs:', error);
    }
    
    logChannels.moderation.send({ embeds: [embed] });
});

// ===== COMMANDS =====
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const isAdmin = message.member?.permissions.has('Administrator');
    
        // ===== CLAUDE TOKEN TRACKING COMMANDS =====
    if (message.content === '!tokenusage' && isAdmin) {
        if (claudeTracker) {
            await claudeTracker.handleTokenUsageCommand(message);
        } else {
            await message.reply('❌ Claude token tracker not initialized! Add `claudeWebhook` to config.json');
        }
    }

    if (message.content === '!optimization' && isAdmin) {
        if (claudeTracker) {
            await claudeTracker.handleOptimizationCommand(message);
        } else {
            await message.reply('❌ Claude token tracker not initialized!');
        }
    }

    if (message.content.startsWith('!logtoken ') && isAdmin) {
        const args = message.content.split(' ');
        if (args.length >= 3 && claudeTracker) {
            const inputTokens = parseInt(args[1]);
            const outputTokens = parseInt(args[2]);
            const context = args.slice(3).join(' ') || 'Manual entry';
            
            if (isNaN(inputTokens) || isNaN(outputTokens)) {
                return message.reply('❌ Input and output tokens must be numbers!');
            }
            
            claudeTracker.logTokenUsage(inputTokens, outputTokens, context);
            await message.reply(`✅ Logged **${(inputTokens + outputTokens).toLocaleString()}** tokens`);
        } else if (!claudeTracker) {
            await message.reply('❌ Claude token tracker not initialized!');
        } else {
            await message.reply('Usage: `!logtoken <input_tokens> <output_tokens> [context]`');
        }
    }

    if (message.content === '!test' && isAdmin) {
        await message.reply('Bot is working and you have admin!');
    }

    if (message.content.startsWith('!approve') && isAdmin) {
        const args = message.content.split(' ');
        
        if (args.length < 3) {
            return message.reply('Usage: `!approve <user_id> <role_name>`\nExample: `!approve 123456789012345678 Verified`');
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
                return message.reply(`❌ Role "${roleName}" not found!`);
            }
            
            if (member) {
                await member.roles.add(role);
                return message.reply(`✅ Assigned **${role.name}** to <@${userId}>`);
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
                
                return message.reply(`✅ User is not in the server. **${role.name}** will be assigned when they join.`);
            }
        } catch (error) {
            console.error('Error with approve command:', error);
            return message.reply('❌ Error processing approval. Check the user ID is valid.');
        }
    }
    
    if (message.content === '!checksales' && isAdmin) {
        await message.reply('🔍 Checking for sales...');
        if (saleMonitor) {
            await saleMonitor.forceCheck();
            await message.reply('✅ Sale check complete!');
        } else {
            await message.reply('❌ Sale monitor not initialized!');
        }
    }
    
    if (message.content === '!forcesales' && isAdmin) {
        await message.reply('💥 Force posting ALL tracked games...');
        if (saleMonitor) {
            await saleMonitor.forcePostAll();
            await message.reply('✅ Posted all tracked games!');
        } else {
            await message.reply('❌ Sale monitor not initialized!');
        }
    }
    
    if (message.content === '!listgames' && isAdmin) {
        if (saleMonitor) {
            const gameCount = saleMonitor.gameIds.length;
            await message.reply(`📋 Currently tracking **${gameCount}** games.`);
        } else {
            await message.reply('❌ Sale monitor not initialized!');
        }
    }
    
    if (message.content.startsWith('!addgame ') && isAdmin) {
        const appId = message.content.split(' ')[1];
        if (appId && saleMonitor) {
            saleMonitor.addGame(appId);
            await message.reply(`✅ Added Steam App ID ${appId} to monitoring`);
        } else {
            await message.reply('❌ Usage: `!addgame <steam_app_id>`');
        }
    }
    
    if (message.content.startsWith('!removegame ') && isAdmin) {
        const appId = message.content.split(' ')[1];
        if (appId && saleMonitor) {
            saleMonitor.removeGame(appId);
            await message.reply(`✅ Removed Steam App ID ${appId} from monitoring`);
        } else {
            await message.reply('❌ Usage: `!removegame <steam_app_id>`');
        }
    }
    
    if (message.content === '!saleshelp' && isAdmin) {
        const helpEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('💊 Steam Sale Monitor Commands')
            .setDescription('All commands require Administrator permission')
            .addFields(
                { name: '!checksales', value: 'Check for games currently on sale', inline: false },
                { name: '!forcesales', value: 'Force post ALL tracked games', inline: false },
                { name: '!listgames', value: 'Show how many games are being tracked', inline: false },
                { name: '!addgame <app_id>', value: 'Add a Steam game to monitor', inline: false },
                { name: '!removegame <app_id>', value: 'Remove a game from monitoring', inline: false },
                { name: '!cleargamedata', value: 'Clear tracked game data (resets sale detection)', inline: false },
                { name: '!saleshelp', value: 'Show this help message', inline: false }
            )
            .setFooter({ text: 'Automatic checks run every hour' });
        await message.reply({ embeds: [helpEmbed] });
    }

    if (message.content === '!cleargamedata' && isAdmin) {
        if (saleMonitor) {
            saleMonitor.clearTrackedData();
            await message.reply('✅ Cleared all tracked game data. Next check will detect all current sales as "new".');
        } else {
            await message.reply('❌ Sale monitor not initialized!');
        }
    }
    
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
            return message.reply('📊 No invite data available yet!');
        }
        
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('📊 Invite Leaderboard')
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
            return message.reply('Usage: `!whoinvited <user_id>`');
        }
        
        const inviteData = memberInvites.get(userId);
        
        if (!inviteData) {
            return message.reply('❌ No invite data found for this user. They may have joined before tracking was enabled.');
        }
        
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎫 Invite Information')
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
            .setTitle('🎫 Invite Tracking Commands')
            .setDescription('All commands require Administrator permission')
            .addFields(
                { name: '!invitestats', value: 'Show top 10 inviters leaderboard', inline: false },
                { name: '!whoinvited <user_id>', value: 'See which invite a specific user used', inline: false },
                { name: '!invitehelp', value: 'Show this help message', inline: false }
            )
            .setFooter({ text: 'Invite data is saved to member-invites.json' });
        await message.reply({ embeds: [helpEmbed] });
    }
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', () => {
    console.log('Saving data before shutdown...');
    saveMemberInvites();
    console.log('✅ Data saved. Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Saving data before shutdown...');
    saveMemberInvites();
    console.log('✅ Data saved. Shutting down...');
    process.exit(0);
});

client.login(config.token);
