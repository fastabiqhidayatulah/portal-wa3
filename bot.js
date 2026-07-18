// =================================================================
//                      IMPOR MODUL & INISIALISASI
// =================================================================
const pino = require('pino'); // Logger canggih
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
// googleapis/leaveReminder removed (calendar feature deprecated)
require('dotenv').config();
const multer = require('multer');

// Handlers
const helpHandler = require('./handlers/helpHandler');
const geminiHandler = require('./handlers/geminiHandler');

// =================================================================
//                 FUNGSI UTAMA UNTUK MENJALANKAN BOT
// =================================================================
async function startBot() {
    // -----------------------------------------------------------------
    //          MEMUAT BAILEYS (ESM) SECARA DINAMIS (v7 COMPATIBLE)
    // -----------------------------------------------------------------
    const {
        default: makeWASocket,
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion, // <-- Impor fungsi untuk mengambil versi terbaru
    } = await import('@whiskeysockets/baileys');
    const { Boom } = await import('@hapi/boom');

    // --- Konfigurasi Logger (Pino) seperti di example.js ---
    const logger = pino({
        level: 'info',
        transport: {
            targets: [
                { target: 'pino-pretty', options: { colorize: true }, level: 'info' },
                { target: 'pino/file', options: { destination: './bot-logs.log' }, level: 'info' }
            ]
        }
    });

    // Inisialisasi Aplikasi Express & Server
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server);

    // Ensure uploads directory exists and configure multer
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const upload = multer({ dest: uploadsDir });

    const PORT = 3000;

    // Variabel Global untuk Status Bot
    let sock;
    let qrCode = null;
    let connectionStatus = 'Menunggu koneksi...';

    // =================================================================
    //                         FUNGSI BANTUAN
    // =================================================================
    // Fungsi log sekarang menggunakan Pino
    const log = (message, type = 'info') => {
        const timestamp = `[${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}]`;
        logger[type](`${timestamp} ${message}`); // Menggunakan logger.info(), logger.error(), etc.
        io.emit('log', `${timestamp} ${message}`);
    };
    const readJSON = (filePath) => { try { if (fs.existsSync(filePath)) { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } return null; } catch (error) { log(`Error membaca file JSON ${filePath}: ${error}`, 'error'); return null; } };
    const writeJSON = (filePath, data) => { try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); } catch (error) { log(`Error menulis file JSON ${filePath}: ${error}`, 'error'); } };

    // ... (Sisa kode middleware, API, dll tetap sama, tidak perlu diubah) ...
    // [SNIP: Kode dari middleware Express hingga sebelum fungsi connectToWhatsApp tetap sama]

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: process.env.SESSION_SECRET || 'secret-key-default', resave: false, saveUninitialized: true, cookie: { secure: process.env.NODE_ENV === 'production' }}));
    const checkPageAuth = (req, res, next) => { if (req.session.userId) { next(); } else { res.redirect('/login.html'); } };
    const checkApiAuth = (req, res, next) => { if (req.session.userId) { next(); } else { res.status(401).json({ error: 'Sesi tidak valid atau telah berakhir. Silakan login kembali.' }); } };
    const checkApiKey = (req, res, next) => { const apiKey = req.headers['x-api-key']; if (apiKey && apiKey === process.env.EXTERNAL_API_KEY) { next(); } else { res.status(403).json({ error: 'Forbidden: API Key tidak valid atau tidak ada.' }); } };
    app.use(express.static(path.join(__dirname, 'public')));
    app.get('/', checkPageAuth);
    app.get('/index.html', checkPageAuth);
    app.get('/validator.html', checkPageAuth);
    app.get('/settings.html', checkPageAuth);
    app.use('/api/internal', checkApiAuth);

    // =================================================================
    //                 KONEKSI WHATSAPP (BAILEYS V7 - STABLE VERSION)
    // =================================================================
    async function connectToWhatsApp() {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        // --- MENGAMBIL VERSI WA TERBARU SECARA DINAMIS ---
        const { version, isLatest } = await fetchLatestBaileysVersion();
        log(`Menggunakan WA v${version.join('.')}, Versi Terbaru: ${isLatest}`);

        sock = makeWASocket({
            version, // <-- Gunakan versi terbaru yang didapat
            logger,  // <-- Gunakan Pino logger yang sudah dikonfigurasi
            printQRInTerminal: true,
            auth: state,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                qrCode = qr;
                connectionStatus = 'Menunggu Scan QR';
                io.emit('status', { status: connectionStatus, qr: qrCode });
                log('QR Code diterima, silakan scan.');
            }
            
            if (connection === 'close') {
                const error = lastDisconnect?.error;
                const statusCode = error instanceof Boom ? error.output.statusCode : 500;
                
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                connectionStatus = `Koneksi ditutup. Alasan: ${statusCode}, ${error?.message}. Menghubungkan kembali: ${shouldReconnect}`;
                log(connectionStatus, 'error');
                io.emit('status', { status: connectionStatus, qr: null });

                if (shouldReconnect) {
                    setTimeout(connectToWhatsApp, 5000);
                } else {
                    log('Tidak dapat terhubung: Logout Terdeteksi. Hapus folder auth dan restart.', 'error');
                    if (fs.existsSync('auth_info_baileys')) {
                        fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                    }
                }
            } else if (connection === 'open') {
                qrCode = null;
                connectionStatus = `Terhubung sebagai ${sock.user.name || sock.user.id}`;
                log(connectionStatus);
                io.emit('status', { status: connectionStatus, qr: qrCode });
                // Removed scheduled jobs and leave reminder setup
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const from = msg.key.remoteJid;
            log(`Pesan diterima dari ${from}: "${messageText}"`);
            if (messageText.startsWith('/help')) await helpHandler(sock, from);
            else if (messageText.startsWith('/gemini')) await geminiHandler(sock, from, messageText.substring(7).trim());
        });
    }
    
    // [SNIP: Sisa kode fungsi (Socket.IO, Login, API, Scheduler, dll) tetap sama]
    // ... KODE ANDA YANG LAIN DARI SINI ...
    // ... TETAP SAMA DAN TIDAK PERLU DIUBAH ...
    // =================================================================
    //                 KOMUNIKASI REAL-TIME (SOCKET.IO)
    // =================================================================
    io.on('connection', (socket) => {
        log('Dashboard terhubung via Socket.IO.');
        socket.emit('status', { status: connectionStatus, qr: qrCode });
        socket.emit('log', 'Selamat datang di log server.');
        socket.on('validate-numbers', async (data) => {
            if (!sock || !sock.user) return socket.emit('validation-error', { message: 'Bot tidak terhubung.' });
            const { numbers } = data;
            let checkedCount = 0;
            for (const number of numbers) {
                try {
                    let formattedNumber = number.trim().startsWith('0') ? '62' + number.trim().substring(1) : number.trim();
                    const [result] = await sock.onWhatsApp(`${formattedNumber}@s.whatsapp.net`);
                    socket.emit('validation-update', { number, status: result?.exists ? 'Aktif' : 'Tidak Terdaftar' });
                } catch (e) {
                    socket.emit('validation-update', { number, status: 'Error' });
                } finally {
                    checkedCount++;
                    socket.emit('validation-progress', { checked: checkedCount, total: numbers.length });
                    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 3000) + 2000));
                }
            }
            socket.emit('validation-complete');
        });
    });

    // =================================================================
    //                 SISTEM LOGIN & OTENTIKASI
    // =================================================================
    app.post('/login', (req, res) => {
        const { username, password } = req.body;
        const users = readJSON(path.join(__dirname, 'users.json'));
        const user = users.find(u => u.username === username);
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.username;
            log(`Pengguna ${username} berhasil login.`);
            res.status(200).json({ message: 'Login berhasil' });
        } else {
            log(`Percobaan login gagal untuk pengguna: ${username}.`, 'error');
            res.status(401).json({ message: 'Username atau password salah' });
        }
    });
    app.get('/logout', (req, res) => {
        const username = req.session.userId;
        req.session.destroy(() => {
            log(`Pengguna ${username} telah logout.`);
            res.redirect('/login.html');
        });
    });

    // =================================================================
    //                 API INTERNAL (DASHBOARD)
    // =================================================================
    app.get('/api/internal/status', (req, res) => res.json({ status: connectionStatus, qr: qrCode }));
    app.post('/api/internal/logout-wa', async (req, res) => {
        log('Menerima permintaan logout & hapus sesi WA.');
        try {
            await sock.logout();
        } catch (e) {
            log(`Error saat logout: ${e.message}`, 'error');
        } finally {
            if (fs.existsSync('auth_info_baileys')) {
                fs.rmSync('auth_info_baileys', { recursive: true, force: true });
            }
            res.json({ message: 'Proses logout dan hapus sesi dimulai.' });
            exec('pm2 restart whatsapp-bot', (err) => { if (err) log(`Gagal restart PM2: ${err}`, 'error'); });
        }
    });
    app.get('/api/internal/get-groups', async (req, res) => {
        if (!sock || !sock.user) return res.status(503).json({ error: 'Bot tidak terhubung.' });
        try {
            const groups = await sock.groupFetchAllParticipating();
            const groupList = Object.values(groups).map(g => ({ id: g.id, subject: g.subject })).sort((a, b) => a.subject.localeCompare(b.subject));
            res.json(groupList);
        } catch (e) { res.status(500).json({ error: 'Gagal mengambil grup.' }); }
    });
    app.get('/api/internal/get-templates', (req, res) => res.json(readJSON('templates.json')));
    app.post('/api/internal/save-template', (req, res) => {
        const { name, message } = req.body;
        if (!name || !message) return res.status(400).json({ error: 'Nama dan isi template harus diisi.' });
        const templates = readJSON('templates.json') || [];
        templates.push({ name, message });
        writeJSON('templates.json', templates);
        io.emit('templates_updated');
        res.json({ success: true, message: 'Template berhasil disimpan.' });
    });

    // =================================================================
    //                 SISTEM PENJADWALAN (SCHEDULER)
    // =================================================================
    async function sendBroadcastWithDelay(destinations, message, source = "Scheduler") {
        log(`[${source}] Memulai broadcast ke ${destinations.length} target.`);
        for (const dest of destinations) {
            try {
                let targetJid = dest;
                if (!targetJid.includes('@')) {
                    if (targetJid.startsWith('0')) {
                        targetJid = '62' + dest.substring(1);
                    }
                    targetJid = `${targetJid}@s.whatsapp.net`;
                }
                await sock.sendMessage(targetJid, { text: message });
                log(`[${source}] Pesan terkirim ke ${targetJid}`);
            } catch (e) {
                log(`[${source}] Gagal mengirim ke ${dest}: ${e.message}`, 'error');
            }
            const delay = Math.floor(Math.random() * 5000) + 5000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        log(`[${source}] Broadcast selesai.`);
    }


    app.get('/api/internal/get-scheduled-jobs', (req, res) => res.json(readJSON('schedules.json')));

    app.post('/api/internal/schedule-message', (req, res) => {
        const { targets, groups, message, templateName, scheduleType, scheduleData } = req.body;
        const allTargets = [...(targets || []), ...(groups || [])];
        if (allTargets.length === 0 || !message) return res.status(400).json({ error: "Target dan pesan harus diisi." });
        const jobId = uuidv4();
        const job = { id: jobId, ...req.body };
        if (scheduleType === 'now') {
            sendBroadcastWithDelay(allTargets, message, "Scheduler (Now)");
            res.json({ success: true, message: 'Pesan sedang dikirim sekarang.' });
        } else {
            const schedules = readJSON('schedules.json') || [];
            schedules.push(job);
            writeJSON('schedules.json', schedules);
            if (scheduleType === 'once') {
                const scheduleDateTime = new Date(`${scheduleData.date}T${scheduleData.time}`);
                if (scheduleDateTime > new Date()) {
                    const jobFunction = () => {
                        sendBroadcastWithDelay(allTargets, message, `Scheduler Job #${jobId}`);
                        const currentSchedules = readJSON('schedules.json');
                        const updatedSchedules = currentSchedules.filter(s => s.id !== jobId);
                        writeJSON('schedules.json', updatedSchedules);
                        io.emit('schedule_updated');
                    };
                    const delay = scheduleDateTime.getTime() - new Date().getTime();
                    setTimeout(jobFunction, delay);
                    log(`Tugas sekali kirim #${jobId} dijadwalkan untuk ${scheduleDateTime}`);
                }
            } else {
                createCronJob(job);
            }
            io.emit('schedule_updated');
            res.json({ success: true, message: `Pesan berhasil dijadwalkan dengan ID: ${jobId}` });
        }
    });

    // Scheduler/Calendar features removed.

    // =================================================================
    //                         API EKSTERNAL
    // =================================================================
    app.post('/api/external/send-message', checkApiKey, async (req, res) => {
        const { targetType, target, message } = req.body;
        if (!targetType || !target || !message) {
            return res.status(400).json({ error: 'Properti "targetType", "target", dan "message" wajib diisi.' });
        }
        if (!sock || !sock.user) {
            return res.status(503).json({ error: 'Service Unavailable: Bot belum terhubung.' });
        }
        try {
            let targetJid;
            if (targetType === 'personal') {
                let number = target.trim();
                if (number.startsWith('0')) {
                    number = '62' + number.substring(1);
                }
                targetJid = `${number}@s.whatsapp.net`;
                const [result] = await sock.onWhatsApp(targetJid);
                if (!result || !result.exists) {
                    return res.status(404).json({ error: `Nomor ${target} tidak terdaftar di WhatsApp.` });
                }
            } else if (targetType === 'group') {
                const groups = await sock.groupFetchAllParticipating();
                const group = Object.values(groups).find(g => g.subject.toLowerCase() === target.toLowerCase());
                if (!group) {
                    return res.status(404).json({ error: `Grup dengan nama "${target}" tidak ditemukan.` });
                }
                targetJid = group.id;
            } else {
                return res.status(400).json({ error: 'Nilai "targetType" tidak valid. Gunakan "personal" atau "group".' });
            }
            await sock.sendMessage(targetJid, { text: message });
            log(`Pesan eksternal terkirim ke ${target} (${targetJid})`);
            res.json({ success: true, message: `Pesan berhasil dikirim ke ${target}.` });
        } catch (e) {
            log(`Gagal mengirim pesan eksternal: ${e.message}`, 'error');
            res.status(500).json({ error: `Gagal mengirim pesan: ${e.message}` });
        }
    });

    // =================================================================
    //                 ENDPOINTS UNTUK MENGIRIM MEDIA / DOKUMEN
    // =================================================================
    app.post('/api/internal/send-media', upload.single('file'), async (req, res) => {
        try {
            if (!sock || !sock.user) return res.status(503).json({ error: 'Bot tidak terhubung.' });

            // targets: personalTargets (comma-separated) or groupId (single)
            const personalTargets = req.body.personalTargets ? req.body.personalTargets.split(',').map(n => n.trim()).filter(Boolean) : [];
            const groupId = req.body.groupId || null;
            const caption = req.body.caption || '';

            const file = req.file;
            if (!file) return res.status(400).json({ error: 'File tidak ditemukan pada request.' });

            const buffer = fs.readFileSync(file.path);
            const mime = file.mimetype || '';

            const sendToJid = async (jid) => {
                let payload;
                if (mime.startsWith('image')) payload = { image: buffer, caption };
                else if (mime.startsWith('video')) payload = { video: buffer, caption };
                else if (mime.startsWith('audio')) payload = { audio: buffer, ptt: false };
                else payload = { document: buffer, fileName: file.originalname, mimetype: mime };

                await sock.sendMessage(jid, payload);
            };

            // send to personal numbers
            for (const number of personalTargets) {
                let formatted = number;
                if (formatted.startsWith('0')) formatted = '62' + formatted.substring(1);
                const targetJid = `${formatted}@s.whatsapp.net`;
                await sendToJid(targetJid);
            }

            // send to group if provided
            if (groupId) {
                // if groupId looks like a full JID use it, otherwise try to resolve by name
                let targetGroupId = groupId;
                if (!groupId.includes('@')) {
                    const groups = await sock.groupFetchAllParticipating();
                    const found = Object.values(groups).find(g => g.subject.toLowerCase() === groupId.toLowerCase());
                    if (found) targetGroupId = found.id; else return res.status(404).json({ error: 'Grup tidak ditemukan.' });
                }
                await sendToJid(targetGroupId);
            }

            // cleanup temp file
            try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }

            res.json({ success: true, message: 'Media berhasil dikirim.' });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Gagal mengirim media.' });
        }
    });

    app.post('/api/internal/send-media-url', async (req, res) => {
        try {
            if (!sock || !sock.user) return res.status(503).json({ error: 'Bot tidak terhubung.' });
            const { personalTargets, groupId, url, caption } = req.body;
            if (!url) return res.status(400).json({ error: 'URL harus disertakan.' });

            const inferTypeFromUrl = (u) => {
                const lower = u.toLowerCase();
                if (lower.match(/\.(jpg|jpeg|png|webp|gif)$/)) return 'image';
                if (lower.match(/\.(mp4|mov|mkv|webm)$/)) return 'video';
                if (lower.match(/\.(mp3|wav|m4a|aac)$/)) return 'audio';
                return 'document';
            };

            const type = inferTypeFromUrl(url);
            const makePayload = () => {
                if (type === 'image') return { image: { url }, caption: caption || '' };
                if (type === 'video') return { video: { url }, caption: caption || '' };
                if (type === 'audio') return { audio: { url } };
                return { document: { url }, fileName: path.basename(url) };
            };

            const payload = makePayload();

            if (personalTargets) {
                const targets = personalTargets.split(',').map(n => n.trim()).filter(Boolean);
                for (const number of targets) {
                    let formatted = number;
                    if (formatted.startsWith('0')) formatted = '62' + formatted.substring(1);
                    const targetJid = `${formatted}@s.whatsapp.net`;
                    await sock.sendMessage(targetJid, payload);
                }
            }

            if (groupId) {
                let targetGroupId = groupId;
                if (!groupId.includes('@')) {
                    const groups = await sock.groupFetchAllParticipating();
                    const found = Object.values(groups).find(g => g.subject.toLowerCase() === groupId.toLowerCase());
                    if (found) targetGroupId = found.id; else return res.status(404).json({ error: 'Grup tidak ditemukan.' });
                }
                await sock.sendMessage(targetGroupId, payload);
            }

            res.json({ success: true, message: 'Media (via URL) berhasil dikirim.' });
        } catch (e) { res.status(500).json({ error: e.message || 'Gagal mengirim media via URL.' }); }
    });


    // =================================================================
    //                         JALANKAN SERVER
    // =================================================================
    server.listen(PORT, '0.0.0.0', () => {
        log(`Server berjalan di http://0.0.0.0:${PORT}`);
        connectToWhatsApp().catch(err => log(`Gagal memulai koneksi WhatsApp: ${err}`, 'error'));
    });
    process.on('SIGINT', async () => {
        log('Menutup koneksi...');
        if (sock) await sock.end(new Error('Shutdown manual'));
        process.exit(0);
    });

}

// Panggil fungsi utama untuk menjalankan bot
startBot().catch(err => {
    console.error("Gagal menjalankan bot:", err);
});