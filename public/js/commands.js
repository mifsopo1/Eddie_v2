// Load channels and roles on page load
document.addEventListener('DOMContentLoaded', function() {
    loadChannels();
    loadRoles();
});

// Load all channels from API
async function loadChannels() {
    try {
        const response = await fetch('/api/channels');
        const data = await response.json();
        
        if (data.success) {
            // Populate executor dropdown
            const channelSelect = document.getElementById('channelSelect');
            if (channelSelect) {
                data.channels.forEach(channel => {
                    const option = document.createElement('option');
                    option.value = channel.id;
                    option.textContent = `#${channel.name}`;
                    channelSelect.appendChild(option);
                });
            }
            
            // Populate allowed channels checkboxes
            const allowedList = document.getElementById('allowedChannelsList');
            if (allowedList) {
                data.channels.forEach(channel => {
                    const label = document.createElement('label');
                    label.className = 'channel-item';
                    label.innerHTML = `
                        <input type="checkbox" name="allowedChannels" value="${channel.id}">
                        <span>#${channel.name}</span>
                    `;
                    allowedList.appendChild(label);
                });
            }
            
            // Populate ignored channels checkboxes
            const ignoredList = document.getElementById('ignoredChannelsList');
            if (ignoredList) {
                data.channels.forEach(channel => {
                    const label = document.createElement('label');
                    label.className = 'channel-item';
                    label.innerHTML = `
                        <input type="checkbox" name="ignoredChannels" value="${channel.id}">
                        <span>#${channel.name}</span>
                    `;
                    ignoredList.appendChild(label);
                });
            }
        }
    } catch (error) {
        console.error('Error loading channels:', error);
    }
}

// Load all roles from API
async function loadRoles() {
    try {
        const response = await fetch('/api/roles');
        const data = await response.json();
        
        if (data.success) {
            // Populate required roles checkboxes
            const requiredList = document.getElementById('requiredRolesList');
            if (requiredList) {
                data.roles.forEach(role => {
                    const label = document.createElement('label');
                    label.className = 'channel-item';
                    label.innerHTML = `
                        <input type="checkbox" name="requiredRoles" value="${role.id}">
                        <span style="color: ${role.color}">@${role.name}</span>
                    `;
                    requiredList.appendChild(label);
                });
            }
            
            // Populate ignored roles checkboxes
            const ignoredList = document.getElementById('ignoredRolesList');
            if (ignoredList) {
                data.roles.forEach(role => {
                    const label = document.createElement('label');
                    label.className = 'channel-item';
                    label.innerHTML = `
                        <input type="checkbox" name="ignoredRoles" value="${role.id}">
                        <span style="color: ${role.color}">@${role.name}</span>
                    `;
                    ignoredList.appendChild(label);
                });
            }
        }
    } catch (error) {
        console.error('Error loading roles:', error);
    }
}

// Toggle section collapse
function toggleSection(header) {
    const section = header.parentElement;
    const content = section.querySelector('.section-content');
    const icon = header.querySelector('.toggle-icon');
    
    if (section.classList.contains('collapsed')) {
        section.classList.remove('collapsed');
        content.style.display = 'block';
        icon.textContent = '▼';
    } else {
        section.classList.add('collapsed');
        content.style.display = 'none';
        icon.textContent = '▶';
    }
}

// Toggle create form
function toggleCreateForm() {
    const section = document.getElementById('createCommandSection');
    const header = section.querySelector('.section-header');
    toggleSection(header);
}

// Execute command
async function executeCommand(event) {
    event.preventDefault();
    
    const channelId = document.getElementById('channelSelect').value;
    const command = document.getElementById('commandInput').value;
    const resultDiv = document.getElementById('executeResult');
    
    resultDiv.innerHTML = '<div class="loading">Executing...</div>';
    
    try {
        const response = await fetch('/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId, command })
        });
        
        const data = await response.json();
        
        if (data.success) {
            resultDiv.innerHTML = '<div class="success-message">✅ Command executed!</div>';
            document.getElementById('commandInput').value = '';
        } else {
            resultDiv.innerHTML = `<div class="error-message">❌ ${data.error}</div>`;
        }
        
        setTimeout(() => { resultDiv.innerHTML = ''; }, 3000);
    } catch (error) {
        resultDiv.innerHTML = `<div class="error-message">❌ ${error.message}</div>`;
    }
}

// Toggle command enabled/disabled
async function toggleCommand(commandId) {
    try {
        const response = await fetch(`/commands/toggle/${commandId}`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            location.reload();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Filter commands by category
function filterCommands(category) {
    const rows = document.querySelectorAll('.command-row');
    const buttons = document.querySelectorAll('.filter-btn');
    
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    rows.forEach(row => {
        if (category === 'all' || row.dataset.category === category) {
            row.style.display = 'flex';
        } else {
            row.style.display = 'none';
        }
    });
}

// Filter channels/roles in selector
function filterChannels(listId) {
    const searchInput = document.getElementById(listId + 'Search');
    const list = document.getElementById(listId + 'List');
    const filter = searchInput.value.toLowerCase();
    const items = list.querySelectorAll('.channel-item');
    
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(filter)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// Handle "All Channels" checkbox
function handleAllChannels(listId) {
    const list = document.getElementById(listId + 'List');
    const allCheckbox = list.querySelector('input[value="all"]');
    const otherCheckboxes = list.querySelectorAll('input[type="checkbox"]:not([value="all"])');
    
    if (allCheckbox.checked) {
        otherCheckboxes.forEach(cb => {
            cb.checked = false;
            cb.disabled = true;
        });
    } else {
        otherCheckboxes.forEach(cb => {
            cb.disabled = false;
        });
    }
}

// Handle "@everyone" role checkbox
function handleEveryoneRole(listId) {
    const list = document.getElementById(listId + 'List');
    const everyoneCheckbox = list.querySelector('input[value="everyone"]');
    const otherCheckboxes = list.querySelectorAll('input[type="checkbox"]:not([value="everyone"])');
    
    if (everyoneCheckbox.checked) {
        otherCheckboxes.forEach(cb => {
            cb.checked = false;
            cb.disabled = true;
        });
    } else {
        otherCheckboxes.forEach(cb => {
            cb.disabled = false;
        });
    }
}

// Update response type visibility
function updateResponseType() {
    const responseType = document.getElementById('responseType').value;
    
    document.getElementById('textResponse').style.display = 'none';
    document.getElementById('embedResponse').style.display = 'none';
    document.getElementById('reactionResponse').style.display = 'none';
    
    if (responseType === 'text' || responseType === 'dm' || responseType === 'multiple') {
        document.getElementById('textResponse').style.display = 'block';
    } else if (responseType === 'embed') {
        document.getElementById('embedResponse').style.display = 'block';
    } else if (responseType === 'react' || responseType === 'multiple') {
        document.getElementById('reactionResponse').style.display = 'block';
    }
}

// Update trigger help text
function updateTriggerHelp() {
    const triggerType = document.getElementById('triggerType').value;
    const helpText = document.getElementById('triggerHelp');
    const triggerInput = document.getElementById('triggerInput');
    
    const helpTexts = {
        'command': 'Don\'t include the prefix. Separate multiple with commas: hello, hi, hey',
        'exact': 'Message must match exactly: Hello World',
        'contains': 'Triggers if message contains this word/phrase',
        'startswith': 'Triggers if message starts with this text',
        'regex': 'Advanced: Use regular expression pattern'
    };
    
    helpText.textContent = helpTexts[triggerType] || '';
}