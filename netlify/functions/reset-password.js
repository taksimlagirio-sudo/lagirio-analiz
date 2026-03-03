const { adminClient, verifyAdmin, ok, err } = require('./_shared');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
    }
    if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

    try {
        await verifyAdmin(event.headers.authorization);
        const { userId } = JSON.parse(event.body || '{}');
        if (!userId) return err('userId zorunludur', 400);

        // Kullanıcının email adresini al
        const { data: userData, error: getUserErr } = await adminClient.auth.admin.getUserById(userId);
        if (getUserErr || !userData?.user) return err('Kullanıcı bulunamadı', 404);

        const email = userData.user.email;

        // Şifre sıfırlama emaili gönder
        const { error: resetErr } = await adminClient.auth.resetPasswordForEmail(email, {
            redirectTo: process.env.SITE_URL || 'https://analizlagirio.netlify.app'
        });
        if (resetErr) throw resetErr;

        return ok({ success: true });
    } catch (e) {
        console.error('reset-password error:', e);
        return err(e.message || 'Sunucu hatası', e.status || 500);
    }
};
