const { adminClient, verifyAdmin, ok, err } = require('./_shared');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'PUT, OPTIONS' }, body: '' };
    }
    if (event.httpMethod !== 'PUT') return err('Method not allowed', 405);

    try {
        await verifyAdmin(event.headers.authorization);
        const { userId, name, apartmentIds } = JSON.parse(event.body || '{}');
        if (!userId) return err('userId zorunludur', 400);

        // İsim güncelle
        if (name) {
            const { error: profileErr } = await adminClient
                .from('user_profiles')
                .update({ name })
                .eq('id', userId);
            if (profileErr) throw profileErr;
        }

        // Daire atamalarını güncelle (replace pattern: sil + ekle)
        if (Array.isArray(apartmentIds)) {
            const { error: delErr } = await adminClient
                .from('user_apartment_assignments')
                .delete()
                .eq('user_id', userId);
            if (delErr) throw delErr;

            if (apartmentIds.length) {
                const assignments = apartmentIds.map(apartmentId => ({ user_id: userId, apartment_id: apartmentId }));
                const { error: insertErr } = await adminClient.from('user_apartment_assignments').insert(assignments);
                if (insertErr) throw insertErr;
            }
        }

        return ok({ success: true });
    } catch (e) {
        console.error('update-user error:', e);
        return err(e.message || 'Sunucu hatası', e.status || 500);
    }
};
