import os
import re

def fix_ejs_file(file_path):
    """Fix navbar issues in a single EJS file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original_content = content
        changes_made = []
        
        # Fix 1: Remove hardcoded class="active" from Analytics link
        # This matches the specific pattern where there are two class attributes
        pattern1 = r'(<a href="/analytics")\s+class="active"\s+(class="[^"]*")'
        if re.search(pattern1, content):
            content = re.sub(pattern1, r'\1 \2', content)
            changes_made.append("Removed hardcoded 'active' class from Analytics link")
        
        # Fix 2: Wrap nav link text in <span> tags (if not already wrapped)
        # Pattern to find nav links with text not in spans
        nav_links = [
            ('Dashboard', '📊'),
            ('Messages', '💬'),
            ('Deleted', '🗑️'),
            ('Members', '👥'),
            ('Moderation', '🔨'),
            ('Attachments', '📎'),
            ('Voice', '🔊'),
            ('Invites', '🎫'),
            ('Commands', '⚙️'),
            ('Analytics', '📈'),
            ('Appeals', '🎫')
        ]
        
        for text, icon in nav_links:
            # Pattern: icon followed by space and text NOT in span
            pattern = rf'(<span class="nav-icon">{re.escape(icon)}</span>)\s+{text}(?!\s*</span>)'
            replacement = rf'\1 <span>{text}</span>'
            
            if re.search(pattern, content):
                content = re.sub(pattern, replacement, content)
                changes_made.append(f"Wrapped '{text}' in <span> tag")
        
        # Only write if changes were made
        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True, changes_made
        else:
            return False, ["No changes needed"]
            
    except Exception as e:
        return False, [f"Error: {str(e)}"]

def find_and_fix_ejs_files(directory='.'):
    """Find all EJS files and fix them"""
    fixed_files = []
    skipped_files = []
    error_files = []
    
    print("🔍 Scanning for .ejs files...\n")
    
    for root, dirs, files in os.walk(directory):
        # Skip node_modules and other common directories
        dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', 'dist', 'build']]
        
        for file in files:
            if file.endswith('.ejs'):
                file_path = os.path.join(root, file)
                print(f"📄 Processing: {file_path}")
                
                was_fixed, changes = fix_ejs_file(file_path)
                
                if was_fixed:
                    fixed_files.append(file_path)
                    for change in changes:
                        print(f"   ✅ {change}")
                else:
                    if "Error" in changes[0]:
                        error_files.append((file_path, changes[0]))
                        print(f"   ❌ {changes[0]}")
                    else:
                        skipped_files.append(file_path)
                        print(f"   ⏭️  {changes[0]}")
                print()
    
    # Summary
    print("\n" + "="*60)
    print("📊 SUMMARY")
    print("="*60)
    print(f"✅ Files fixed: {len(fixed_files)}")
    print(f"⏭️  Files skipped (no changes needed): {len(skipped_files)}")
    print(f"❌ Files with errors: {len(error_files)}")
    print()
    
    if fixed_files:
        print("Fixed files:")
        for f in fixed_files:
            print(f"  • {f}")
        print()
    
    if error_files:
        print("Files with errors:")
        for f, err in error_files:
            print(f"  • {f}: {err}")
        print()
    
    print("✨ Done!")

if __name__ == "__main__":
    print("🚀 EJS Navbar Fixer")
    print("="*60)
    print("This script will:")
    print("  1. Remove hardcoded 'active' class from Analytics links")
    print("  2. Wrap nav link text in <span> tags for responsive design")
    print("="*60)
    
    # Get the directory to scan
    directory = input("\nEnter the directory to scan (press Enter for current directory): ").strip()
    if not directory:
        directory = '.'
    
    if not os.path.exists(directory):
        print(f"❌ Error: Directory '{directory}' does not exist!")
    else:
        confirm = input(f"\n⚠️  This will modify all .ejs files in '{directory}'. Continue? (yes/no): ").strip().lower()
        
        if confirm in ['yes', 'y']:
            print()
            find_and_fix_ejs_files(directory)
        else:
            print("❌ Operation cancelled.")