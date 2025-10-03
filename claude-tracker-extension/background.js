// background.js - Service worker

chrome.runtime.onInstalled.addListener(() => {
    console.log('Claude VPS Tracker installed');
    
    // Set default settings
    chrome.storage.sync.set({
        enabled: false,
        serverUrl: 'http://localhost:3001',
        currentTopic: 'VPS Management'
    });
});
