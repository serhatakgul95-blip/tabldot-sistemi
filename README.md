# Personel Yaşam ve Tabldot Sistemi V5 — Aşama 1

Bu sürüm, V4 prototipinin üzerine **rol/yetki altyapısı** ve **yoklama/personel durum takibi** ekler.

## Yeni eklenenler

- Tek kullanıcı hesabına birden fazla rol atanabilir.
- Admin, Personel Listesi içinden `Rol / Yetki` ile rol atayabilir.
- Roller: Personel, Aşçı, İdari İşler, Karakol Komutanı, Müdür, Admin.
- İdari İşler için `Yoklama Girişi` ekranı.
- Personel varsayılan olarak `Mevcut` kabul edilir; yalnızca istisnalar girilir.
- Durumlar: Mevcut, Yıllık İzin, Mazeret İzni, Yol İzni, Raporlu/İstirahatli, Görevli, Geçici Görevli, Kurs/Eğitim, Sevkli, Nöbet İstirahati, Diğer.
- Başlangıç ve bitiş tarihiyle toplu yoklama durumu girilebilir.
- Onaylanmış izinler yoklamaya otomatik yansır.
- Karakol Komutanı için günlük yoklama özeti ve haftalık personel matrisi.
- Önceki/sonraki gün ve hafta görüntülenebilir.
- Personel bazında yoklama geçmişi görüntülenebilir.
- Rol ve yoklama değişiklikleri için yerel audit log temeli eklendi.

## Demo hesapları

- Admin: `05000000001` / `123456`
- Müdür: `05000000002` / `123456`
- Personel: `05000000003` / `123456`
- Aşçı: `05000000006` / `123456`
- İdari İşler: `05000000007` / `123456`
- Karakol Komutanı: `05000000008` / `123456`

## Not

Bu hâlâ GitHub Pages üzerinde çalışan yerel prototiptir. Veriler tarayıcının `localStorage` alanında tutulur. Firestore/Firebase geçişi daha sonra yapılacaktır.
