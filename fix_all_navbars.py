#!/usr/bin/env python3
import os
import glob

NAVBAR_CSS = '''/* Inline Navbar Styles */
        .navbar {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            padding: 0.75rem 1.5rem;
            position: sticky;
            top: 0;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1.5rem;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        .nav-brand { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }
        .bot-avatar { width: 40px; height: 40px; border-radius: 50%; border: 2px solid rgba(88, 101, 242, 0.5); box-shadow: 0 0 12px rgba(88, 101, 242, 0.3); }
        .bot-info { display: flex; flex-direction: column; gap: 0.15rem; }
        .bot-info h2 { color: #fff; font-size: 1.1rem; margin: 0; font-weight: 600; line-height: 1; }
        .bot-status { color: #43b581; font-size: 0.7rem; font-weight: 500; line-height: 1; }
        .nav-center { flex: 1; display: flex; justify-content: center; overflow-x: auto; }
        .nav-links { display: flex; gap: 0.35rem; flex-wrap: nowrap; justify-content: center; }
        .nav-links a { color: var(--text-secondary); text-decoration: none; padding: 0.5rem 0.85rem; border-radius: 6px; transition: all 0.2s ease; font-weight: 500; font-size: 0.85rem; display: flex; align-items: center; gap: 0.4rem; white-space: nowrap; }
        .nav-icon { font-size: 0.95rem; }
        .nav-links a:hover { background: rgba(255, 255, 255, 0.1); color: #fff; transform: translateY(-1px); }
        .nav-links a.active { background: rgba(88, 101, 242, 0.25); color: var(--primary); box-shadow: 0 2px 8px rgba(88, 101, 242, 0.3); }
        .nav-user { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }
        .user-profile { display: flex; align-items: center; gap: 0.6rem; background: rgba(0, 0, 0, 0.3); padding: 0.4rem 0.8rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1); transition: all 0.3s ease; }
        .user-profile:hover { background: rgba(0, 0, 0, 0.4); border-color: rgba(88, 101, 242, 0.5); }
        .user-avatar { width: 32px; height: 32px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.2); }
        .user-avatar-placeholder { width: 32px; height: 32px; border-radius: 50%; background: rgba(88, 101, 242, 0.3); display: flex; align-items: center; justify-content: center; font-size: 1.3rem; border: 2px solid rgba(255, 255, 255, 0.2); }
        .user-details { display: flex; flex-direction: column; gap: 0.15rem; }
        .user-name { color: #fff; font-weight: 600; font-size: 0.85rem; line-height: 1; }
        .user-badge { font-size: 0.65rem; font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.3px; width: fit-content; line-height: 1; }
        .user-badge.admin { background: rgba(88, 101, 242, 0.3); color: #5865f2; }
        .user-badge.password { background: rgba(250, 166, 26, 0.3); color: #faa61a; }
        .logout-btn { background: rgba(237, 66, 69, 0.2); color: var(--danger); padding: 0.5rem; border-radius: 6px; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; text-decoration: none; border: 1px solid rgba(237, 66, 69, 0.3); width: 36px; height: 36px; }
        .logout-btn:hover { background: rgba(237, 66, 69, 0.3); transform: scale(1.08); }
        @media (max-width: 1400px) {
            .nav-links a span:not(.nav-icon) { display: none; }
            .nav-links a { padding: 0.5rem 0.6rem; }
        }
        @media (max-width: 1024px) {
            .navbar { flex-wrap: wrap; padding: 0.75rem 1rem; }
            .nav-center { order: 3; width: 100%; margin-top: 0.75rem; justify-content: flex-start; }
            .nav-links { justify-content: flex-start; }
            .bot-status { display: none; }
        }
        @media (max-width: 768px) {
            .navbar { padding: 0.6rem 0.8rem; }
            .bot-avatar { width: 36px; height: 36px; }
            .bot-info h2 { font-size: 1rem; }
            .user-details { display: none; }
            .user-avatar, .user-avatar-placeholder { width: 36px; height: 36px; }
            .nav-center { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
            .nav-center::-webkit-scrollbar { display: none; }
            .nav-links { gap: 0.25rem; }
            .nav-links a { padding: 0.45rem 0.55rem; font-size: 0.8rem; }
        }

        '''

views_path = '/var/lib/jenkins/discord-logger-bot/views/'

for file in glob.glob(views_path + '*.ejs'):
    with open(file, 'r') as f:
        content = f.read()
    
    if 'Inline Navbar Styles' in content:
        print(f"✅ {file} - Already has navbar styles")
        continue
    
    if '<style>' in content:
        content = content.replace('<style>', '<style>\n        ' + NAVBAR_CSS, 1)
        with open(file, 'w') as f:
            f.write(content)
        print(f"✅ {file} - Added navbar styles")
    else:
        print(f"⚠️  {file} - No <style> tag found")

print("\n✨ Done!")