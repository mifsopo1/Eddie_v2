import re

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

files = ['views/dashboard.ejs', 'views/messages.ejs', 'views/deleted.ejs', 'views/user.ejs', 'views/analytics.ejs']

for filename in files:
    try:
        with open(filename, 'r') as f:
            content = f.read()
        
        # Replace the include line
        content = re.sub(r"<%- include\('partials/header'\) %>", header, content)
        
        with open(filename, 'w') as f:
            f.write(content)
        
        print(f"Fixed {filename}")
    except Exception as e:
        print(f"Error with {filename}: {e}")

print("All done!")
