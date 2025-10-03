// vps-conversation-tracker.js
const ClaudeTokenTracker = require('./claudeTokenTracker');
const fs = require('fs');

class VPSConversationTracker {
    constructor(tracker) {
        this.tracker = tracker;
        this.conversationFile = 'vps-conversations.json';
        this.conversations = this.loadConversations();
        this.currentConversation = null;
    }

    loadConversations() {
        try {
            if (fs.existsSync(this.conversationFile)) {
                return JSON.parse(fs.readFileSync(this.conversationFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading conversations:', error);
        }
        return [];
    }

    saveConversations() {
        try {
            fs.writeFileSync(this.conversationFile, JSON.stringify(this.conversations, null, 2));
        } catch (error) {
            console.error('Error saving conversations:', error);
        }
    }

    startConversation(topic) {
        this.currentConversation = {
            id: Date.now(),
            topic: topic,
            startTime: Date.now(),
            messages: [],
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCost: 0
        };
    }

    logMessage(userMessage, assistantResponse, inputTokens, outputTokens) {
        if (!this.currentConversation) {
            this.startConversation('Untitled Conversation');
        }

        const inputCost = (inputTokens / 1000000) * 3.00;
        const outputCost = (outputTokens / 1000000) * 15.00;
        const messageCost = inputCost + outputCost;

        const messageData = {
            timestamp: Date.now(),
            userMessage: userMessage.substring(0, 200),
            assistantResponse: assistantResponse.substring(0, 200),
            inputTokens: inputTokens,
            outputTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
            cost: messageCost
        };

        this.currentConversation.messages.push(messageData);
        this.currentConversation.totalInputTokens += inputTokens;
        this.currentConversation.totalOutputTokens += outputTokens;
        this.currentConversation.totalCost += messageCost;

        this.tracker.logTokenUsage(
            inputTokens, 
            outputTokens, 
            `VPS: ${this.currentConversation.topic}`
        );

        this.saveConversations();
    }

    endConversation() {
        if (this.currentConversation) {
            this.currentConversation.endTime = Date.now();
            this.currentConversation.duration = 
                this.currentConversation.endTime - this.currentConversation.startTime;
            
            this.conversations.push(this.currentConversation);
            this.saveConversations();
            
            const summary = {
                topic: this.currentConversation.topic,
                messages: this.currentConversation.messages.length,
                totalTokens: this.currentConversation.totalInputTokens + 
                            this.currentConversation.totalOutputTokens,
                cost: this.currentConversation.totalCost
            };
            
            this.currentConversation = null;
            return summary;
        }
        return null;
    }

    getLifetimeStats() {
        const allConvos = [...this.conversations];
        if (this.currentConversation) {
            allConvos.push(this.currentConversation);
        }

        const stats = {
            totalConversations: allConvos.length,
            totalMessages: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalTokens: 0,
            totalCost: 0,
            averageTokensPerConvo: 0,
            averageCostPerConvo: 0,
            recentConversations: []
        };

        allConvos.forEach(convo => {
            stats.totalMessages += convo.messages.length;
            stats.totalInputTokens += convo.totalInputTokens;
            stats.totalOutputTokens += convo.totalOutputTokens;
            stats.totalCost += convo.totalCost;
        });

        stats.totalTokens = stats.totalInputTokens + stats.totalOutputTokens;
        stats.averageTokensPerConvo = stats.totalConversations > 0 
            ? stats.totalTokens / stats.totalConversations 
            : 0;
        stats.averageCostPerConvo = stats.totalConversations > 0
            ? stats.totalCost / stats.totalConversations
            : 0;

        stats.recentConversations = allConvos
            .slice(-5)
            .map(c => ({
                topic: c.topic,
                messages: c.messages.length,
                tokens: c.totalInputTokens + c.totalOutputTokens,
                cost: c.totalCost.toFixed(4),
                date: new Date(c.startTime).toLocaleDateString()
            }))
            .reverse();

        return stats;
    }

    generateStatsEmbed() {
        const { EmbedBuilder } = require('discord.js');
        const stats = this.getLifetimeStats();

        const embed = new EmbedBuilder()
            .setColor('#6366f1')
            .setTitle('🤖 VPS Conversation Statistics')
            .setDescription('Lifetime usage for VPS management conversations')
            .addFields(
                {
                    name: '📊 Overall Stats',
                    value: `**${stats.totalConversations}** conversations\n` +
                           `**${stats.totalMessages}** messages\n` +
                           `**${stats.totalTokens.toLocaleString()}** total tokens`,
                    inline: true
                },
                {
                    name: '💰 Cost Analysis',
                    value: `**$${stats.totalCost.toFixed(4)}** total\n` +
                           `**$${stats.averageCostPerConvo.toFixed(4)}** per conversation\n` +
                           `Input: ${stats.totalInputTokens.toLocaleString()}\n` +
                           `Output: ${stats.totalOutputTokens.toLocaleString()}`,
                    inline: true
                },
                {
                    name: '📈 Averages',
                    value: `**${Math.round(stats.averageTokensPerConvo).toLocaleString()}** tokens/convo\n` +
                           `**${(stats.totalMessages / stats.totalConversations || 0).toFixed(1)}** messages/convo`,
                    inline: true
                }
            );

        if (stats.recentConversations.length > 0) {
            const recentList = stats.recentConversations.map((c, i) => 
                `${i + 1}. **${c.topic}** (${c.date})\n` +
                `   ${c.messages} msgs • ${c.tokens.toLocaleString()} tokens • $${c.cost}`
            ).join('\n\n');

            embed.addFields({
                name: '📝 Recent Conversations',
                value: recentList,
                inline: false
            });
        }

        if (this.currentConversation) {
            embed.addFields({
                name: '🔴 Current Session',
                value: `**${this.currentConversation.topic}**\n` +
                       `${this.currentConversation.messages.length} messages • ` +
                       `${(this.currentConversation.totalInputTokens + this.currentConversation.totalOutputTokens).toLocaleString()} tokens • ` +
                       `$${this.currentConversation.totalCost.toFixed(4)}`,
                inline: false
            });
        }

        embed.setTimestamp();
        embed.setFooter({ 
            text: 'Claude Sonnet 3.5 • $3/M input • $15/M output' 
        });

        return embed;
    }

    async sendStatsToDiscord(webhookUrl) {
        const embed = this.generateStatsEmbed();
        
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    embeds: [embed.toJSON()]
                })
            });

            if (response.ok) {
                console.log('✅ VPS stats sent to Discord');
                return true;
            } else {
                console.error('❌ Failed to send stats:', response.statusText);
                return false;
            }
        } catch (error) {
            console.error('❌ Error sending stats:', error);
            return false;
        }
    }
}

module.exports = VPSConversationTracker;
