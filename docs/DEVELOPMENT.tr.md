# Notes

Windows için yerel çalışan kişisel not, görev, takvim ve şema uygulaması.

Geliştirme için önce `npm install`, ardından `npm start` çalıştırılır.

Windows kurulum paketi `npm run build` komutuyla oluşturulur. Güncel çıktı dosyası `release/Notes-Setup-1.5.3.exe` konumundadır.

Bu bilgisayardaki kurulu uygulamayı güncellemek için yeni paket oluşturulduktan sonra `npm run update:installed` çalıştırılır. Komut mevcut Notes kurulumunu doğrular, yerel veri dosyalarını yedekler, güncellemeyi aynı klasöre sessizce uygular, masaüstü ve Başlat menüsü kısayollarını kurulu uygulamaya yönlendirir ve uygulamayı yeniden açar. Kullanıcının uygulamayı elle kaldırması veya kurulum adımlarından geçmesi gerekmez. Bu, bu geliştirme bilgisayarı için yerel güncelleme komutudur; internet üzerinden otomatik güncelleme hizmeti değildir.

Kurulu uygulamanın Windows kimliği `local.notes.desktop` olarak sabittir. Görev çubuğundan yeniden açma komutu doğrudan kurulu `Notes.exe` dosyasına gider. Geliştirme ve QA çalıştırmaları ayrı kimlikler kullanır. Kurulu sürüm, kendi kimliğini taşıyan hatalı masaüstü, Başlat menüsü ve mevcut görev çubuğu kısayollarını yedekleyerek onarır; diğer uygulamaların kısayollarını değiştirmez.

Kullanıcı verileri Windows kullanıcı profilindeki Electron `userData` klasöründe `notes-data.json` dosyasına kaydedilir. Uygulama hesap, üyelik veya internet bağlantısı gerektirmez.

Yeni çalışma alanı boş başlar. 1.5.1 sürümü, ilk taslaktan kalmış ve içeriği değiştirilmemiş örnek kayıtları tek seferlik temizler. Başlık eşleşmesi tek başına silme nedeni değildir; kullanıcının değiştirdiği notlar ve görevler korunur. Temizlik öncesi veri dosyası `userData/backups` klasörüne yedeklenir. Eski yedek içe aktarılırken de aynı kontrol uygulanır.

Üst çubuktaki canlı saate tıklayarak veya takvimde bir gün seçip **Alarm ekle** düğmesini kullanarak tarihli ve saatli alarm kurulabilir. Görev eklerken saat seçilirse aynı görev için masaüstü hatırlatması kurulur; saat boş bırakılırsa görev yalnızca tarihle saklanır. Görevin tarihine tıklayarak hatırlatma eklenebilir, düzenlenebilir veya kaldırılabilir.

Takvim başlığındaki ay ve yıla tıklayarak gün, ay ve yıl seçilir. Seçim anında aynı takvim üzerinde gösterilir; takvim tekrar açılıp kapanmaz. Ayın gün sayısı ve artık yıllar otomatik hesaplanır.

Kırmızı vurgu rengi ve dolgusu `src/styles.css` içindeki ortak `--accent-red` (`#871626`) ve `--accent-fill` tanımlarından gelir. Takvimde bugünü gösteren kırmızı geçiş, kırmızı düğmelerde de aynen kullanılır; kenarlıklar, simgeler ve diğer vurgular aynı ana renge bağlıdır.

Alarmlar takvimde görünür, açılıp kapatılabilir ve çaldığında 5 dakika ertelenebilir. Windows bildirimi seslidir; bildirime tıklamak ilgili takvim gününü açar. Windows'un Notes bildirimlerine izin vermesi gerekir.

Pencerenin kapatma düğmesi uygulamayı sistem tepsisine gizler; alarmlar arka planda çalışmaya devam eder. Tamamen kapatmak için tepsi menüsündeki **Çıkış (alarmlar durur)** seçilir. Bilgisayar kapalı veya uykudayken alarm çalmaz; geçen alarmlar uygulama yeniden açıldığında veya bilgisayar uyandığında bildirilir. Aynı alarmın tekrar çalmasını önleyen kayıtlar ayrı `alarm-history.json` dosyasında tutulur. Alarm ve görev ayarları JSON yedeğine dahildir.

`npm test` zamanlayıcı testlerini, `npm run qa` mevcut işlev testlerini, `npm run qa:alarms` ise alarm/bildirim akışlarını ayrı test profilleriyle çalıştırır. Kaynaktan Electron testi için `NOTES_QA_SOURCE=1` ortam değişkeni kullanılır; varsayılan hedef `release/win-unpacked/Notes.exe` dosyasıdır.
