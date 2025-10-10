// ============================================
// EXAMPLE: Properly deduplicated ban logging
// ============================================

// At the top of index.js:
class LogDeduplicator {
    constructor() {
        this.recentLogs = new Map();
        this.timeout = 2000;
    }
    
    isDuplicate(key) {
        const now = Date.now();
        const lastLog = this.recentLogs.get(key);
        
        if (lastLog && (now - lastLog) < this.timeout) {
            return true;
        }
        
        this.recentLogs.set(key, now);
        return false;
    }
}

const logDeduplicator = new LogDeduplicator();

// ============================================
// Then in your event listeners:
// ============================================

client.on('guildBanAdd', async (ban) => {
    try {
        // Create unique dedup key
        const dedupKey = `ban_add_${ban.user.id}_${ban.guild.id}`;
        
        // Check if duplicate
        if (logDeduplicator.isDuplicate(dedupKey)) {
            console.log('🔇 Skipping duplicate ban log');
            return; // EXIT EARLY!
        }
        
        // Fetch audit log to get reason
        const auditLogs = await ban.guild.fetchAuditLogs({
            type: 22, // BanAdd
            limit: 1
        });
        
        const banLog = auditLogs.entries.first();
        const reason = banLog?.reason || 'No reason provided';
        
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logBan(ban, reason);
        }
        
        // Log to Discord
        const modChannel = await client.channels.fetch(config.logChannels.moderation).catch(() => null);
        if (modChannel) {
            const embed = new EmbedBuilder()
                .setColor('#ed4245')
                .setTitle('🔨 Member Banned')
                .setDescription(`**${ban.user.tag}** was banned`)
                .addFields(
                    { name: 'User', value: `${ban.user.tag} (\`${ban.user.id}\`)`, inline: true },
                    { name: 'Reason', value: reason, inline: true }
                )
                .setThumbnail(ban.user.displayAvatarURL())
                .setTimestamp();
            
            await modChannel.send({ embeds: [embed] });
        }
        
        console.log(`✅ Logged ban: ${ban.user.tag}`);
    } catch (error) {
        console.error('Error in guildBanAdd:', error);
    }
});

client.on('guildBanRemove', async (ban) => {
    try {
        // Create unique dedup key
        const dedupKey = `ban_remove_${ban.user.id}_${ban.guild.id}`;
        
        // Check if duplicate
        if (logDeduplicator.isDuplicate(dedupKey)) {
            console.log('🔇 Skipping duplicate unban log');
            return;
        }
        
        // Log to MongoDB
        if (mongoLogger && mongoLogger.connected) {
            await mongoLogger.logUnban(ban);
        }
        
        // Log to Discord
        const modChannel = await client.channels.fetch(config.logChannels.moderation).catch(() => null);
        if (modChannel) {
            const embed = new EmbedBuilder()
                .setColor('#43b581')
                .setTitle('✅ Member Unbanned')
                .setDescription(`**${ban.user.tag}** was unbanned`)
                .addFields({ name: 'User', value: `${ban.user.tag} (\`${ban.user.id}\`)` })
                .setThumbnail(ban.user.displayAvatarURL())
                .setTimestamp();
            
            await modChannel.send({ embeds: [embed] });
        }
        
        console.log(`✅ Logged unban: ${ban.user.tag}`);
    } catch (error) {
        console.error('Error in guildBanRemove:', error);
    }
});

// ============================================
// For mutes (guildMemberUpdate):
// ============================================

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        // Check if timeout changed
        if (oldMember.communicationDisabledUntil === newMember.communicationDisabledUntil) {
            return; // No timeout change
        }
        
        const wasMuted = oldMember.communicationDisabledUntil && oldMember.communicationDisabledUntil > new Date();
        const isMuted = newMember.communicationDisabledUntil && newMember.communicationDisabledUntil > new Date();
        
        if (!wasMuted && isMuted) {
            // User was muted
            const dedupKey = `mute_${newMember.id}_${newMember.guild.id}_${Date.now()}`;
            
            if (logDeduplicator.isDuplicate(dedupKey)) {
                return;
            }
            
            const modChannel = await client.channels.fetch(config.logChannels.moderation).catch(() => null);
            if (modChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#faa61a')
                    .setTitle('🔇 Member Muted')
                    .setDescription(`**${newMember.user.tag}** was timed out`)
                    .addFields(
                        { name: 'User', value: `${newMember.user.tag} (\`${newMember.id}\`)`, inline: true },
                        { name: 'Until', value: `<t:${Math.floor(newMember.communicationDisabledUntil.getTime() / 1000)}:F>`, inline: true }
                    )
                    .setThumbnail(newMember.user.displayAvatarURL())
                    .setTimestamp();
                
                await modChannel.send({ embeds: [embed] });
            }
        } else if (wasMuted && !isMuted) {
            // User was unmuted
            const dedupKey = `unmute_${newMember.id}_${newMember.guild.id}_${Date.now()}`;
            
            if (logDeduplicator.isDuplicate(dedupKey)) {
                return;
            }
            
            const modChannel = await client.channels.fetch(config.logChannels.moderation).catch(() => null);
            if (modChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#43b581')
                    .setTitle('🔊 Member Unmuted')
                    .setDescription(`**${newMember.user.tag}** timeout was removed`)
                    .addFields({ name: 'User', value: `${newMember.user.tag} (\`${newMember.id}\`)` })
                    .setThumbnail(newMember.user.displayAvatarURL())
                    .setTimestamp();
                
                await modChannel.send({ embeds: [embed] });
            }
        }
    } catch (error) {
        console.error('Error in guildMemberUpdate:', error);
    }
});

