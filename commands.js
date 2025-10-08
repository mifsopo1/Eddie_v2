const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

class CommandHandler {
    constructor(client, config) {
        this.client = client;
        this.config = config;
        this.prefix = config.prefix || '!';
        this.commands = new Map();
        this.warnings = new Map();
        this.afkUsers = new Map();
        this.reminders = new Map();
        this.logChannels = {}; // Store log channels reference
        
        this.loadWarnings();
        this.registerCommands();
        
        console.log(`✅ Registered ${this.commands.size} commands:`, Array.from(this.commands.keys()).join(', '));
    }

    // Add method to set log channels from index.js
    setLogChannels(logChannels) {
        this.logChannels = logChannels;
        console.log('✅ Log channels linked to command handler');
    }

    // Helper method to log moderation actions
    async logModerationAction(embed) {
        if (this.logChannels.moderation) {
            try {
                await this.logChannels.moderation.send({ embeds: [embed] });
            } catch (error) {
                console.error('Error logging moderation action:', error);
            }
        }
    }

    registerCommands() {
        // ========== INFORMATION COMMANDS ==========
        
        // Help Command
        this.commands.set('help', {
            name: 'help',
            description: 'Shows all available commands',
            usage: '!help [command]',
            aliases: ['h', 'commands', 'cmds'],
            category: 'Information',
            execute: async (message, args) => {
                if (args[0]) {
                    const cmd = this.commands.get(args[0].toLowerCase()) || 
                               Array.from(this.commands.values()).find(c => c.aliases?.includes(args[0].toLowerCase()));
                    
                    if (!cmd) {
                        return message.reply('❌ Command not found!');
                    }
                    
                    const embed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle(`📖 Command: ${cmd.name}`)
                        .setDescription(cmd.description)
                        .addFields(
                            { name: 'Usage', value: `\`${cmd.usage}\``, inline: false },
                            { name: 'Aliases', value: cmd.aliases?.join(', ') || 'None', inline: true },
                            { name: 'Category', value: cmd.category || 'Utility', inline: true }
                        );
                    
                    if (cmd.permissions) {
                        embed.addFields({ name: 'Required Permissions', value: cmd.permissions.join(', '), inline: true });
                    }
                    
                    return message.reply({ embeds: [embed] });
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('📚 Bot Commands')
                    .setDescription(`Use \`${this.prefix}help [command]\` for detailed info\nPrefix: \`${this.prefix}\``)
                    .setFooter({ text: `Requested by ${message.author.tag}` })
                    .setTimestamp();
                
                const categories = {
                    'Information': [],
                    'Moderation': [],
                    'Server Management': [],
                    'Utility': [],
                    'Fun': []
                };
                
                this.commands.forEach(cmd => {
                    const category = cmd.category || 'Utility';
                    if (categories[category]) {
                        categories[category].push(`\`${cmd.name}\``);
                    }
                });
                
                Object.entries(categories).forEach(([category, cmds]) => {
                    if (cmds.length > 0) {
                        embed.addFields({
                            name: `${category} (${cmds.length})`,
                            value: cmds.join(', '),
                            inline: false
                        });
                    }
                });
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Ping Command
        this.commands.set('ping', {
            name: 'ping',
            description: 'Check bot latency',
            usage: '!ping',
            aliases: ['pong', 'latency'],
            category: 'Information',
            execute: async (message) => {
                const sent = await message.reply('🏓 Pinging...');
                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('🏓 Pong!')
                    .addFields(
                        { name: 'Bot Latency', value: `${sent.createdTimestamp - message.createdTimestamp}ms`, inline: true },
                        { name: 'API Latency', value: `${Math.round(this.client.ws.ping)}ms`, inline: true },
                        { name: 'Uptime', value: this.formatUptime(this.client.uptime), inline: true }
                    )
                    .setTimestamp();
                
                await sent.edit({ content: null, embeds: [embed] });
            }
        });

        // Server Info Command
        this.commands.set('serverinfo', {
            name: 'serverinfo',
            description: 'Display server information',
            usage: '!serverinfo',
            aliases: ['si', 'server', 'guildinfo'],
            category: 'Information',
            execute: async (message) => {
                const guild = message.guild;
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`📊 ${guild.name}`)
                    .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
                    .addFields(
                        { name: '👑 Owner', value: `<@${guild.ownerId}>`, inline: true },
                        { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                        { name: '🆔 Server ID', value: guild.id, inline: true },
                        { name: '👥 Members', value: `${guild.memberCount}`, inline: true },
                        { name: '💬 Channels', value: `${guild.channels.cache.size}`, inline: true },
                        { name: '🎭 Roles', value: `${guild.roles.cache.size}`, inline: true },
                        { name: '😀 Emojis', value: `${guild.emojis.cache.size}`, inline: true },
                        { name: '🔒 Verification Level', value: guild.verificationLevel.toString(), inline: true },
                        { name: '📈 Boost Level', value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount} boosts)`, inline: true }
                    )
                    .setTimestamp();
                
                if (guild.description) {
                    embed.setDescription(guild.description);
                }
                
                return message.reply({ embeds: [embed] });
            }
        });

        // User Info Command
        this.commands.set('userinfo', {
            name: 'userinfo',
            description: 'Display user information',
            usage: '!userinfo [@user]',
            aliases: ['ui', 'user', 'whois', 'memberinfo'],
            category: 'Information',
            execute: async (message, args) => {
                const target = message.mentions.members.first() || message.member;
                const user = target.user;
                
                let inviteInfo = '';
                try {
                    const memberInvites = JSON.parse(fs.readFileSync('member-invites.json', 'utf8'));
                    if (memberInvites[user.id]) {
                        const invite = memberInvites[user.id];
                        inviteInfo = `\n**Invited by:** ${invite.inviter}\n**Invite Code:** \`${invite.code}\``;
                    }
                } catch (error) {
                    // File doesn't exist or error reading
                }
                
                const embed = new EmbedBuilder()
                    .setColor(target.displayHexColor || '#3498db')
                    .setTitle(`👤 ${user.tag}`)
                    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
                    .addFields(
                        { name: '🆔 User ID', value: user.id, inline: true },
                        { name: '📅 Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                        { name: '📥 Joined Server', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
                        { name: '🎭 Roles', value: target.roles.cache.map(r => r).slice(0, 10).join(', ') || 'None', inline: false }
                    )
                    .setTimestamp();
                
                if (inviteInfo) {
                    embed.addFields({ name: '🔗 Invite Info', value: inviteInfo, inline: false });
                }
                
                if (target.premiumSince) {
                    embed.addFields({ name: '💎 Boosting Since', value: `<t:${Math.floor(target.premiumSinceTimestamp / 1000)}:R>`, inline: true });
                }
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Stats Command
        this.commands.set('stats', {
            name: 'stats',
            description: 'Show bot statistics',
            usage: '!stats',
            aliases: ['botstats', 'botinfo', 'about'],
            category: 'Information',
            execute: async (message) => {
                const totalUsers = this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('📊 Bot Statistics')
                    .setThumbnail(this.client.user.displayAvatarURL())
                    .addFields(
                        { name: '🌐 Servers', value: `${this.client.guilds.cache.size}`, inline: true },
                        { name: '👥 Total Users', value: `${totalUsers.toLocaleString()}`, inline: true },
                        { name: '⏱️ Uptime', value: this.formatUptime(this.client.uptime), inline: true },
                        { name: '💾 Memory', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`, inline: true },
                        { name: '🏓 Ping', value: `${Math.round(this.client.ws.ping)}ms`, inline: true },
                        { name: '⚙️ Node.js', value: process.version, inline: true }
                    )
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // ========== MODERATION COMMANDS WITH LOGGING ==========

        // Kick Command
        this.commands.set('kick', {
            name: 'kick',
            description: 'Kick a member from the server',
            usage: '!kick @user [reason]',
            aliases: ['yeet'],
            category: 'Moderation',
            permissions: ['KickMembers'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
                    return message.reply('❌ You need **Kick Members** permission!');
                }
                
                const target = message.mentions.members.first();
                if (!target) {
                    return message.reply('❌ Please mention a user to kick!');
                }
                
                if (!target.kickable) {
                    return message.reply('❌ I cannot kick this user!');
                }
                
                const reason = args.slice(1).join(' ') || 'No reason provided';
                
                // Get invite info before kicking
                let inviteInfo = '';
                try {
                    const memberInvites = JSON.parse(fs.readFileSync('member-invites.json', 'utf8'));
                    if (memberInvites[target.id]) {
                        const invite = memberInvites[target.id];
                        inviteInfo = `**Invited by:** ${invite.inviter}\n**Invite Code:** \`${invite.code}\``;
                    }
                } catch (error) {
                    // File doesn't exist or error reading
                }
                
                try {
                    // Try to DM user before kicking
                    await target.send(`You have been kicked from **${message.guild.name}**\nReason: ${reason}`).catch(() => {});
                    
                    // Kick the user
                    await target.kick(reason);
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#ff6600')
                        .setTitle('👢 Member Kicked')
                        .addFields(
                            { name: 'User', value: `${target.user.tag}`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#ff6600')
                        .setTitle('👢 Member Kicked')
                        .setThumbnail(target.user.displayAvatarURL())
                        .addFields(
                            { name: 'User', value: `${target.user.tag}\n<@${target.id}> (${target.id})`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: `User ID: ${target.id}` });
                    
                    if (inviteInfo) {
                        logEmbed.addFields({ name: 'Invite Info', value: inviteInfo, inline: false });
                    }
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error kicking user:', error);
                    return message.reply('❌ Failed to kick user!');
                }
            }
        });

        // Ban Command
        this.commands.set('ban', {
            name: 'ban',
            description: 'Ban a member from the server',
            usage: '!ban @user [reason]',
            aliases: ['hammer'],
            category: 'Moderation',
            permissions: ['BanMembers'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                    return message.reply('❌ You need **Ban Members** permission!');
                }
                
                const target = message.mentions.members.first();
                if (!target) {
                    return message.reply('❌ Please mention a user to ban!');
                }
                
                if (!target.bannable) {
                    return message.reply('❌ I cannot ban this user!');
                }
                
                const reason = args.slice(1).join(' ') || 'No reason provided';
                
                // Get invite info before banning
                let inviteInfo = '';
                try {
                    const memberInvites = JSON.parse(fs.readFileSync('member-invites.json', 'utf8'));
                    if (memberInvites[target.id]) {
                        const invite = memberInvites[target.id];
                        inviteInfo = `**Invited by:** ${invite.inviter}\n**Invite Code:** \`${invite.code}\``;
                    }
                } catch (error) {
                    // File doesn't exist or error reading
                }
                
                try {
                    // Try to DM user before banning
                    await target.send(`You have been banned from **${message.guild.name}**\nReason: ${reason}`).catch(() => {});
                    
                    // Ban the user
                    await target.ban({ reason, deleteMessageSeconds: 86400 });
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#8b0000')
                        .setTitle('🔨 Member Banned')
                        .addFields(
                            { name: 'User', value: `${target.user.tag}`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#8b0000')
                        .setTitle('🔨 Member Banned')
                        .setThumbnail(target.user.displayAvatarURL())
                        .addFields(
                            { name: 'User', value: `${target.user.tag}\n<@${target.id}> (${target.id})`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'Reason', value: reason, inline: false },
                            { name: 'Messages Deleted', value: 'Last 24 hours', inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: `User ID: ${target.id}` });
                    
                    if (inviteInfo) {
                        logEmbed.addFields({ name: 'Invite Info', value: inviteInfo, inline: false });
                    }
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error banning user:', error);
                    return message.reply('❌ Failed to ban user!');
                }
            }
        });

        // Unban Command
        this.commands.set('unban', {
            name: 'unban',
            description: 'Unban a user from the server',
            usage: '!unban <user_id> [reason]',
            aliases: ['pardon'],
            category: 'Moderation',
            permissions: ['BanMembers'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                    return message.reply('❌ You need **Ban Members** permission!');
                }
                
                const userId = args[0];
                if (!userId || !/^\d+$/.test(userId)) {
                    return message.reply('❌ Please provide a valid user ID!');
                }
                
                const reason = args.slice(1).join(' ') || 'No reason provided';
                
                try {
                    // Fetch ban to get user info
                    const banInfo = await message.guild.bans.fetch(userId).catch(() => null);
                    
                    if (!banInfo) {
                        return message.reply('❌ This user is not banned!');
                    }
                    
                    const user = banInfo.user;
                    
                    // Unban the user
                    await message.guild.members.unban(userId, reason);
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ User Unbanned')
                        .addFields(
                            { name: 'User', value: `${user.tag}`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ User Unbanned')
                        .setThumbnail(user.displayAvatarURL())
                        .addFields(
                            { name: 'User', value: `${user.tag}\n<@${userId}> (${userId})`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: `User ID: ${userId}` });
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error unbanning user:', error);
                    return message.reply('❌ Failed to unban user! Make sure they are banned.');
                }
            }
        });

        // Mute Command
        this.commands.set('mute', {
            name: 'mute',
            description: 'Mute a member',
            usage: '!mute @user [duration] [reason]',
            aliases: ['silence', 'shush'],
            category: 'Moderation',
            permissions: ['ModerateMembers'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                    return message.reply('❌ You need **Moderate Members** permission!');
                }
                
                const target = message.mentions.members.first();
                if (!target) {
                    return message.reply('❌ Please mention a user to mute!');
                }
                
                // Parse duration (e.g., 10m, 1h, 1d)
                let duration = null;
                let durationText = 'Permanent';
                let reasonIndex = 1;
                
                if (args[1] && /^\d+[smhd]$/.test(args[1])) {
                    const timeStr = args[1].toLowerCase();
                    const amount = parseInt(timeStr);
                    
                    if (timeStr.endsWith('s')) duration = amount * 1000;
                    else if (timeStr.endsWith('m')) duration = amount * 60000;
                    else if (timeStr.endsWith('h')) duration = amount * 3600000;
                    else if (timeStr.endsWith('d')) duration = amount * 86400000;
                    
                    durationText = args[1];
                    reasonIndex = 2;
                }
                
                const reason = args.slice(reasonIndex).join(' ') || 'No reason provided';
                
                let mutedRole = message.guild.roles.cache.find(r => r.name === 'Muted');
                if (!mutedRole) {
                    mutedRole = await message.guild.roles.create({
                        name: 'Muted',
                        color: '#808080',
                        permissions: []
                    });
                    
                    message.guild.channels.cache.forEach(async (channel) => {
                        await channel.permissionOverwrites.create(mutedRole, {
                            SendMessages: false,
                            AddReactions: false,
                            Speak: false
                        }).catch(console.error);
                    });
                }
                
                try {
                    await target.roles.add(mutedRole);
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#ffa500')
                        .setTitle('🔇 Member Muted')
                        .addFields(
                            { name: 'User', value: `${target.user.tag}`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                            { name: 'Duration', value: durationText, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#ffa500')
                        .setTitle('🔇 Member Muted')
                        .setThumbnail(target.user.displayAvatarURL())
                        .addFields(
                            { name: 'User', value: `${target.user.tag}\n<@${target.id}> (${target.id})`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'Duration', value: durationText, inline: true },
                            { name: 'Expires', value: duration ? `<t:${Math.floor((Date.now() + duration) / 1000)}:R>` : 'Never', inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: `User ID: ${target.id}` });
                    
                    await this.logModerationAction(logEmbed);
                    
                    // Auto-unmute if duration is set
                    if (duration) {
                        setTimeout(async () => {
                            try {
                                if (target.roles.cache.has(mutedRole.id)) {
                                    await target.roles.remove(mutedRole);
                                    
                                    const unmuteLogEmbed = new EmbedBuilder()
                                        .setColor('#00ff00')
                                        .setTitle('🔊 Member Auto-Unmuted')
                                        .setThumbnail(target.user.displayAvatarURL())
                                        .addFields(
                                            { name: 'User', value: `${target.user.tag}\n<@${target.id}>`, inline: true },
                                            { name: 'Duration', value: durationText, inline: true },
                                            { name: 'Original Reason', value: reason, inline: false }
                                        )
                                        .setTimestamp();
                                    
                                    await this.logModerationAction(unmuteLogEmbed);
                                }
                            } catch (error) {
                                console.error('Error auto-unmuting user:', error);
                            }
                        }, duration);
                    }
                    
                } catch (error) {
                    console.error('Error muting user:', error);
                    return message.reply('❌ Failed to mute user!');
                }
            }
        });

        // Unmute Command
        this.commands.set('unmute', {
            name: 'unmute',
            description: 'Unmute a member',
            usage: '!unmute @user [reason]',
            aliases: ['unsilence'],
            category: 'Moderation',
            permissions: ['ModerateMembers'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                    return message.reply('❌ You need **Moderate Members** permission!');
                }
                
                const target = message.mentions.members.first();
                if (!target) {
                    return message.reply('❌ Please mention a user to unmute!');
                }
                
                const mutedRole = message.guild.roles.cache.find(r => r.name === 'Muted');
                if (!mutedRole || !target.roles.cache.has(mutedRole.id)) {
                    return message.reply('❌ User is not muted!');
                }
                
                const reason = args.slice(1).join(' ') || 'No reason provided';
                
                try {
                    await target.roles.remove(mutedRole);
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🔊 Member Unmuted')
                        .addFields(
                            { name: 'User', value: `${target.user.tag}`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🔊 Member Unmuted')
                        .setThumbnail(target.user.displayAvatarURL())
                        .addFields(
                            { name: 'User', value: `${target.user.tag}\n<@${target.id}> (${target.id})`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: `User ID: ${target.id}` });
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error unmuting user:', error);
                    return message.reply('❌ Failed to unmute user!');
                }
            }
        });

        // Warn Command
        this.commands.set('warn', {
            name: 'warn',
            description: 'Warn a member',
            usage: '!warn @user <reason>',
            aliases: ['warning'],
            category: 'Moderation',
            permissions: ['ModerateMembers'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                    return message.reply('❌ You need **Moderate Members** permission!');
                }const target = message.mentions.members.first();
                if (!target) {
                    return message.reply('❌ Please mention a user to warn!');
                }
                
                const reason = args.slice(1).join(' ');
                if (!reason) {
                    return message.reply('❌ Please provide a reason for the warning!');
                }
                
                const userWarnings = this.warnings.get(target.id) || [];
                userWarnings.push({
                    moderator: message.author.id,
                    reason: reason,
                    timestamp: Date.now()
                });
                this.warnings.set(target.id, userWarnings);
                this.saveWarnings();
                
                // User confirmation embed
                const confirmEmbed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('⚠️ User Warned')
                    .addFields(
                        { name: 'User', value: `${target.user.tag}`, inline: true },
                        { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                        { name: 'Total Warnings', value: userWarnings.length.toString(), inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setTimestamp();
                
                await message.reply({ embeds: [confirmEmbed] });
                
                // Log to moderation channel
                const logEmbed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('⚠️ User Warned')
                    .setThumbnail(target.user.displayAvatarURL())
                    .addFields(
                        { name: 'User', value: `${target.user.tag}\n<@${target.id}> (${target.id})`, inline: true },
                        { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                        { name: 'Warning #', value: userWarnings.length.toString(), inline: true },
                        { name: 'Total Warnings', value: userWarnings.length.toString(), inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: `User ID: ${target.id}` });
                
                await this.logModerationAction(logEmbed);
                
                // Try to DM the user
                try {
                    await target.send(`You have been warned in **${message.guild.name}**\nReason: ${reason}\nTotal warnings: ${userWarnings.length}`);
                } catch (error) {
                    console.log(`Could not DM ${target.user.tag}`);
                }
            }
        });

        // Warnings Command
        this.commands.set('warnings', {
            name: 'warnings',
            description: 'View user warnings',
            usage: '!warnings @user',
            aliases: ['warns', 'infractions'],
            category: 'Moderation',
            permissions: ['ModerateMembers'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                    return message.reply('❌ You need **Moderate Members** permission!');
                }
                
                const target = message.mentions.members.first();
                if (!target) {
                    return message.reply('❌ Please mention a user to check warnings!');
                }
                
                const userWarnings = this.warnings.get(target.id) || [];
                
                if (userWarnings.length === 0) {
                    return message.reply(`✅ ${target.user.tag} has no warnings!`);
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle(`⚠️ Warnings for ${target.user.tag}`)
                    .setThumbnail(target.user.displayAvatarURL())
                    .setDescription(`Total Warnings: ${userWarnings.length}`)
                    .setTimestamp();
                
                userWarnings.forEach((warn, index) => {
                    embed.addFields({
                        name: `Warning #${index + 1}`,
                        value: `**Moderator:** <@${warn.moderator}>\n**Reason:** ${warn.reason}\n**Date:** <t:${Math.floor(warn.timestamp / 1000)}:R>`,
                        inline: false
                    });
                });
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Clear Warnings Command
        this.commands.set('clearwarns', {
            name: 'clearwarns',
            description: 'Clear all warnings for a user',
            usage: '!clearwarns @user',
            aliases: ['clearwarnings', 'resetwarns'],
            category: 'Moderation',
            permissions: ['Administrator'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return message.reply('❌ You need **Administrator** permission!');
                }
                
                const target = message.mentions.members.first();
                if (!target) {
                    return message.reply('❌ Please mention a user to clear warnings!');
                }
                
                const userWarnings = this.warnings.get(target.id) || [];
                
                if (userWarnings.length === 0) {
                    return message.reply(`✅ ${target.user.tag} has no warnings to clear!`);
                }
                
                const warningCount = userWarnings.length;
                this.warnings.delete(target.id);
                this.saveWarnings();
                
                // User confirmation embed
                const confirmEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('✅ Warnings Cleared')
                    .addFields(
                        { name: 'User', value: `${target.user.tag}`, inline: true },
                        { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                        { name: 'Warnings Cleared', value: warningCount.toString(), inline: true }
                    )
                    .setTimestamp();
                
                await message.reply({ embeds: [confirmEmbed] });
                
                // Log to moderation channel
                const logEmbed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('✅ Warnings Cleared')
                    .setThumbnail(target.user.displayAvatarURL())
                    .addFields(
                        { name: 'User', value: `${target.user.tag}\n<@${target.id}> (${target.id})`, inline: true },
                        { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                        { name: 'Warnings Cleared', value: warningCount.toString(), inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: `User ID: ${target.id}` });
                
                await this.logModerationAction(logEmbed);
            }
        });

        // Purge Command
        this.commands.set('purge', {
            name: 'purge',
            description: 'Delete multiple messages',
            usage: '!purge <amount> [@user]',
            aliases: ['clear', 'clean', 'prune'],
            category: 'Moderation',
            permissions: ['ManageMessages'],
            execute: async (message, args) => {
                if (!message.member.roles.cache.has('645744514576809984')) {
                    return message.reply('❌ Overwatch required!');
                }
                
                const amount = parseInt(args[0]);
                if (isNaN(amount) || amount < 1 || amount > 100) {
                    return message.reply('❌ Please provide a number between 1 and 100!');
                }
                
                const targetUser = message.mentions.users.first();
                
                try {
                    await message.delete();
                    
                    let deletedCount = 0;
                    
                    if (targetUser) {
                        const messages = await message.channel.messages.fetch({ limit: amount });
                        const userMessages = messages.filter(m => m.author.id === targetUser.id);
                        const deleted = await message.channel.bulkDelete(userMessages, true);
                        deletedCount = deleted.size;
                        
                        const reply = await message.channel.send(`✅ Deleted ${deletedCount} messages from ${targetUser.tag}!`);
                        setTimeout(() => reply.delete().catch(() => {}), 5000);
                    } else {
                        const deleted = await message.channel.bulkDelete(amount, true);
                        deletedCount = deleted.size;
                        
                        const reply = await message.channel.send(`✅ Deleted ${deletedCount} messages!`);
                        setTimeout(() => reply.delete().catch(() => {}), 5000);
                    }
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle('🗑️ Messages Purged')
                        .addFields(
                            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'Messages Deleted', value: deletedCount.toString(), inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: `Channel ID: ${message.channel.id}` });
                    
                    if (targetUser) {
                        logEmbed.addFields({ name: 'Target User', value: `${targetUser.tag}\n<@${targetUser.id}>`, inline: true });
                    }
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error purging messages:', error);
                    return message.reply('❌ Failed to delete messages!');
                }
            }
        });

        // Slowmode Command
        this.commands.set('slowmode', {
            name: 'slowmode',
            description: 'Set channel slowmode',
            usage: '!slowmode <seconds> [#channel]',
            aliases: ['slow'],
            category: 'Moderation',
            permissions: ['ManageChannels'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                    return message.reply('❌ You need **Manage Channels** permission!');
                }
                
                const seconds = parseInt(args[0]);
                if (isNaN(seconds) || seconds < 0 || seconds > 21600) {
                    return message.reply('❌ Please provide a number between 0 and 21600 seconds!');
                }
                
                const channel = message.mentions.channels.first() || message.channel;
                
                try {
                    await channel.setRateLimitPerUser(seconds);
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle('⏱️ Slowmode Updated')
                        .addFields(
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Slowmode', value: seconds === 0 ? 'Disabled' : `${seconds}s`, inline: true },
                            { name: 'Set By', value: message.author.tag, inline: true }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle('⏱️ Slowmode Changed')
                        .addFields(
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'New Slowmode', value: seconds === 0 ? 'Disabled' : `${seconds} seconds`, inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: `Channel ID: ${channel.id}` });
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error setting slowmode:', error);
                    return message.reply('❌ Failed to set slowmode!');
                }
            }
        });

        // Lock Command
        this.commands.set('lock', {
            name: 'lock',
            description: 'Lock a channel',
            usage: '!lock [#channel] [reason]',
            aliases: ['lockdown'],
            category: 'Moderation',
            permissions: ['ManageChannels'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                    return message.reply('❌ You need **Manage Channels** permission!');
                }
                
                const channel = message.mentions.channels.first() || message.channel;
                const reason = args.slice(message.mentions.channels.size > 0 ? 1 : 0).join(' ') || 'No reason provided';
                
                try {
                    await channel.permissionOverwrites.edit(message.guild.id, {
                        SendMessages: false
                    });
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('🔒 Channel Locked')
                        .addFields(
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Locked By', value: message.author.tag, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('🔒 Channel Locked')
                        .addFields(
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: `Channel ID: ${channel.id}` });
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error locking channel:', error);
                    return message.reply('❌ Failed to lock channel!');
                }
            }
        });

        // Unlock Command
        this.commands.set('unlock', {
            name: 'unlock',
            description: 'Unlock a channel',
            usage: '!unlock [#channel] [reason]',
            aliases: [],
            category: 'Moderation',
            permissions: ['ManageChannels'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                    return message.reply('❌ You need **Manage Channels** permission!');
                }
                
                const channel = message.mentions.channels.first() || message.channel;
                const reason = args.slice(message.mentions.channels.size > 0 ? 1 : 0).join(' ') || 'No reason provided';
                
                try {
                    await channel.permissionOverwrites.edit(message.guild.id, {
                        SendMessages: null
                    });
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🔓 Channel Unlocked')
                        .addFields(
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Unlocked By', value: message.author.tag, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🔓 Channel Unlocked')
                        .addFields(
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: `Channel ID: ${channel.id}` });
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error unlocking channel:', error);
                    return message.reply('❌ Failed to unlock channel!');
                }
            }
        });

        // Nuke Command
        this.commands.set('nuke', {
            name: 'nuke',
            description: 'Delete and recreate channel',
            usage: '!nuke [#channel]',
            aliases: ['recreate'],
            category: 'Moderation',
            permissions: ['ManageChannels'],
            execute: async (message, args) => {
                if (!message.member.roles.cache.has('645744514576809984')) {
                    return message.reply('❌ Overwatch required!');
                }
                
                const channel = message.mentions.channels.first() || message.channel;
                const channelName = channel.name;
                const channelId = channel.id;
                
                try {
                    const position = channel.position;
                    const newChannel = await channel.clone();
                    await channel.delete();
                    await newChannel.setPosition(position);
                    
                    const embed = new EmbedBuilder()
                        .setColor('#ff6600')
                        .setTitle('💥 Channel Nuked')
                        .setDescription(`Channel has been recreated by ${message.author.tag}`)
                        .setTimestamp();
                    
                    await newChannel.send({ embeds: [embed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#ff6600')
                        .setTitle('💥 Channel Nuked')
                        .addFields(
                            { name: 'Old Channel', value: `#${channelName} (${channelId})`, inline: true },
                            { name: 'New Channel', value: `<#${newChannel.id}>`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: `Old ID: ${channelId} | New ID: ${newChannel.id}` });
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error nuking channel:', error);
                    return message.reply('❌ Failed to nuke channel!');
                }
            }
        });

        // Nickname Command
        this.commands.set('nickname', {
            name: 'nickname',
            description: 'Change user nickname',
            usage: '!nickname @user <new_nick>',
            aliases: ['nick', 'setnick'],
            category: 'Moderation',
            permissions: ['ManageNicknames'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                    return message.reply('❌ You need **Manage Nicknames** permission!');
                }
                
                const target = message.mentions.members.first();
                if (!target) {
                    return message.reply('❌ Please mention a user!');
                }
                
                const oldNick = target.displayName;
                const newNick = args.slice(1).join(' ') || null;
                
                try {
                    await target.setNickname(newNick);
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle('✏️ Nickname Changed')
                        .addFields(
                            { name: 'User', value: target.user.tag, inline: true },
                            { name: 'New Nickname', value: newNick || 'Reset to username', inline: true }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to moderation channel
                    const logEmbed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle('✏️ Nickname Changed')
                        .setThumbnail(target.user.displayAvatarURL())
                        .addFields(
                            { name: 'User', value: `${target.user.tag}\n<@${target.id}>`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true },
                            { name: 'Old Nickname', value: oldNick, inline: true },
                            { name: 'New Nickname', value: newNick || 'Reset to username', inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: `User ID: ${target.id}` });
                    
                    await this.logModerationAction(logEmbed);
                    
                } catch (error) {
                    console.error('Error changing nickname:', error);
                    return message.reply('❌ Failed to change nickname!');
                }
            }
        });

        // ========== SERVER MANAGEMENT COMMANDS ==========

        // Add Role Command
        this.commands.set('addrole', {
            name: 'addrole',
            description: 'Add role to user',
            usage: '!addrole @user @role',
            aliases: ['giverole'],
            category: 'Server Management',
            permissions: ['ManageRoles'],
            execute: async (message, args) => {
                if (!message.member.roles.cache.has('645744514576809984')) {
                    return message.reply('❌ Overwatch required!');
                }
                
                const target = message.mentions.members.first();
                const role = message.mentions.roles.first();
                
                if (!target || !role) {
                    return message.reply('❌ Please mention a user and a role!');
                }
                
                try {
                    await target.roles.add(role);
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Role Added')
                        .addFields(
                            { name: 'User', value: target.user.tag, inline: true },
                            { name: 'Role', value: role.name, inline: true }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to role channel (or moderation if role channel doesn't exist)
                    const logEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Role Added')
                        .setThumbnail(target.user.displayAvatarURL())
                        .addFields(
                            { name: 'User', value: `${target.user.tag}\n<@${target.id}>`, inline: true },
                            { name: 'Role', value: `${role.name}\n<@&${role.id}>`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: `User ID: ${target.id}` });
                    
                    if (this.logChannels.role) {
                        await this.logChannels.role.send({ embeds: [logEmbed] });
                    } else {
                        await this.logModerationAction(logEmbed);
                    }
                    
                } catch (error) {
                    console.error('Error adding role:', error);
                    return message.reply('❌ Failed to add role!');
                }
            }
        });

        // Remove Role Command
        this.commands.set('removerole', {
            name: 'removerole',
            description: 'Remove role from user',
            usage: '!removerole @user @role',
            aliases: ['takerole'],
            category: 'Server Management',
            permissions: ['ManageRoles'],
            execute: async (message, args) => {
                if (!message.member.roles.cache.has('645744514576809984')) {
                    return message.reply('❌ Overwatch required!');
                }
                
                const target = message.mentions.members.first();
                const role = message.mentions.roles.first();
                
                if (!target || !role) {
                    return message.reply('❌ Please mention a user and a role!');
                }
                
                try {
                    await target.roles.remove(role);
                    
                    // User confirmation embed
                    const confirmEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Role Removed')
                        .addFields(
                            { name: 'User', value: target.user.tag, inline: true },
                            { name: 'Role', value: role.name, inline: true }
                        )
                        .setTimestamp();
                    
                    await message.reply({ embeds: [confirmEmbed] });
                    
                    // Log to role channel (or moderation if role channel doesn't exist)
                    const logEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Role Removed')
                        .setThumbnail(target.user.displayAvatarURL())
                        .addFields(
                            { name: 'User', value: `${target.user.tag}\n<@${target.id}>`, inline: true },
                            { name: 'Role', value: `${role.name}\n<@&${role.id}>`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}\n<@${message.author.id}>`, inline: true }
                        )
                        .setTimestamp()
                        .setFooter({ text: `User ID: ${target.id}` });
                    
                    if (this.logChannels.role) {
                        await this.logChannels.role.send({ embeds: [logEmbed] });
                    } else {
                        await this.logModerationAction(logEmbed);
                    }
                    
                } catch (error) {
                    console.error('Error removing role:', error);
                    return message.reply('❌ Failed to remove role!');
                }
            }
        });

        // Create Invite Command
        this.commands.set('createinvite', {
            name: 'createinvite',
            description: 'Create invite link',
            usage: '!createinvite [max_uses] [max_age_hours]',
            aliases: ['makeinvite'],
            category: 'Server Management',
            permissions: ['CreateInstantInvite'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
                    return message.reply('❌ You need **Create Instant Invite** permission!');
                }
                
                const maxUses = parseInt(args[0]) || 0;
                const maxAge = (parseInt(args[1]) || 0) * 3600;
                
                try {
                    const invite = await message.channel.createInvite({
                        maxUses: maxUses,
                        maxAge: maxAge
                    });
                    
                    const embed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle('🔗 Invite Created')
                        .addFields(
                            { name: 'Link', value: invite.url, inline: false },
                            { name: 'Max Uses', value: maxUses === 0 ? 'Unlimited' : maxUses.toString(), inline: true },
                            { name: 'Expires', value: maxAge === 0 ? 'Never' : `${args[1]} hours`, inline: true }
                        )
                        .setTimestamp();
                    
                    return message.reply({ embeds: [embed] });
                } catch (error) {
                    console.error('Error creating invite:', error);
                    return message.reply('❌ Failed to create invite!');
                }
            }
        });

        // ========== UTILITY COMMANDS (keeping original implementations) ==========
        
        // Avatar Command
        this.commands.set('avatar', {
            name: 'avatar',
            description: 'Display user avatar',
            usage: '!avatar [@user]',
            aliases: ['av', 'pfp', 'icon'],
            category: 'Utility',
            execute: async (message) => {
                const target = message.mentions.users.first() || message.author;
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`${target.tag}'s Avatar`)
                    .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))
                    .setDescription(`[Download](${target.displayAvatarURL({ dynamic: true, size: 1024 })})`)
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Banner Command
        this.commands.set('banner', {
            name: 'banner',
            description: 'Display user banner',
            usage: '!banner [@user]',
            aliases: ['userbanner'],
            category: 'Utility',
            execute: async (message) => {
                const target = message.mentions.users.first() || message.author;
                const user = await this.client.users.fetch(target.id, { force: true });
                
                if (!user.banner) {
                    return message.reply('❌ This user does not have a banner!');
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`${user.tag}'s Banner`)
                    .setImage(user.bannerURL({ size: 1024 }))
                    .setDescription(`[Download](${user.bannerURL({ size: 1024 })})`)
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Server Icon Command
        this.commands.set('servericon', {
            name: 'servericon',
            description: 'Display server icon',
            usage: '!servericon',
            aliases: ['icon'],
            category: 'Utility',
            execute: async (message) => {
                const guild = message.guild;
                
                if (!guild.iconURL()) {
                    return message.reply('❌ This server does not have an icon!');
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`${guild.name}'s Icon`)
                    .setImage(guild.iconURL({ dynamic: true, size: 1024 }))
                    .setDescription(`[Download](${guild.iconURL({ dynamic: true, size: 1024 })})`)
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Server Banner Command
        this.commands.set('serverbanner', {
            name: 'serverbanner',
            description: 'Display server banner',
            usage: '!serverbanner',
            aliases: ['sbanner'],
            category: 'Utility',
            execute: async (message) => {
                const guild = message.guild;
                
                if (!guild.bannerURL()) {
                    return message.reply('❌ This server does not have a banner!');
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`${guild.name}'s Banner`)
                    .setImage(guild.bannerURL({ size: 1024 }))
                    .setDescription(`[Download](${guild.bannerURL({ size: 1024 })})`)
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Invite Command
        this.commands.set('invite', {
            name: 'invite',
            description: 'Get bot invite link',
            usage: '!invite',
            aliases: [],
            category: 'Utility',
            execute: async (message) => {
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('🤖 Invite Me!')
                    .setDescription(`[Click here to invite me to your server!](https://discord.com/api/oauth2/authorize?client_id=${this.client.user.id}&permissions=8&scope=bot)`)
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // AFK Command
        this.commands.set('afk', {
            name: 'afk',
            description: 'Set yourself as AFK',
            usage: '!afk [reason]',
            aliases: ['away'],
            category: 'Utility',
            execute: async (message, args) => {
                const reason = args.join(' ') || 'AFK';
                
                this.afkUsers.set(message.author.id, {
                    reason: reason,
                    timestamp: Date.now()
                });
                
                return message.reply(`✅ You are now AFK: ${reason}`);
            }
        });

        // Remind Me Command
        this.commands.set('remindme', {
            name: 'remindme',
            description: 'Set a reminder',
            usage: '!remindme <time> <message>',
            aliases: ['remind', 'reminder'],
            category: 'Utility',
            execute: async (message, args) => {
                if (args.length < 2) {
                    return message.reply('❌ Usage: !remindme <time> <message>\nExample: !remindme 10m Take a break');
                }
                
                const timeStr = args[0].toLowerCase();
                const reminderText = args.slice(1).join(' ');
                
                let duration = 0;
                if (timeStr.endsWith('s')) duration = parseInt(timeStr) * 1000;
                else if (timeStr.endsWith('m')) duration = parseInt(timeStr) * 60000;
                else if (timeStr.endsWith('h')) duration = parseInt(timeStr) * 3600000;
                else if (timeStr.endsWith('d')) duration = parseInt(timeStr) * 86400000;
                else return message.reply('❌ Invalid time format! Use: 10s, 5m, 2h, or 1d');
                
                if (duration < 10000 || duration > 2592000000) {
                    return message.reply('❌ Duration must be between 10 seconds and 30 days!');
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('⏰ Reminder Set')
                    .addFields(
                        { name: 'Reminder', value: reminderText, inline: false },
                        { name: 'Time', value: `<t:${Math.floor((Date.now() + duration) / 1000)}:R>`, inline: true }
                    )
                    .setTimestamp();
                
                await message.reply({ embeds: [embed] });
                
                setTimeout(async () => {
                    const reminderEmbed = new EmbedBuilder()
                        .setColor('#ff9900')
                        .setTitle('⏰ Reminder!')
                        .setDescription(reminderText)
                        .setTimestamp();
                    
                    try {
                        await message.author.send({ embeds: [reminderEmbed] });
                    } catch {
                        message.channel.send(`<@${message.author.id}> ${reminderText}`);
                    }
                }, duration);
            }
        });

        // Poll Command
        this.commands.set('poll', {
            name: 'poll',
            description: 'Create a poll',
            usage: '!poll <question>',
            aliases: ['vote'],
            category: 'Utility',
            execute: async (message, args) => {
                if (args.length === 0) {
                    return message.reply('❌ Please provide a question!');
                }
                
                const question = args.join(' ');
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('📊 Poll')
                    .setDescription(question)
                    .setFooter({ text: `Poll by ${message.author.tag}` })
                    .setTimestamp();
                
                const pollMessage = await message.channel.send({ embeds: [embed] });
                await pollMessage.react('👍');
                await pollMessage.react('👎');
                await pollMessage.react('🤷');
            }
        });

        // Say Command
        this.commands.set('say', {
            name: 'say',
            description: 'Make bot say something',
            usage: '!say <message>',
            aliases: ['echo'],
            category: 'Utility',
            execute: async (message, args) => {
                if (args.length === 0) {
                    return message.reply('❌ Please provide a message!');
                }
                
                await message.delete().catch(() => {});
                return message.channel.send(args.join(' '));
            }
        });

        // Embed Command
        this.commands.set('embed', {
            name: 'embed',
            description: 'Create custom embed',
            usage: '!embed <title> | <description>',
            aliases: [],
            category: 'Utility',
            execute: async (message, args) => {
                if (args.length === 0) {
                    return message.reply('❌ Usage: !embed <title> | <description>');
                }
                
                const content = args.join(' ').split('|');
                if (content.length < 2) {
                    return message.reply('❌ Please separate title and description with |');
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(content[0].trim())
                    .setDescription(content[1].trim())
                    .setFooter({ text: `Created by ${message.author.tag}` })
                    .setTimestamp();
                
                await message.delete().catch(() => {});
                return message.channel.send({ embeds: [embed] });
            }
        });

        // Role Info Command
        this.commands.set('roleinfo', {
            name: 'roleinfo',
            description: 'Get detailed role information',
            usage: '!roleinfo @role',
            aliases: ['ri'],
            category: 'Information',
            execute: async (message, args) => {
                const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
                
                if (!role) {
                    return message.reply('❌ Please mention a role or provide a role ID!');
                }
                
                const embed = new EmbedBuilder()
                    .setColor(role.color || '#3498db')
                    .setTitle(`🎭 Role Info: ${role.name}`)
                    .addFields(
                        { name: 'ID', value: role.id, inline: true },
                        { name: 'Color', value: role.hexColor, inline: true },
                        { name: 'Position', value: role.position.toString(), inline: true },
                        { name: 'Members', value: role.members.size.toString(), inline: true },
                        { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
                        { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
                        { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true }
                    )
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Roles Command
        this.commands.set('roles', {
            name: 'roles',
            description: 'List all server roles',
            usage: '!roles',
            aliases: ['rolelist'],
            category: 'Information',
            execute: async (message) => {
                const roles = message.guild.roles.cache
                    .sort((a, b) => b.position - a.position)
                    .filter(role => role.id !== message.guild.id);
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`📋 Server Roles (${roles.size})`)
                    .setDescription(`Total roles in **${message.guild.name}**`)
                    .setTimestamp();
                
                const roleChunks = [];
                let currentChunk = [];
                let currentLength = 0;
                
                roles.forEach(role => {
                    const memberCount = role.members.size;
                    const roleText = `${role} - ${memberCount} member${memberCount !== 1 ? 's' : ''}`;
                    
                    if (currentLength + roleText.length > 1000) {
                        roleChunks.push(currentChunk.join('\n'));
                        currentChunk = [roleText];
                        currentLength = roleText.length;
                    } else {
                        currentChunk.push(roleText);
                        currentLength += roleText.length;
                    }
                });
                
                if (currentChunk.length > 0) {
                    roleChunks.push(currentChunk.join('\n'));
                }
                
                roleChunks.forEach((chunk, index) => {
                    embed.addFields({
                        name: index === 0 ? 'Roles' : '\u200b',
                        value: chunk,
                        inline: false
                    });
                });
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Emojis Command
        this.commands.set('emojis', {
            name: 'emojis',
            description: 'List all server emojis',
            usage: '!emojis',
            aliases: ['emojilist'],
            category: 'Information',
            execute: async (message) => {
                const emojis = message.guild.emojis.cache;
                
                if (emojis.size === 0) {
                    return message.reply('❌ This server has no custom emojis!');
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`😀 Server Emojis (${emojis.size})`)
                    .setTimestamp();
                
                const emojiList = emojis.map(e => `${e} \`:${e.name}:\``).join(' ');
                
                if (emojiList.length > 4096) {
                    embed.setDescription(emojiList.slice(0, 4090) + '...');
                } else {
                    embed.setDescription(emojiList);
                }
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Channel Info Command
        this.commands.set('channelinfo', {
            name: 'channelinfo',
            description: 'Get channel information',
            usage: '!channelinfo [#channel]',
            aliases: ['ci'],
            category: 'Information',
            execute: async (message, args) => {
                const channel = message.mentions.channels.first() || message.channel;
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`💬 Channel Info: ${channel.name}`)
                    .addFields(
                        { name: 'ID', value: channel.id, inline: true },
                        { name: 'Type', value: channel.type.toString(), inline: true },
                        { name: 'Created', value: `<t:${Math.floor(channel.createdTimestamp / 1000)}:R>`, inline: true }
                    )
                    .setTimestamp();
                
                if (channel.topic) {
                    embed.addFields({ name: 'Topic', value: channel.topic, inline: false });
                }
                
                if (channel.rateLimitPerUser) {
                    embed.addFields({ name: 'Slowmode', value: `${channel.rateLimitPerUser}s`, inline: true });
                }
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Member Count Command
        this.commands.set('membercount', {
            name: 'membercount',
            description: 'Show member statistics',
            usage: '!membercount',
            aliases: ['members', 'mc'],
            category: 'Information',
            execute: async (message) => {
                const guild = message.guild;
                const members = guild.members.cache;
                const bots = members.filter(m => m.user.bot).size;
                const humans = members.size - bots;
                const online = members.filter(m => m.presence?.status === 'online').size;
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('👥 Member Statistics')
                    .addFields(
                        { name: 'Total Members', value: guild.memberCount.toString(), inline: true },
                        { name: 'Humans', value: humans.toString(), inline: true },
                        { name: 'Bots', value: bots.toString(), inline: true },
                        { name: 'Online', value: online.toString(), inline: true }
                    )
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Bot Permissions Command
        this.commands.set('botperms', {
            name: 'botperms',
            description: 'Check bot permissions',
            usage: '!botperms',
            aliases: [],
            category: 'Information',
            execute: async (message) => {
                if (!message.member.roles.cache.has('645744514576809984')) {
                    return message.reply('❌ Overwatch required!');
                }
                
                const permissions = message.guild.members.me.permissions.toArray();
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('🔐 Bot Permissions')
                    .setDescription(permissions.map(p => `✅ ${p}`).join('\n'))
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Uptime Command
        this.commands.set('uptime', {
            name: 'uptime',
            description: 'Show bot uptime',
            usage: '!uptime',
            aliases: [],
            category: 'Information',
            execute: async (message) => {
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('⏱️ Bot Uptime')
                    .setDescription(`Bot has been online for:\n**${this.formatUptime(this.client.uptime)}**`)
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Bans Command
        this.commands.set('bans', {
            name: 'bans',
            description: 'List all banned users',
            usage: '!bans',
            aliases: ['banlist'],
            category: 'Information',
            permissions: ['BanMembers'],
            execute: async (message) => {
                if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
                    return message.reply('❌ You need **Ban Members** permission!');
                }
                
                const bans = await message.guild.bans.fetch();
                
                if (bans.size === 0) {
                    return message.reply('✅ No banned users!');
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle(`🔨 Banned Users (${bans.size})`)
                    .setDescription(bans.map(ban => `**${ban.user.tag}** - ${ban.reason || 'No reason'}`).join('\n').slice(0, 4096))
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Invites Command
        this.commands.set('invites', {
            name: 'invites',
            description: 'List all active invites',
            usage: '!invites',
            aliases: ['invitelist'],
            category: 'Information',
            permissions: ['ManageGuild'],
            execute: async (message) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                    return message.reply('❌ You need **Manage Server** permission!');
                }
                
                const invites = await message.guild.invites.fetch();
                
                if (invites.size === 0) {
                    return message.reply('❌ No active invites!');
                }
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle(`🔗 Active Invites (${invites.size})`)
                    .setDescription(invites.map(inv => 
                        `**${inv.code}** - ${inv.inviter?.tag || 'Unknown'} (${inv.uses || 0} uses)`
                    ).join('\n').slice(0, 4096))
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Audit Log Command
        this.commands.set('audit', {
            name: 'audit',
            description: 'View recent audit log entries',
            usage: '!audit [amount]',
            aliases: ['auditlog', 'logs'],
            category: 'Information',
            permissions: ['ViewAuditLog'],
            execute: async (message, args) => {
                if (!message.member.roles.cache.has('645744514576809984')) {
                    return message.reply('❌ Overwatch required!');
                }
                
                const limit = parseInt(args[0]) || 5;
                const auditLogs = await message.guild.fetchAuditLogs({ limit: Math.min(limit, 10) });
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('📋 Recent Audit Log')
                    .setTimestamp();
                
                auditLogs.entries.forEach(entry => {
                    embed.addFields({
                        name: `${entry.action} by ${entry.executor.tag}`,
                        value: `Target: ${entry.target?.tag || 'Unknown'}\n<t:${Math.floor(entry.createdTimestamp / 1000)}:R>`,
                        inline: false
                    });
                });
                
                return message.reply({ embeds: [embed] });
            }
        });

        // ========== FUN COMMANDS ==========

        // 8ball Command
        this.commands.set('8ball', {
            name: '8ball',
            description: 'Ask magic 8ball',
            usage: '!8ball <question>',
            aliases: ['eightball'],
            category: 'Fun',
            execute: async (message, args) => {
                if (args.length === 0) {
                    return message.reply('❌ Please ask a question!');
                }
                
                const responses = [
                    'It is certain.', 'It is decidedly so.', 'Without a doubt.',
                    'Yes definitely.', 'You may rely on it.', 'As I see it, yes.',
                    'Most likely.', 'Outlook good.', 'Yes.', 'Signs point to yes.',
                    'Reply hazy, try again.', 'Ask again later.', 'Better not tell you now.',
                    'Cannot predict now.', 'Concentrate and ask again.',
                    "Don't count on it.", 'My reply is no.', 'My sources say no.',
                    'Outlook not so good.', 'Very doubtful.'
                ];
                
                const response = responses[Math.floor(Math.random() * responses.length)];
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('🎱 Magic 8-Ball')
                    .addFields(
                        { name: 'Question', value: args.join(' '), inline: false },
                        { name: 'Answer', value: response, inline: false }
                    )
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Flip Command
        this.commands.set('flip', {
            name: 'flip',
            description: 'Flip a coin',
            usage: '!flip',
            aliases: ['coin', 'coinflip'],
            category: 'Fun',
            execute: async (message) => {
                const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('🪙 Coin Flip')
                    .setDescription(`The coin landed on: **${result}**`)
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Roll Command
        this.commands.set('roll', {
            name: 'roll',
            description: 'Roll a dice',
            usage: '!roll [number]',
            aliases: ['dice'],
            category: 'Fun',
            execute: async (message, args) => {
                const max = parseInt(args[0]) || 6;
                
                if (max < 2 || max > 100) {
                    return message.reply('❌ Please provide a number between 2 and 100!');
                }
                
                const result = Math.floor(Math.random() * max) + 1;
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('🎲 Dice Roll')
                    .setDescription(`You rolled a **${result}** out of ${max}!`)
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Choose Command
        this.commands.set('choose', {
            name: 'choose',
            description: 'Choose between options',
            usage: '!choose <option1> | <option2> | ...',
            aliases: ['pick'],
            category: 'Fun',
            execute: async (message, args) => {
                if (args.length === 0) {
                    return message.reply('❌ Please provide options separated by |');
                }
                
                const options = args.join(' ').split('|').map(o => o.trim());
                
                if (options.length < 2) {
                    return message.reply('❌ Please provide at least 2 options!');
                }
                
                const choice = options[Math.floor(Math.random() * options.length)];
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('🤔 I Choose...')
                    .setDescription(`**${choice}**`)
                    .setFooter({ text: `Out of ${options.length} options` })
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Reverse Command
        this.commands.set('reverse', {
            name: 'reverse',
            description: 'Reverse text',
            usage: '!reverse <text>',
            aliases: [],
            category: 'Fun',
            execute: async (message, args) => {
                if (args.length === 0) {
                    return message.reply('❌ Please provide text to reverse!');
                }
                
                const reversed = args.join(' ').split('').reverse().join('');
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('🔄 Reversed Text')
                    .addFields(
                        { name: 'Original', value: args.join(' '), inline: false },
                        { name: 'Reversed', value: reversed, inline: false }
                    )
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Rate Command
        this.commands.set('rate', {
            name: 'rate',
            description: 'Rate something out of 10',
            usage: '!rate <thing>',
            aliases: [],
            category: 'Fun',
            execute: async (message, args) => {
                if (args.length === 0) {
                    return message.reply('❌ Please provide something to rate!');
                }
                
                const thing = args.join(' ');
                const rating = Math.floor(Math.random() * 11);
                
                const embed = new EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('⭐ Rating')
                    .setDescription(`I rate **${thing}** a **${rating}/10**!`)
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Meme Command
        this.commands.set('meme', {
            name: 'meme',
            description: 'Get a random meme',
            usage: '!meme',
            aliases: [],
            category: 'Fun',
            execute: async (message) => {
                try {
                    const response = await fetch('https://meme-api.com/gimme');
                    const data = await response.json();
                    
                    const embed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle(data.title)
                        .setImage(data.url)
                        .setFooter({ text: `👍 ${data.ups} | r/${data.subreddit}` })
                        .setTimestamp();
                    
                    return message.reply({ embeds: [embed] });
                } catch (error) {
                    return message.reply('❌ Failed to fetch meme!');
                }
            }
        });

        // Joke Command
        this.commands.set('joke', {
            name: 'joke',
            description: 'Get a random joke',
            usage: '!joke',
            aliases: [],
            category: 'Fun',
            execute: async (message) => {
                try {
                    const response = await fetch('https://official-joke-api.appspot.com/random_joke');
                    const data = await response.json();
                    
                    const embed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle('😂 Joke')
                        .addFields(
                            { name: 'Setup', value: data.setup, inline: false },
                            { name: 'Punchline', value: data.punchline, inline: false }
                        )
                        .setTimestamp();
                    
                    return message.reply({ embeds: [embed] });
                } catch (error) {
                    return message.reply('❌ Failed to fetch joke!');
                }
            }
        });
    }

    loadWarnings() {
        try {
            if (fs.existsSync('warnings.json')) {
                const data = JSON.parse(fs.readFileSync('warnings.json', 'utf8'));
                this.warnings = new Map(Object.entries(data));
                console.log(`✅ Loaded ${this.warnings.size} user warnings`);
            }
        } catch (error) {
            console.error('Error loading warnings:', error);
        }
    }

    saveWarnings() {
        try {
            const data = Object.fromEntries(this.warnings);
            fs.writeFileSync('warnings.json', JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error saving warnings:', error);
        }
    }

    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    }

    async handleCommand(message) {
        // Check for AFK users
        if (this.afkUsers.has(message.author.id)) {
            this.afkUsers.delete(message.author.id);
            message.reply('✅ Welcome back! Your AFK status has been removed.').then(m => {
                setTimeout(() => m.delete().catch(() => {}), 5000);
            });
        }
        
        // Check if anyone mentioned is AFK
        message.mentions.users.forEach(user => {
            if (this.afkUsers.has(user.id)) {
                const afkData = this.afkUsers.get(user.id);
                message.reply(`💤 ${user.tag} is currently AFK: ${afkData.reason}`).then(m => {
                    setTimeout(() => m.delete().catch(() => {}), 5000);
                });
            }
        });
        
        if (!message.content.startsWith(this.prefix)) return;
        if (message.author.bot) return;
        
        const args = message.content.slice(this.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        
        console.log(`🔍 Command received: "${commandName}" from ${message.author.tag}`);
        console.log(`📝 Args:`, args);
        
        const command = this.commands.get(commandName) || 
                       Array.from(this.commands.values()).find(cmd => cmd.aliases?.includes(commandName));
        
        if (!command) {
            console.log(`❌ Command not found: ${commandName}`);
            return;
        }
        
        console.log(`✅ Command found: ${command.name}`);
        
        try {
            await command.execute.call(this, message, args);
            console.log(`✅ Command executed successfully: ${command.name}`);
        } catch (error) {
            console.error(`❌ Error executing command ${commandName}:`, error);
            message.reply('❌ There was an error executing that command!');
        }
    }

    // Load command data into edit form
async function editCommand(commandId) {
    try {
        const response = await fetch(`/api/commands/${commandId}`);
        const data = await response.json();
        
        if (!data.success) {
            alert('Error loading command: ' + data.error);
            return;
        }
        
        const command = data.command;
        
        // Populate form fields
        document.getElementById('edit_id').value = command._id;
        document.getElementById('edit_name').value = command.name;
        document.getElementById('edit_category').value = command.category || 'general';
        document.getElementById('edit_description').value = command.description || '';
        document.getElementById('edit_triggerType').value = command.triggerType || 'command';
        
        // Handle trigger (array or string)
        const trigger = Array.isArray(command.trigger) ? command.trigger.join(', ') : command.trigger;
        document.getElementById('edit_trigger').value = trigger;
        
        document.getElementById('edit_responseType').value = command.responseType || 'text';
        document.getElementById('edit_response').value = command.response || '';
        
        // Embed fields
        document.getElementById('edit_embedTitle').value = command.embedTitle || '';
        document.getElementById('edit_embedDescription').value = command.embedDescription || '';
        document.getElementById('edit_embedColor').value = command.embedColor || '#5865f2';
        document.getElementById('edit_embedFooter').value = command.embedFooter || '';
        
        // Reaction
        document.getElementById('edit_reactionEmoji').value = command.reactionEmoji || '';
        
        // Checkboxes
        document.getElementById('edit_enabled').checked = command.enabled !== false;
        document.getElementById('edit_deleteTrigger').checked = command.deleteTrigger === true;
        
        // Update form action
        document.getElementById('editForm').action = `/commands/edit/${commandId}`;
        
        // Show correct response type fields
        updateEditResponseType();
        
        // Show modal
        document.getElementById('editModal').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading command:', error);
        alert('Error loading command: ' + error.message);
    }
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

function updateEditResponseType() {
    const responseType = document.getElementById('edit_responseType').value;
    
    document.getElementById('edit_textResponse').style.display = 'none';
    document.getElementById('edit_embedResponse').style.display = 'none';
    document.getElementById('edit_reactionResponse').style.display = 'none';
    
    if (responseType === 'text' || responseType === 'dm' || responseType === 'multiple') {
        document.getElementById('edit_textResponse').style.display = 'block';
    }
    if (responseType === 'embed') {
        document.getElementById('edit_embedResponse').style.display = 'block';
    }
    if (responseType === 'react' || responseType === 'multiple') {
        document.getElementById('edit_reactionResponse').style.display = 'block';
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('editModal');
    if (event.target === modal) {
        closeEditModal();
    }
}


module.exports = CommandHandler;