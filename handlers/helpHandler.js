/**
 * Mengirimkan pesan bantuan yang berisi daftar perintah bot.
 * @param {import('@whiskeysockets/baileys').WASocket} sock - Instance socket Baileys.
 * @param {string} jid - JID (Jabber ID) dari pengirim atau grup.
 */
async function helpHandler(sock, jid) {
    // Pesan bantuan menggunakan template literal (backticks ``)
    // yang memungkinkan penulisan multi-baris.
    const helpMessage = `👋 *Bantuan Bot Multifungsi* 👋

Berikut adalah daftar perintah yang tersedia:

- \`/help\`: Menampilkan pesan bantuan ini.
- \`/gemini [pertanyaan]\`: Ajukan pertanyaan ke AI.
  Contoh: \`/gemini Apa ibu kota Indonesia?\`

Selamat mencoba!`;
    
    try {
        // Menggunakan await untuk memastikan proses pengiriman pesan selesai.
        await sock.sendMessage(jid, { text: helpMessage });
        console.log(`Pesan bantuan berhasil terkirim ke ${jid}`);
    } catch (error) {
        // Memberi log jika terjadi error saat pengiriman
        console.error(`Gagal mengirim pesan bantuan ke ${jid}:`, error);
    }
}

// Mengekspor fungsi 'helpHandler' agar bisa diimpor dan digunakan di file lain,
// khususnya di bot.js. Ini adalah bagian yang krusial.
module.exports = helpHandler;
