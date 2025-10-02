// steamSaleMonitor.js
// Add this to your Discord bot to monitor Steam sales

const { EmbedBuilder } = require('discord.js');

class SteamSaleMonitor {
    constructor(client, config) {
        this.client = client;
        this.saleChannelId = config.saleChannelId;
        this.checkInterval = config.saleCheckInterval || 3600000; // Default: 1 hour
        this.trackedGames = new Map(); // Store game prices
        
        // All Drug Dealer Simulator games + Movie Games S.A. titles
        this.gameIds = [
            // Drug Dealer Simulator Series
            '682990',  // Drug Dealer Simulator (original)
            '1708850', // Drug Dealer Simulator 2
            '1275630', // Drug Dealer Simulator: Free Sample
            '3169480', // Drug Dealer Simulator 2: Casino DLC
            
            // Movie Games S.A. Other Titles
            '689480',  // Lust for Darkness
            '523650',  // Lust from Beyond
            '1085750', // The Thaumaturge
            '1506990', // Lust from Beyond: M Edition
            '1329540', // Lust from Beyond: Scarlet
            '1522940', // Paradise Lost
            '1951890', // Lust from Beyond: Prologue
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
            } else if (gameData.is_free) {
                // Handle free games/DLCs differently
                console.log(`ℹ️ ${gameData.name} is a free game/demo`);
            }
        } catch (error) {
            console.error(`Error checking app ${appId}:`, error);
        }
    }

    async postSaleAlert(gameData, priceData) {
        const saleChannel = this.client.channels.cache.get(this.saleChannelId);
        
        if (!saleChannel) {
            console.error('❌ Sale channel not found! Check your config.json');
            return;
        }

        // Custom emoji and color for Drug Dealer Simulator games
        const isDDS = gameData.name.toLowerCase().includes('drug dealer');
        const emoji = isDDS ? '💊' : '🎮';
        const color = isDDS ? '#00ff00' : '#1b2838';

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`${emoji} ${gameData.name} is ON SALE!`)
            .setURL(`https://store.steampowered.com/app/${gameData.steam_appid}`)
            .setDescription(this.truncateText(gameData.short_description, 200))
            .setThumbnail(gameData.header_image)
            .addFields(
                {
                    name: '💰 Discount',
                    value: `**${priceData.discount_percent}% OFF**`,
                    inline: true
                },
                {
                    name: '💵 Original Price',
                    value: `~~$${(priceData.initial / 100).toFixed(2)}~~`,
                    inline: true
                },
                {
                    name: '🏷️ Sale Price',
                    value: `**$${(priceData.final / 100).toFixed(2)}**`,
                    inline: true
                }
            )
            .setImage(gameData.header_image)
            .setFooter({ 
                text: 'Steam Sale Alert • Movie Games S.A.',
                iconURL: 'https://store.cloudflare.steamstatic.com/public/shared/images/header/logo_steam.svg'
            })
            .setTimestamp();

        // Add genres if available
        if (gameData.genres && gameData.genres.length > 0) {
            embed.addFields({
                name: '🎯 Genres',
                value: gameData.genres.map(g => g.description).join(', '),
                inline: false
            });
        }

        try {
            await saleChannel.send({ 
                embeds: [embed] 
            });
            console.log(`✅ Posted sale alert for ${gameData.name}`);
        } catch (error) {
            console.error('Error posting sale alert:', error);
        }
    }

    truncateText(text, maxLength) {
        if (!text) return 'No description available';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Method to manually trigger a check (useful for testing)
    async forceCheck() {
        console.log('🔄 Forcing sale check...');
        await this.checkAllGames();
    }

    // Method to add new games to monitor
    addGame(appId) {
        if (!this.gameIds.includes(appId)) {
            this.gameIds.push(appId);
            console.log(`✅ Added game ${appId} to monitoring list`);
        }
    }

    // Method to remove games from monitoring
    removeGame(appId) {
        const index = this.gameIds.indexOf(appId);
        if (index > -1) {
            this.gameIds.splice(index, 1);
            this.trackedGames.delete(appId);
            console.log(`✅ Removed game ${appId} from monitoring list`);
        }
    }

    // Method to force post ALL games regardless of sale status
    async forcePostAll() {
        console.log('💥 Force posting all tracked games...');
        const saleChannel = this.client.channels.cache.get(this.saleChannelId);
        
        if (!saleChannel) {
            console.error('❌ Sale channel not found! Check your config.json');
            return;
        }

        for (const appId of this.gameIds) {
            try {
                const response = await fetch(
                    `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=english`
                );
                
                if (!response.ok) continue;
                
                const data = await response.json();
                if (!data[appId] || !data[appId].success) continue;
                
                const gameData = data[appId].data;
                const priceData = gameData.price_overview;
                
                // Post game info regardless of sale status
                if (priceData) {
                    await this.postSaleAlert(gameData, priceData);
                } else if (!gameData.is_free) {
                    // Post info about games without price data
                    const embed = {
                        color: 0x808080,
                        title: `🎮 ${gameData.name}`,
                        url: `https://store.steampowered.com/app/${gameData.steam_appid}`,
                        description: this.truncateText(gameData.short_description, 200),
                        thumbnail: { url: gameData.header_image },
                        fields: [
                            {
                                name: 'Status',
                                value: 'Price info unavailable',
                                inline: true
                            }
                        ],
                        timestamp: new Date().toISOString()
                    };
                    await saleChannel.send({ embeds: [embed] });
                }
                
                // Delay to avoid rate limiting
                await this.sleep(3000);
            } catch (error) {
                console.error(`Error force posting game ${appId}:`, error.message);
            }
        }
        
        console.log('✅ Finished force posting all games');
    }
}

module.exports = SteamSaleMonitor;