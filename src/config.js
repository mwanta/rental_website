
// Loads and validates environment variables

require('dotenv').config();

const PORT = process.env.PORT || 3000;

// ICAL URLs
const FEEDS = [
    { source: 'vrbo', url: process.env.VRBO_ICAL_URL },
    { source: 'airbnb', url: process.env.AIRBNB_ICAL_URL },
].filter((feed) => {
    if (!feed.url) {
        console.warn(`Warning: no URL set for ${feed.source} (check your .env file). Skipping this feed.`);
        return false;
    }
    return true;
});

if (FEEDS.length === 0) {
    console.error('No iCal feed URLs configured. Add VRBO_ICAL_URL and/or AIRBNB_ICAL_URL to your .env file.');
    process.exit(1);
}

// How often to refresh the cached availability data
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * For the contact form
 *
 * Currently implemented providers: gmail, icloud, outlook
 */
const EMAIL = {
    provider: (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase(),
    user: process.env.EMAIL_USER,
    appPassword: process.env.EMAIL_APP_PASSWORD,
    toAddress: process.env.CONTACT_TO_ADDRESS || process.env.EMAIL_USER,
    customHost: process.env.EMAIL_HOST,
    customPort: Number(process.env.EMAIL_PORT) || 587,
    customSecure: process.env.EMAIL_SECURE === 'true',
};

module.exports = {
    PORT,
    FEEDS,
    REFRESH_INTERVAL_MS,
    EMAIL,
};