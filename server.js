
// Entry point: wires up middleware and routes, then starts the server.

const express = require('express');
const { PORT } = require('./src/config');
const { startAvailabilityRefresh } = require('./src/availability');
const routes = require('./src/routes');

const app = express();

// Simple CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.use(express.json()); // parses JSON bodies
app.use(express.static('public')); // serves the frontend
app.use(routes); // /api/availability, /api/health, /api/contact

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startAvailabilityRefresh();
});