# GençServi / Personel Yaşam ve Tabldot Sistemi V6.1

V6.1, V5 arayüzünü Firebase Authentication + Cloud Firestore ile merkezi hale getiren ilk gerçek veritabanı sürümüdür.

## Bu sürümde

- Telefon numarası + şifre görünümü korunur.
- Arka planda Firebase Authentication Email/Password kullanılır.
- Telefon numarası teknik bir Firebase e-posta kimliğine dönüştürülür; gerçek e-posta kullanıcıya gösterilmez.
- Şifreler Firestore'a veya app.js içine kaydedilmez.
- İlk kurulumda site içinden ilk Admin hesabı oluşturulur.
- Yeni kayıtlar `Onay Bekliyor` olarak `users` koleksiyonuna yazılır.
- Admin üyelik onaylar ve rol/yetki atar.
- Admin isterse site içinden Firebase hesabıyla yeni personel de oluşturabilir.
- Firestore koleksiyonları site tarafından otomatik oluşturulur.
- Yemek, izin, yoklama, ödeme ve çamaşır verileri merkezi Firestore'a yazılır.
- Firestore değişiklikleri gerçek zamanlı dinlenir ve açık ekran yenilenir.
- Sistem Ayarları içinden Firestore verisi manuel yenilenebilir ve JSON yedek indirilebilir.

## Firestore koleksiyonları

- `users`
- `mealChoices`
- `mealExpenses`
- `payments`
- `debts`
- `leaveRequests`
- `leavePreferences`
- `leavePlanResults`
- `laundryReservations`
- `attendance`
- `auditLogs`
- `settings/app`

## GitHub Pages'e yükleme

Aşağıdaki beş dosya repository ana dizininde bulunmalıdır:

- `index.html`
- `styles.css`
- `app.js`
- `firebase.js`
- `README.md`

## Firebase'de bir defalık gerekli ayar

Firebase Console > Authentication > Sign-in method > Email/Password etkinleştirilmelidir.

Firestore şu anda geliştirme/test aşamasındadır. Gerçek personel, izin, telefon, ödeme ve diğer hassas kayıtlar girilmeden önce Firestore Security Rules rol/yetki bazlı olarak kilitlenmelidir.

## İlk açılış

Firestore `users` koleksiyonu boşsa giriş ekranında `İlk Admin Hesabını Oluştur` kutusu görünür. İlk admin oluşturulduktan sonra diğer personel `Kayıt Ol` ekranından başvuru yapabilir; admin `Personel Listesi` ekranından üyeliği onaylar ve rol atar.


## V6.1 düzeltmesi
- İlk admin butonu artık herhangi bir kullanıcıya değil, admin hesabının varlığına bakar.
- Bir kullanıcı daha önce Kayıt Ol ekranından hesap açmışsa, aynı telefon ve şifreyle ilk admin olarak yükseltilebilir.
