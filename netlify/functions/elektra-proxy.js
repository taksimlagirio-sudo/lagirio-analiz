const { verifyUser, ok, err } = require('./_shared');

/**
 * ElektraWeb Booking API proxy
 *
 * Auth flow:
 *   POST /login
 *     headers: Authorization: Bearer <ELEKTRAWEB_API_KEY>, x-captcha: ""
 *     body: { "hotel-id", "usercode", "password" }
 *     response: { success: true, jwt: "..." }
 *   JWT is 24h valid; we cache for 23h module-level (warm function).
 *
 * Exposed actions:
 *   - test-connection
 *   - reservations: fromCheckIn, toCheckIn, reservationStatus
 *   - reservations-in-house
 *   - room-list: derived from recent reservations (unique room-no + room-type)
 */

const ELEKTRAWEB_BASE_URL = process.env.ELEKTRAWEB_BASE_URL || 'https://bookingapi.elektraweb.com';
const ELEKTRAWEB_HOTEL_ID = process.env.ELEKTRAWEB_HOTEL_ID || '32978';
const DEFAULT_TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

// Module-level cache (persists across warm invocations)
let cachedToken = null;
let tokenExpiresAt = 0;
let loginPromise = null;

const ALLOWED_ACTIONS = [
    'test-connection',
    'reservations',
    'reservations-in-house',
    'room-list'
];

async function login() {
    const hotelId = ELEKTRAWEB_HOTEL_ID;
    const usercode = process.env.ELEKTRAWEB_USERCODE;
    const password = process.env.ELEKTRAWEB_PASSWORD;
    const apiKey = process.env.ELEKTRAWEB_API_KEY;

    if (!usercode || !password) {
        throw new Error('ELEKTRAWEB_USERCODE ve ELEKTRAWEB_PASSWORD ortam degiskenleri tanimlanmamis');
    }
    if (!apiKey) {
        throw new Error('ELEKTRAWEB_API_KEY ortam degiskeni tanimlanmamis');
    }

    const res = await fetch(`${ELEKTRAWEB_BASE_URL}/login`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'x-captcha': ''
        },
        body: JSON.stringify({ 'hotel-id': hotelId, usercode, password })
    });

    if (!res.ok) {
        const text = await res.text();
        throw Object.assign(new Error(`ElektraWeb login hatasi (${res.status}): ${text}`), { status: res.status });
    }

    const data = await res.json();
    if (data && data.success === false) {
        throw Object.assign(new Error(`ElektraWeb login basarisiz: ${data.message || data.error || 'success=false'}`), { status: 401 });
    }

    const token =
        data?.jwt || data?.token || data?.access_token ||
        data?.accessToken || data?.['access-token'] ||
        data?.jwtToken || data?.jwt_token ||
        data?.authToken || data?.auth_token;

    if (!token) {
        throw new Error(`ElektraWeb login: token bulunamadi (${JSON.stringify(data)})`);
    }

    const expiresInSec = data?.expires_in || data?.expiresIn || 0;
    const ttlMs = expiresInSec > 0 ? (expiresInSec * 1000 - 60 * 1000) : DEFAULT_TOKEN_TTL_MS;

    return { token, expiresAt: Date.now() + ttlMs };
}

async function getToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
    if (loginPromise) return loginPromise;
    loginPromise = login()
        .then(({ token, expiresAt }) => {
            cachedToken = token;
            tokenExpiresAt = expiresAt;
            loginPromise = null;
            return token;
        })
        .catch((e) => {
            loginPromise = null;
            throw e;
        });
    return loginPromise;
}

function invalidateToken() {
    cachedToken = null;
    tokenExpiresAt = 0;
    loginPromise = null;
}

async function elektraGet(path, queryParams = {}) {
    const doCall = async () => {
        const token = await getToken();
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(queryParams)) {
            if (v !== undefined && v !== null && v !== '') qs.append(k, v);
        }
        const url = `${ELEKTRAWEB_BASE_URL}${path}${qs.toString() ? '?' + qs.toString() : ''}`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'x-captcha': ''
            }
        });
        return res;
    };

    let res = await doCall();
    // Retry once on token invalidation
    if (res.status === 401 || res.status === 498) {
        invalidateToken();
        res = await doCall();
    }

    if (!res.ok) {
        const text = await res.text();
        throw Object.assign(new Error(`ElektraWeb API hatasi (${res.status}): ${text}`), { status: res.status });
    }
    return res.json();
}

function hotelPath(suffix = '') {
    return `/hotel/${ELEKTRAWEB_HOTEL_ID}${suffix}`;
}

function normalizeReservationList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.reservations)) return data.reservations;
    if (data && Array.isArray(data.results)) return data.results;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data['reservation-list'])) return data['reservation-list'];
    return [];
}

/**
 * Reservation list'i ortak projeksiyon/takvim formatina cevirir.
 * Owner tarafi bu formati bekler: id, room-no, check-in, check-out, channel, price.
 */
function toCommonFormat(eRes) {
    return {
        id: eRes['reservation-id'] || eRes.id,
        roomNo: String(eRes['room-no'] || '').trim(),
        roomType: eRes['room-type'] || '',
        checkIn: eRes['check-in-date'] || eRes['check-in'],
        checkOut: eRes['check-out-date'] || eRes['check-out'],
        adultCount: eRes['adult-count'] || 0,
        childCount: (eRes['elder-child-count'] || 0) + (eRes['younger-child-count'] || 0) + (eRes['baby-count'] || 0),
        contactName: eRes['contact-name'] || '',
        agency: eRes.agency || '',
        voucherNo: eRes['voucher-no'] || '',
        totalPrice: eRes['reservation-total-price'] || 0,
        paidPrice: eRes['reservation-paid-price'] || 0,
        currency: eRes['reservation-currency'] || 'EUR',
        status: eRes['reservation-status'] || 'Reservation',
        rateType: eRes['rate-type'] || ''
    };
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
        return err('Yalnizca POST istekleri kabul edilir', 405);
    }

    try {
        const { profile, elektrawebRoomNos } = await verifyUser(event.headers.authorization || event.headers.Authorization);

        const body = JSON.parse(event.body || '{}');
        const { action, params = {} } = body;

        if (!action || !ALLOWED_ACTIONS.includes(action)) {
            return err('Gecersiz action: ' + action, 400);
        }

        // room-list is admin-only (for mapping UI)
        if (action === 'room-list' && profile.role !== 'admin') {
            return err('Bu endpoint\'e erisim yetkiniz yok', 403);
        }

        if (action === 'test-connection') {
            // Simple login ping
            await getToken();
            return ok({ success: true, message: 'ElektraWeb baglantisi aktif', hotelId: ELEKTRAWEB_HOTEL_ID });
        }

        if (action === 'reservations') {
            const queryParams = {};
            if (params.fromCheckIn) queryParams['from-check-in'] = params.fromCheckIn;
            if (params.toCheckIn) queryParams['to-check-in'] = params.toCheckIn;
            queryParams['reservation-status'] = params.reservationStatus || 'Reservation';

            const data = await elektraGet(hotelPath('/reservation-list'), queryParams);
            let reservations = normalizeReservationList(data).map(toCommonFormat);

            // Owner filtering: only show reservations for mapped room-no's
            if (profile.role === 'owner') {
                const allowed = new Set((elektrawebRoomNos || []).map(String));
                reservations = reservations.filter(r => allowed.has(String(r.roomNo)));
            }

            return ok({ success: true, count: reservations.length, reservations });
        }

        if (action === 'reservations-in-house') {
            const data = await elektraGet(hotelPath('/reservation-in-house'));
            let reservations = normalizeReservationList(data).map(toCommonFormat);

            if (profile.role === 'owner') {
                const allowed = new Set((elektrawebRoomNos || []).map(String));
                reservations = reservations.filter(r => allowed.has(String(r.roomNo)));
            }

            return ok({ success: true, count: reservations.length, reservations });
        }

        if (action === 'room-list') {
            // Admin-only: derive unique (roomNo, roomType) pairs from a wide reservation query
            const today = new Date();
            const fromDate = new Date(today.getFullYear(), today.getMonth() - 6, 1).toISOString().split('T')[0];
            const toDate = new Date(today.getFullYear(), today.getMonth() + 12, 28).toISOString().split('T')[0];

            const rooms = new Map(); // roomNo -> { roomNo, roomType }

            for (const status of ['Reservation', 'Cancelled']) {
                try {
                    const data = await elektraGet(hotelPath('/reservation-list'), {
                        'from-check-in': fromDate,
                        'to-check-in': toDate,
                        'reservation-status': status
                    });
                    const list = normalizeReservationList(data);
                    for (const r of list) {
                        const rn = String(r['room-no'] || '').trim();
                        if (!rn) continue;
                        if (!rooms.has(rn)) {
                            rooms.set(rn, {
                                roomNo: rn,
                                roomType: r['room-type'] || ''
                            });
                        }
                    }
                } catch (e) {
                    console.error(`[elektra-proxy] room-list ${status} hatasi:`, e.message);
                }
            }

            const roomList = Array.from(rooms.values()).sort((a, b) => a.roomNo.localeCompare(b.roomNo, 'tr'));
            return ok({ success: true, count: roomList.length, rooms: roomList });
        }

        return err('Bilinmeyen action: ' + action, 400);

    } catch (e) {
        console.error('[elektra-proxy] Hata:', e.message);
        return err(e.message, e.status || 500);
    }
};
