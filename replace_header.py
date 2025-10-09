import os
import re

# Configuration
VIEWS_DIR = '/var/lib/jenkins/discord-logger-bot/views/'  # Change this to your views directory path
OLD_TEXT = "<h2>Eddie's Logger</h2>"
NEW_TEXT = "<h2>Drug Dealer Simulator | Eddie</h2>"

def replace_in_file(filepath):
    """Replace text in a single file"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if OLD_TEXT in content:
            new_content = content.replace(OLD_TEXT, NEW_TEXT)
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            
            return True
        return False
    except Exception as e:
        print(f"❌ Error processing {filepath}: {e}")
        return False

def main():
    """Main function to process all .ejs files"""
    if not os.path.exists(VIEWS_DIR):
        print(f"❌ Directory not found: {VIEWS_DIR}")
        print("Please update VIEWS_DIR in the script to point to your views folder")
        return
    
    files_modified = 0
    files_checked = 0
    
    print("🔍 Searching for files to update...\n")
    
    # Walk through all files in views directory
    for root, dirs, files in os.walk(VIEWS_DIR):
        for filename in files:
            if filename.endswith('.ejs'):
                filepath = os.path.join(root, filename)
                files_checked += 1
                
                if replace_in_file(filepath):
                    print(f"✅ Updated: {filepath}")
                    files_modified += 1
                else:
                    print(f"⏭️  Skipped: {filepath} (no match found)")
    
    print(f"\n{'='*50}")
    print(f"📊 Summary:")
    print(f"   Files checked: {files_checked}")
    print(f"   Files modified: {files_modified}")
    print(f"{'='*50}")
    
    if files_modified > 0:
        print(f"\n✨ Successfully replaced '{OLD_TEXT}' with '{NEW_TEXT}'")
        print("🔄 Don't forget to restart your Discord bot!")
    else:
        print("\n⚠️  No files were modified. The text may have already been replaced.")

if __name__ == "__main__":
    main()