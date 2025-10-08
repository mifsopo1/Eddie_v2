#!/usr/bin/env python3
import re
import os

# Read the navbar from messages.ejs (which works correctly)
with open('views/messages.ejs', 'r') as f:
    messages_content = f.read()

# Extract the navbar style and HTML from messages.ejs
style_match = re.search(r'(<style>.*?</style>)', messages_content, re.DOTALL)
navbar_match = re.search(r'(<nav class="navbar">.*?</nav>)', messages_content, re.DOTALL)

if not style_match or not navbar_match:
    print("❌ Could not extract navbar from messages.ejs")
    exit(1)

navbar_style = style_match.group(1)
navbar_html = navbar_match.group(1)

# Define which link should be active for each page
pages = {
    'dashboard.ejs': 'dashboard',
    'deleted.ejs': 'deleted',
    'members.ejs': 'members',
    'moderation.ejs': 'moderation',
    'attachments.ejs': 'attachments',
    'voice.ejs': 'voice',
    'invites.ejs': 'invites',
    'commands.ejs': 'commands',
    'analytics.ejs': 'analytics',
    'user.ejs': 'user'
}

for filename, active_page in pages.items():
    filepath = f'views/{filename}'
    
    if not os.path.exists(filepath):
        print(f"⚠️  Skipping {filename} - file not found")
        continue
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Remove old navbar if exists (both inline navbar and include statement)
    content = re.sub(r'<%- include\([\'"]partials/navbar[\'"]\) %>', '', content)
    content = re.sub(r'<nav class="navbar">.*?</nav>', '', content, flags=re.DOTALL)
    content = re.sub(r'<style>.*?\.navbar.*?</style>', '', content, flags=re.DOTALL)
    
    # Create navbar with correct active link
    page_navbar = navbar_html
    # Remove all active classes first
    page_navbar = re.sub(r' class="active"', '', page_navbar)
    
    # Add active class to the correct link based on page
    link_map = {
        'dashboard': r'(<a href="/")',
        'messages': r'(<a href="/messages")',
        'deleted': r'(<a href="/deleted")',
        'members': r'(<a href="/members")',
        'moderation': r'(<a href="/moderation")',
        'attachments': r'(<a href="/attachments")',
        'voice': r'(<a href="/voice")',
        'invites': r'(<a href="/invites")',
        'commands': r'(<a href="/commands")',
        'analytics': r'(<a href="/analytics")',
        'user': r'(<a href="/user)'
    }
    
    if active_page in link_map:
        page_navbar = re.sub(link_map[active_page], r'\1 class="active"', page_navbar)
    
    # Insert navbar style in <head> and navbar HTML after <body>
    # Add style before </head>
    if navbar_style not in content:
        content = re.sub(r'</head>', f'    {navbar_style}\n</head>', content)
    
    # Add navbar after <body>
    content = re.sub(r'(<body[^>]*>)', f'\\1\n    {page_navbar}\n', content)
    
    # Write updated content
    with open(filepath, 'w') as f:
        f.write(content)
    
    print(f"✅ Updated {filename}")

print("\n🎉 All files updated successfully!")
print("Restart your bot with: node index.js")