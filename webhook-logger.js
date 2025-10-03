// webhook-logger.js
const express = require('express');
const VPSConversationTracker = require('./vps-conversation-tracker');

class WebhookLogger {
    constructor(tracker, port = 3001) {
        this.tracker = tracker;
        this.port = port;
        this.app = express();
        this.app.use(express.json());
        this.setupRoutes();
    }

    setupRoutes() {
        this.app.post('/log-conversation', (req, res) => {
            try {
                const { 
                    userMessage, 
                    assistantResponse, 
                    inputTokens, 
                    outputTokens, 
                    topic 
                } = req.body;

                if (!userMessage || !assistantResponse || !inputTokens || !outputTokens) {
                    return res.status(400).json({ 
                        error: 'Missing required fields' 
                    });
                }

                if (!this.tracker.currentConversation) {
                    this.tracker.startConversation(topic || 'VPS Management');
                }

                this.tracker.logMessage(
                    userMessage, 
                    assistantResponse, 
                    inputTokens, 
                    outputTokens
                );

                console.log(`✅ Logged conversation: ${inputTokens + outputTokens} tokens`);

                res.json({ 
                    success: true, 
                    totalTokens: inputTokens + outputTokens,
                    conversationId: this.tracker.currentConversation?.id
                });
            } catch (error) {
                console.error('Error logging conversation:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        this.app.post('/start-conversation', (req, res) => {
            const { topic } = req.body;
            this.tracker.startConversation(topic || 'VPS Management');
            res.json({ 
                success: true, 
                conversationId: this.tracker.currentConversation.id 
            });
        });

        this.app.post('/end-conversation', (req, res) => {
            const summary = this.tracker.endConversation();
            res.json({ success: true, summary });
        });

        this.app.get('/stats', (req, res) => {
            const stats = this.tracker.getLifetimeStats();
            res.json(stats);
        });

        this.app.get('/health', (req, res) => {
            res.json({ 
                status: 'ok', 
                currentConversation: !!this.tracker.currentConversation 
            });
        });
    }

    start() {
        this.app.listen(this.port, '0.0.0.0', () => {
            console.log(`📡 Webhook logger listening on port ${this.port}`);
            console.log(`Endpoints:`);
            console.log(`  POST http://localhost:${this.port}/log-conversation`);
            console.log(`  POST http://localhost:${this.port}/start-conversation`);
            console.log(`  POST http://localhost:${this.port}/end-conversation`);
            console.log(`  GET  http://localhost:${this.port}/stats`);
        });
    }
}

module.exports = WebhookLogger;
