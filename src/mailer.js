
// Sets up a Nodemailer transporter using your own email account.

const nodemailer = require('nodemailer');
const { EMAIL } = require('./config');

// use SMTP host/port to configure icloud and outlook for NodeMailer.
const PROVIDER_SMTP_SETTINGS = {
    icloud: { host: 'smtp.mail.me.com', port: 587, secure: false },
    outlook: { host: 'smtp.office365.com', port: 587, secure: false },
};

function createMailTransporter() {
    const { provider, user, appPassword, customHost, customPort, customSecure } = EMAIL;

    if (!user || !appPassword) {
        console.warn('Warning: EMAIL_USER / EMAIL_APP_PASSWORD not set — the contact form will not be able to send email.');
        return null;
    }

    if (provider === 'gmail') {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: { user, pass: appPassword },
        });
    }

    if (PROVIDER_SMTP_SETTINGS[provider]) {
        return nodemailer.createTransport({
            ...PROVIDER_SMTP_SETTINGS[provider],
            auth: { user, pass: appPassword },
        });
    }

    if (provider === 'custom') {
        return nodemailer.createTransport({
            host: customHost,
            port: customPort,
            secure: customSecure,
            auth: { user, pass: appPassword },
        });
    }

    console.error(`Unknown EMAIL_PROVIDER "${provider}". Use gmail, icloud, outlook, or custom.`);
    return null;
}

module.exports = { createMailTransporter };