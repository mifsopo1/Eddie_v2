const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('appeal')
        .setDescription('Submit an appeal for a ban, mute, or warning')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of punishment to appeal')
                .setRequired(true)
                .addChoices(
                    { name: 'Ban', value: 'ban' },
                    { name: 'Mute/Timeout', value: 'mute' },
                    { name: 'Warning', value: 'warn' },
                    { name: 'Other', value: 'other' }
                ))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Why should we accept your appeal?')
                .setRequired(true)
                .setMaxLength(2000))
        .addStringOption(option =>
            option.setName('evidence')
                .setDescription('Any evidence to support your appeal (links, etc.)')
                .setRequired(false)
                .setMaxLength(1000)),

    async execute(interaction, client, mongoLogger) {
        try {
            const appealType = interaction.options.getString('type');
            const reason = interaction.options.getString('reason');
            const evidence = interaction.options.getString('evidence') || '';
            const user = interaction.user;

            // Check if user already has pending appeal
            const existingAppeal = await mongoLogger.db.collection('appeals').findOne({
                userId: user.id,
                status: { $in: ['pending', 'reviewing'] }
            });

            if (existingAppeal) {
                return interaction.reply({
                    content: '❌ You already have a pending appeal. Please wait for staff to review it.',
                    ephemeral: true
                });
            }

            // Find the original moderation action
            const originalAction = await mongoLogger.db.collection('moderation').findOne(
                {
                    userId: user.id,
                    actionType: appealType
                },
                { sort: { timestamp: -1 } }
            );

            // Create the appeal
            const appeal = {
                userId: user.id,
                userName: user.username,
                discordTag: user.tag,
                appealType: appealType,
                originalAction: originalAction || null,
                appeal: {
                    reason: reason,
                    evidence: evidence,
                    submittedAt: new Date()
                },
                status: 'pending',
                response: null,
                history: [
                    {
                        action: 'submitted',
                        by: user.tag,
                        timestamp: new Date()
                    }
                ]
            };

            const result = await mongoLogger.db.collection('appeals').insertOne(appeal);

            // Send confirmation to user
            const userEmbed = new EmbedBuilder()
                .setColor('#43b581')
                .setTitle('✅ Appeal Submitted Successfully')
                .setDescription('Your appeal has been submitted and is pending review.')
                .addFields(
                    { name: 'Appeal ID', value: result.insertedId.toString(), inline: true },
                    { name: 'Type', value: appealType.toUpperCase(), inline: true },
                    { name: 'Status', value: '⏳ Pending Review', inline: true }
                )
                .addFields({ name: 'What Happens Next?', value: 'Staff will review your appeal and send you a DM when there\'s an update. This typically takes 24-48 hours.' })
                .setTimestamp()
                .setFooter({ text: 'Thank you for your patience' });

            await interaction.reply({ embeds: [userEmbed], ephemeral: true });

            // Log to appeals channel
            const config = require('../config.json');
            const appealsChannel = await client.channels.fetch(config.logChannels.appeals).catch(() => null);

            if (appealsChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#faa61a')
                    .setTitle('🎫 New Appeal Submitted')
                    .setDescription(`**User:** ${user.tag} (\`${user.id}\`)\n**Type:** ${appealType}`)
                    .addFields(
                        { name: 'Reason', value: reason.substring(0, 1024) },
                        { name: 'Appeal ID', value: result.insertedId.toString(), inline: true },
                        { name: 'Status', value: '⏳ Pending', inline: true }
                    )
                    .setThumbnail(user.displayAvatarURL())
                    .setTimestamp();

                if (evidence) {
                    logEmbed.addFields({ name: 'Evidence', value: evidence.substring(0, 1024) });
                }

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setLabel('View in Dashboard')
                            .setStyle(ButtonStyle.Link)
                            .setURL(`${config.dashboard.baseUrl}/appeals/${result.insertedId}`)
                    );

                await appealsChannel.send({ embeds: [logEmbed], components: [row] });
            }

        } catch (error) {
            console.error('Error submitting appeal:', error);
            await interaction.reply({
                content: '❌ An error occurred while submitting your appeal. Please try again or contact an administrator.',
                ephemeral: true
            });
        }
    }
};