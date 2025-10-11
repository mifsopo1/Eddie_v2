console.log('🚀 Protection settings script loaded!');

// Load protection settings when page loads
document.addEventListener('DOMContentLoaded', async () => {
    console.log('✅ DOM loaded, initializing...');
    
    try {
        await loadProtectionSettings();
    } catch (error) {
        console.error('❌ Failed to load settings on page load:', error);
    }
    
    // Add event listener for save button
    const saveButton = document.getElementById('saveProtectionSettings');
    if (saveButton) {
        console.log('✅ Save button found, attaching listener');
        saveButton.addEventListener('click', async (e) => {
            e.preventDefault();
            console.log('🖱️ Save button clicked!');
            await saveProtectionSettings();
        });
    } else {
        console.error('❌ Save button not found! ID: saveProtectionSettings');
    }
});

// Load current settings from server
async function loadProtectionSettings() {
    console.log('📡 Fetching protection settings from server...');
    
    try {
        const response = await fetch('/api/protection/settings');
        console.log('📥 Response status:', response.status);
        
        const data = await response.json();
        console.log('📦 Response data:', data);
        
        if (data.success) {
            const settings = data.settings;
            console.log('✅ Settings loaded successfully:', settings);
            
            // Anti-Spam Settings
            const antiSpamToggle = document.getElementById('antiSpamEnabled');
            const maxMessages = document.getElementById('maxMessages');
            const timeWindow = document.getElementById('timeWindow');
            const spamAction = document.getElementById('spamAction');
            
            if (antiSpamToggle) antiSpamToggle.checked = settings.antiSpam.enabled;
            if (maxMessages) maxMessages.value = settings.antiSpam.maxMessages;
            if (timeWindow) timeWindow.value = settings.antiSpam.timeWindow;
            if (spamAction) spamAction.value = settings.antiSpam.action;
            
            // Mass Mention Settings
            const massMentionToggle = document.getElementById('massMentionEnabled');
            const maxMentions = document.getElementById('maxMentions');
            const mentionAction = document.getElementById('mentionAction');
            
            if (massMentionToggle) massMentionToggle.checked = settings.massMention.enabled;
            if (maxMentions) maxMentions.value = settings.massMention.maxMentions;
            if (mentionAction) mentionAction.value = settings.massMention.action;
            
            // Anti-Raid Settings
            const antiRaidToggle = document.getElementById('antiRaidEnabled');
            const joinThreshold = document.getElementById('joinThreshold');
            const raidTimeWindow = document.getElementById('raidTimeWindow');
            const raidAction = document.getElementById('raidAction');
            
            if (antiRaidToggle) antiRaidToggle.checked = settings.antiRaid.enabled;
            if (joinThreshold) joinThreshold.value = settings.antiRaid.joinThreshold;
            if (raidTimeWindow) raidTimeWindow.value = settings.antiRaid.timeWindow;
            if (raidAction) raidAction.value = settings.antiRaid.action;
            
            // Update visual states
            updateSectionStates();
            
            console.log('✅ All form fields populated');
        } else {
            console.error('❌ Server returned error:', data.error);
            alert('Failed to load settings: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('❌ Error loading settings:', error);
        alert('Failed to load settings: ' + error.message);
    }
}

// Update visual state of sections
function updateSectionStates() {
    const sections = [
        { toggle: 'antiSpamEnabled', section: 'antiSpamSection' },
        { toggle: 'massMentionEnabled', section: 'massMentionSection' },
        { toggle: 'antiRaidEnabled', section: 'antiRaidSection' }
    ];
    
    sections.forEach(({ toggle, section }) => {
        const toggleEl = document.getElementById(toggle);
        const sectionEl = document.getElementById(section);
        if (toggleEl && sectionEl) {
            if (toggleEl.checked) {
                sectionEl.classList.add('enabled');
            } else {
                sectionEl.classList.remove('enabled');
            }
        }
    });
}

// Save settings to server
async function saveProtectionSettings() {
    console.log('💾 Starting save process...');
    
    const saveButton = document.getElementById('saveProtectionSettings');
    if (!saveButton) {
        console.error('❌ Save button not found!');
        return;
    }
    
    const originalText = saveButton.innerHTML;
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    // Gather all settings
    const settings = {
        antiSpam: {
            enabled: document.getElementById('antiSpamEnabled')?.checked || false,
            maxMessages: parseInt(document.getElementById('maxMessages')?.value) || 5,
            timeWindow: parseInt(document.getElementById('timeWindow')?.value) || 5,
            action: document.getElementById('spamAction')?.value || 'delete'
        },
        massMention: {
            enabled: document.getElementById('massMentionEnabled')?.checked || false,
            maxMentions: parseInt(document.getElementById('maxMentions')?.value) || 5,
            action: document.getElementById('mentionAction')?.value || 'delete'
        },
        antiRaid: {
            enabled: document.getElementById('antiRaidEnabled')?.checked || false,
            joinThreshold: parseInt(document.getElementById('joinThreshold')?.value) || 10,
            timeWindow: parseInt(document.getElementById('raidTimeWindow')?.value) || 60,
            action: document.getElementById('raidAction')?.value || 'kick'
        }
    };
    
    console.log('📤 Sending settings to server:', settings);
    
    try {
        const response = await fetch('/api/protection/settings', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(settings)
        });
        
        console.log('📥 Response status:', response.status);
        
        const data = await response.json();
        console.log('📦 Response data:', data);
        
        if (data.success) {
            console.log('✅ Settings saved successfully!');
            
            saveButton.innerHTML = '<i class="fas fa-check"></i> Saved!';
            saveButton.classList.remove('btn-primary');
            saveButton.classList.add('btn-success');
            
            setTimeout(() => {
                saveButton.innerHTML = originalText;
                saveButton.classList.remove('btn-success');
                saveButton.classList.add('btn-primary');
                saveButton.disabled = false;
            }, 2000);
        } else {
            throw new Error(data.error || 'Server returned failure status');
        }
    } catch (error) {
        console.error('❌ Save error:', error);
        alert('❌ Failed to save settings: ' + error.message);
        saveButton.innerHTML = originalText;
        saveButton.disabled = false;
    }
}