class StickyManager {
    constructor(client, mongoLogger) {
        this.client = client;
        this.mongoLogger = mongoLogger;
        this.messageCounters = new Map(); // Track message counts per channel
    }

    async initialize() {
        console.log('📌 Initializing Sticky Message Manager...');
        
        // Listen for messages
        this.client.on('messageCreate', async (message) => {
            if (message.author.bot) return;
            await this.handleMessage(message);
        });
        
        console.log('✅ Sticky Message Manager initialized');
    }

    async handleMessage(message) {
        try {
            // Get all active sticky messages for this channel
            const stickyMessages = await this.mongoLogger.db.collection('stickyMessages')
                .find({
                    channelId: message.channel.id,
                    enabled: true
                })
                .toArray();
            
            if (stickyMessages.length === 0) return;
            
            for (const sticky of stickyMessages) {
                // Initialize counter if needed
                const key = `${sticky.channelId}_${sticky._id}`;
                if (!this.messageCounters.has(key)) {
                    this.messageCounters.set(key, 0);
                }
                
                // Increment counter
                const count = this.messageCounters.get(key) + 1;
                this.messageCounters.set(key, count);
                
                console.log(`📊 Sticky ${sticky._id}: ${count}/${sticky.threshold} messages`);
                
                // Check if we should repost
                if (count >= sticky.threshold) {
                    await this.repostSticky(sticky);
                    this.messageCounters.set(key, 0); // Reset counter
                }
            }
        } catch (error) {
            console.error('Error handling sticky message:', error);
        }
    }

    async repostSticky(sticky) {
        try {
            const channel = await this.client.channels.fetch(sticky.channelId);
            if (!channel || !channel.isTextBased()) return;
            
            // Delete old sticky message if it exists
            if (sticky.messageId) {
                try {
                    const oldMessage = await channel.messages.fetch(sticky.messageId);
                    await oldMessage.delete();
                    console.log(`🗑️ Deleted old sticky message in #${channel.name}`);
                } catch (error) {
                    console.log('Could not delete old sticky message:', error.message);
                }
            }
            
            // Send new sticky message
            const newMessage = await channel.send(sticky.message);
            
            // Update database
            await this.mongoLogger.db.collection('stickyMessages').updateOne(
                { _id: sticky._id },
                { 
                    $set: { messageId: newMessage.id },
                    $inc: { repostCount: 1 }
                }
            );
            
            console.log(`📌 Reposted sticky in #${channel.name} (total: ${(sticky.repostCount || 0) + 1})`);
        } catch (error) {
            console.error('Error reposting sticky:', error);
        }
    }
}

module.exports = StickyManager;