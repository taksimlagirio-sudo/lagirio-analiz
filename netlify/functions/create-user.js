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
        const { name, email, apartmentIds = [] } = JSON.parse(event.body || '{}');
        if (!name || !email) return err('Ad ve email zorunludur', 400);
        if (!apartmentIds.length) return err('En az bir daire seçilmelidir', 400);

        const siteUrl = process.env.SITE_URL || 'https://analizlagirio.netlify.app';

        // Supabase'de kullanıcı oluştur + davet linki al
        step = 'generateLink';
        if (!adminClient.auth.admin?.generateLink) {
            throw new Error('adminClient.auth.admin.generateLink mevcut değil — Supabase JS versiyonu eski olabilir');
        }
        const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
            type: 'invite',
            email,
            options: { data: { name }, redirectTo: siteUrl }
        });

        if (linkErr) {
            if (linkErr.message?.includes('already registered') || linkErr.status === 422) {
                return err('Bu email adresi zaten kayıtlı', 409);
            }
            throw new Error('generateLink: ' + linkErr.message);
        }

        const userId = linkData.user?.id;
        const inviteLink = linkData.properties?.action_link || linkData.action_link;

        if (!userId) throw new Error('generateLink userId dönmedi: ' + JSON.stringify(Object.keys(linkData)));
        if (!inviteLink) throw new Error('generateLink inviteLink dönmedi: ' + JSON.stringify(Object.keys(linkData.properties || linkData)));

        // user_profiles oluştur
        step = 'profile';
        const { error: profileErr } = await adminClient
            .from('user_profiles')
            .insert({ id: userId, name, email, role: 'owner', is_active: true });

        if (profileErr && !profileErr.message?.includes('duplicate') && !profileErr.code?.includes('23505')) {
            throw new Error('profile insert: ' + profileErr.message);
        }

        // Daire atamaları
        step = 'apartments';
        const assignments = apartmentIds.map(apartmentId => ({ user_id: userId, apartment_id: apartmentId }));
        const { error: assignErr } = await adminClient.from('user_apartment_assignments').insert(assignments);
        if (assignErr) throw new Error('apartment assign: ' + assignErr.message);

        // Email gönder
        step = 'email';
        const smtpOk = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
        if (!smtpOk) {
            console.warn('SMTP env vars eksik, email atlanıyor. Invite link:', inviteLink);
        } else {
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
                subject: 'Lagirio Analiz — Hesabınız Hazır',
                html: `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f8fafc;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#1e293b;font-size:22px;margin:0;font-weight:700;">Lagirio Analiz</h1>
    <p style="color:#64748b;font-size:13px;margin-top:4px;">Daire Yönetim Paneli</p>
  </div>
  <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0;">
    <p style="color:#1e293b;font-size:15px;margin-top:0;">Merhaba <strong>${name}</strong>,</p>
    <p style="color:#475569;font-size:14px;line-height:1.7;margin-bottom:24px;">
      Lagirio Analiz paneline erişiminiz tanımlandı.<br>
      Aşağıdaki butona tıklayarak şifrenizi belirleyin ve daire raporlarınıza ulaşın.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${inviteLink}"
         style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;
                padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block;">
        Şifremi Belirle &amp; Giriş Yap
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #f1f5f9;margin:20px 0;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">
      Bu link <strong>24 saat</strong> geçerlidir. Buton çalışmazsa bu adresi kopyalayın:
    </p>
    <p style="color:#6366f1;font-size:11px;word-break:break-all;margin-top:6px;">${inviteLink}</p>
  </div>
  <p style="color:#cbd5e1;font-size:11px;text-align:center;margin-top:20px;">
    Lagirio &mdash; Taksim 360 &nbsp;&bull;&nbsp;
    <a href="mailto:admin@lagirio.com" style="color:#94a3b8;text-decoration:none;">admin@lagirio.com</a>
  </p>
</div>`
            });
        }

        return ok({ success: true, userId, emailSent: !!smtpOk });
    } catch (e) {
        console.error('create-user [' + step + '] error:', e);
        return err('[' + step + '] ' + (e.message || 'Sunucu hatası'), e.status || 500);
    }
};
