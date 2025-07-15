const express = require('express');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
const { Pool } = require('pg');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS water_levels (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        leesville_forebay DECIMAL(6,2),
        smith_mountain_tailwater DECIMAL(6,2),
        data_updated_at VARCHAR(100),
        scrape_successful BOOLEAN DEFAULT true
      );
    `);
    
    // Create index for faster queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_water_levels_timestamp 
      ON water_levels(timestamp);
    `);
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Data scraping function
async function scrapeWaterLevels() {
  let browser;
  try {
    console.log('Starting water level scrape...');
    
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.goto('https://www.aep.com/recreation/hydro', {
      waitUntil: 'networkidle2',
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
      let dataUpdatedAt = null;
      
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

    await browser.close();

    // Validate data
    if (data.leesvilleForebay === null || data.smithMountainTailwater === null) {
      throw new Error('Failed to extract water level data');
    }

    // Store in database
    const query = `
      INSERT INTO water_levels (leesville_forebay, smith_mountain_tailwater, data_updated_at)
      VALUES ($1, $2, $3)
      RETURNING id, timestamp;
    `;
    
    const result = await pool.query(query, [
      data.leesvilleForebay,
      data.smithMountainTailwater,
      data.dataUpdatedAt
    ]);

    console.log(`Data scraped successfully: Leesville ${data.leesvilleForebay}ft, Smith Mountain ${data.smithMountainTailwater}ft`);
    console.log(`Stored with ID: ${result.rows[0].id} at ${result.rows[0].timestamp}`);
    
    return data;

  } catch (error) {
    console.error('Scraping error:', error);
    
    // Log failed scrape attempt
    try {
      await pool.query(`
        INSERT INTO water_levels (scrape_successful, data_updated_at)
        VALUES (false, $1)
      `, [error.message]);
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

// API Routes
app.get('/api/current', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT leesville_forebay, smith_mountain_tailwater, timestamp, data_updated_at
      FROM water_levels 
      WHERE scrape_successful = true
      ORDER BY timestamp DESC 
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No data available' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const hoursInt = parseInt(hours);
    
    if (isNaN(hoursInt) || hoursInt < 1 || hoursInt > 8760) { // Max 1 year
      return res.status(400).json({ error: 'Invalid hours parameter' });
    }
    
    const result = await pool.query(`
      SELECT leesville_forebay, smith_mountain_tailwater, timestamp
      FROM water_levels 
      WHERE scrape_successful = true
        AND timestamp >= NOW() - INTERVAL '${hoursInt} hours'
      ORDER BY timestamp ASC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(CASE WHEN scrape_successful = true THEN 1 END) as successful_scrapes,
        MIN(timestamp) as first_record,
        MAX(timestamp) as last_record,
        AVG(leesville_forebay) as avg_leesville,
        AVG(smith_mountain_tailwater) as avg_smith_mountain
      FROM water_levels
      WHERE timestamp >= NOW() - INTERVAL '30 days'
    `);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Schedule scraping every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('Running scheduled scrape...');
  try {
    await scrapeWaterLevels();
  } catch (error) {
    console.error('Scheduled scrape failed:', error);
  }
});

// Initialize and start server
async function startServer() {
  await initializeDatabase();
  
  // Run initial scrape
  try {
    console.log('Running initial scrape...');
    await scrapeWaterLevels();
  } catch (error) {
    console.error('Initial scrape failed:', error);
  }
  
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);