const { verifyUser, ok, err } = require('./_shared');

/**
 * PMS Lagirio takvim/rezervasyon beslemesi — proxy.
 *
 * NİÇİN VAR: Takvim ve projeksiyon verisi ElektraWeb'den geliyordu. Artık işletmenin tek
 * doğruluk kaynağı pms-lagirio (ayrı Supabase projesi). Analiz kullanıcıları (daire sahipleri)
 * PMS'te hesap sahibi değil; bu yüzden zincir şöyle:
 *
 *   tarayıcı → (analiz oturum token'ı) → BU FONKSİYON → (paylaşılan token) → PMS `analiz-feed`
 *
 * Kimlik/yetki BURADA çözülür (kullanıcı ve daire atamaları bu projede yaşıyor); PMS tarafı
 * yalnız "çağıran analiz mi" sorusuna bakar. Owner filtresi de burada uygulanır — sahibin
 * dairesine bağlı OLMAYAN birimin rezervasyonu tarayıcıya hiç inmez.
 *
 * Ortam değişkenleri (Netlify → Site settings → Environment variables):
 *   PMS_FEED_URL    = https://<pms-proje-ref>.supabase.co/functions/v1/analiz-feed
 *   PMS_FEED_TOKEN  = PMS'teki ANALIZ_FEED_TOKEN ile AYNI uzun rastgele dize
 * İkisinden biri eksikse fonksiyon 503 ile AÇIKÇA söyler; sessizce boş liste dönmez —
 * boş takvim "kurulum eksik" ile "rezervasyon yok"u aynı gösterirdi.
 *
 * Eylemler:
 *   - ping         : bağlantı testi (admin)
 *   - units        : PMS birim listesi — eşleştirme ekranı (admin)
 *   - reservations : { from, to, includeCancelled } — owner ise kendi birimleriyle sınırlı
 */

const PMS_FEED_URL = process.env.PMS_FEED_URL;
const PMS_FEED_TOKEN = process.env.PMS_FEED_TOKEN;

const ALLOWED_ACTIONS = ['ping', 'units', 'reservations'];
const ADMIN_ONLY = ['ping', 'units'];

// Tarih biçimi burada da kilitlenir: bozuk parametre PMS'e gitmeden dönsün.
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

async function pmsCall(action, params = {}) {
    const res = await fetch(PMS_FEED_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-analiz-token': PMS_FEED_TOKEN
        },
        body: JSON.stringify({ action, params })
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }

    if (!res.ok) {
        // PMS'in kendi hata metnini AYNEN taşı: "neden boş" sorusunun cevabı orada.
        const msg = (data && data.error) || text || `HTTP ${res.status}`;
        throw Object.assign(new Error(`PMS beslemesi: ${msg}`), { status: res.status });
    }
    if (!data) throw new Error('PMS beslemesi geçersiz cevap döndürdü');
    return data;
}

exports.handler = async (event) => {
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

    if (!PMS_FEED_URL || !PMS_FEED_TOKEN) {
        return err('PMS_FEED_URL / PMS_FEED_TOKEN ortam degiskenleri tanimli degil — PMS beslemesi kapali', 503);
    }

    try {
        const { profile, pmsUnitIds } = await verifyUser(event.headers.authorization || event.headers.Authorization);

        const body = JSON.parse(event.body || '{}');
        const { action, params = {} } = body;

        if (!action || !ALLOWED_ACTIONS.includes(action)) {
            return err('Gecersiz action: ' + action, 400);
        }
        if (ADMIN_ONLY.includes(action) && profile.role !== 'admin') {
            return err('Bu endpoint\'e erisim yetkiniz yok', 403);
        }

        if (action === 'ping') {
            const data = await pmsCall('ping');
            return ok({ success: true, ...data });
        }

        if (action === 'units') {
            const data = await pmsCall('units');
            return ok({ success: true, tenant: data.tenant, count: (data.units || []).length, units: data.units || [] });
        }

        if (action === 'reservations') {
            if (!TARIH.test(String(params.from || '')) || !TARIH.test(String(params.to || ''))) {
                return err('from/to YYYY-MM-DD olmali', 400);
            }

            const data = await pmsCall('reservations', {
                from: params.from,
                to: params.to,
                includeCancelled: params.includeCancelled === true
            });

            let reservations = data.reservations || [];

            // Owner filtresi: yalnız kendisine atanmış dairelerin bağlı olduğu PMS birimleri.
            // Eşleştirilmemiş daire = HİÇ rezervasyon; bu sessiz kalmasın diye owner'ın bağlı
            // birim sayısını da döndürüyoruz (ekran "eşleştirme yok" der, "boş takvim" demez).
            if (profile.role === 'owner') {
                const izinli = new Set(pmsUnitIds || []);
                reservations = reservations.filter(r => izinli.has(r.unitId));
            }

            return ok({
                success: true,
                tenant: data.tenant,
                range: data.range,
                count: reservations.length,
                // PMS tarafında birimi çözülemeyen kayıt sayısı — takvimde eksiklik aranırken
                // ilk bakılacak yer burası.
                unmatchedUnitCount: data.unmatchedUnitCount || 0,
                // PMS'te henüz BİRİM ATANMAMIŞ rezervasyon sayısı: hiçbir daireye düşemez,
                // "takvim boş" şikâyetinin ilk bakılacak yeri. Yalnız admin'e verilir —
                // owner için bu, kendi dairesi dışındaki işletme geneli bir sayı olurdu.
                unassignedCount: profile.role === 'admin' ? (data.unassignedCount || 0) : null,
                mappedUnitCount: profile.role === 'owner' ? (pmsUnitIds || []).length : null,
                reservations
            });
        }

        return err('Bilinmeyen action: ' + action, 400);

    } catch (e) {
        console.error('[pms-proxy] Hata:', e.message);
        return err(e.message, e.status || 500);
    }
};
