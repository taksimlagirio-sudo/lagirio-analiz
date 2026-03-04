const nodemailer = require('nodemailer');
const { adminClient, verifyAdmin, ok, err } = require('./_shared');

const createTransporter = () => nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: (process.env.SMTP_PORT || '465') === '465',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: { rejectUnauthorized: false }
});

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

        const siteUrl = process.env.SITE_URL || 'https://analizlagirio.netlify.app';

        // Supabase'de kullanıcı oluştur + davet linki al (email göndermez)
        const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
            type: 'invite',
            email,
            options: {
                data: { name },
                redirectTo: siteUrl
            }
        });

        if (linkErr) {
            if (linkErr.message?.includes('already registered') || linkErr.status === 422) {
                return err('Bu email adresi zaten kayıtlı', 409);
            }
            throw linkErr;
        }

        const userId = linkData.user.id;
        const inviteLink = linkData.properties?.action_link || linkData.action_link;

        // user_profiles oluştur
        const { error: profileErr } = await adminClient
            .from('user_profiles')
            .insert({ id: userId, name, email, role: 'owner', is_active: true });

        if (profileErr && !profileErr.message?.includes('duplicate')) throw profileErr;

        // Daire atamaları
        if (apartmentIds.length) {
            const assignments = apartmentIds.map(apartmentId => ({ user_id: userId, apartment_id: apartmentId }));
            const { error: assignErr } = await adminClient.from('user_apartment_assignments').insert(assignments);
            if (assignErr) throw assignErr;
        }

        // admin@lagirio.com üzerinden davet emaili gönder
        const transporter = createTransporter();
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
  <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <p style="color:#1e293b;font-size:15px;margin-top:0;">Merhaba <strong>${name}</strong>,</p>
    <p style="color:#475569;font-size:14px;line-height:1.7;margin-bottom:24px;">
      Lagirio Analiz paneline erişiminiz tanımlandı.<br>
      Aşağıdaki butona tıklayarak şifrenizi belirleyin ve daire raporlarınıza ulaşın.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${inviteLink}"
         style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;
                padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;
                display:inline-block;letter-spacing:0.3px;">
        Şifremi Belirle &amp; Giriş Yap
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #f1f5f9;margin:20px 0;">
    <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.6;">
      Bu link <strong>24 saat</strong> geçerlidir. Buton çalışmazsa aşağıdaki adresi tarayıcınıza kopyalayın:
    </p>
    <p style="color:#6366f1;font-size:11px;word-break:break-all;margin-top:6px;">${inviteLink}</p>
  </div>
  <p style="color:#cbd5e1;font-size:11px;text-align:center;margin-top:20px;">
    Lagirio &mdash; Taksim 360 &nbsp;&bull;&nbsp;
    <a href="mailto:admin@lagirio.com" style="color:#94a3b8;text-decoration:none;">admin@lagirio.com</a>
  </p>
</div>`
        });

        return ok({ success: true, userId });
    } catch (e) {
        console.error('create-user error:', e);
        return err(e.message || 'Sunucu hatası', e.status || 500);
    }
};
