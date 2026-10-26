# Hasil implementasi dan verifikasi

Proyek baru dibuat di `aet-ai-rebuilt/`; aplikasi ZIP tetap menjadi referensi terpisah. Kode aplikasi, tes, riwayat Git, dokumen arsitektur lama, benchmark, dan database SQLite lama tidak dipakai sebagai fondasi implementasi baru. Konten, font berlisensi, favicon, dan dokumen resmi yang relevan digunakan kembali.

## Versi terpasang

Node.js 24.19.0, npm 11.9.0, Next.js 16.4.2, React/React DOM 19.3.1, TypeScript 5.9.3, Tailwind CSS/PostCSS 4.3.3, Lucide React 1.60.0, Fastify 5.12.7, dan Prisma/client/adapter PostgreSQL 6.19.0. Database lokal memakai PostgreSQL 16. Versi lengkap terkunci di `package-lock.json`.

## Pemeriksaan yang benar-benar dijalankan

| Pemeriksaan | Hasil |
| --- | --- |
| Instalasi ulang `PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci`, `npm run db:generate` | Lulus; verifikasi TLS/checksum tetap aktif. |
| `npm run db:migrate` | Migrasi PostgreSQL diterapkan; memakai pelacakan checksum dan advisory lock. |
| `npm run seed`, diulang dua kali | Lulus; tepat 1 berita, 1 kegiatan, 1 anggota tim. ID, slug, Markdown, tanggal, dan kolom sumber diverifikasi; tidak menggandakan data. |
| `npm run typecheck` | Lulus untuk kontrak, API, frontend, dan skrip. |
| `npm run lint` | Lulus, tanpa warning. |
| `npm test` dengan `AET_TEST_DATABASE_URL` untuk database lokal berakhiran `_test` dan `AET_TEST_DISPOSABLE_DB=true` | **73/73 lulus**, 0 gagal, 0 dilewati, 0 dibatalkan. Termasuk integrasi PostgreSQL nyata. |
| `npm run build:api` | Lulus; artefak API terpisah di `apps/api/dist/`. |
| `npm run build:web` | Lulus dengan `next build --webpack`; output statis di `apps/web/out/`. |
| `npm run verify:export` | Lulus: 12 rute wajib, 184 berkas, font/aset lokal, DOCX, pemisahan browser/backend, dan pemindaian nilai secret. |
| `node scripts/browser-smoke.mjs` (tersedia sebagai `npm run test:browser`) terhadap ekspor yang disajikan server Python statis | **14 pemeriksaan lulus** pada Chromium desktop/seluler; navigasi, rute detail, chat/SSE tiruan, edit, cancel, riwayat, dialog, dan overflow. Tidak membutuhkan server Next.js produksi. |
| `scripts/browser-admin.ts` (tersedia sebagai `npm run test:browser:admin`) dengan database disposable dan API uji terpisah | **8 alur lulus**: login/cookie HttpOnly/CORS, CMS CRUD/publikasi, tanggal WIB, upload tiruan dengan pratinjau nyata, model-test tiruan manual, seluler, dan logout. Data/admin/sesi sementara dibersihkan. |
| `npm run admin:create` melalui pseudo-terminal | Lulus; input kata sandi tidak ditampilkan, hash scrypt tersimpan, administrator uji dibersihkan. |
| Pemindaian kode sumber | 103 berkas diperiksa; tidak ada nilai secret terkonfigurasi atau pola kredensial berisiko ditemukan. |

Pengujian AI memakai mock: klasifikasi/routing adaptif, variasi effort/kapabilitas, fallback sebelum output, tidak mengulang setelah output parsial, pembatalan koneksi HTTP/deadline, batas concurrency, SSE tidak lengkap, pembatasan respons, dokumen/gambar, SSRF/DNS/redirect, serta otorisasi model-test. Tidak ada panggilan model live otomatis.

Hasil dan screenshot browser lokal berada di `.local/browser/` dan sengaja tidak dimasukkan dalam arsip sumber. Perbaikan hasil pengujian mencakup fokus Tab/Shift+Tab menu seluler, normalisasi path pada rate limit, dan PATCH publikasi yang mempertahankan kolom lain.

## Batas yang masih memerlukan konfigurasi operator

- `SUMOPOD_API_KEY` belum tersedia; model live dan ketersediaan kandidat pada akun Sumopod belum diverifikasi. Router adaptif sudah aktif tanpa flag, tetapi tidak menganggap kandidat sebagai model yang sudah terverifikasi. Gunakan panel admin untuk pengujian manual setelah key diisi aman.
- Tavily, object storage produksi, dan rebuild hook bersifat opsional dan belum dikonfigurasi. Pengujian upload memakai adapter tiruan; integrasi produksi tidak diklaim berhasil.
- Tiga URL gambar Vercel Blob asli diblokir proxy jaringan. URL dipertahankan dan fallback gambar bekerja; ketersediaan asal belum dapat ditentukan. Tautan resmi/map juga bergantung akses jaringan deployment.
- Rute detail baru atau slug yang berubah memerlukan sinkronisasi manifest, build, dan deployment ulang. Konten yang dihapus/tidak diterbitkan ditolak API meskipun shell statis lama masih tersimpan.
- `AETPCR.docx` memiliki satu sumber kanonis di `apps/web/public/AETPCR.docx`; hasil ekspor berisi salinan byte-identik di `apps/web/out/AETPCR.docx`.
- Belum ada deployment ke hosting produksi atau publikasi environment cloud. PostgreSQL lokal hanya untuk pengembangan; produksi memerlukan layanan PostgreSQL persisten, secret, HTTPS, dan administrator yang dibuat operator.

## Menjalankan dan menerapkan

### Pembaruan kompatibilitas pemanggilan perintah Windows

Skrip lingkungan dan development kini menjalankan entry point JavaScript npm/TSX/Prisma melalui executable Node, memakai argv terpisah dan `shell:false`. Tujuh tes regresi baru mencakup resolusi jalur Windows, fallback lokasi npm, export paket, jalur dengan spasi/argumen literal, peluncuran TSX, dan penanganan kegagalan child process. Sesudah perubahan, **80/80 tes lulus** dengan database disposable, lint tanpa warning, typecheck, `db:generate`, dan build API lulus. Pemeriksaan ini dijalankan di Linux dengan fixture jalur Windows; eksekusi Windows native dan perilaku Ctrl+C Windows belum diverifikasi di mesin ini.

Ikuti [README.md](README.md) untuk instalasi, lima pengaturan inti, migrasi, import, pembuatan administrator, dan `npm run dev`. Untuk tes browser, sajikan `apps/web/out/` pada port frontend lokal dan jalankan API terpisah; browser-admin hanya menerima database lokal disposable. Lihat [DEPLOYMENT.md](DEPLOYMENT.md) untuk hosting statis, API terpisah, cookie/CORS, header, integrasi opsional, dan rebuild. Kontrak endpoint dijelaskan di [API.md](API.md).
