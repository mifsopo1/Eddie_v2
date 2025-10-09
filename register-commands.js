const { REST, Routes } = require('discord.js');
const config = require('./config.json');

const commands = [
    {
        name: 'appeal',
        description: 'Submit an appeal for a ban, mute, or warning',
        options: [
            {
                name: 'type',
                description: 'Type of punishment to appeal',
                type: 3,
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
                type: 3,
                required: true,
                max_length: 2000
            },
            {
                name: 'evidence',
                description: 'Any evidence to support your appeal (links, etc.)',
                type: 3,
                required: false,
                max_length: 1000
            }
        ]
    }
];

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
    try {
        console.log('🔄 Registering /appeal slash command...');

        await rest.put(
            Routes.applicationGuildCommands(config.clientId, config.guildId),
            { body: commands }
        );

        console.log('✅ /appeal command registered successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error registering commands:', error);
        process.exit(1);
    }
})();
