# Leesville Lake Water Level Monitor

A water level monitoring and tracking system for Leesville Lake.

## Features

- 🌊 **Real-time monitoring**: Updated every 15 minutes
- 📊 **Historical charts**: Interactive graphs showing 24 hours to 1 year of data
- 📱 **Mobile responsive**: Works great on phones and tablets
- 🎯 **Status indicators**: Visual alerts for normal/high/low water levels
- 📈 **Statistics**: Success rates and averages over the last 30 days
- 🔄 **Auto-refresh**: Frontend updates every 5 minutes
- 🚀 **Easy deployment**: One-click deployment to Railway

## Quick Start

### Prerequisites
- Node.js 18+ 
- A Railway account (free tier available)
- A GitHub account

### Local Development

1. **Clone or download the project files**:
   ```bash
   mkdir leesville-monitor
   cd leesville-monitor
   # Copy all the provided files into this directory
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up local database** (optional for testing):
   ```bash
   # Install PostgreSQL locally or use a cloud database
   # Set DATABASE_URL environment variable
   export DATABASE_URL="postgresql://username:password@localhost:5432/leesville_monitor"
   ```

4. **Test the scraper**:
   ```bash
   npm test
   ```

5. **Run locally**:
   ```bash
   npm run dev
   ```

Visit `http://localhost:3000` to see the dashboard.

## Deployment to Railway

### Step 1: Create GitHub Repository

1. Go to [GitHub](https://github.com) and create a new repository called `leesville-water-monitor`
2. Upload all the project files to your repository:
   - `server.js`
   - `package.json`
   - `railway.json`
   - `test-scraper.js`
   - `public/index.html`
   - `README.md`

### Step 2: Deploy to Railway

1. Go to [Railway.app](https://railway.app) and sign up/login
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `leesville-water-monitor` repository
5. Railway will automatically detect it's a Node.js project

### Step 3: Add Database

1. In your Railway project dashboard, click "New Service"
2. Choose "Database" → "PostgreSQL"
3. Railway will automatically create a database and connect it to your app

### Step 4: Configure Environment Variables

Railway should automatically set the `DATABASE_URL` environment variable. You can verify this in your project settings under "Variables".

### Step 5: Deploy

1. Railway will automatically build and deploy your app
2. You'll get a URL like `https://your-app-name.railway.app`
3. Visit the URL to see your water level dashboard!

## File Structure

```
leesville-monitor/
├── server.js              # Main application server
├── package.json           # Dependencies and scripts
├── railway.json           # Railway deployment config
├── test-scraper.js        # Test script for scraper
├── public/
│   └── index.html         # Frontend dashboard
└── README.md              # This file
```

## API Endpoints

- `GET /` - Main dashboard
- `GET /api/current` - Current water levels
- `GET /api/history?hours=24` - Historical data (hours parameter)
- `GET /api/stats` - Statistics for last 30 days

## How It Works

1. **Data Collection**: Every 15 minutes, the server runs a Puppeteer script that:
   - Opens the AEP hydro website
   - Locates the Roanoke River table
   - Extracts Leesville forebay and Smith Mountain tailwater values
   - Stores the data in PostgreSQL with timestamps

2. **Data Storage**: Uses PostgreSQL to store:
   - Water level readings
   - Timestamps
   - Success/failure status
   - AEP's "last updated" timestamp

3. **Web Interface**: A responsive single-page application that:
   - Shows current levels with status indicators
   - Displays interactive charts for different time periods
   - Auto-refreshes every 5 minutes
   - Provides statistics and system health info

## Monitoring Data Quality

The system includes several data quality features:

- **Validation**: Checks that extracted values are reasonable
- **Error logging**: Failed scrapes are logged with error details
- **Success rate tracking**: Statistics show scraping reliability
- **Data gap detection**: Can identify when scraping stops working

## Troubleshooting

### Common Issues

1. **Scraper not working**: 
   - Run `npm test` to check if the scraper can extract data
   - The AEP website may have changed structure
   - Check Railway logs for error messages

2. **Database connection issues**:
   - Verify `DATABASE_URL` is set correctly in Railway
   - Check if PostgreSQL service is running

3. **Missing data**:
   - Check if the cron job is running (Railway logs)
   - Verify the scraper is finding the correct table elements

### Viewing Logs

In Railway:
1. Go to your project dashboard
2. Click on your service
3. Go to "Logs" tab to see real-time application logs

## Customization

### Changing Scrape Frequency

In `server.js`, modify the cron schedule:
```javascript
// Current: every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  
// Every 10 minutes:
cron.schedule('*/10 * * * *', async () => {

// Every 30 minutes:
cron.schedule('*/30 * * * *', async () => {
```

### Adding Email Alerts

You can extend the system to send email alerts when water levels are unusual:

1. Install a mail service (nodemailer + Gmail, SendGrid, etc.)
2. Add threshold checking in the scraper
3. Send emails when levels exceed thresholds

### Custom Styling

Modify the CSS in `public/index.html` to change colors, fonts, or layout.

## Cost Estimate

**Railway Free Tier**:
- 500 hours/month of runtime (more than enough for 24/7)
- PostgreSQL database included
- Custom domain support
- **Total cost: $0/month**

**If you exceed free tier**:
- Railway Pro: $5/month
- Still very affordable for this use case

## Support

If you encounter issues:

1. Check the Railway logs for error messages
2. Test the scraper locally with `npm test`
3. Verify the AEP website hasn't changed structure
4. Check that all files are properly uploaded to GitHub

The system is designed to be robust and handle temporary failures gracefully. It will automatically retry failed scrapes and continue collecting data.

## License

MIT License - feel free to modify and use as needed!
