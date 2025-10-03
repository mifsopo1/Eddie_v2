const config = require('./config.json');

const statsEmbed = {
    color: 0x6366f1,
    title: '📊 VPS Conversation Tracking - Final Report',
    description: 'Lifetime statistics and lessons learned',
    fields: [
        {
            name: '📈 Overall Stats',
            value: '**2** conversations\n**2** messages\n**1,004** total tokens',
            inline: true
        },
        {
            name: '💰 Actual Usage Cost',
            value: '**$0.01275** total\nInput: 154 tokens\nOutput: 850 tokens',
            inline: true
        },
        {
            name: '🔧 Setup Cost',
            value: '**~$0.57** for this session\n~50,000 tokens spent\nDebugging & setup',
            inline: true
        }
    ],
    timestamp: new Date().toISOString()
};

const lessonEmbed = {
    color: 0x10b981,
    title: '💡 Why You Were Right to Stop',
    description: 'Sometimes the solution costs more than the problem',
    fields: [
        {
            name: '❌ The Problem',
            value: 'Wanted to track token usage to optimize costs',
            inline: false
        },
        {
            name: '🔨 The Solution Attempt',
            value: '• Built VPS conversation tracker\n• Created browser extension\n• Set up webhook server\n• Debugged for hours\n• **Cost: ~$0.57 in tokens**',
            inline: false
        },
        {
            name: '📊 Typical Usage',
            value: '• Average VPS question: 500 tokens (~$0.0015)\n• Average answer: 2,000 tokens (~$0.03)\n• **Typical conversation: $0.03-$0.04**',
            inline: false
        },
        {
            name: '🎯 The Math',
            value: '**Setup cost:** $0.57\n**Typical weekly usage:** $0.15-$0.30\n**Break-even time:** ~2-4 weeks\n\n...but you would have spent this time *using* Claude, not *tracking* Claude! 😅',
            inline: false
        },
        {
            name: '✅ What Actually Worked',
            value: '• Discord logging bot - **Perfect!**\n• Steam sale monitor - **Working!**\n• Invite tracking - **Working!**\n• Manual token logging - **Simple & effective!**',
            inline: false
        },
        {
            name: '🏆 The Real Win',
            value: 'You recognized when to cut your losses. That\'s good engineering judgment!\n\nSometimes "good enough" is better than "perfect but expensive".',
            inline: false
        }
    ],
    footer: {
        text: 'Classic case of over-engineering • The irony is not lost'
    },
    timestamp: new Date().toISOString()
};

async function sendToDiscord() {
    try {
        const response = await fetch(config.claudeWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [statsEmbed, lessonEmbed]
            })
        });

        if (response.ok) {
            console.log('✅ Stats sent to Discord!');
        } else {
            console.log('❌ Failed to send:', response.statusText);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

sendToDiscord();
