#!/bin/bash

# Configuration
LOG_FILE="system-metrics.log"
DISCORD_WEBHOOK="https://discord.com/api/webhooks/1423505952984006746/W4LsJT1MnLc-Cez6nBdsYckDRgcdRo8DNOlFSH4llK6Z-oiz1k5rAcEEmEOFRd2Tztbt"
BOT_DIR="/var/lib/jenkins/discord-logger-bot"

# Get system metrics
get_metrics() {
    echo "=== System Metrics - $(date) ===" >> "$LOG_FILE"
    
    # CPU Usage
    CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)
    echo "CPU Usage: ${CPU}%" >> "$LOG_FILE"
    
    # Memory Usage
    MEM=$(free -m | awk 'NR==2{printf "%.2f%%", $3*100/$2}')
    echo "Memory Usage: ${MEM}" >> "$LOG_FILE"
    
    # Disk Usage
    DISK=$(df -h / | awk 'NR==2{print $5}')
    echo "Disk Usage: ${DISK}" >> "$LOG_FILE"
    
    # Bot Process Check
    if pgrep -f "node index.js" > /dev/null; then
        BOT_STATUS="✅ Running"
        UPTIME=$(ps -p $(pgrep -f "node index.js") -o etime= | tr -d ' ')
    else
        BOT_STATUS="❌ Not Running"
        UPTIME="N/A"
    fi
    echo "Bot Status: ${BOT_STATUS}" >> "$LOG_FILE"
    echo "Bot Uptime: ${UPTIME}" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"
}

# Send daily report to Discord
send_discord_report() {
    TAIL_LOGS=$(tail -n 20 "$LOG_FILE" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
    
    curl -X POST "$DISCORD_WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"📊 **Daily System Report**\n\`\`\`\n${TAIL_LOGS}\n\`\`\`\"}"
}

# Main execution
cd "$BOT_DIR"
get_metrics

# Send report if it's around midnight (called from cron)
HOUR=$(date +%H)
if [ "$HOUR" == "00" ]; then
    send_discord_report
fi
