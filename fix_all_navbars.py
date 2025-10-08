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

# Find all EJS files in views directory, excluding login.ejs
ejs_files = glob.glob('views/*.ejs')
exclude_files = ['views/login.ejs']

for filename in ejs_files:
    if filename in exclude_files:
        print(f"⊘ Skipping {filename}")
        continue
    
    try:
        with open(filename, 'r') as f:
            content = f.read()
        
        # Replace any existing navbar or include statement
        if "include('partials/header')" in content:
            content = re.sub(r"<%- include\('partials/header'\) %>", header, content)
            print(f"✓ Replaced include in {filename}")
        elif '<nav class="navbar">' in content:
            # Replace existing navbar
            content = re.sub(r'<nav class="navbar">.*?</nav>', header, content, flags=re.DOTALL)
            print(f"✓ Updated navbar in {filename}")
        else:
            print(f"⊙ No navbar/include found in {filename}")
            continue
        
        with open(filename, 'w') as f:
            f.write(content)
            
    except Exception as e:
        print(f"✗ Error with {filename}: {e}")

print("\n✅ All navbars updated with complete menu!")
