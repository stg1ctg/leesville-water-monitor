const { chromium } = require('playwright');

// Data scraping function using browserless
async function scrapeWaterLevels() {
  let browser;
  try {
    console.log('Starting water level scrape...');

    // Connect to browserless service
    const browserlessUrl = process.env.BROWSERLESS_URL || 'ws://localhost:3000';


    browser = await chromium.connect(browserlessUrl);
    const page = await browser.newPage();
    
    await page.goto('https://www.aep.com/recreation/hydro', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for the table to load
    await page.waitForSelector('table', { timeout: 15000 });

    // Extract data from the Roanoke River table
    const data = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      let roanokeTables = [];
      
      // Find the Roanoke River section
      for (let table of tables) {
        const rows = table.querySelectorAll('tr');
        for (let row of rows) {
          const cells = row.querySelectorAll('td, th');
          if (cells.length > 0) {
            const firstCell = cells[0];
            if (firstCell && (firstCell.textContent.includes('Leesville') || 
                            firstCell.textContent.includes('Smith Mountain'))) {
              roanokeTables.push(table);
              break;
            }
          }
        }
      }
      
      let leesvilleForebay = null;
      let smithMountainTailwater = null;
      
      // Extract data from found tables
      for (let table of roanokeTables) {
        const rows = table.querySelectorAll('tr');
        
        for (let row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            const project = cells[0].textContent.trim();
            
            if (project === 'Leesville') {
              const forebayText = cells[2].textContent.trim();
              const forebayMatch = forebayText.match(/(\d+\.\d+)/);
              if (forebayMatch) {
                leesvilleForebay = parseFloat(forebayMatch[1]);
              }
            } else if (project === 'Smith Mountain') {
              const tailwaterText = cells[3].textContent.trim();
              const tailwaterMatch = tailwaterText.match(/(\d+\.\d+)/);
              if (tailwaterMatch) {
                smithMountainTailwater = parseFloat(tailwaterMatch[1]);
              }
            }
          }
        }
      }
      
      return {
        leesvilleForebay,
        smithMountainTailwater
      };
    });

    await browser.close();

    // Validate data
    if (data.leesvilleForebay === null || data.smithMountainTailwater === null) {
      throw new Error('Failed to extract water level data');
    }

    // Store in database - no need for data_updated_at, timestamp column handles this
    const query = `
      INSERT INTO water_levels (leesville_forebay, smith_mountain_tailwater)
      VALUES ($1, $2)
      RETURNING id, timestamp;
    `;
    
    const result = await pool.query(query, [
      data.leesvilleForebay,
      data.smithMountainTailwater
    ]);

    console.log(`Data scraped successfully: Leesville ${data.leesvilleForebay}ft, Smith Mountain ${data.smithMountainTailwater}ft`);
    console.log(`Stored with ID: ${result.rows[0].id} at ${result.rows[0].timestamp}`);
    
    return data;

  } catch (error) {
    console.error('Scraping error:', error);
    
    // Log failed scrape attempt - no need for data_updated_at here either
    try {
      await pool.query(`
        INSERT INTO water_levels (scrape_successful)
        VALUES (false)
      `);
    } catch (dbError) {
      console.error('Failed to log scrape error:', dbError);
    }
    
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
