# Supabase Ortak Veritabanı — Uygulama Planı

## Genel Bakış

Lagirio Analiz, Daire Uygulaması ve Pricing System ortak bir Supabase veritabanını paylaşacak.
Kullanıcı yönetimi lagirio-analiz admin panelinden yapılır; daire sahiplerine otomatik davet emaili gönderilir.

**Supabase Projesi:** `https://yrjrokmncqpicsoakdsa.supabase.co`

---

## Faz 1: Auth + Kullanıcı Yönetimi ✅ (Tamamlandı)

### Yapılanlar

- `netlify/functions/` dizini oluşturuldu
- 4 Netlify Function yazıldı: `create-user`, `delete-user`, `update-user`, `reset-password`
- `index.html` Auth modülü Supabase tabanlıya dönüştürüldü
- Login formu email input'a çevrildi
- DataManager → Users paneli yenilendi (davet akışı)
- `UserManager` JS objesi eklendi

### Supabase'de Manuel Yapılacaklar

**1. SQL Schema çalıştır** (Dashboard > SQL Editor):

```sql
CREATE TABLE public.user_profiles (
  id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  email      TEXT        NOT NULL,
  role       TEXT        NOT NULL DEFAULT 'owner' CHECK (role IN ('admin', 'owner')),
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE TABLE public.user_apartment_assignments (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  apartment_id TEXT NOT NULL,
  PRIMARY KEY (user_id, apartment_id)
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION public.sync_role_to_jwt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('user_role', NEW.role)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_role_change
  AFTER INSERT OR UPDATE OF role ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_to_jwt();

ALTER TABLE public.user_profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_apartment_assignments  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_profiles" ON public.user_profiles FOR SELECT
  USING ((auth.jwt() ->> 'user_role') = 'admin' OR id = auth.uid());

CREATE POLICY "select_assignments" ON public.user_apartment_assignments FOR SELECT
  USING ((auth.jwt() ->> 'user_role') = 'admin' OR user_id = auth.uid());

CREATE POLICY "service_write_profiles"    ON public.user_profiles             FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_write_assignments" ON public.user_apartment_assignments FOR ALL USING (auth.role() = 'service_role');
```

**2. Admin hesabı oluştur** (Dashboard > Authentication > Users > Add User):
- Email: şirket emaili (örn. `admin@lagirio.com`)
- Password: güçlü şifre belirle
- Auto Confirm: ✓

**3. Admin profilini ekle** (oluşan UUID ile):
```sql
INSERT INTO public.user_profiles (id, name, email, role, is_active)
VALUES ('<ADMIN_UUID>', 'Lagirio Admin', 'admin@lagirio.com', 'admin', true);
```

**4. Netlify env vars ekle** (Netlify Dashboard > Site Settings > Environment Variables):
- `SUPABASE_URL` = `https://yrjrokmncqpicsoakdsa.supabase.co`
- `SUPABASE_ANON_KEY` = (anon public key)
- `SUPABASE_SERVICE_ROLE_KEY` = (service_role key — gizli, sadece functions)
- `SITE_URL` = `https://analizlagirio.netlify.app`

**5. Supabase Redirect URLs** (Dashboard > Authentication > URL Configuration):
- `https://analizlagirio.netlify.app` ekle

**6. SMTP ayarla** (Dashboard > Authentication > SMTP — opsiyonel ama önerilir):
- Resend/SendGrid/Postmark ile özel domain email

---

## Faz 2: daire-uygulamasi Supabase Entegrasyonu (Sonraki Adım)

**Hedef:** Tüm veri localStorage yerine Supabase'e yazılsın.

- Sadece Lagirio staff giriş yapar (owner erişimi yok)
- JSON import: mevcut localStorage verilerini Supabase'e aktarmak için
- JSON export: yedek almak için

**Tablolar:** `apartments`, `reservations`, `expenses`, `capital_expenses`, `lagirio_expenses`, `expense_categories`

---

## Faz 3: pricing-system Entegrasyonu (Daha Sonra)

**Hedef:** Rezervasyon/doluluk verilerini Supabase'den okusun.

- `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` env var olarak ekle
- Mevcut pricing-calendar API push mekanizması değişmez

---

## Önemli Notlar

- Admin hesabı artık sadece Supabase'de — eski `admin/lagirio2025` kullanılamaz
- Drive sync (analiz verisi) hâlâ çalışır, sadece kullanıcı sync'i kaldırıldı
- Netlify Functions yalnızca admin tokenı kabul eder (güvenlik garantili)
