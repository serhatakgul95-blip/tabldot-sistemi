# PBYS V8 — Personel Bilgi Yönetim Sistemi

Bu test sürümü V6 Firestore altyapısı üzerine toplu kullanıcı geri bildirimlerini uygular.

## Bu sürümde
- **Tabldot Sorumlusu** rolü: yemek yönetimi, bilanço ve tabldot raporları
- Borç/ödeme bölümünde banka, hesap sahibi ve IBAN yönetimi
- Bekleyen/reddedilen izin taleplerini personelin silip iptal edebilmesi; yetkili için kayıt silme
- Yoklama Girişi/Yoklama Özeti açılmama hatası giderildi; durum sözlüğü tanımlandı
- Yoklamada serbest metin **Görev / Açıklama** alanı (örn. Şehir merkezine çıkış yaptı)
- Raporlar ekranında gerçek **PDF Önizleme** ve tarayıcıdan **PDF/Yazdır** desteği
- Malzeme/gider kayıtlarını sonradan düzenleme ve silme; mevcut dönem borçlarını yeniden hesaplama
- Admin için çamaşır makinelerini **Aktif / Arızalı / Bakımda** durumuna alma
- Mobil yemek gün kartları daha belirgin başlık, çerçeve ve boşluklarla güncellendi
- Giriş ve marka adı: **PBYS — Personel Bilgi Yönetim Sistemi**
- Personel bilgi düzenleme, çoklu rol ve ek özel yetki yönetimi
- Son admin rolünün yanlışlıkla kaldırılamaması
- Yoklamada durum + bulunduğu yer / görev yeri
- Yıllık izin: 30 gün + ayrı 2 gün yol izni bakiyesi
- Admin/İdari İşler için geçmiş izin kaydı girişi
- Günübirlik izin talebi
- Karakol Komutanı kendi izinlerini ve yıllık tercihini görür; yeni izin talebi göndermez
- Yıllık izin tercihleri: başlangıç seçimine göre otomatik 10/20 günlük dönem
- Eşzamanlı yıllık izin sınırı: aktif personelin %25'i (aşağı yuvarlanır)
- Yıllık izin anket sonuçları, grafik, resmi tatil vurguları ve yönetim değerlendirmesi
- 2. tercihi kabul edilene yönetim içi puan bonusu; personel puanı görmez
- Yemek tercihi varsayılan: **Yiyecek**; kullanıcı sadece **Yemeyeceğim** veya **Görevdeyim / Ayır** istisnasını işaretler
- Onaylı yıllık izin günleri tabldot ücretinden otomatik çıkar
- Mobil yemek tercihleri yatay kaydırmasız kart görünümü
- Tabldot bilançosu: malzeme gideri / toplam ücretli öğün = öğün maliyeti; personel borcu otomatik hesaplama
- Bilanço yazdırma / PDF kaydetme
- Çamaşır makineleri: Beyaz Çamaşır Makinesi, Gri Çamaşır Makinesi, Kurutma Makinesi
- Kurutma Makinesi başlangıçta arızalı
- Personel arıza kaydı oluşturabilir; yetkili durumunu Açık / İnceleniyor / Onarıldı yapabilir
- Firestore'da `laundryFaults` koleksiyonu eklendi

## GitHub'a yükleme
Depodaki eski dosyaların üzerine şu dosyaları yükleyin:
- `index.html`
- `styles.css`
- `app.js`
- `firebase.js`
- `README.md`

Sonra **Commit changes** yapın. GitHub Pages güncellendikten sonra telefonda sayfayı tamamen yenileyin.

> Test modu devam ediyor. Gerçek personel verilerine geçmeden önce Firestore Security Rules rol/yetki modeline göre kilitlenmelidir.
