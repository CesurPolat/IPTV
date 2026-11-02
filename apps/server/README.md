# Shortizle koleksiyon ve dizi listesi

## Arşiv araması

`GET /Streaming/Shortizle/search` sabit `https://shortizle.com/archive` adresine filtreli istek yapar; HTML içindeki Inertia verisini veya doğrudan JSON yanıtını okuyabilir.

```http
GET /Streaming/Shortizle/search?genres%5B%5D=aksiyon&platform=reelshort&kind=dublaj&sort=popular&q=selam&view=grid&page=1
GET /Streaming/Shortizle/search?kind=dublaj&sort=popular&q=&view=grid
```

Desteklenen parametreler: `q` (en fazla 200 karakter), tekrarlanabilen `genres[]`, `platform`, `kind` (boş/dublaj/altyazi), `sort` (popular/new/rating), `view` (grid/list), `page` (pozitif sayfa numarası). Varsayılanlar: boş arama ve dil filtresi, popular sıralama, grid görünüm, sayfa 1. Boş `q` ile filtreli liste alınabilir.

Yanıt `{ items, page, lastPage, perPage, total, options: { genres, platforms } }` biçimindedir. `items` koleksiyonlarla aynı dizi kartı alanlarını kullanır; filtre seçenekleri `{ value, label }` biçimindedir. Sayfa bilgileri upstream’den korunur, boş sonuç hata sayılmaz. Filtre hataları `400 invalid_search`, eksik sonuç/sayfalama şeması `502 invalid_search_response` döndürür. Başarılı aramalar her filtre/sayfa birleşimi için 2 dakika önbellekte tutulur.

Client `/series` ekranında arama formu, çoklu tür seçimi, platform/dil/sıralama, ızgara/liste görünümü ve Önceki/Sonraki sayfa kontrolleri bulunur. Ara düğmesi filtreleri uygular ve sayfayı 1’e döndürür; filtreler URL’de saklanır. Genel arama ekranı da Shortizle sonuçlarını mevcut sağlayıcılarla birleştirir; bir sağlayıcı hata verirse diğerinin sonuçları gösterilir. Dizi seçimi mevcut detay ve oynatma akışını kullanır.

Site `kind=dublaj` seçiliyken bazen `has_dublaj=false` olan kayıtlar da döndürebilir. API filtreyi aynen iletir ve upstream dil işaretlerini değiştirmez.

## Koleksiyonlar ve detay

- `GET /Streaming/Shortizle/collections`: `/koleksiyonlar` sayfasındaki Inertia JSON verisini okuyup `{ heading, collections: [{ key, title, items }] }` döndürür. Ayrıntılı `desktopCollections` varsa kullanılır; aksi halde `collections` okunur. Her dizi `id`, `slug`, `name`, `url`, `posterUrl`, `description`, `episodeCount`, `hasDublaj`, `hasAltyazi`, `isAdult` alanlarını taşır. Film kayıtları ve aynı grup içindeki yinelenen diziler elenir; farklı koleksiyonlarda tekrar görünmesi korunur.
- `GET /Streaming/Shortizle/series/{slug}`: `/icerik/{slug}` sayfasından gerçek sezon ve bölüm numaralarını okuyup mevcut `StreamingSeriesDetail` biçiminde döndürür. Yakında yayınlanacak bölümler listelenmez. Bölüm adresleri `/watch/{slug}/{sezon}/{bolum}` biçimindedir.

Başarılı katalog ve detay yanıtları sunucuda 5 dakika bellekte tutulur. Boş koleksiyon listesi geçerlidir; sayfa şeması eksikse `502 invalid_catalog` veya `502 invalid_series`, geçersiz slug için `400 invalid_slug` döner.

Client’ta **Movies → `/series`** açılınca koleksiyonlar afişli gruplar olarak gösterilir. Dizi seçimi `/series?url=https://shortizle.com/icerik/{slug}` detay ekranına, bölüm seçimi mevcut çözümleyici üzerinden player’a gider. Kumanda yön tuşları ve Enter ile gezilebilir. Yükleme, boş liste ve tekrar deneme durumları bulunur. Eski sağlayıcıların detay bağlantıları mevcut endpoint’i kullanmayı sürdürür.

# Shortizle bölüm oynatma API’si

Shortizle bölüm sayfasını URL-encode ederek mevcut endpoint’e verin:

```http
GET /Streaming/GetMediaUrl?url=https%3A%2F%2Fshortizle.com%2Fwatch%2Fustanin-oyunu-rjes%2F1%2F1
```

Başarılı yanıt `200 text/plain` olarak oynatma URL’si döndürür:

```text
https://iptvapi.cesurpolat.dev/Streaming/Shortizle/<sessionId>/master.m3u8
```

Client mevcut `response.text()` akışını kullanır. Bu adresi player’a HLS kaynağı olarak verin; `/GetMediaUrl` adresini doğrudan video kaynağı yapmayın:

```typescript
const episodeUrl = 'https://shortizle.com/watch/ustanin-oyunu-rjes/1/1';
const response = await fetch(`${apiBase}/Streaming/GetMediaUrl?url=${encodeURIComponent(episodeUrl)}`);
if (!response.ok) throw await response.json();
const playbackUrl = await response.text();
router.navigate(['/player'], { queryParams: { url: playbackUrl } });
```

API anonim ve ayrı bir çerez oturumu kurar. Giriş/abonelik gerektiren içerik açılmaz. Manifest, alt playlist, segment, anahtar ve HLS altyazı adresleri API üzerinden aynı oturumla sunulur. Kaynak adresleri ve upstream çerezleri client’a verilmez. Mevcut Dizipal ve Roketdizi akışları korunur.

Oynatma oturumları 30 dakika hareketsizlikten sonra veya API yeniden başlatıldığında biter. Birden fazla API instance’ı kullanılıyorsa oynatma istekleri aynı instance’a yönlendirilmelidir. Oturum URL’leri erişim anahtarı gibi ele alınmalı ve paylaşılmamalıdır.

Süre bilgisi olan kaynaklar, master yeniden istendiğinde süre bitimine 60 saniye kala aynı kaynak kimliğiyle yenilenir. Eski kaynak kimlikleri eski upstream adresini korur; süresi biten eski segmentler yeni kaynağa eşlenmez. Oynatıcı eski playlisti kullanmaya devam ederken upstream erişimi biterse `/GetMediaUrl` yeniden çağrılıp yeni master yüklenmelidir. API oturumu için `410 session_expired` da aynı şekilde ele alınır.

Hatalar `application/problem+json` ve `code` alanı taşır: geçersiz adres `400`, giriş gereksinimi `401`, erişim reddi `403`, bulunamayan bölüm/kaynak `404`, bitmiş oturum `410`, upstream/geçersiz manifest/desteklenmeyen kaynak `502`, zaman aşımı `504`. HTTP 200 dönen HTML, HLS kabul edilmez. Upstream’de identity istenir; gzip/deflate/Brotli çözülür, zstd `502 unsupported_encoding` döndürür.

İzinli upstream host’ları `shortizle.com`, `api.mybigdramapool.com`, `storage-pilot.shortizle.com`, `stream.shortizle.com` ve `short-depo-test.b-cdn.net` ile sınırlıdır. Yeni bir CDN kullanılırsa otomatik olarak güvenilmez; host listesi incelenerek güncellenmelidir. Kaynaklar HTTPS kullanmalı ve DNS sonucu genel ağ adresi olmalıdır.

Testler (depo kökünden):

```powershell
dotnet test apps/server/IPTVAPI.sln
# İsteğe bağlı canlı test; ikinci test PATH üzerinde ffmpeg gerektirir:
$env:SHORTIZLE_LIVE_TEST = '1'
dotnet test apps/server/Shortizle.Tests/Shortizle.Tests.csproj --filter FullyQualifiedName~Live
```

Canlı testler anonim kaynak çözümleme, master/alt playlist/medya erişimi ve gerçek HTTP endpoint’inden ffmpeg ile video karesi çözmeyi kontrol eder. Gateway segmentleri uzantısız olabildiğinden ffmpeg testinde `allowed_extensions=ALL`, `allowed_segment_extensions=ALL`, `extension_picky=0` kullanılır; bu seçenekler API’nin upstream host ve ağ doğrulamasını değiştirmez. Canlı sonuçlar kaynak erişimine göre değişebilir. Tarayıcı player’ında görsel oynatma ayrıca doğrulanmalıdır.

# TRT 1
https://trt.daioncdn.net/trt-1/master.m3u8?app=web

# ATV
https://trkvz.daioncdn.net/atv/atv.m3u8?ce=3&app=d1ce2d40-5256-4550-b02e-e73c185a314e

fetch https://securevideotoken.tmgrup.com.tr/webtv/secure?url=https%3A%2F%2Ftrkvz.daioncdn.net%2Fatv%2Fatv.m3u8%3Fce%3D3%26app%3Dd1ce2d40-5256-4550-b02e-e73c185a314e
header Referer=https://www.atv.com.tr/

# Kanal D
https://demiroren.daioncdn.net/kanald/kanald.m3u8?app=kanald_web&ce=3&ppid=90c3164ba032ec3d41ffbcd67477566c

# Star TV
https://dogus.daioncdn.net/startv/startv.m3u8?ce=3&app=a20ac41e-bdc3-4aa1-934d-26b484480ac9

# NOW TV
https://nowtv-live-ad.ercdn.net/nowtv/playlist.m3u8?st=lYaZ2cR1YSGPD86f3FyT1Q&e=1742609470

# TV360
https://turkmedya-live.ercdn.net/tv360/tv360.m3u8

# Kanal 7
https://kanal7.daioncdn.net/kanal7/kanal7.m3u8?app=f99587ad-1637-494d-8255-da35b09d17a1&ce=3

# Show TV
https://ciner.daioncdn.net/showtv/showtv.m3u8?ce=3&app=4bc856ef-4c68-4a94-bc87-37dfaaa66558

# A2 TV
https://trkvz.daioncdn.net/a2tv/a2tv.m3u8?ce=3&app=59363a60-be96-4f73-9eff-355d0ff2c758

# TV8
https://tv8.daioncdn.net/tv8/tv8.m3u8?app=7ddc255a-ef47-4e81-ab14-c0e5f2949788&ce=3

# TV2
https://demiroren.daioncdn.net/teve2/teve2.m3u8?ce=3&app=6aab838a-437e-4a1b-bbd0-e30f79cdbbbd

# Habertürk
https://ciner.daioncdn.net/haberturktv/haberturktv.m3u8?app=c98ab0b0-50cc-495b-bb37-778e91f5ff5b&ce=3

# TLC
https://dogus.daioncdn.net/tlc/tlc.m3u8?ce=3&app=1aca0aa1-06e3-41ff-a8e5-38d7df475469

# DMAX
https://dogus.daioncdn.net/dmax/dmax.m3u8?ce=3&app=5a02c599-d17e-4982-9b04-090934d51af7
