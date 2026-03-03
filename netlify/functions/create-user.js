const { adminClient, verifyAdmin, ok, err } = require('./_shared');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
    }
    if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

    try {
        await verifyAdmin(event.headers.authorization);

        const { name, email, apartmentIds = [] } = JSON.parse(event.body || '{}');
        if (!name || !email) return err('Ad ve email zorunludur', 400);
        if (!apartmentIds.length) return err('En az bir daire seçilmelidir', 400);

        // Supabase invite — otomatik şifre belirleme emaili gönderir
        const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
            data: { name },
            redirectTo: process.env.SITE_URL || 'https://analizlagirio.netlify.app'
        });

        if (inviteErr) {
            // Kullanıcı zaten kayıtlıysa farklı hata mesajı
            if (inviteErr.message?.includes('already registered') || inviteErr.status === 422) {
                return err('Bu email adresi zaten kayıtlı', 409);
            }
            throw inviteErr;
        }

        const userId = inviteData.user.id;

        // user_profiles oluştur
        const { error: profileErr } = await adminClient
            .from('user_profiles')
            .insert({ id: userId, name, email, role: 'owner', is_active: true });

        if (profileErr) throw profileErr;

        // Daire atamaları
        if (apartmentIds.length) {
            const assignments = apartmentIds.map(apartmentId => ({ user_id: userId, apartment_id: apartmentId }));
            const { error: assignErr } = await adminClient.from('user_apartment_assignments').insert(assignments);
            if (assignErr) throw assignErr;
        }

        return ok({ success: true, userId });
    } catch (e) {
        console.error('create-user error:', e);
        return err(e.message || 'Sunucu hatası', e.status || 500);
    }
};
