const { adminClient, verifyAdmin, ok, err } = require('./_shared');

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
    }
    if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

    try {
        await verifyAdmin(event.headers.authorization);
        const { userId, newPassword } = JSON.parse(event.body || '{}');
        if (!userId || !newPassword) return err('userId ve newPassword zorunludur', 400);
        if (newPassword.length < 6) return err('Şifre en az 6 karakter olmalı', 400);

        const { error } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword });
        if (error) throw error;

        return ok({ success: true });
    } catch (e) {
        console.error('reset-password error:', e);
        return err(e.message || 'Sunucu hatası', e.status || 500);
    }
};
