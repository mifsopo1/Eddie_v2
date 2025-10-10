// ============================================
// COMPLETE FIX FOR DOUBLE LOGGING
// ============================================

// Add this deduplicator class at the TOP of your index.js (after requires)

class LogDeduplicator {
    constructor() {
        this.recentLogs = new Map();
        this.timeout = 2000; // 2 second window
    }

    isDuplicate(key) {
        const now = Date.now();
        const lastLog = this.recentLogs.get(key);
        
        if (lastLog && (now - lastLog) < this.timeout) {
            console.log('🔇 Skipping duplicate log:', key.substring(0, 50));
            return true;
        }
        
        this.recentLogs.set(key, now);
        
        // Clean up old entries periodically
        if (this.recentLogs.size > 100) {
            const cutoff = now - this.timeout;
            for (const [k, v] of this.recentLogs.entries()) {
                if (v < cutoff) this.recentLogs.delete(k);
            }
        }
        
        return false;
    }
}

const logDeduplicator = new LogDeduplicator();

// ============================================
// Then UPDATE your event listeners like this:
// ============================================

// BAN EVENT
client.on('guildBanAdd', async (ban) => {
    try {
        // CREATE UNIQUE KEY
        const dedupKey = `ban_${ban.user.id}_${ban.guild.id}_${Date.now()}`;
        
        // CHECK IF DUPLICATE
        if (logDeduplicator.isDuplicate(dedupKey)) {
            return; // EXIT EARLY - Don't log!
        }
        
        // Fetch audit log for reason
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

// UNBAN EVENT
client.on('guildBanRemove', async (ban) => {
    try {
        const dedupKey = `unban_${ban.user.id}_${ban.guild.id}_${Date.now()}`;
        
        if (logDeduplicator.isDuplicate(dedupKey)) {
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

// MUTE/UNMUTE EVENT (guildMemberUpdate)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        // Check if timeout status changed
        if (oldMember.communicationDisabledUntil === newMember.communicationDisabledUntil) {
            return; // No change
        }
        
        const wasMuted = oldMember.communicationDisabledUntil && oldMember.communicationDisabledUntil > new Date();
        const isMuted = newMember.communicationDisabledUntil && newMember.communicationDisabledUntil > new Date();
        
        if (!wasMuted && isMuted) {
            // USER WAS MUTED
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
            // USER WAS UNMUTED
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

// ============================================
// If you're logging from COMMANDS too, add deduplication there:
// ============================================

// In your ban command handler:
const dedupKey = `ban_${targetUser.id}_${message.guild.id}_${Date.now()}`;
if (logDeduplicator.isDuplicate(dedupKey)) {
    // Already logged by audit event, skip
    return;
}

// In your mute command handler:
const dedupKey = `mute_${targetUser.id}_${message.guild.id}_${Date.now()}`;
if (logDeduplicator.isDuplicate(dedupKey)) {
    return;
}
