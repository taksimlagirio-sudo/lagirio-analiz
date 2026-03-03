const { adminClient, verifyAdmin, ok, err } = require('./_shared');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'DELETE, OPTIONS' }, body: '' };
    }
    if (event.httpMethod !== 'DELETE') return err('Method not allowed', 405);

    try {
        const caller = await verifyAdmin(event.headers.authorization);
        const { userId } = JSON.parse(event.body || '{}');
        if (!userId) return err('userId zorunludur', 400);
        if (userId === caller.id) return err('Kendi hesabınızı silemezsiniz', 400);

        // Önce profili kontrol et (mevcut mu?)
        const { data: profile } = await adminClient
            .from('user_profiles')
            .select('role')
            .eq('id', userId)
            .single();

        if (!profile) return err('Kullanıcı bulunamadı', 404);
        if (profile.role === 'admin') return err('Admin hesabı silinemez', 400);

        // Supabase Auth'dan sil — cascade ile user_profiles ve user_apartment_assignments silinir
        const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
        if (deleteErr) throw deleteErr;

        return ok({ success: true });
    } catch (e) {
        console.error('delete-user error:', e);
        return err(e.message || 'Sunucu hatası', e.status || 500);
    }
};
