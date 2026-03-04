const { adminClient, verifyAdmin, ok, err } = require('./_shared');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
    }
    if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

    let step = 'auth';
    try {
        await verifyAdmin(event.headers.authorization);

        step = 'parse';
        const { name, username, password, apartmentIds = [] } = JSON.parse(event.body || '{}');
        if (!name || !username || !password) return err('Ad, kullanıcı adı ve şifre zorunludur', 400);
        if (username.includes('@')) return err('Kullanıcı adında @ kullanmayın', 400);
        if (password.length < 6) return err('Şifre en az 6 karakter olmalı', 400);
        if (!apartmentIds.length) return err('En az bir daire seçilmelidir', 400);

        // Kullanıcı adından Supabase email üret (Türkçe ve özel karakterleri temizle)
        const email = username.toLowerCase()
            .replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s')
            .replace(/ı/g,'i').replace(/ö/g,'o').replace(/ç/g,'c')
            .replace(/[^a-z0-9._-]/g,'_')
            .replace(/^[._-]+|[._-]+$/g,'')
            .replace(/_+/g,'_') + '@lagirio.app';

        step = 'createUser';
        const { data: userData, error: createErr } = await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { name, username }
        });

        if (createErr) {
            if (createErr.message?.includes('already registered') || createErr.status === 422) {
                return err('Bu kullanıcı adı zaten alınmış', 409);
            }
            throw new Error('createUser: ' + createErr.message);
        }

        const userId = userData.user.id;

        step = 'profile';
        const { error: profileErr } = await adminClient
            .from('user_profiles')
            .insert({ id: userId, name, email, role: 'owner', is_active: true });

        if (profileErr && !profileErr.code?.includes('23505')) {
            throw new Error('profile: ' + profileErr.message);
        }

        step = 'apartments';
        const assignments = apartmentIds.map(apartmentId => ({ user_id: userId, apartment_id: apartmentId }));
        const { error: assignErr } = await adminClient.from('user_apartment_assignments').insert(assignments);
        if (assignErr) throw new Error('apartments: ' + assignErr.message);

        return ok({ success: true, userId, email });
    } catch (e) {
        console.error('create-user [' + step + '] error:', e);
        return err('[' + step + '] ' + (e.message || 'Sunucu hatası'), e.status || 500);
    }
};
