const { createClient } = require('@supabase/supabase-js');

const adminClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

async function verifyAdmin(authHeader) {
    const token = authHeader?.replace('Bearer ', '');
    if (!token) throw Object.assign(new Error('Token gerekli'), { status: 401 });

    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) throw Object.assign(new Error('Geçersiz token: ' + (error?.message || 'user null')), { status: 401 });

    const { data: profile } = await adminClient
        .from('user_profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .single();

    if (profile?.role !== 'admin' || !profile?.is_active) {
        throw Object.assign(new Error('Yalnızca adminler bu işlemi yapabilir'), { status: 403 });
    }
    return user;
}

async function verifyUser(authHeader) {
    const token = authHeader?.replace('Bearer ', '');
    if (!token) throw Object.assign(new Error('Token gerekli'), { status: 401 });

    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) throw Object.assign(new Error('Geçersiz token: ' + (error?.message || 'user null')), { status: 401 });

    const { data: profile } = await adminClient
        .from('user_profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .single();

    if (!profile?.is_active) {
        throw Object.assign(new Error('Hesap aktif değil'), { status: 403 });
    }

    let apartmentIds = [];
    let elektrawebRoomNos = [];

    if (profile.role === 'owner') {
        const { data: assignments } = await adminClient
            .from('user_apartment_assignments')
            .select('apartment_id')
            .eq('user_id', user.id);

        apartmentIds = (assignments || []).map(a => a.apartment_id);

        if (apartmentIds.length > 0) {
            const { data: apartments } = await adminClient
                .from('apartments')
                .select('data')
                .in('id', apartmentIds);

            elektrawebRoomNos = (apartments || [])
                .map(a => {
                    const d = typeof a.data === 'string' ? JSON.parse(a.data) : a.data;
                    return d?.elektrawebRoomNo;
                })
                .filter(Boolean);
        }
    }

    return { user, profile, apartmentIds, elektrawebRoomNos };
}

function ok(body) {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(body)
    };
}

function err(message, status = 500) {
    return {
        statusCode: status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: message })
    };
}

module.exports = { adminClient, verifyAdmin, verifyUser, ok, err };
