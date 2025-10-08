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
        
        # Check if it has the include statement
        if "include('partials/header')" in content:
            # Replace the include line with the actual header
            content = re.sub(r"<%- include\('partials/header'\) %>", header, content)
            
            with open(filename, 'w') as f:
                f.write(content)
            
            print(f"✓ Fixed {filename}")
        else:
            print(f"⊙ No include found in {filename}")
            
    except Exception as e:
        print(f"✗ Error with {filename}: {e}")

print("\n✅ All done!")
