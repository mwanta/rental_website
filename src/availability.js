
// Fetches your Vrbo and Airbnb iCal feeds, merges the booked date ranges,
// and keeps an in-memory cache that's refreshed on a timer

const ical = require('node-ical');
const { FEEDS, REFRESH_INTERVAL_MS } = require('./config');

let cachedBookedRanges = [];
let lastUpdated = null;
let lastFeedErrors = {};

/**
 * Uses ICAL endpoint to retrieve availability information for a given source.
 *
 * Returns the dates the rental is booked.
 *
 * @param feed - where to retrieve the data from (vrbo or airbnb)
 * @returns {Promise<{start: *, end: *, summary, source: *}[]|*[]>} - booked date ranges
 */
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
        return [];
    }
}

/**
 * Merges overlapping/adajacent booked ranges from all platforms in FEEDS into single-blocks
 * so they don't show up as separate entries.
 *
 * @param ranges - the booked dates
 * @returns {*[]} - the merged dates
 */
function mergeRanges(ranges) {
    if (ranges.length === 0) return [];

    const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        const current = sorted[i];

        if (current.start <= last.end) {
            // Overlapping or touching : extend the existing block
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

/**
 * Refresh cached data.
 */
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

// Starts the initial fetch plus the recurring refresh timer.
function startAvailabilityRefresh() {
    refreshAvailability(); // fetch immediately
    setInterval(refreshAvailability, REFRESH_INTERVAL_MS); // then on a timer
}

// Accessors used by routes — always return the current cached state.
function getAvailabilitySnapshot() {
    return {
        lastUpdated,
        bookedRanges: cachedBookedRanges,
        feedErrors: lastFeedErrors,
    };
}

module.exports = {
    refreshAvailability,
    startAvailabilityRefresh,
    getAvailabilitySnapshot,
};