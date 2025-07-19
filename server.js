const { chromium } = require('playwright');
const express = require('express');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
const { Pool } = require('pg');
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

// Initialize database table
async function initializeDatabase() {
  try {
    console.log('Initializing database...');
    
    // Create table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS water_levels (
        id SERIAL PRIMARY KEY,
        leesville_forebay DECIMAL(6,2),
        smith_mountain_tailwater DECIMAL(6,2),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        data_updated_at TIMESTAMP,
        scrape_successful BOOLEAN DEFAULT true
      );
    `);
    
    // Create index for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_water_levels_timestamp 
      ON water_levels(timestamp);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_water_levels_successful 
      ON water_levels(scrape_successful);
    `);
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

// Data scraping function using browserless
async function scrapeWaterLevels() {
  let browser;
  try {
    console.log('Starting water level scrape...');

    // Get browserless configuration
    const browserlessUrl = process.env.BROWSERLESS_URL;
    const browserlessToken = process.env.BROWSERLESS_TOKEN;

    if (!browserlessUrl) {
      throw new Error('BROWSERLESS_URL environment variable is required');
    }

    if (!browserlessToken) {
      throw new Error('BROWSERLESS_TOKEN environment variable is required');
    }

    // For Railway browserless, use the /playwright endpoint with token
    let connectionUrl;
    
    if (browserlessUrl.includes('railway.app')) {
      // Railway browserless format
      connectionUrl = `${browserlessUrl}/playwright?token=${browserlessToken}`;
    } else {
      // Handle other browserless services
      if (browserlessUrl.startsWith('ws://') || browserlessUrl.startsWith('wss://')) {
        connectionUrl = `${browserlessUrl}?token=${browserlessToken}`;
      } else if (browserlessUrl.startsWith('http://') || browserlessUrl.startsWith('https://')) {
        const wsUrl = browserlessUrl.replace(/^https?:\/\//, 'wss://');
        connectionUrl = `${wsUrl}?token=${browserlessToken}`;
      } else {
        throw new Error('Invalid BROWSERLESS_URL format. Must start with ws://, wss://, http://, or https://');
      }
    }

    console.log('Connecting to browserless service...');
    console.log('Using connection URL:', connectionUrl.replace(browserlessToken, '***'));
    
    browser = await chromium.connect(connectionUrl);
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
      console.log('Finishing water level scrape...');

      
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

    // Store in database
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
    
    // Log failed scrape attempt
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

// API Routes
app.get('/api/current', async (req, res) => {
  try {
    console.log('API /current called');
    const result = await pool.query(`
      SELECT leesville_forebay, smith_mountain_tailwater, timestamp, data_updated_at
      FROM water_levels 
      WHERE scrape_successful = true
      ORDER BY timestamp DESC 
      LIMIT 1
    `);
    
    console.log('Current data query result:', result.rows.length, 'rows');
    if (result.rows.length > 0) {
      console.log('Latest data:', result.rows[0]);
    }
    
    if (result.rows.length === 0) {
      console.log('No data found in database');
      return res.status(404).json({ error: 'No data available' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('API /current error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    console.log('API /history called with hours:', req.query.hours);
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
    
    console.log('History query result:', result.rows.length, 'rows');
    
    res.json(result.rows);
  } catch (error) {
    console.error('API /history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    console.log('API /stats called');
    
    // Get 24 hour high/low
    const last24h = await pool.query(`
      SELECT 
        MAX(leesville_forebay) as high_24h,
        MIN(leesville_forebay) as low_24h
      FROM water_levels
      WHERE scrape_successful = true
        AND timestamp >= NOW() - INTERVAL '24 hours'
    `);
    
    // Get 7 day high/low
    const last7d = await pool.query(`
      SELECT 
        MAX(leesville_forebay) as high_7d,
        MIN(leesville_forebay) as low_7d
      FROM water_levels
      WHERE scrape_successful = true
        AND timestamp >= NOW() - INTERVAL '7 days'
    `);
    
    // Get all-time high
    const allTimeHigh = await pool.query(`
      SELECT 
        leesville_forebay as all_time_high,
        timestamp as all_time_high_date
      FROM water_levels
      WHERE scrape_successful = true
        AND leesville_forebay IS NOT NULL
      ORDER BY leesville_forebay DESC
      LIMIT 1
    `);
    
    // Get all-time low
    const allTimeLow = await pool.query(`
      SELECT 
        leesville_forebay as all_time_low,
        timestamp as all_time_low_date
      FROM water_levels
      WHERE scrape_successful = true
        AND leesville_forebay IS NOT NULL
      ORDER BY leesville_forebay ASC
      LIMIT 1
    `);
    
    const stats = {
      high_24h: last24h.rows[0]?.high_24h || null,
      low_24h: last24h.rows[0]?.low_24h || null,
      high_7d: last7d.rows[0]?.high_7d || null,
      low_7d: last7d.rows[0]?.low_7d || null,
      all_time_high: allTimeHigh.rows[0]?.all_time_high || null,
      all_time_high_date: allTimeHigh.rows[0]?.all_time_high_date || null,
      all_time_low: allTimeLow.rows[0]?.all_time_low || null,
      all_time_low_date: allTimeLow.rows[0]?.all_time_low_date || null
    };
    
    console.log('Stats query result:', stats);
    
    res.json(stats);
  } catch (error) {
    console.error('API /stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Debug endpoint to check recent database entries
app.get('/api/debug', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM water_levels 
      ORDER BY timestamp DESC 
      LIMIT 10
    `);
    
    res.json({
      message: 'Latest 10 database entries',
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('API /debug error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Schedule scraping every 15 minutes
cron.schedule('*/5 * * * *', async () => {
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
