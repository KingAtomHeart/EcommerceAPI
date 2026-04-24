// PH shipping rate table. Single source of truth for backend order pricing.

const SHIPPING_REGIONS = {
    NCR:      { label: 'Metro Manila (NCR)',  rate: 180 },
    LUZON:    { label: 'Luzon (outside NCR)', rate: 250 },
    VISAYAS:  { label: 'Visayas',             rate: 400 },
    MINDANAO: { label: 'Mindanao',            rate: 500 },
};

// Every province / pseudo-province the address form allows, mapped to its region.
// "Metro Manila" is a pseudo-province for NCR (NCR is not technically a province).
const PROVINCE_TO_REGION = {
    'Metro Manila': 'NCR',
    // LUZON
    'Abra': 'LUZON', 'Apayao': 'LUZON', 'Benguet': 'LUZON', 'Ifugao': 'LUZON', 'Kalinga': 'LUZON', 'Mountain Province': 'LUZON',
    'Ilocos Norte': 'LUZON', 'Ilocos Sur': 'LUZON', 'La Union': 'LUZON', 'Pangasinan': 'LUZON',
    'Batanes': 'LUZON', 'Cagayan': 'LUZON', 'Isabela': 'LUZON', 'Nueva Vizcaya': 'LUZON', 'Quirino': 'LUZON',
    'Aurora': 'LUZON', 'Bataan': 'LUZON', 'Bulacan': 'LUZON', 'Nueva Ecija': 'LUZON', 'Pampanga': 'LUZON', 'Tarlac': 'LUZON', 'Zambales': 'LUZON',
    'Batangas': 'LUZON', 'Cavite': 'LUZON', 'Laguna': 'LUZON', 'Quezon': 'LUZON', 'Rizal': 'LUZON',
    'Marinduque': 'LUZON', 'Occidental Mindoro': 'LUZON', 'Oriental Mindoro': 'LUZON', 'Palawan': 'LUZON', 'Romblon': 'LUZON',
    'Albay': 'LUZON', 'Camarines Norte': 'LUZON', 'Camarines Sur': 'LUZON', 'Catanduanes': 'LUZON', 'Masbate': 'LUZON', 'Sorsogon': 'LUZON',
    // VISAYAS
    'Aklan': 'VISAYAS', 'Antique': 'VISAYAS', 'Capiz': 'VISAYAS', 'Guimaras': 'VISAYAS', 'Iloilo': 'VISAYAS', 'Negros Occidental': 'VISAYAS',
    'Bohol': 'VISAYAS', 'Cebu': 'VISAYAS', 'Negros Oriental': 'VISAYAS', 'Siquijor': 'VISAYAS',
    'Biliran': 'VISAYAS', 'Eastern Samar': 'VISAYAS', 'Leyte': 'VISAYAS', 'Northern Samar': 'VISAYAS', 'Samar': 'VISAYAS', 'Southern Leyte': 'VISAYAS',
    // MINDANAO
    'Zamboanga del Norte': 'MINDANAO', 'Zamboanga del Sur': 'MINDANAO', 'Zamboanga Sibugay': 'MINDANAO',
    'Bukidnon': 'MINDANAO', 'Camiguin': 'MINDANAO', 'Lanao del Norte': 'MINDANAO', 'Misamis Occidental': 'MINDANAO', 'Misamis Oriental': 'MINDANAO',
    'Davao de Oro': 'MINDANAO', 'Davao del Norte': 'MINDANAO', 'Davao del Sur': 'MINDANAO', 'Davao Occidental': 'MINDANAO', 'Davao Oriental': 'MINDANAO',
    'Cotabato': 'MINDANAO', 'Sarangani': 'MINDANAO', 'South Cotabato': 'MINDANAO', 'Sultan Kudarat': 'MINDANAO',
    'Agusan del Norte': 'MINDANAO', 'Agusan del Sur': 'MINDANAO', 'Dinagat Islands': 'MINDANAO', 'Surigao del Norte': 'MINDANAO', 'Surigao del Sur': 'MINDANAO',
    'Basilan': 'MINDANAO', 'Lanao del Sur': 'MINDANAO', 'Maguindanao del Norte': 'MINDANAO', 'Maguindanao del Sur': 'MINDANAO', 'Sulu': 'MINDANAO', 'Tawi-Tawi': 'MINDANAO',
};

function computeShippingFromProvince(province) {
    const region = PROVINCE_TO_REGION[province];
    if (!region) return { ok: false, error: 'We don\'t ship to that area yet.' };
    const def = SHIPPING_REGIONS[region];
    return { ok: true, fee: def.rate, regionCode: region, regionLabel: def.label };
}

module.exports = { SHIPPING_REGIONS, PROVINCE_TO_REGION, computeShippingFromProvince };
