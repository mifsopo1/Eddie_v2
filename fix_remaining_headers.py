import re
import os
import glob

header = '''<nav class="navbar">
    <div class="nav-brand">
        <h2>🤖 <%= client.user.tag %></h2>
    </div>
    <div class="nav-links">
        <a href="/">Dashboard</a>
        <a href="/messages">Messages</a>
        <a href="/deleted">Deleted</a>
        <a href="/members">Members</a>
        <a href="/moderation">Moderation</a>
        <a href="/attachments">Attachments</a>
        <a href="/voice">Voice</a>
        <a href="/invites">Invites</a>
        <a href="/commands">Commands</a>
        <a href="/analytics">Analytics</a>
        <a href="/logout" class="logout">Logout</a>
    </div>
</nav>'''

# Find ALL EJS files
ejs_files = glob.glob('views/*.ejs')
exclude_files = ['views/login.ejs']

for filename in ejs_files:
    if filename in exclude_files:
        print(f"⊘ Skipping {filename}")
        continue
    
    try:
        with open(filename, 'r') as f:
            content = f.read()
        
        # Check if it has the include statement OR an old navbar
        has_changes = False
        
        if "include('partials/header')" in content:
            content = re.sub(r"<%- include\('partials/header'\) %>", header, content)
            has_changes = True
            print(f"✓ Replaced include in {filename}")
        elif '<nav class="navbar">' in content and 'Commands</a>' not in content:
            # Old navbar without Commands link - update it
            content = re.sub(r'<nav class="navbar">.*?</nav>', header, content, flags=re.DOTALL)
            has_changes = True
            print(f"✓ Updated old navbar in {filename}")
        elif '<nav class="navbar">' in content:
            print(f"⊙ Navbar already up-to-date in {filename}")
        else:
            print(f"⚠ No navbar found in {filename}")
        
        if has_changes:
            with open(filename, 'w') as f:
                f.write(content)
            
    except Exception as e:
        print(f"✗ Error with {filename}: {e}")

print("\n✅ All done!")
