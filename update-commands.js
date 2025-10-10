const fs = require('fs');

console.log('🔧 Starting commands.js Update Script...\n');

// Try to find the commands.js file
const possiblePaths = [
    './commands.js',
    './src/commands.js',
    './commands/commands.js',
    './handlers/commands.js',
    './lib/commands.js'
];

let filePath = null;
for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
        filePath = p;
        console.log(`✅ Found commands.js at: ${p}\n`);
        break;
    }
}

if (!filePath) {
    console.error('❌ Could not find commands.js!');
    console.log('\n📁 Files in current directory:');
    fs.readdirSync('.').forEach(file => {
        if (file.endsWith('.js')) console.log(`   - ${file}`);
    });
    process.exit(1);
}

// Read the current commands file
let content = fs.readFileSync(filePath, 'utf8');

// Backup the original file
const backupPath = filePath + '.backup';
fs.writeFileSync(backupPath, content);
console.log(`✅ Backup created: ${backupPath}\n`);

// Check if helper methods already exist
if (content.includes('getTargetMember')) {
    console.log('⚠️  Helper methods already exist! Skipping addition...\n');
} else {
    // 1. Add helper methods - find a good insertion point
    const helperMethods = `
    // ========== HELPER METHODS FOR USER ID SUPPORT ==========
    
    // Helper method to get user from mention or ID
    async getTargetMember(message, args) {
        // Check for mention first
        let target = message.mentions.members.first();
        
        // If no mention, check if first arg is a user ID
        if (!target && args[0]) {
            const userId = args[0].replace(/[<@!>]/g, ''); // Remove mention characters if present
            if (/^\\d{17,19}$/.test(userId)) { // Validate Discord ID format
                try {
                    target = await message.guild.members.fetch(userId);
                } catch (error) {
                    console.error('Failed to fetch user:', error);
                }
            }
        }
        
        return target;
    }

    // Helper method to get user object (not member) from mention or ID
    async getTargetUser(message, args) {
        // Check for mention first
        let target = message.mentions.users.first();
        
        // If no mention, check if first arg is a user ID
        if (!target && args[0]) {
            const userId = args[0].replace(/[<@!>]/g, '');
            if (/^\\d{17,19}$/.test(userId)) {
                try {
                    target = await this.client.users.fetch(userId);
                } catch (error) {
                    console.error('Failed to fetch user:', error);
                }
            }
        }
        
        return target;
    }

    // Helper to determine reason start index
    getReasonStartIndex(message, args) {
        if (message.mentions.members.size > 0) return 1;
        if (args[0] && /^\\d{17,19}$/.test(args[0].replace(/[<@!>]/g, ''))) return 1;
        return 0;
    }
`;

    // Find insertion point - look for constructor end, loadWarnings, or registerCommands
    let insertionPoint = -1;
    const markers = [
        'loadWarnings() {',
        'saveWarnings() {',
        'registerCommands() {',
        'formatUptime(ms) {'
    ];

    for (const marker of markers) {
        const index = content.indexOf(marker);
        if (index !== -1) {
            insertionPoint = index;
            break;
        }
    }

    if (insertionPoint !== -1) {
        content = content.slice(0, insertionPoint) + helperMethods + '\n\n    ' + content.slice(insertionPoint);
        console.log('✅ Added helper methods\n');
    } else {
        console.log('⚠️  Could not find insertion point, adding at end of class...\n');
        const classEnd = content.lastIndexOf('}');
        content = content.slice(0, classEnd) + helperMethods + '\n' + content.slice(classEnd);
    }
}

// 2. Update commands to use the new helper methods
console.log('🔄 Updating commands...\n');

// Update kick command
if (content.includes("this.commands.set('kick'")) {
    content = content.replace(
        /\/\/ Kick Command[\s\S]*?this\.commands\.set\('kick'[\s\S]*?usage: '!kick @user \[reason\]'/,
        match => match.replace("usage: '!kick @user [reason]'", "usage: '!kick @user|userID [reason]'")
    );
    content = content.replace(
        /(\s+\/\/ Kick Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    content = content.replace(
        /'❌ Please mention a user to kick!'/g,
        "'❌ Please mention a user or provide a valid user ID to kick!'"
    );
    content = content.replace(
        /(\/\/ Kick Command[\s\S]*?)const reason = args\.slice\(1\)\.join\(' '\)/,
        '$1const reason = args.slice(this.getReasonStartIndex(message, args)).join(\' \')'
    );
    console.log('✅ Updated kick command');
}

// Update ban command
if (content.includes("this.commands.set('ban'")) {
    content = content.replace(
        /\/\/ Ban Command[\s\S]*?this\.commands\.set\('ban'[\s\S]*?usage: '!ban @user \[reason\]'/,
        match => match.replace("usage: '!ban @user [reason]'", "usage: '!ban @user|userID [reason]'")
    );
    content = content.replace(
        /(\s+\/\/ Ban Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    content = content.replace(
        /'❌ Please mention a user to ban!'/g,
        "'❌ Please mention a user or provide a valid user ID to ban!'"
    );
    content = content.replace(
        /(\/\/ Ban Command[\s\S]*?)const reason = args\.slice\(1\)\.join\(' '\) \|\| 'No reason provided';/,
        '$1const reason = args.slice(this.getReasonStartIndex(message, args)).join(\' \') || \'No reason provided\';'
    );
    console.log('✅ Updated ban command');
}

// Update mute command
if (content.includes("this.commands.set('mute'")) {
    content = content.replace(
        /\/\/ Mute Command[\s\S]*?this\.commands\.set\('mute'[\s\S]*?usage: '!mute @user \[duration\] \[reason\]'/,
        match => match.replace("usage: '!mute @user [duration] [reason]'", "usage: '!mute @user|userID [duration] [reason]'")
    );
    content = content.replace(
        /(\s+\/\/ Mute Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    content = content.replace(
        /'❌ Please mention a user to mute!'/g,
        "'❌ Please mention a user or provide a valid user ID to mute!'"
    );
    console.log('✅ Updated mute command');
}

// Update unmute command
if (content.includes("this.commands.set('unmute'")) {
    content = content.replace(
        /\/\/ Unmute Command[\s\S]*?this\.commands\.set\('unmute'[\s\S]*?usage: '!unmute @user \[reason\]'/,
        match => match.replace("usage: '!unmute @user [reason]'", "usage: '!unmute @user|userID [reason]'")
    );
    content = content.replace(
        /(\s+\/\/ Unmute Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    content = content.replace(
        /'❌ Please mention a user to unmute!'/g,
        "'❌ Please mention a user or provide a valid user ID to unmute!'"
    );
    console.log('✅ Updated unmute command');
}

// Update warn command
if (content.includes("this.commands.set('warn'")) {
    content = content.replace(
        /\/\/ Warn Command[\s\S]*?this\.commands\.set\('warn'[\s\S]*?usage: '!warn @user <reason>'/,
        match => match.replace("usage: '!warn @user <reason>'", "usage: '!warn @user|userID <reason>'")
    );
    content = content.replace(
        /(\s+\/\/ Warn Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    content = content.replace(
        /'❌ Please mention a user to warn!'/g,
        "'❌ Please mention a user or provide a valid user ID to warn!'"
    );
    content = content.replace(
        /(\/\/ Warn Command[\s\S]*?)const reason = args\.slice\(1\)\.join\(' '\);/,
        '$1const reason = args.slice(this.getReasonStartIndex(message, args)).join(\' \');'
    );
    console.log('✅ Updated warn command');
}

// Update warnings command
if (content.includes("this.commands.set('warnings'")) {
    content = content.replace(
        /\/\/ Warnings Command[\s\S]*?this\.commands\.set\('warnings'[\s\S]*?usage: '!warnings @user'/,
        match => match.replace("usage: '!warnings @user'", "usage: '!warnings @user|userID'")
    );
    content = content.replace(
        /(\s+\/\/ Warnings Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    content = content.replace(
        /'❌ Please mention a user to check warnings!'/g,
        "'❌ Please mention a user or provide a valid user ID to check warnings!'"
    );
    console.log('✅ Updated warnings command');
}

// Update clearwarns command
if (content.includes("this.commands.set('clearwarns'")) {
    content = content.replace(
        /\/\/ Clear Warnings Command[\s\S]*?this\.commands\.set\('clearwarns'[\s\S]*?usage: '!clearwarns @user'/,
        match => match.replace("usage: '!clearwarns @user'", "usage: '!clearwarns @user|userID'")
    );
    content = content.replace(
        /(\s+\/\/ Clear Warnings Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    content = content.replace(
        /'❌ Please mention a user to clear warnings!'/g,
        "'❌ Please mention a user or provide a valid user ID to clear warnings!'"
    );
    console.log('✅ Updated clearwarns command');
}

// Update addrole command
if (content.includes("this.commands.set('addrole'")) {
    content = content.replace(
        /\/\/ Add Role Command[\s\S]*?this\.commands\.set\('addrole'[\s\S]*?usage: '!addrole @user @role'/,
        match => match.replace("usage: '!addrole @user @role'", "usage: '!addrole @user|userID @role'")
    );
    content = content.replace(
        /(\s+\/\/ Add Role Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    console.log('✅ Updated addrole command');
}

// Update removerole command
if (content.includes("this.commands.set('removerole'")) {
    content = content.replace(
        /\/\/ Remove Role Command[\s\S]*?this\.commands\.set\('removerole'[\s\S]*?usage: '!removerole @user @role'/,
        match => match.replace("usage: '!removerole @user @role'", "usage: '!removerole @user|userID @role'")
    );
    content = content.replace(
        /(\s+\/\/ Remove Role Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    console.log('✅ Updated removerole command');
}

// Update nickname command
if (content.includes("this.commands.set('nickname'")) {
    content = content.replace(
        /\/\/ Nickname Command[\s\S]*?this\.commands\.set\('nickname'[\s\S]*?usage: '!nickname @user <new_nick>'/,
        match => match.replace("usage: '!nickname @user <new_nick>'", "usage: '!nickname @user|userID <new_nick>'")
    );
    content = content.replace(
        /(\s+\/\/ Nickname Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\);/,
        '$1const target = await this.getTargetMember(message, args);'
    );
    console.log('✅ Updated nickname command');
}

// Update userinfo command
if (content.includes("this.commands.set('userinfo'")) {
    content = content.replace(
        /\/\/ User Info Command[\s\S]*?this\.commands\.set\('userinfo'[\s\S]*?usage: '!userinfo \[@user\]'/,
        match => match.replace("usage: '!userinfo [@user]'", "usage: '!userinfo [@user|userID]'")
    );
    content = content.replace(
        /(\s+\/\/ User Info Command[\s\S]*?execute: async \(message, args\) => \{[\s\S]*?)const target = message\.mentions\.members\.first\(\) \|\| message\.member;/,
        '$1const target = await this.getTargetMember(message, args) || message.member;'
    );
    console.log('✅ Updated userinfo command');
}

// Update avatar command
if (content.includes("this.commands.set('avatar'")) {
    content = content.replace(
        /\/\/ Avatar Command[\s\S]*?this\.commands\.set\('avatar'[\s\S]*?usage: '!avatar \[@user\]'/,
        match => match.replace("usage: '!avatar [@user]'", "usage: '!avatar [@user|userID]'")
    );
    content = content.replace(
        /(\s+\/\/ Avatar Command[\s\S]*?execute: async \(message.*?\) => \{[\s\S]*?)const target = message\.mentions\.users\.first\(\) \|\| message\.author;/,
        '$1const target = await this.getTargetUser(message, args) || message.author;'
    );
    console.log('✅ Updated avatar command');
}

// Update banner command
if (content.includes("this.commands.set('banner'")) {
    content = content.replace(
        /\/\/ Banner Command[\s\S]*?this\.commands\.set\('banner'[\s\S]*?usage: '!banner \[@user\]'/,
        match => match.replace("usage: '!banner [@user]'", "usage: '!banner [@user|userID]'")
    );
    content = content.replace(
        /(\s+\/\/ Banner Command[\s\S]*?execute: async \(message.*?\) => \{[\s\S]*?)const target = message\.mentions\.users\.first\(\) \|\| message\.author;/,
        '$1const target = await this.getTargetUser(message, args) || message.author;'
    );
    console.log('✅ Updated banner command');
}

// Write the updated file
fs.writeFileSync(filePath, content);

console.log('\n✅ commands.js updated successfully!');
console.log('\n📝 Summary:');
console.log('   - Added 3 helper methods (getTargetMember, getTargetUser, getReasonStartIndex)');
console.log('   - Updated all user-based commands to support user IDs');
console.log(`   - Backup saved as: ${backupPath}`);
console.log('\n🎯 You can now use commands like:');
console.log('   !kick 202666589550673930 reason');
console.log('   !ban 202666589550673930 reason');
console.log('   !userinfo 202666589550673930');
console.log('   !avatar 202666589550673930');
console.log('\n⚠️  Make sure to restart your bot and test thoroughly!');