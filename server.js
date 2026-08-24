// server.js
// A minimal Node.js/Express backend that fetches BOTH your Vrbo and Airbnb
// iCal feeds, merges the booked date ranges, and serves them as clean JSON
// for your frontend calendar to consume.

require('dotenv').config();

const express = require('express');
const ical = require('node-ical');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- CONFIG ----
// iCal feed URLs are loaded from environment variables (see .env file).
// Vrbo:   Host dashboard -> Calendar -> Export/Sync Calendars
// Airbnb: Host dashboard -> Calendar -> Availability settings -> Export Calendar
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

// How often to refresh the cached data, in milliseconds.
// These feeds typically only update every few hours on the platform's
// side, so there's no benefit to polling more often than this.
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ---- IN-MEMORY CACHE ----
// We cache the merged result so every visitor to your site doesn't
// trigger fresh fetches to Vrbo/Airbnb — we just serve from memory
// and refresh on a timer instead.
let cachedBookedRanges = [];
let lastUpdated = null;
let lastFeedErrors = {};

async function fetchFeed(feed) {
    try {
        const events = await ical.async.fromURL(feed.url);

        const ranges = Object.values(events)
            .filter((e) => e.type === 'VEVENT')
            .map((e) => ({
                start: e.start.toISOString().split('T')[0], // YYYY-MM-DD
                end: e.end.toISOString().split('T')[0],
                summary: e.summary || 'Booked',
                source: feed.source,
            }));

        delete lastFeedErrors[feed.source];
        return ranges;
    } catch (err) {
        console.error(`Failed to fetch ${feed.source} feed:`, err.message);
        lastFeedErrors[feed.source] = err.message;
        return []; // don't let one broken feed take down the other
    }
}

// Merges overlapping/adjacent booked ranges from different platforms
// into single blocks, so a date double-booked or blocked on both
// platforms doesn't show up as two separate overlapping entries.
function mergeRanges(ranges) {
    if (ranges.length === 0) return [];

    const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        const current = sorted[i];

        if (current.start <= last.end) {
            // Overlapping or touching — extend the existing block
            last.end = current.end > last.end ? current.end : last.end;
            last.sources = last.sources || [last.source];
            if (!last.sources.includes(current.source)) {
                last.sources.push(current.source);
            }
            delete last.source;
        } else {
            merged.push({ ...current, sources: [current.source] });
            delete merged[merged.length - 1].source;
        }
    }

    return merged;
}

async function refreshAvailability() {
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const allRanges = results.flat();

    cachedBookedRanges = mergeRanges(allRanges);
    lastUpdated = new Date().toISOString();

    console.log(
        `[${lastUpdated}] Refreshed availability: ${cachedBookedRanges.length} merged booked ranges ` +
        `(from ${allRanges.length} raw entries across ${FEEDS.length} feeds).`
    );
}

// Simple CORS middleware (so your frontend, likely on a different
// origin/port during development, can call this API)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    next();
});

// Serve the frontend (public/index.html) at the root URL
app.use(express.static('public'));

// ---- ROUTES ----

// Returns the merged list of booked date ranges from all platforms
app.get('/api/availability', (req, res) => {
    res.json({
        lastUpdated,
        bookedRanges: cachedBookedRanges,
        feedErrors: lastFeedErrors, // lets the frontend surface a "sync issue" warning if a feed is down
    });
});

// Simple health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', lastUpdated, feedErrors: lastFeedErrors });
});

// ---- STARTUP ----
app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    await refreshAvailability(); // fetch immediately on startup
    setInterval(refreshAvailability, REFRESH_INTERVAL_MS); // then on a timer
});