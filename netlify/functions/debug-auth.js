// Geçici debug endpoint — prod'da kullandıktan sonra silin
const { adminClient } = require('./_shared');

exports.handler = async (event) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    };

    const token = event.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        return { statusCode: 400, headers, body: JSON.stringify({ step: 'no_token', detail: 'Authorization header yok' }) };
    }

    // SUPABASE_URL / SERVICE_ROLE_KEY varlığını kontrol et
    const envCheck = {
        SUPABASE_URL: !!process.env.SUPABASE_URL,
        SUPABASE_URL_value: process.env.SUPABASE_URL?.slice(0, 30) + '...',
        SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        token_preview: token.slice(0, 20) + '...',
        token_length: token.length
    };

    // getUser dene
    let getUserResult;
    try {
        const { data, error } = await adminClient.auth.getUser(token);
        getUserResult = {
            success: !error,
            user_id: data?.user?.id,
            user_email: data?.user?.email,
            error_message: error?.message,
            error_status: error?.status,
            error_code: error?.code
        };
    } catch (e) {
        getUserResult = { exception: e.message };
    }

    // Eğer user bulunduysa user_profiles'a bak
    let profileResult = null;
    if (getUserResult.user_id) {
        const { data, error } = await adminClient
            .from('user_profiles')
            .select('role, is_active')
            .eq('id', getUserResult.user_id)
            .single();
        profileResult = { data, error: error?.message };
    }

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ envCheck, getUserResult, profileResult }, null, 2)
    };
};
