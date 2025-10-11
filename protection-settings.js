console.log('🚀 Protection settings loaded');

document.addEventListener('DOMContentLoaded', async () => {
    console.log('✅ Page loaded, loading settings...');
    await loadProtectionSettings();
    
    // Save button
    const saveBtn = document.getElementById('saveProtectionSettings');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveProtectionSettings);
    }
    
    // Real-time toggle feedback
    setupToggleListeners();
});

function setupToggleListeners() {
    const toggleIds = ['antiSpamEnabled', 'massMentionEnabled', 'antiRaidEnabled'];
    
    toggleIds.forEach(id => {
        const toggle = document.getElementById(id);
        if (toggle) {
            toggle.addEventListener('change', function() {
                console.log(`Toggle ${id} changed to:`, this.checked);
            });
        }
    });
}

async function loadProtectionSettings() {
    try {
        const response = await fetch('/api/protection/settings');
        const data = await response.json();
        
        console.log('📥 Loaded from server:', data);
        
        if (data.success) {
            const s = data.settings;
            
            // Anti-Spam
            const antiSpam = document.getElementById('antiSpamEnabled');
            if (antiSpam) antiSpam.checked = s.antiSpam.enabled;
            const maxMsg = document.getElementById('maxMessages');
            if (maxMsg) maxMsg.value = s.antiSpam.maxMessages;
            const timeWin = document.getElementById('timeWindow');
            if (timeWin) timeWin.value = s.antiSpam.timeWindow;
            const spamAct = document.getElementById('spamAction');
            if (spamAct) spamAct.value = s.antiSpam.action;
            
            // Mass Mention
            const massMention = document.getElementById('massMentionEnabled');
            if (massMention) massMention.checked = s.massMention.enabled;
            const maxMent = document.getElementById('maxMentions');
            if (maxMent) maxMent.value = s.massMention.maxMentions;
            const mentAct = document.getElementById('mentionAction');
            if (mentAct) mentAct.value = s.massMention.action;
            
            // Anti-Raid
            const antiRaid = document.getElementById('antiRaidEnabled');
            if (antiRaid) antiRaid.checked = s.antiRaid.enabled;
            const joinThresh = document.getElementById('joinThreshold');
            if (joinThresh) joinThresh.value = s.antiRaid.joinThreshold;
            const raidTime = document.getElementById('raidTimeWindow');
            if (raidTime) raidTime.value = s.antiRaid.timeWindow;
            const raidAct = document.getElementById('raidAction');
            if (raidAct) raidAct.value = s.antiRaid.action;
            
            console.log('✅ Form updated successfully');
            console.log('  Anti-Spam enabled:', antiSpam?.checked);
            console.log('  Mass Mention enabled:', massMention?.checked);
            console.log('  Anti-Raid enabled:', antiRaid?.checked);
        }
    } catch (error) {
        console.error('❌ Load error:', error);
    }
}

async function saveProtectionSettings() {
    console.log('💾 Saving...');
    
    const btn = document.getElementById('saveProtectionSettings');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    
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
    
    console.log('📤 Saving:', settings);
    
    try {
        const response = await fetch('/api/protection/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        const data = await response.json();
        console.log('📥 Response:', data);
        
        if (data.success) {
            btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.disabled = false;
            }, 2000);
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        console.error('❌ Save error:', error);
        alert('Save failed: ' + error.message);
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}