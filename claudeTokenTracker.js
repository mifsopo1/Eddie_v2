// claudeTokenTracker.js
const fs = require('fs');
const { EmbedBuilder } = require('discord.js');

class ClaudeTokenTracker {
    constructor(client, webhookUrl) {
        this.client = client;
        this.webhookUrl = webhookUrl;
        this.dataFile = 'claude-token-usage.json';
        this.tokenData = this.loadTokenData();
        
        // Start daily report scheduler
        this.scheduleDailyReport();
    }

    loadTokenData() {
        try {
            if (fs.existsSync(this.dataFile)) {
                return JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            }
        } catch (error) {
            console.error('Error loading token data:', error);
        }
        
        // Default structure
        return {
            dailyUsage: {},
            totalTokens: 0,
            lastReset: Date.now(),
            conversations: []
        };
    }

    saveTokenData() {
        try {
            fs.writeFileSync(this.dataFile, JSON.stringify(this.tokenData, null, 2));
        } catch (error) {
            console.error('Error saving token data:', error);
        }
    }

    // Log token usage from a conversation
    logTokenUsage(inputTokens, outputTokens, conversationContext = '') {
        const today = new Date().toISOString().split('T')[0];
        
        if (!this.tokenData.dailyUsage[today]) {
            this.tokenData.dailyUsage[today] = {
                input: 0,
                output: 0,
                total: 0,
                conversations: 0
            };
        }
        
        this.tokenData.dailyUsage[today].input += inputTokens;
        this.tokenData.dailyUsage[today].output += outputTokens;
        this.tokenData.dailyUsage[today].total += (inputTokens + outputTokens);
        this.tokenData.dailyUsage[today].conversations += 1;
        
        this.tokenData.totalTokens += (inputTokens + outputTokens);
        
        this.tokenData.conversations.push({
            date: Date.now(),
            input: inputTokens,
            output: outputTokens,
            context: conversationContext
        });
        
        // Keep only last 100 conversations
        if (this.tokenData.conversations.length > 100) {
            this.tokenData.conversations = this.tokenData.conversations.slice(-100);
        }
        
        this.saveTokenData();
    }

    // Get usage for a specific date range
    getUsageStats(days = 7) {
        const stats = {
            totalInput: 0,
            totalOutput: 0,
            totalTokens: 0,
            totalConversations: 0,
            dailyBreakdown: []
        };
        
        const today = new Date();
        
        for (let i = 0; i < days; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            if (this.tokenData.dailyUsage[dateStr]) {
                const dayData = this.tokenData.dailyUsage[dateStr];
                stats.totalInput += dayData.input;
                stats.totalOutput += dayData.output;
                stats.totalTokens += dayData.total;
                stats.totalConversations += dayData.conversations;
                
                stats.dailyBreakdown.push({
                    date: dateStr,
                    ...dayData
                });
            } else {
                stats.dailyBreakdown.push({
                    date: dateStr,
                    input: 0,
                    output: 0,
                    total: 0,
                    conversations: 0
                });
            }
        }
        
        stats.dailyBreakdown.reverse();
        return stats;
    }

    // Generate usage embed
    generateUsageEmbed(days = 7) {
        const stats = this.getUsageStats(days);
        const avgPerDay = stats.totalTokens / days;
        const avgPerConversation = stats.totalConversations > 0 
            ? stats.totalTokens / stats.totalConversations 
            : 0;

        // Calculate costs (Claude Sonnet 3.5 pricing)
        const inputCost = (stats.totalInput / 1000000) * 3.00;  // $3 per million input tokens
        const outputCost = (stats.totalOutput / 1000000) * 15.00; // $15 per million output tokens
        const totalCost = inputCost + outputCost;

        const embed = new EmbedBuilder()
            .setColor('#6366f1')
            .setTitle('🤖 Claude Token Usage Report')
            .setDescription(`Statistics for the last ${days} days`)
            .addFields(
                {
                    name: '📊 Total Usage',
                    value: `**${stats.totalTokens.toLocaleString()}** tokens\n` +
                           `Input: ${stats.totalInput.toLocaleString()}\n` +
                           `Output: ${stats.totalOutput.toLocaleString()}`,
                    inline: true
                },
                {
                    name: '💬 Conversations',
                    value: `**${stats.totalConversations}** total\n` +
                           `Avg: ${(stats.totalConversations / days).toFixed(1)}/day`,
                    inline: true
                },
                {
                    name: '💰 Estimated Cost',
                    value: `**$${totalCost.toFixed(2)}**\n` +
                           `Input: $${inputCost.toFixed(2)}\n` +
                           `Output: $${outputCost.toFixed(2)}`,
                    inline: true
                },
                {
                    name: '📈 Averages',
                    value: `**${avgPerDay.toFixed(0)}** tokens/day\n` +
                           `**${avgPerConversation.toFixed(0)}** tokens/conversation`,
                    inline: false
                }
            )
            .setTimestamp();

        // Add daily breakdown
        if (stats.dailyBreakdown.length > 0) {
            const recentDays = stats.dailyBreakdown.slice(-5);
            const breakdown = recentDays.map(day => {
                const date = new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return `**${date}**: ${day.total.toLocaleString()} tokens (${day.conversations} convos)`;
            }).join('\n');
            
            embed.addFields({
                name: '📅 Recent Daily Usage',
                value: breakdown || 'No data',
                inline: false
            });
        }

        return embed;
    }

    // Generate optimization tips
    generateOptimizationEmbed() {
        const stats = this.getUsageStats(30);
        const avgTokensPerConvo = stats.totalConversations > 0 
            ? stats.totalTokens / stats.totalConversations 
            : 0;

        const tips = [];

        if (avgTokensPerConvo > 50000) {
            tips.push('🔴 **High token usage per conversation** (>50k)\n' +
                     '→ Consider breaking down complex requests into smaller queries');
        }

        if (stats.totalOutput > stats.totalInput * 2) {
            tips.push('🟡 **Output tokens are 2x+ input tokens**\n' +
                     '→ Request more concise responses when possible');
        }

        if (stats.totalConversations > 100) {
            tips.push('🟢 **High conversation volume**\n' +
                     '→ Consider caching frequently used information');
        }

        const last7Days = this.getUsageStats(7);
        const prev7Days = this.getUsageStats(14);
        const weeklyGrowth = prev7Days.totalTokens > 0 
            ? ((last7Days.totalTokens - prev7Days.totalTokens) / prev7Days.totalTokens) * 100
            : 0;

        if (weeklyGrowth > 50) {
            tips.push(`🔴 **Usage increased ${weeklyGrowth.toFixed(0)}% this week**\n` +
                     '→ Review recent usage patterns');
        }

        if (tips.length === 0) {
            tips.push('✅ **Your token usage looks optimized!**\n' +
                     '→ Keep up the good practices');
        }

        const embed = new EmbedBuilder()
            .setColor('#10b981')
            .setTitle('💡 Token Usage Optimization Tips')
            .setDescription(tips.join('\n\n'))
            .addFields(
                {
                    name: '📊 Current Stats',
                    value: `Avg tokens/conversation: **${avgTokensPerConvo.toFixed(0)}**\n` +
                           `Input/Output ratio: **${stats.totalOutput > 0 ? (stats.totalInput / stats.totalOutput).toFixed(2) : 'N/A'}**`,
                    inline: false
                },
                {
                    name: '🎯 Best Practices',
                    value: '• Be specific and concise in prompts\n' +
                           '• Use system messages effectively\n' +
                           '• Request shorter responses when detailed output isn\'t needed\n' +
                           '• Avoid redundant context in follow-ups',
                    inline: false
                }
            )
            .setTimestamp();

        return embed;
    }

    // Send daily report via webhook
    async sendDailyReport() {
        try {
            const embed = this.generateUsageEmbed(7);
            
            const response = await fetch(this.webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    embeds: [embed.toJSON()]
                })
            });

            if (response.ok) {
                console.log('✅ Daily Claude token report sent');
            } else {
                console.error('❌ Failed to send daily report:', response.statusText);
            }
        } catch (error) {
            console.error('❌ Error sending daily report:', error);
        }
    }

    // Schedule daily reports at midnight
    scheduleDailyReport() {
        const scheduleNext = () => {
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            
            const msUntilMidnight = tomorrow - now;
            
            setTimeout(() => {
                this.sendDailyReport();
                scheduleNext(); // Schedule next day
            }, msUntilMidnight);
            
            console.log(`📅 Next Claude token report scheduled for: ${tomorrow.toLocaleString()}`);
        };
        
        scheduleNext();
    }

    // Manual command to view usage
    async handleTokenUsageCommand(message) {
        const embed = this.generateUsageEmbed(7);
        await message.reply({ embeds: [embed] });
    }

    // Manual command to view optimization tips
    async handleOptimizationCommand(message) {
        const embed = this.generateOptimizationEmbed();
        await message.reply({ embeds: [embed] });
    }
}

module.exports = ClaudeTokenTracker;
