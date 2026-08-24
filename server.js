// server.js
// A minimal Node.js/Express backend that fetches BOTH your Vrbo and Airbnb
// iCal feeds, merges the booked date ranges, and serves them as clean JSON
// for your frontend calendar to consume.

require('dotenv').config();

const express = require('express');
const ical = require('node-ical');
const nodemailer = require('nodemailer');

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

// ---- EMAIL (for the contact form) ----
// Uses your own email account to send messages — free, since it's just
// your existing Gmail (or other provider) account, not a paid service.
// For Gmail: you must use an "App Password", not your normal password.
// Google Account -> Security -> 2-Step Verification -> App passwords
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;
const CONTACT_TO_ADDRESS = process.env.CONTACT_TO_ADDRESS || EMAIL_USER;

// Nodemailer's "service" shortcut only knows a fixed list of providers.
// iCloud isn't one of them, so it (and any other provider) is configured
// via explicit SMTP host/port instead.
const PROVIDER_SMTP_SETTINGS = {
    icloud: { host: 'smtp.mail.me.com', port: 587, secure: false },
    outlook: { host: 'smtp.office365.com', port: 587, secure: false },
};

let mailTransporter = null;
if (EMAIL_USER && EMAIL_APP_PASSWORD) {
    if (EMAIL_PROVIDER === 'gmail') {
        mailTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
        });
    } else if (PROVIDER_SMTP_SETTINGS[EMAIL_PROVIDER]) {
        mailTransporter = nodemailer.createTransport({
            ...PROVIDER_SMTP_SETTINGS[EMAIL_PROVIDER],
            auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
        });
    } else if (EMAIL_PROVIDER === 'custom') {
        mailTransporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: Number(process.env.EMAIL_PORT) || 587,
            secure: process.env.EMAIL_SECURE === 'true',
            auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
        });
    } else {
        console.error(`Unknown EMAIL_PROVIDER "${EMAIL_PROVIDER}". Use gmail, icloud, outlook, or custom.`);
    }
} else {
    console.warn('Warning: EMAIL_USER / EMAIL_APP_PASSWORD not set — the contact form will not be able to send email.');
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
    res.header('Access-Control-Allow-Methods', 'GET, POST');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Parse JSON request bodies (needed for the contact form POST)
app.use(express.json());

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

// Very light in-memory rate limiting: max 5 submissions per IP per hour.
// Prevents the endpoint from being trivially spammed. For a small
// personal site this is enough; a high-traffic site would want a
// proper rate-limiting package or a spam-filtering service instead.
const submissionLog = new Map(); // ip -> array of timestamps

function isRateLimited(ip) {
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour
    const maxPerWindow = 5;

    const timestamps = (submissionLog.get(ip) || []).filter((t) => now - t < windowMs);
    timestamps.push(now);
    submissionLog.set(ip, timestamps);

    return timestamps.length > maxPerWindow;
}

// Receives the contact form submission and emails it to you.
app.post('/api/contact', async (req, res) => {
    const { name, email, dates, message, website } = req.body || {};

    // Honeypot field: a real visitor never fills this in (it's hidden via
    // CSS on the form), but simple bots that auto-fill every field will.
    if (website) {
        return res.status(200).json({ ok: true }); // pretend success, do nothing
    }

    if (!name || !email || !message) {
        return res.status(400).json({ ok: false, error: 'Name, email, and message are required.' });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        return res.status(400).json({ ok: false, error: 'Please provide a valid email address.' });
    }

    const ip = req.ip;
    if (isRateLimited(ip)) {
        return res.status(429).json({ ok: false, error: 'Too many submissions. Please try again later.' });
    }

    if (!mailTransporter) {
        console.error('Contact form submitted but email is not configured (EMAIL_USER / EMAIL_APP_PASSWORD missing).');
        return res.status(500).json({ ok: false, error: 'Message could not be sent right now. Please try again later.' });
    }

    try {
        await mailTransporter.sendMail({
            from: `"Website contact form" <${EMAIL_USER}>`,
            to: CONTACT_TO_ADDRESS,
            replyTo: email,
            subject: `New inquiry from ${name}`,
            text: [
                `Name: ${name}`,
                `Email: ${email}`,
                dates ? `Dates: ${dates}` : null,
                '',
                message,
            ].filter(Boolean).join('\n'),
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('Failed to send contact form email:', err.message);
        res.status(500).json({ ok: false, error: 'Message could not be sent right now. Please try again later.' });
    }
});

// ---- STARTUP ----
app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    await refreshAvailability(); // fetch immediately on startup
    setInterval(refreshAvailability, REFRESH_INTERVAL_MS); // then on a timer
});