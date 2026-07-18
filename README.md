# WhatsApp Bot (Local)

Ringkasan singkat untuk menjalankan dan menggunakan bot ini secara lokal.

- **Status perubahan:** Fitur Scheduler dan Google Calendar telah dihapus. UI dan endpoint terkait dihapus.

## Persiapan
1. Install Node.js (direkomendasikan v18+). Pastikan `node` dan `npm` tersedia.
2. Jalankan:
   - `npm install`

## Variabel lingkungan (.env)
Buat file `.env` di root berisi minimal:

- `PORT` (opsional, default 8000)
- `SESSION_SECRET` (string rahasia untuk session)
- `EXTERNAL_API_KEY` (API key untuk endpoint eksternal)

Jangan membagikan `.env` atau kunci sensitif.

## Menjalankan
- Mulai server:
  - `node bot.js`
- Buka dashboard di: `http://localhost:8000` lalu login.
  - Default user/password: lihat file [users.json](users.json#L1) (sudah disesuaikan ke `password123`).

## Endpoints & UI
- Dokumentasi endpoint dan contoh ada di: [public/docs.html](public/docs.html)
- UI kirim media: [public/send.html](public/send.html)
- Dashboard utama: [public/index.html](public/index.html)
- Pengaturan (fitur scheduler/kalender dinonaktifkan): [public/settings.html](public/settings.html)

API penting:
- `POST /api/internal/send-media` — upload file (multipart/form-data), butuh sesi login.
- `POST /api/internal/send-media-url` — kirim media dari URL (JSON), butuh sesi login.
- `POST /api/external/send-message` — endpoint publik pakai header `x-api-key`.
- `GET /api/internal/get-groups` — daftar grup bot ikut serta.

Untuk contoh `curl` dan contoh Node.js per endpoint, lihat [public/docs.html](public/docs.html).

## Port conflict
Jika `EADDRINUSE` muncul, hentikan proses di port 8000 atau ganti `PORT` di `.env`.
- Windows: `netstat -ano | findstr :8000` lalu `taskkill /PID <pid> /F`.

## File yang dihapus
Scheduler / calendar-related files removed:
- `handlers/leaveReminderHandler.js` (dihapus)
- `public/scheduler.html` (dihapus)
- `public/calendar.html` (dihapus)
- `reminder_settings.json` (dihapus)
- `schedules.json` (dihapus)
- `google_token.json` (dihapus)

Perubahan utama:
- `bot.js` dibersihkan dari duplicate imports/vars dan route calendar/scheduler dihapus.
- `public/docs.html`, `public/settings.html`, `public/index.html` diperbarui.

## Jika mau saya lanjutkan
- Jalankan server dan saya bisa membantu verifikasi endpoint.
- Kembalikan fitur Kalender jika diperlukan.

Jika ingin saya jalankan server sekarang, konfirmasi dan saya akan mulai serta memantau log singkat.
