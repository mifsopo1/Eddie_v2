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
        
        this.loadWarnings();
        this.registerCommands();
        
        console.log(`✅ Registered ${this.commands.size} commands:`, Array.from(this.commands.keys()).join(', '));
    }

    registerCommands() {
        // Help Command
        this.commands.set('help', {
            name: 'help',
            description: 'Shows all available commands',
            usage: '!help [command]',
            aliases: ['h', 'commands'],
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
                            { name: 'Aliases', value: cmd.aliases?.join(', ') || 'None', inline: true }
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
                    'Moderation': [],
                    'Information': [],
                    'Utility': [],
                    'Admin': []
                };
                
                this.commands.forEach(cmd => {
                    const category = cmd.category || 'Utility';
                    if (categories[category]) {
                        categories[category].push(`\`${cmd.name}\` - ${cmd.description}`);
                    }
                });
                
                Object.entries(categories).forEach(([category, cmds]) => {
                    if (cmds.length > 0) {
                        embed.addFields({
                            name: `${category}`,
                            value: cmds.join('\n') || 'None',
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
            category: 'Utility',
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
            aliases: ['ui', 'user', 'whois'],
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
                    console.error('Error reading invite data:', error);
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

        // Kick Command
        this.commands.set('kick', {
            name: 'kick',
            description: 'Kick a member from the server',
            usage: '!kick @user [reason]',
            aliases: [],
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
                
                try {
                    await target.send(`You have been kicked from **${message.guild.name}**\nReason: ${reason}`).catch(() => {});
                    await target.kick(reason);
                    
                    const embed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('👢 Member Kicked')
                        .addFields(
                            { name: 'User', value: `${target.user.tag}`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    return message.reply({ embeds: [embed] });
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
            aliases: [],
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
                
                try {
                    await target.send(`You have been banned from **${message.guild.name}**\nReason: ${reason}`).catch(() => {});
                    await target.ban({ reason, deleteMessageSeconds: 86400 });
                    
                    const embed = new EmbedBuilder()
                        .setColor('#8b0000')
                        .setTitle('🔨 Member Banned')
                        .addFields(
                            { name: 'User', value: `${target.user.tag}`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    return message.reply({ embeds: [embed] });
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
            usage: '!unban <user_id>',
            aliases: [],
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
                
                try {
                    await message.guild.members.unban(userId);
                    
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ User Unbanned')
                        .addFields(
                            { name: 'User ID', value: userId, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true }
                        )
                        .setTimestamp();
                    
                    return message.reply({ embeds: [embed] });
                } catch (error) {
                    console.error('Error unbanning user:', error);
                    return message.reply('❌ Failed to unban user! Make sure they are banned.');
                }
            }
        });

        // Warn Command
        this.commands.set('warn', {
            name: 'warn',
            description: 'Warn a user',
            usage: '!warn @user [reason]',
            aliases: [],
            category: 'Moderation',
            permissions: ['ModerateMembers'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                    return message.reply('❌ You need **Moderate Members** permission!');
                }
                
                const target = message.mentions.members.first();
                if (!target) {
                    return message.reply('❌ Please mention a user to warn!');
                }
                
                const reason = args.slice(1).join(' ') || 'No reason provided';
                
                const userWarnings = this.warnings.get(target.id) || [];
                userWarnings.push({
                    moderator: message.author.id,
                    reason: reason,
                    timestamp: Date.now()
                });
                this.warnings.set(target.id, userWarnings);
                this.saveWarnings();
                
                const embed = new EmbedBuilder()
                    .setColor('#ff9900')
                    .setTitle('⚠️ User Warned')
                    .addFields(
                        { name: 'User', value: `${target.user.tag}`, inline: true },
                        { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                        { name: 'Total Warnings', value: userWarnings.length.toString(), inline: true },
                        { name: 'Reason', value: reason, inline: false }
                    )
                    .setTimestamp();
                
                await message.reply({ embeds: [embed] });
                
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
            description: 'View warnings for a user',
            usage: '!warnings @user',
            aliases: ['warns'],
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
        this.commands.set('clearwarnings', {
            name: 'clearwarnings',
            description: 'Clear all warnings for a user',
            usage: '!clearwarnings @user',
            aliases: ['clearwarns'],
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
                
                this.warnings.delete(target.id);
                this.saveWarnings();
                
                const embed = new EmbedBuilder()
                    .setColor('#00ff00')
                    .setTitle('✅ Warnings Cleared')
                    .addFields(
                        { name: 'User', value: `${target.user.tag}`, inline: true },
                        { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                        { name: 'Warnings Cleared', value: userWarnings.length.toString(), inline: true }
                    )
                    .setTimestamp();
                
                return message.reply({ embeds: [embed] });
            }
        });

        // Mute Command
        this.commands.set('mute', {
            name: 'mute',
            description: 'Mute a member',
            usage: '!mute @user [duration] [reason]',
            aliases: [],
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
                
                const reason = args.slice(1).join(' ') || 'No reason provided';
                
                try {
                    await target.roles.add(mutedRole);
                    
                    const embed = new EmbedBuilder()
                        .setColor('#ffa500')
                        .setTitle('🔇 Member Muted')
                        .addFields(
                            { name: 'User', value: `${target.user.tag}`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true },
                            { name: 'Reason', value: reason, inline: false }
                        )
                        .setTimestamp();
                    
                    return message.reply({ embeds: [embed] });
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
            usage: '!unmute @user',
            aliases: [],
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
                
                try {
                    await target.roles.remove(mutedRole);
                    
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🔊 Member Unmuted')
                        .addFields(
                            { name: 'User', value: `${target.user.tag}`, inline: true },
                            { name: 'Moderator', value: `${message.author.tag}`, inline: true }
                        )
                        .setTimestamp();
                    
                    return message.reply({ embeds: [embed] });
                } catch (error) {
                    console.error('Error unmuting user:', error);
                    return message.reply('❌ Failed to unmute user!');
                }
            }
        });

        // Purge Command
        this.commands.set('purge', {
            name: 'purge',
            description: 'Delete multiple messages',
            usage: '!purge <amount>',
            aliases: ['clear', 'clean'],
            category: 'Moderation',
            permissions: ['ManageMessages'],
            execute: async (message, args) => {
                if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return message.reply('❌ You need **Manage Messages** permission!');
                }
                
                const amount = parseInt(args[0]);
                if (isNaN(amount) || amount < 1 || amount > 100) {
                    return message.reply('❌ Please provide a number between 1 and 100!');
                }
                
                try {
                    await message.delete();
                    const deleted = await message.channel.bulkDelete(amount, true);
                    
                    const reply = await message.channel.send(`✅ Deleted ${deleted.size} messages!`);
                    setTimeout(() => reply.delete().catch(() => {}), 5000);
                } catch (error) {
                    console.error('Error purging messages:', error);
                    return message.reply('❌ Failed to delete messages!');
                }
            }
        });

        // Stats Command
        this.commands.set('stats', {
            name: 'stats',
            description: 'Show bot statistics',
            usage: '!stats',
            aliases: ['botstats', 'botinfo'],
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

        // Avatar Command
        this.commands.set('avatar', {
            name: 'avatar',
            description: 'Display user avatar',
            usage: '!avatar [@user]',
            aliases: ['av', 'pfp'],
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
}

module.exports = CommandHandler;