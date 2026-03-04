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
        const { userId } = JSON.parse(event.body || '{}');
        if (!userId) return err('userId zorunludur', 400);

        step = 'getUser';
        const { data: userData, error: getUserErr } = await adminClient.auth.admin.getUserById(userId);
        if (getUserErr || !userData?.user) return err('Kullanıcı bulunamadı', 404);

        const email = userData.user.email;
        const name = userData.user.user_metadata?.name || email;
        const siteUrl = process.env.SITE_URL || 'https://analizlagirio.netlify.app';

        step = 'generateLink';
        const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
            type: 'recovery',
            email,
            options: { redirectTo: siteUrl }
        });
        if (linkErr) throw new Error('generateLink: ' + linkErr.message);

        const resetLink = linkData.properties?.action_link || linkData.action_link;
        if (!resetLink) throw new Error('Reset link üretilemedi');

        step = 'email';
        const smtpOk = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
        if (!smtpOk) throw new Error('SMTP env vars eksik (SMTP_HOST, SMTP_USER, SMTP_PASS)');

        const nodemailer = require('nodemailer');
        const port = parseInt(process.env.SMTP_PORT || '465', 10);
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            tls: { rejectUnauthorized: false }
        });

        await transporter.sendMail({
            from: `"Lagirio Analiz" <${process.env.SMTP_USER}>`,
            to: email,
            subject: 'Lagirio Analiz — Şifre Sıfırlama',
            html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f8fafc;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1e293b;font-size:22px;margin:0;font-weight:700;">Lagirio Analiz</h1>
    <p style="color:#64748b;font-size:13px;margin-top:4px;">Daire Yönetim Paneli</p>
  </div>
  <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0;">
    <p style="color:#1e293b;font-size:15px;margin-top:0;">Merhaba <strong>${name}</strong>,</p>
    <p style="color:#475569;font-size:14px;line-height:1.7;margin-bottom:24px;">
      Hesabınız için şifre sıfırlama talebinde bulunuldu.<br>
      Aşağıdaki butona tıklayarak yeni şifrenizi belirleyebilirsiniz.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${resetLink}"
         style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;
                padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block;">
        Yeni Şifre Belirle
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #f1f5f9;margin:20px 0;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">
      Bu link <strong>1 saat</strong> geçerlidir. Bu talebi siz yapmadıysanız dikkate almayın.
    </p>
    <p style="color:#6366f1;font-size:11px;word-break:break-all;margin-top:6px;">${resetLink}</p>
  </div>
  <p style="color:#cbd5e1;font-size:11px;text-align:center;margin-top:20px;">
    Lagirio &mdash; Taksim 360 &nbsp;&bull;&nbsp;
    <a href="mailto:admin@lagirio.com" style="color:#94a3b8;text-decoration:none;">admin@lagirio.com</a>
  </p>
</div>`
        });

        return ok({ success: true });
    } catch (e) {
        console.error('reset-password [' + step + '] error:', e);
        return err('[' + step + '] ' + (e.message || 'Sunucu hatası'), e.status || 500);
    }
};
