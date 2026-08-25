// All Express routes live here: availability, health check, and the
// contact form submission endpoint (including basic spam protection).

const express = require('express');
const { EMAIL } = require('./config');
const { getAvailabilitySnapshot } = require('./availability');
const { createMailTransporter } = require('./mailer');

const router = express.Router();
const mailTransporter = createMailTransporter();

// Returns the merged list of booked date ranges from all platforms
router.get('/api/availability', (req, res) => {
    res.json(getAvailabilitySnapshot());
});

// Simple health check
router.get('/api/health', (req, res) => {
    const { lastUpdated, feedErrors } = getAvailabilitySnapshot();
    res.json({ status: 'ok', lastUpdated, feedErrors });
});

// In-memory rate limiting: max 5 submissions per IP per hour.
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
router.post('/api/contact', async (req, res) => {
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

    if (isRateLimited(req.ip)) {
        return res.status(429).json({ ok: false, error: 'Too many submissions. Please try again later.' });
    }

    if (!mailTransporter) {
        console.error('Contact form submitted but email is not configured (EMAIL_USER / EMAIL_APP_PASSWORD missing).');
        return res.status(500).json({ ok: false, error: 'Message could not be sent right now. Please try again later.' });
    }

    try {
        await mailTransporter.sendMail({
            from: `"Website contact form" <${EMAIL.user}>`,
            to: EMAIL.toAddress,
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

module.exports = router;