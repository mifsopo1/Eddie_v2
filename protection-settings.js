// Load protection settings when page loads
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🔧 Loading protection settings...');
    await loadProtectionSettings();
    
    // Add event listener for save button
    const saveButton = document.getElementById('saveProtectionSettings');
    if (saveButton) {
        saveButton.addEventListener('click', saveProtectionSettings);
        console.log('✅ Save button listener attached');
    }
});

// Load current settings from server
async function loadProtectionSettings() {
    try {
        const response = await fetch('/api/protection/settings');
        const data = await response.json();
        
        if (data.success) {
            const settings = data.settings;
            console.log('📥 Loaded settings:', settings);
            
            // Anti-Spam Settings
            document.getElementById('antiSpamEnabled').checked = settings.antiSpam.enabled;
            document.getElementById('maxMessages').value = settings.antiSpam.maxMessages;
            document.getElementById('timeWindow').value = settings.antiSpam.timeWindow;
            document.getElementById('spamAction').value = settings.antiSpam.action;
            
            // Mass Mention Settings
            document.getElementById('massMentionEnabled').checked = settings.massMention.enabled;
            document.getElementById('maxMentions').value = settings.massMention.maxMentions;
            document.getElementById('mentionAction').value = settings.massMention.action;
            
            // Anti-Raid Settings
            document.getElementById('antiRaidEnabled').checked = settings.antiRaid.enabled;
            document.getElementById('joinThreshold').value = settings.antiRaid.joinThreshold;
            document.getElementById('raidTimeWindow').value = settings.antiRaid.timeWindow;
            document.getElementById('raidAction').value = settings.antiRaid.action;
            
            // Update visual states
            updateSectionStates();
            
            console.log('✅ Protection settings loaded successfully');
        } else {
            console.error('❌ Failed to load settings:', data.error);
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
    console.log('💾 Saving protection settings...');
    
    const saveButton = document.getElementById('saveProtectionSettings');
    const originalText = saveButton.innerHTML;
    saveButton.disabled = true;
    saveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
    const settings = {
        antiSpam: {
            enabled: document.getElementById('antiSpamEnabled').checked,
            maxMessages: parseInt(document.getElementById('maxMessages').value),
            timeWindow: parseInt(document.getElementById('timeWindow').value),
            action: document.getElementById('spamAction').value
        },
        massMention: {
            enabled: document.getElementById('massMentionEnabled').checked,
            maxMentions: parseInt(document.getElementById('maxMentions').value),
            action: document.getElementById('mentionAction').value
        },
        antiRaid: {
            enabled: document.getElementById('antiRaidEnabled').checked,
            joinThreshold: parseInt(document.getElementById('joinThreshold').value),
            timeWindow: parseInt(document.getElementById('raidTimeWindow').value),
            action: document.getElementById('raidAction').value
        }
    };
    
    console.log('📤 Sending settings:', settings);
    
    try {
        const response = await fetch('/api/protection/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        const data = await response.json();
        console.log('📥 Server response:', data);
        
        if (data.success) {
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
            throw new Error(data.error || 'Failed to save settings');
        }
    } catch (error) {
        console.error('❌ Save error:', error);
        alert('❌ Failed to save settings: ' + error.message);
        saveButton.innerHTML = originalText;
        saveButton.disabled = false;
    }
}