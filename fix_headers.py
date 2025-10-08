import re

header = '''<nav class="navbar">
    <div class="nav-brand">
        <h2>🤖 <%= client.user.tag %></h2>
    </div>
    <div class="nav-links">
        <a href="/">Dashboard</a>
        <a href="/messages">Messages</a>
        <a href="/deleted">Deleted</a>
        <a href="/user/search">User Lookup</a>
        <a href="/logout" class="logout">Logout</a>
    </div>
</nav>'''

files = ['views/messages.ejs', 'views/deleted.ejs', 'views/user.ejs']

for filename in files:
    with open(filename, 'r') as f:
        content = f.read()
    
    # Replace the include line
    content = re.sub(r"<%- include\('partials/header'\) %>", header, content)
    
    with open(filename, 'w') as f:
        f.write(content)
    
    print(f"Fixed {filename}")

print("All done!")
