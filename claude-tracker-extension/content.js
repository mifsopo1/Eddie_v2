// content.js - Captures Claude conversations

class ClaudeConversationTracker {
    constructor() {
        this.serverUrl = 'http://localhost:3001';
        this.conversationActive = false;
        this.currentTopic = '';
        this.lastMessageCount = 0;
        this.observer = null;
        this.init();
    }

    init() {
        console.log('🤖 Claude VPS Tracker initialized');
        
        // Load settings
        chrome.storage.sync.get(['enabled', 'serverUrl', 'currentTopic'], (data) => {
            this.serverUrl = data.serverUrl || 'http://localhost:3001';
            this.conversationActive = data.enabled || false;
            this.currentTopic = data.currentTopic || 'VPS Management';
            
            if (this.conversationActive) {
                this.startTracking();
            }
        });

        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'start') {
                this.startConversation(request.topic);
                sendResponse({ success: true });
            } else if (request.action === 'stop') {
                this.stopConversation();
                sendResponse({ success: true });
            } else if (request.action === 'getStatus') {
                sendResponse({ 
                    active: this.conversationActive,
                    topic: this.currentTopic 
                });
            }
        });
    }

    startTracking() {
        console.log('👀 Started tracking conversations');
        
        // Watch for new messages
        this.observer = new MutationObserver(() => {
            this.checkForNewMessages();
        });

        // Observe the chat container
        const chatContainer = document.querySelector('[data-testid="conversation"]') || 
                            document.querySelector('.conversation') ||
                            document.body;
        
        if (chatContainer) {
            this.observer.observe(chatContainer, {
                childList: true,
                subtree: true
            });
        }
    }

    stopTracking() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    async startConversation(topic) {
        this.currentTopic = topic;
        this.conversationActive = true;
        
        chrome.storage.sync.set({ 
            enabled: true, 
            currentTopic: topic 
        });
        
        try {
            const response = await fetch(`${this.serverUrl}/start-conversation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic: topic })
            });
            
            if (response.ok) {
                console.log('✅ Started conversation:', topic);
                this.startTracking();
            }
        } catch (error) {
            console.error('❌ Error starting conversation:', error);
        }
    }

    async stopConversation() {
        this.conversationActive = false;
        this.stopTracking();
        
        chrome.storage.sync.set({ enabled: false });
        
        try {
            const response = await fetch(`${this.serverUrl}/end-conversation`, {
                method: 'POST'
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Ended conversation:', data.summary);
            }
        } catch (error) {
            console.error('❌ Error ending conversation:', error);
        }
    }

    checkForNewMessages() {
        if (!this.conversationActive) return;

        // Find all messages in the conversation
        const messages = this.extractMessages();
        
        if (messages.length > this.lastMessageCount) {
            // New messages detected
            const newMessages = messages.slice(this.lastMessageCount);
            this.lastMessageCount = messages.length;
            
            // Process pairs (user message + assistant response)
            for (let i = 0; i < newMessages.length; i += 2) {
                if (i + 1 < newMessages.length) {
                    const userMsg = newMessages[i];
                    const assistantMsg = newMessages[i + 1];
                    
                    if (userMsg.role === 'user' && assistantMsg.role === 'assistant') {
                        this.logMessagePair(userMsg.content, assistantMsg.content);
                    }
                }
            }
        }
    }

    extractMessages() {
        const messages = [];
        
        // Try different selectors for Claude's UI
        const messageElements = document.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]') ||
                               document.querySelectorAll('.message');
        
        messageElements.forEach(el => {
            const isUser = el.getAttribute('data-testid') === 'user-message' || 
                          el.classList.contains('user-message');
            
            const content = el.textContent || el.innerText;
            
            if (content && content.trim()) {
                messages.push({
                    role: isUser ? 'user' : 'assistant',
                    content: content.trim()
                });
            }
        });
        
        return messages;
    }

    estimateTokens(text) {
        // Rough estimation: ~4 characters per token
        // More accurate than word count for code/technical content
        const chars = text.length;
        const tokens = Math.ceil(chars / 4);
        
        // Add overhead for message structure
        return tokens + 50;
    }

    async logMessagePair(userMessage, assistantMessage) {
        const inputTokens = this.estimateTokens(userMessage);
        const outputTokens = this.estimateTokens(assistantMessage);
        
        console.log(`📊 Logging: ${inputTokens} input, ${outputTokens} output tokens`);
        
        try {
            const response = await fetch(`${this.serverUrl}/log-conversation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userMessage: userMessage,
                    assistantResponse: assistantMessage,
                    inputTokens: inputTokens,
                    outputTokens: outputTokens,
                    topic: this.currentTopic
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Logged conversation:', data.totalTokens, 'tokens');
                
                // Show notification
                this.showNotification(
                    `Logged ${data.totalTokens} tokens`,
                    `Input: ${inputTokens} | Output: ${outputTokens}`
                );
            }
        } catch (error) {
            console.error('❌ Error logging conversation:', error);
        }
    }

    showNotification(title, message) {
        // Create a subtle notification in the page
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-family: sans-serif;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        notification.innerHTML = `
            <div style="font-weight: bold;">${title}</div>
            <div style="font-size: 12px; margin-top: 4px;">${message}</div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Initialize tracker
const tracker = new ClaudeConversationTracker();
