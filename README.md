# Zabu Greedy (H5)

Cocos Creator 3.x H5 build — ZabuChat uygulaması içinde WebView ile açılır.
Yayın: Cloudflare Pages → https://greedy.zabuchat.com

- Build adımı yok, dosyalar olduğu gibi servis edilir (Framework: None, output: `/`).
- `zabu-bridge.js`: Flutter ⇄ oyun köprüsü. Token tutmaz; bahis/sonuç sunucuda (Supabase `greedy-baby`).
- Tarayıcıda tek başına açılırsa oyun başlamaz (Flutter köprüsü gerekir).
