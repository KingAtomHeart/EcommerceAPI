const https = require('https');

// Live exchange rates for the storefront's multi-currency DISPLAY. Prices are
// stored/charged in PHP (base); this only converts for what shoppers see. Rates
// are fetched from a free, no-key API and cached in memory so we hit it at most
// a couple of times a day. If the API is ever down we serve the last good cache
// (or a PHP-only fallback), so the store never breaks over FX.
let cache = { base: 'PHP', rates: null, updatedAt: 0 };
const TTL = 12 * 60 * 60 * 1000; // 12 hours

function fetchRates() {
    return new Promise((resolve, reject) => {
        https.get('https://open.er-api.com/v6/latest/PHP', res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

module.exports.getRates = async (req, res) => {
    try {
        if (!cache.rates || Date.now() - cache.updatedAt > TTL) {
            const data = await fetchRates();
            if (data?.result === 'success' && data.rates) {
                cache = { base: 'PHP', rates: { ...data.rates, PHP: 1 }, updatedAt: Date.now() };
            }
        }
    } catch (err) {
        console.error('[currency] rate fetch failed:', err.message);
    }
    return res.status(200).json({
        base: 'PHP',
        rates: cache.rates || { PHP: 1 },
        updatedAt: cache.updatedAt,
    });
};
