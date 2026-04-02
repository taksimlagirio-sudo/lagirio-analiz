const { verifyUser, ok, err, adminClient } = require('./_shared');

const HOMESBERG_API_URL = process.env.HOMESBERG_API_URL || 'https://public-api.homesberg.com/v1';
const HOMESBERG_API_KEY = process.env.HOMESBERG_API_KEY;

// İzin verilen endpoint'ler
const ALLOWED_ACTIONS = [
    'listings',
    'reservations',
    'reservation-detail',
    'calendar',
    'channel-types',
    'currencies'
];

function buildUrl(action, params = {}) {
    let path;
    switch (action) {
        case 'listings':
            path = '/listings';
            break;
        case 'reservations':
            path = '/reservations';
            break;
        case 'reservation-detail':
            path = `/reservations/${params._id}`;
            delete params._id;
            break;
        case 'calendar':
            path = '/calendar';
            break;
        case 'channel-types':
            path = '/reservations/channel-types';
            break;
        case 'currencies':
            path = '/reservations/currencies';
            break;
        default:
            throw new Error('Geçersiz action: ' + action);
    }

    const qs = new URLSearchParams();
    for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null && val !== '') {
            qs.append(key, val);
        }
    }
    const queryString = qs.toString();
    return `${HOMESBERG_API_URL}${path}${queryString ? '?' + queryString : ''}`;
}

exports.handler = async (event) => {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return err('Yalnızca POST istekleri kabul edilir', 405);
    }

    if (!HOMESBERG_API_KEY) {
        return err('Homesberg API key yapılandırılmamış', 500);
    }

    try {
        // Kullanıcıyı doğrula
        const { user, profile, apartmentIds, homesbergListingIds } = await verifyUser(event.headers.authorization || event.headers.Authorization);

        const body = JSON.parse(event.body || '{}');
        const { action, params = {} } = body;

        if (!action || !ALLOWED_ACTIONS.includes(action)) {
            return err('Geçersiz action: ' + action, 400);
        }

        // Owner güvenlik kontrolü: sadece kendi listing'lerine erişebilir
        if (profile.role === 'owner') {
            const listingId = params.listing__id || params.listing_id;
            if (listingId && !homesbergListingIds.includes(String(listingId))) {
                return err('Bu listing\'e erişim yetkiniz yok', 403);
            }

            // Reservation detail için: önce reservation'ı çek, listing kontrolü yap
            if (action === 'reservation-detail' && params._id) {
                // İlk olarak reservation'ı çekip listing kontrolü yapacağız
                // Proxy'den geçirip kontrol edeceğiz aşağıda
            }

            // listings endpoint'i admin-only (eşleştirme için)
            if (action === 'listings') {
                return err('Bu endpoint\'e erişim yetkiniz yok', 403);
            }
        }

        // Admin için tüm apartments'ın listing ID'lerini çek (listings endpoint hariç)
        if (profile.role === 'admin' && action !== 'listings') {
            // Admin tüm listing'lere erişebilir, ek kontrol yok
        }

        // Homesberg API çağrısı
        const url = buildUrl(action, params);
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Api-Key ${HOMESBERG_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // Rate limit kontrolü
        if (response.status === 429) {
            return {
                statusCode: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Retry-After': response.headers.get('Retry-After') || '60'
                },
                body: JSON.stringify({ error: 'Rate limit aşıldı, lütfen bekleyin' })
            };
        }

        if (!response.ok) {
            const errorText = await response.text();
            return err(`Homesberg API hatası (${response.status}): ${errorText}`, response.status);
        }

        const data = await response.json();

        // Owner reservation-detail güvenlik kontrolü
        if (profile.role === 'owner' && action === 'reservation-detail') {
            if (data.listing && !homesbergListingIds.includes(String(data.listing))) {
                return err('Bu rezervasyona erişim yetkiniz yok', 403);
            }
        }

        // Owner reservations/calendar listelerinde filtreleme
        if (profile.role === 'owner' && (action === 'reservations' || action === 'calendar')) {
            if (data.results && Array.isArray(data.results)) {
                data.results = data.results.filter(item => {
                    const lid = String(item.listing_id || item.listing || '');
                    return homesbergListingIds.includes(lid);
                });
                data.count = data.results.length;
            }
        }

        return ok(data);

    } catch (e) {
        return err(e.message, e.status || 500);
    }
};
