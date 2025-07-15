const puppeteer = require('puppeteer');

async function testScraper() {
  let browser;
  try {
    console.log('🚀 Starting scraper test...\n');
    
    browser = await puppeteer.launch({
      headless: false, // Set to true for production
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    console.log('📄 Opening AEP hydro page...');
    
    await page.goto('https://www.aep.com/recreation/hydro', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    console.log('⏳ Waiting for table to load...');
    await page.waitForSelector('table', { timeout: 15000 });

    console.log('🔍 Extracting water level data...');
    const data = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      let leesvilleForebay = null;
      let smithMountainTailwater = null;
      let dataUpdatedAt = null;
      
      console.log('Found', tables.length, 'tables');
      
      // Search through all tables for Roanoke River data
      for (let table of tables) {
        const rows = table.querySelectorAll('tr');
        console.log('Checking table with', rows.length, 'rows');
        
        for (let row of rows) {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            const project = cells[0].textContent.trim();
            console.log('Found project:', project);
            
            if (project === 'Leesville') {
              const forebayText = cells[2].textContent.trim();
              console.log('Leesville forebay text:', forebayText);
              const forebayMatch = forebayText.match(/(\d+\.\d+)/);
              if (forebayMatch) {
                leesvilleForebay = parseFloat(forebayMatch[1]);
              }
            } else if (project === 'Smith Mountain') {
              const tailwaterText = cells[3].textContent.trim();
              console.log('Smith Mountain tailwater text:', tailwaterText);
              const tailwaterMatch = tailwaterText.match(/(\d+\.\d+)/);
              if (tailwaterMatch) {
                smithMountainTailwater = parseFloat(tailwaterMatch[1]);
              }
            }
          }
        }
      }
      
      // Find the data update timestamp
      const updateElements = document.querySelectorAll('*');
      for (let element of updateElements) {
        if (element.textContent && element.textContent.includes('Data last updated')) {
          dataUpdatedAt = element.textContent.trim();
          break;
        }
      }
      
      return {
        leesvilleForebay,
        smithMountainTailwater,
        dataUpdatedAt
      };
    });

    console.log('\n📊 Extraction Results:');
    console.log('=====================================');
    console.log(`Leesville Forebay: ${data.leesvilleForebay ? data.leesvilleForebay + ' ft' : 'NOT FOUND'}`);
    console.log(`Smith Mountain Tailwater: ${data.smithMountainTailwater ? data.smithMountainTailwater + ' ft' : 'NOT FOUND'}`);
    console.log(`Data Updated: ${data.dataUpdatedAt || 'NOT FOUND'}`);
    console.log('=====================================\n');

    // Validation
    if (data.leesvilleForebay === null || data.smithMountainTailwater === null) {
      console.error('❌ FAILED: Could not extract both water level values');
      console.log('This might indicate a change in the website structure.');
    } else {
      console.log('✅ SUCCESS: Both water level values extracted successfully!');
      
      // Basic validation ranges
      if (data.leesvilleForebay < 500 || data.leesvilleForebay > 700) {
        console.warn('⚠️  WARNING: Leesville forebay value seems unusual (expected range: 500-700 ft)');
      }
      if (data.smithMountainTailwater < 500 || data.smithMountainTailwater > 700) {
        console.warn('⚠️  WARNING: Smith Mountain tailwater value seems unusual (expected range: 500-700 ft)');
      }
    }

    await browser.close();
    return data;

  } catch (error) {
    console.error('❌ Scraping test failed:', error);
    
    if (browser) {
      await browser.close();
    }
    
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testScraper()
    .then(() => {
      console.log('\n🎉 Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = testScraper;