// steamSaleMonitor.js
// Add this to your Discord bot to monitor Steam sales

const { EmbedBuilder } = require('discord.js');
const fs = require('fs');

class SteamSaleMonitor {
    constructor(client, config) {
        this.client = client;
        this.saleChannelId = config.saleChannelId;
        this.checkInterval = config.saleCheckInterval || 3600000; // Default: 1 hour
        
        // Load saved data if it exists
        try {
            if (fs.existsSync('sales-data.json')) {
                const savedData = JSON.parse(fs.readFileSync('sales-data.json'));
                this.trackedGames = new Map(savedData);
                console.log('📦 Loaded previous sale data');
            } else {
                this.trackedGames = new Map();
            }
        } catch (error) {
            console.error('Error loading sales data:', error);
            this.trackedGames = new Map();
        }
        
        // All Drug Dealer Simulator games + Movie Games S.A. titles
        this.gameIds = [
            // Drug Dealer Simulator Series
            '682990',  // Drug Dealer Simulator (original)
            '1708850', // Drug Dealer Simulator 2
            '1275630', // Drug Dealer Simulator: Free Sample
            '3169480', // Drug Dealer Simulator 2: Casino DLC
        ];
    }

    async start() {
        console.log('🎮 Starting Steam Sale Monitor...');
        
        // Initial check
        await this.checkAllGames();
        
        // Set up interval checking
        setInterval(() => {
            this.checkAllGames();
        }, this.checkInterval);
        
        console.log(`✅ Sale monitor running (checking every ${this.checkInterval / 60000} minutes)`);
    }

    async checkAllGames() {
        console.log('🔍 Checking for game sales...');
        
        for (const appId of this.gameIds) {
            try {
                await this.checkGameSale(appId);
                // Delay between requests to avoid rate limiting
                await this.sleep(2000);
            } catch (error) {
                console.error(`Error checking game ${appId}:`, error.message);
            }
        }
    }

    async checkGameSale(appId) {
        try {
            const response = await fetch(
                `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english`
            );
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data[appId] || !data[appId].success) {
                console.log(`⚠️ Could not fetch data for app ${appId}`);
                return;
            }
            
            const gameData = data[appId].data;
            const priceData = gameData.price_overview;
            
            // Check if game has price data and is on sale
            if (priceData) {
                const currentDiscount = priceData.discount_percent;
                const previousData = this.trackedGames.get(appId);
                
                // If game just went on sale (wasn't on sale before, is now)
                if (currentDiscount > 0 && (!previousData || previousData.discount === 0)) {
                    await this.postSaleAlert(gameData, priceData);
                }
                
                // Store current state
                this.trackedGames.set(appId, {
                    name: gameData.name,
                    discount: currentDiscount,
                    price: priceData.final,
                    lastChecked: Date.now()
                });

                // Save to file
                try {
                    fs.writeFileSync('sales-data.json', JSON.stringify([...this.trackedGames]));
                } catch (error) {
                    console.error('Error saving sales data:', error);
                }
            } else if (gameData.is_free) {
                // Handle free games/DLCs differently
                console.log(`ℹ️ ${gameData.name} is a free game/demo`);
            }
        } catch (error) {
            console.error(`Error checking app ${appId}:`, error);
        }
    }

    // ... rest of your code stays the same ...