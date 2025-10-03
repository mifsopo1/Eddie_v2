// popup.js - Extension popup logic

document.addEventListener('DOMContentLoaded', async () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statsBtn = document.getElementById('statsBtn');
    const topicInput = document.getElementById('topic');
    const statusDiv = document.getElementById('status');
    
    // Get current status
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (response) => {
        if (response && response.active) {
            showActive(response.topic);
        } else {
            showInactive();
        }
    });
    
    startBtn.addEventListener('click', async () => {
        const topic = topicInput.value || 'VPS Management';
        
        chrome.tabs.sendMessage(tab.id, { 
            action: 'start', 
            topic: topic 
        }, (response) => {
            if (response && response.success) {
                showActive(topic);
            }
        });
    });
    
    stopBtn.addEventListener('click', async () => {
        chrome.tabs.sendMessage(tab.id, { action: 'stop' }, (response) => {
            if (response && response.success) {
                showInactive();
            }
        });
    });
    
    statsBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: 'http://localhost:3001/stats' });
    });
    
    function showActive(topic) {
        statusDiv.textContent = `🟢 Tracking: ${topic}`;
        statusDiv.className = 'status active';
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        topicInput.disabled = true;
    }
    
    function showInactive() {
        statusDiv.textContent = '⭕ Not Tracking';
        statusDiv.className = 'status inactive';
        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';
        topicInput.disabled = false;
    }
});
