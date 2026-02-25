# Lagirio Analiz - Proje Context

## Şirket: Taksim 360 (Lagirio)

İstanbul Taksim'de otel tarzı apart daire işletmeciliği yapan bir şirket. İşletme markası **Lagirio**, tüzel yapı **Taksim 360**.

### İşletme Modeli

İki farklı yaklaşım bir arada:

1. **Kiralık Daireler (Şirket Daireleri)**
   - Uzun dönem kiralayıp kısa dönem işletilen daireler
   - Tüm gelir ve giderler doğrudan şirkete ait

2. **Komisyonlu Yönetim (Sahip Daireleri)**
   - Daire sahiplerine profesyonel yönetim hizmeti
   - Sahipler adına platformlarda kiralama yapılıyor
   - Gelirden komisyon alınıyor
   - Sahiplere aylık detaylı kâr-zarar raporu sunuluyor

### Finansal Yapı

- E-Logo sistemi üzerinden e-fatura
- Profesyonel muhasebeci desteğiyle vergi/yasal uyumluluk
- Her daire için ayrı kârlılık takibi
- Platform komisyonları, KDV, banka/nakit ayrımı gibi karmaşık hesaplamalar

### Müşteri Kitleleri

1. **Daire Sahipleri (B2B)** — Komisyonlu yönetim modeli müşterileri. Şeffaf raporlama ve maksimum kârlılık beklentisi.
2. **Misafirler (B2C)** — Airbnb, Booking.com vb. platformlardan gelen turistler ve iş gezginleri.

### Operasyonel Odak

Rezervasyon platformları (Airbnb, Booking.com, doğrudan) üzerinden misafir kabulü. Günlük operasyonlar: rezervasyon gelirleri, platform komisyonları, vergiler, temizlik, bakım-onarım ve diğer giderlerin takibi. Manuel süreçlerden otomasyona geçiş aşamasında.

---

## Bu Uygulama Ne Yapıyor?

**Lagirio Analiz**, şirketin iç yönetim ve analiz panelidir. Hem şirket yönetimi (admin) hem daire sahipleri (owner) tarafından kullanılır.

### Teknik Yapı

- **Statik site** — Tek `index.html` dosyası, Netlify'da host
- **Sunucu yok** — Tüm veri client-side, Google Drive üzerinden senkronizasyon
- **İki rol:** Admin (Lagirio yönetimi) ve Owner (daire sahipleri)
- **Grafik kütüphanesi:** ECharts
- **UI:** Tailwind CSS + Lucide Icons

### Sayfalar / Sekmeler

| Sekme | Açıklama |
|-------|----------|
| **Dashboard** | KPI kartları, gelir grafikleri, platform dağılımı, hızlı istatistikler |
| **Trendler** | Aylık gelir/doluluk trendleri, büyüme analizi, mevsimsel analiz, kâr marjı, tahmin kartları (projeksiyon verisinden) |
| **Analiz** | Daire bazlı ve sistem bazlı karşılaştırmalı analizler |
| **Projeksiyon** | PMS HTML dosyaları + geçmiş veriden 12 aylık gelir/gider/kâr tahmini |
| **Verimlilik** | Maliyet etkinliği metrikleri |
| **Veri Yönetimi** | Daire, rezervasyon, gider CRUD + sermaye giderleri + Google Drive bağlantısı |

### Veri Modeli

- **Apartments** — Daire tanımları (kod, sistem tipi, vergi oranı, komisyon oranı)
- **Reservations** — Rezervasyonlar (misafir, tarihler, tutar, platform, ödeme yöntemi, komisyon)
- **Expenses** — Giderler (daire bazlı, kategorili)
- **Capital Expenses** — Sermaye giderleri
- **Sistem Tipleri** — Farklı komisyon/vergi modelleri (1-9 arası tipler)

### Önemli Kavramlar

- **Sistem Tipi:** Her dairenin farklı komisyon ve KDV hesaplama modeli var
- **Platform Komisyonu:** Airbnb/Booking.com'un aldığı komisyon
- **Lagirio Komisyonu:** Şirketin daire sahiplerinden aldığı yönetim komisyonu
- **Banka/Nakit Oranı:** Ödemelerin banka transferi vs. nakit oranı (KDV hesabını etkiler)
- **PMS Verisi:** Booking.com'dan indirilen HTML rezervasyon dosyaları (projeksiyon için)
- **Projeksiyon:** Gelecek 12 ay için gelir/gider tahmini (mevcut rezervasyonlar + geçmiş yıl + zincir tahmin)

### Depolama

- `localStorage` — Uygulama verileri, kullanıcı oturumu, Drive config, projeksiyon rezervasyonları
- `sessionStorage` — Google Drive OAuth token (sayfa yenilenmesinde kalıcılık için)
- **Google Drive** — Ana veri dosyası (`lagirio-analiz-data.json`), çoklu cihaz senkronizasyonu

### Geliştirme Notları

- Tek dosya mimarisi (`index.html`) — tüm HTML, CSS, JS tek dosyada
- Harici bağımlılıklar CDN'den: Tailwind, ECharts, Lucide, Google Identity Services
- Netlify üzerinde deploy, branch deploy desteği var
- `google-verification.html` — Google OAuth doğrulama dosyası (Netlify function ile serve ediliyor)
