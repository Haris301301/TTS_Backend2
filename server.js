require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('child_process');

// Load Binary FFmpeg
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// Setup FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const app = express();

// ENV Variables
const PORT = process.env.PORT || 8000;
const ACCESS_CODE = process.env.ACCESS_CODE || 'asleb2026';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Middleware
app.use(
    cors({
        origin: '*',
        methods: ['GET', 'POST', 'DELETE', 'PATCH'],
        credentials: true,
    }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/config', (req, res) => {
    res.json({
        API_BASE_URL: 'https://server-aslab.tail294b4a.ts.net',
    });
});

// Folder Data untuk persistensi JSON
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// Path file JSON untuk persistensi
const DB_FILES = {
    announcements: path.join(dataDir, 'announcements.json'),
    schedules: path.join(dataDir, 'schedules.json'),
    quranSchedules: path.join(dataDir, 'quran_schedules.json'),
};

// ✅ Fungsi untuk memuat data dari file JSON
function loadDatabase(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`❌ Error loading ${filePath}:`, error.message);
    }
    return [];
}

// ✅ Fungsi untuk menyimpan data ke file JSON
function saveDatabase(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`💾 Data disimpan ke: ${path.basename(filePath)}`);
    } catch (error) {
        console.error(`❌ Error saving ${filePath}:`, error.message);
    }
}

// ✅ Fungsi helper untuk save semua database
function saveAllDatabases() {
    saveDatabase(DB_FILES.announcements, announcementDatabase);
    saveDatabase(DB_FILES.schedules, scheduleDatabase);
    saveDatabase(DB_FILES.quranSchedules, quranScheduleDatabase);
}

// Database - Muat dari file JSON saat startup
let announcementDatabase = loadDatabase(DB_FILES.announcements);
let scheduleDatabase = loadDatabase(DB_FILES.schedules);
let quranScheduleDatabase = loadDatabase(DB_FILES.quranSchedules);

console.log(`📂 Database dimuat dari file JSON:`);
console.log(`   - Announcements: ${announcementDatabase.length} item`);
console.log(`   - Schedules: ${scheduleDatabase.length} item`);
console.log(`   - Quran Schedules: ${quranScheduleDatabase.length} item`);

// Folder Temp untuk audio files
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

/* ================= SERVER-SIDE AUDIO PLAYER ================= */
// ✅ Fungsi untuk memutar audio langsung di speaker server (hardware)
// Menggunakan ffplay dari FFmpeg
let lastPlayedScheduleKey = ''; // Tracking untuk mencegah duplikasi
let currentAudioProcess = null; // Track proses audio yang sedang berjalan

// ✅ Fungsi untuk menghentikan semua proses ffplay
async function stopAudioProcess() {
    return new Promise((resolve) => {
        console.log('\n🛑 Menghentikan semua proses audio...');

        // Kill semua proses ffplay yang berjalan
        const killCommand = `ps ax | grep ffplay | grep -v grep | awk '{print $1}' | xargs kill -9 2>/dev/null || true`;

        exec(killCommand, (error, stdout, stderr) => {
            if (error) {
                console.log(
                    '⚠️ Tidak ada proses ffplay yang berjalan atau sudah berhenti',
                );
            } else {
                console.log('✅ Semua proses audio berhasil dihentikan');
            }

            // Reset tracking
            currentAudioProcess = null;
            lastPlayedScheduleKey = '';

            resolve({ success: true, message: 'Audio stopped' });
        });
    });
}

function playAudioOnServer(audioInput, label = 'Audio') {
    if (!audioInput) {
        console.log(`⚠️ [${label}] Path/URL audio kosong, skip.`);
        return;
    }

    // Tentukan apakah input adalah URL atau path lokal
    const isURL = audioInput.startsWith('http');

    // Untuk file lokal, cek apakah ada
    if (!isURL) {
        // Jika bukan absolute path, gabungkan dengan tempDir
        let localPath = audioInput;
        if (!audioInput.startsWith('/') && !audioInput.includes(':')) {
            localPath = path.join(tempDir, audioInput);
        }

        if (!fs.existsSync(localPath)) {
            console.log(`❌ [${label}] File tidak ditemukan: ${localPath}`);
            return;
        }
        audioInput = localPath;
    }
    // Untuk URL, ffplay bisa langsung memutar tanpa download

    console.log(`\n========================================`);
    console.log(`🚀 MEMULAI PEMUTARAN AUDIO: ${audioInput}`);
    console.log(`📢 Label: ${label}`);
    console.log(`🌐 Tipe: ${isURL ? 'URL (streaming)' : 'File Lokal'}`);
    console.log(
        `⏰ Waktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`,
    );
    console.log(`========================================\n`);

    // Gunakan ffplay untuk memutar audio di speaker server
    // -nodisp: Tidak tampilkan GUI
    // -autoexit: Keluar otomatis setelah selesai
    // -loglevel quiet: Tidak tampilkan log ffplay
    const command = `ffplay -nodisp -autoexit -loglevel quiet "${audioInput}"`;
    console.log(`🎵 Menjalankan command: ${command}`);

    // Track proses yang sedang berjalan
    currentAudioProcess = exec(command, (error, stdout, stderr) => {
        if (error && error.killed) {
            console.log(`🛑 [${label}] Audio dihentikan secara manual.`);
        } else if (error) {
            console.error(`❌ [${label}] Error memutar audio:`, error.message);
            if (stderr) console.error(`   stderr: ${stderr}`);
        } else {
            console.log(`✅ [${label}] Audio selesai diputar.`);
        }
        currentAudioProcess = null;
    });
}
app.use('/temp', express.static(tempDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, tempDir),
    filename: (req, file, cb) =>
        cb(null, `upload-${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

/* ================= FUNGSI EJAAN ================= */
function perbaikiLafazIslami(text) {
    let fixed = text;
    fixed = fixed.replace(/\bAllah\b/gi, 'Alloh');
    fixed = fixed.replace(/\bAlloh\b/gi, 'Alloh');
    fixed = fixed.replace(/\bRasulullah\b/gi, 'Rasululloh');
    fixed = fixed.replace(/\bSWT\b/gi, "Subhanahu wa Ta'ala");
    fixed = fixed.replace(/\bSAW\b/gi, 'Shallallahu alaihi wa sallam');
    fixed = fixed.replace(/Al-Maidah/gi, 'almaidah');
    fixed = fixed.replace(/Al Maidah/gi, 'almaidah');
    fixed = fixed.replace(/Almaidah/gi, 'almaidah');
    fixed = fixed.replace(/Al-Fatihah/gi, 'alfatihah');
    fixed = fixed.replace(/Al-Anfal/gi, 'alanfal');
    fixed = fixed.replace(/Al-Quran/gi, 'alquran');
    fixed = fixed.replace(/Assalamualaikum/gi, 'Assalamu alaikum');
    fixed = fixed.replace(/Wassalamualaikum/gi, 'Wassalamu alaikum');
    fixed = fixed.replace(/Warahmatullahi/gi, 'Warohmatullohi');
    fixed = fixed.replace(/Wabarakatuh/gi, 'Wabarokatuh');
    fixed = fixed.replace(/Sholat/gi, 'Sholat');
    fixed = fixed.replace(/Salat/gi, 'Sholat');
    fixed = fixed.replace(/Dzuhur/gi, 'Zuhur');
    fixed = fixed.replace(/Ashar/gi, 'Asar');
    fixed = fixed.replace(/Maghrib/gi, 'Magrib');
    fixed = fixed.replace(/Isya/gi, 'Isya');
    fixed = fixed.replace(/Subuh/gi, 'Subuh');
    return fixed;
}

/* ================= AUTH ================= */
app.post('/api/v1/auth/login', (req, res) => {
    if (req.body.password === ACCESS_CODE) {
        res.json({
            success: true,
            token:
                'dummy-jwt-token-secured-' +
                (process.env.JWT_SECRET || 'default'),
            user: { name: 'Admin', role: 'admin' },
        });
    } else {
        res.status(401).json({ success: false, message: 'Kode Akses Salah!' });
    }
});

// ✅ SIMPLIFIED: Selalu return sukses karena auth sudah dihandle di frontend
// SDK metagptx tidak mengirim token, jadi kita skip pengecekan di sini
app.get('/api/v1/auth/me', (req, res) => {
    // Selalu kembalikan user data (frontend sudah handle auth via ProtectedRoutes)
    return res.json({
        success: true,
        data: {
            id: '1',
            role: 'admin',
            name: 'Asisten Lab',
            email: 'admin@aslabkom.local',
        },
    });
});

// Endpoint tanpa v1 untuk auth.ts
app.get('/api/auth/me', (req, res) => {
    return res.json({
        success: true,
        data: {
            id: '1',
            role: 'admin',
            name: 'Asisten Lab',
            email: 'admin@aslabkom.local',
        },
    });
});

/* ================= AUDIO CONTROL ENDPOINTS ================= */
// ✅ Emergency Stop - Hentikan semua audio yang sedang diputar
app.post('/api/v1/audio/stop', async (req, res) => {
    try {
        const result = await stopAudioProcess();
        console.log('🛑 Emergency Stop dipanggil dari frontend');
        res.json({ success: true, message: 'Audio berhasil dihentikan' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ✅ Status audio - Cek apakah ada audio yang sedang diputar
app.get('/api/v1/audio/status', (req, res) => {
    res.json({
        success: true,
        isPlaying: currentAudioProcess !== null,
    });
});
app.post('/api/tts/generate', (req, res) => {
    const { text, title } = req.body;
    if (!text) return res.status(400).json({ message: 'Teks kosong' });

    const islamicText = perbaikiLafazIslami(text);
    const timestamp = Date.now();
    const txtFileName = `text-${timestamp}.txt`;
    const rawTtsName = `raw-${timestamp}.mp3`;
    const finalFileName = `announcement-${timestamp}.mp3`;

    const txtFilePath = path.join(tempDir, txtFileName);
    const rawTtsPath = path.join(tempDir, rawTtsName);
    const finalFilePath = path.join(tempDir, finalFileName);

    const pythonScriptPath = path.join(__dirname, 'tts_engine.py');
    const introPath = path.join(__dirname, 'bell-intro.mp3');
    const outroPath = path.join(__dirname, 'bell-outro.mp3');

    if (!fs.existsSync(introPath) || !fs.existsSync(outroPath)) {
        return res
            .status(500)
            .json({ message: 'File bell intro/outro hilang!' });
    }

    try {
        fs.writeFileSync(txtFilePath, islamicText, 'utf8');
    } catch (err) {
        return res.status(500).json({ message: 'Gagal menulis file text.' });
    }

    // Gunakan python3 untuk kompatibilitas dengan Docker (Debian-based images)
    const command = `python3 "${pythonScriptPath}" "${txtFilePath}" "${rawTtsPath}"`;

    exec(command, (error, stdout, stderr) => {
        if (error || !fs.existsSync(rawTtsPath)) {
            console.error(`❌ Error TTS Python:`, error?.message);
            console.error(`❌ stderr:`, stderr);
            console.error(`❌ stdout:`, stdout);

            // Cleanup file text jika ada error
            if (fs.existsSync(txtFilePath)) fs.unlinkSync(txtFilePath);

            return res.status(500).json({
                message:
                    'Gagal generate suara. Pastikan Python dan edge-tts terinstall di server.',
                error: error?.message,
                stderr: stderr,
            });
        }

        ffmpeg()
            .input(introPath)
            .input(rawTtsPath)
            .input(outroPath)
            .complexFilter([
                '[1:a]volume=4.0[voice_loud]',
                '[0:a]volume=0.7[intro]',
                '[2:a]volume=0.7[outro]',
                '[intro][voice_loud][outro]concat=n=3:v=0:a=1[out]',
            ])
            .map('[out]')
            .on('end', () => {
                if (fs.existsSync(rawTtsPath)) fs.unlinkSync(rawTtsPath);
                if (fs.existsSync(txtFilePath)) fs.unlinkSync(txtFilePath);

                const audioUrl = `${BASE_URL}/temp/${finalFileName}`;
                const newEntry = {
                    id: timestamp,
                    title: title || 'Tanpa Judul',
                    audio_url: audioUrl,
                    created_at: new Date().toISOString(),
                };
                announcementDatabase.unshift(newEntry);
                saveDatabase(DB_FILES.announcements, announcementDatabase);
                res.json({ success: true, audioUrl, data: newEntry });
            })
            .save(finalFilePath);
    });
});

app.post('/api/tts/upload', upload.single('audio'), (req, res) => {
    if (!req.file)
        return res.status(400).json({ message: 'File tidak ditemukan' });
    const audioUrl = `${BASE_URL}/temp/${req.file.filename}`;
    const newEntry = {
        id: Date.now(),
        title: req.body.title || req.file.originalname,
        audio_url: audioUrl,
    };
    announcementDatabase.unshift(newEntry);
    saveDatabase(DB_FILES.announcements, announcementDatabase);
    res.json({ success: true, audioUrl, data: newEntry });
});

/* ================= CRUD DATA (DENGAN AUTO DELETE) ================= */

// 1. GET ALL
app.get('/api/announcements', (req, res) =>
    res.json({ success: true, items: announcementDatabase }),
);
app.get('/api/announcement-schedules', (req, res) =>
    res.json({ success: true, items: scheduleDatabase }),
);

// 2. DELETE AUDIO MANUAL
app.delete('/api/announcements/:id', (req, res) => {
    const { id } = req.params;
    const index = announcementDatabase.findIndex((a) => a.id === parseInt(id));
    if (index !== -1) {
        const item = announcementDatabase[index];
        const fileName = item.audio_url.split('/').pop();
        const filePath = path.join(tempDir, fileName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        announcementDatabase.splice(index, 1);

        // Hapus juga semua jadwal yang pakai audio ini (Opsional, biar bersih)
        scheduleDatabase = scheduleDatabase.filter(
            (s) => s.announcement_id !== parseInt(id),
        );

        // Simpan perubahan ke file JSON
        saveDatabase(DB_FILES.announcements, announcementDatabase);
        saveDatabase(DB_FILES.schedules, scheduleDatabase);

        return res.json({ success: true, message: 'Berhasil dihapus' });
    }
    res.status(404).json({ success: false });
});

// 3. POST JADWAL
app.post('/api/announcement-schedules', (req, res) => {
    scheduleDatabase.push({ ...req.body, id: Date.now(), is_active: true });
    saveDatabase(DB_FILES.schedules, scheduleDatabase);
    res.json({ success: true });
});

// 4. DELETE JADWAL (UPDATE PENTING DISINI 🔥)
app.delete('/api/announcement-schedules/:id', async (req, res) => {
    const scheduleId = parseInt(req.params.id);
    const scheduleIndex = scheduleDatabase.findIndex(
        (s) => s.id === scheduleId,
    );

    if (scheduleIndex !== -1) {
        const schedule = scheduleDatabase[scheduleIndex];
        const announcementId = schedule.announcement_id;

        // 🛑 STOP AUDIO YANG SEDANG DIPUTAR (jika ada)
        await stopAudioProcess();

        // A. Hapus Jadwalnya dulu dari Database Jadwal
        scheduleDatabase.splice(scheduleIndex, 1);

        // B. LOGIKA PEMBERSIHAN OTOMATIS (AUTO CLEANUP)
        // Cek: Apakah audio ini (announcementId) MASIH DIPAKAI di jadwal lain?
        const isUsedElsewhere = scheduleDatabase.some(
            (s) => s.announcement_id === announcementId,
        );

        // C. Jika TIDAK dipakai jadwal lain, hapus Audio & Datanya
        if (!isUsedElsewhere) {
            const annIndex = announcementDatabase.findIndex(
                (a) => a.id === announcementId,
            );
            if (annIndex !== -1) {
                const item = announcementDatabase[annIndex];

                // 1. Hapus File MP3 Fisik dari folder Temp
                const fileName = item.audio_url.split('/').pop();
                const filePath = path.join(tempDir, fileName);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️ File dihapus otomatis: ${fileName}`);
                }

                // 2. Hapus Data dari Database Pengumuman
                announcementDatabase.splice(annIndex, 1);
                console.log(
                    `🧹 Data Pengumuman '${item.title}' dihapus karena sudah selesai tayang.`,
                );
            }
        }

        saveAllDatabases();
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});

// 5. UPDATE JADWAL (PATCH)
app.patch('/api/announcement-schedules/:id', (req, res) => {
    const idx = scheduleDatabase.findIndex(
        (s) => s.id === parseInt(req.params.id),
    );
    if (idx !== -1) {
        scheduleDatabase[idx].date = req.body.date;
        saveDatabase(DB_FILES.schedules, scheduleDatabase);
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});

// QURAN SECTION (Tetap sama)
app.get('/api/quran-schedules', (req, res) =>
    res.json({ success: true, items: quranScheduleDatabase }),
);
app.post('/api/quran-schedules', (req, res) => {
    quranScheduleDatabase.push({
        ...req.body,
        id: Date.now(),
        is_active: true,
    });
    saveDatabase(DB_FILES.quranSchedules, quranScheduleDatabase);
    res.json({ success: true });
});
app.patch('/api/quran-schedules/:id', (req, res) => {
    const idx = quranScheduleDatabase.findIndex(
        (s) => s.id === parseInt(req.params.id),
    );
    if (idx !== -1) {
        quranScheduleDatabase[idx].date = req.body.date;
        saveDatabase(DB_FILES.quranSchedules, quranScheduleDatabase);
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});
app.delete('/api/quran-schedules/:id', async (req, res) => {
    // 🛑 STOP AUDIO YANG SEDANG DIPUTAR (jika ada)
    await stopAudioProcess();

    quranScheduleDatabase = quranScheduleDatabase.filter(
        (s) => s.id !== parseInt(req.params.id),
    );
    saveDatabase(DB_FILES.quranSchedules, quranScheduleDatabase);
    res.json({ success: true });
});

/* ================= OPTIMIZED SCHEDULE CHECK ================= */
// ✅ Single endpoint untuk check jadwal yang harus diputar SEKARANG
app.get('/api/schedules/check', (req, res) => {
    // ✅ FIX TIMEZONE: Gunakan Asia/Jakarta (WIB) bukan UTC
    const now = new Date();
    const jakartaTime = new Date(
        now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }),
    );

    const currentTime = `${String(jakartaTime.getHours()).padStart(2, '0')}:${String(jakartaTime.getMinutes()).padStart(2, '0')}`;
    const currentDate = jakartaTime.toLocaleDateString('en-CA');

    console.log(`\n⏰ Schedule Check (WIB): ${currentDate} ${currentTime}`);
    console.log(
        `   📋 Total schedules: ${scheduleDatabase.length} announcements, ${quranScheduleDatabase.length} quran`,
    );

    // Filter jadwal pengumuman yang harus diputar SEKARANG
    const activeAnnSchedules = scheduleDatabase
        .filter((s) => {
            const match =
                s.time === currentTime &&
                (s.date === currentDate || s.repeat_type !== 'once');
            if (match) console.log(`   ✅ Matched announcement schedule:`, s);
            return match;
        })
        .map((s) => {
            const ann = announcementDatabase.find(
                (a) => a.id === s.announcement_id,
            );
            return { ...s, announcement: ann };
        });

    // Filter jadwal quran yang harus diputar SEKARANG
    const activeQuranSchedules = quranScheduleDatabase.filter((s) => {
        const match =
            s.time === currentTime &&
            (s.date === currentDate || s.repeat_type !== 'once');
        if (match) console.log(`   ✅ Matched quran schedule:`, s);
        return match;
    });

    console.log(
        `   📢 Active: ${activeAnnSchedules.length} announcements, ${activeQuranSchedules.length} quran`,
    );

    res.json({
        success: true,
        currentTime,
        currentDate,
        serverTime: now.toISOString(),
        totalSchedules: {
            announcements: scheduleDatabase.length,
            quran: quranScheduleDatabase.length,
        },
        announcements: activeAnnSchedules,
        quran: activeQuranSchedules,
    });
});

// app.get('/config', (req, res) => res.json({ api_url: `http://localhost:${PORT}`, environment: "development" }));

/* ================= SERVER-SIDE SCHEDULER ================= */
// ✅ Scheduler yang berjalan setiap 60 detik untuk memutar audio otomatis di speaker server
// Ini berjalan di sisi SERVER, tidak perlu browser terbuka
setInterval(() => {
    // Gunakan timezone Asia/Jakarta (WIB)
    const now = new Date();
    const jakartaTime = new Date(
        now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }),
    );

    const currentTime = `${String(jakartaTime.getHours()).padStart(2, '0')}:${String(jakartaTime.getMinutes()).padStart(2, '0')}`;
    const currentDate = jakartaTime.toLocaleDateString('en-CA'); // Format: YYYY-MM-DD

    // Key untuk tracking duplikasi dalam menit yang sama
    const minuteKey = `${currentDate}-${currentTime}`;

    // Skip jika sudah diproses dalam menit ini
    if (lastPlayedScheduleKey === minuteKey) return;

    let hasPlayed = false;

    // ============ CHECK ANNOUNCEMENT SCHEDULES ============
    scheduleDatabase.forEach((schedule) => {
        if (!schedule.is_active) return;

        // Cek apakah jadwal cocok (waktu sama DAN tanggal sama atau repeat)
        const timeMatch = schedule.time === currentTime;
        const dateMatch =
            schedule.date === currentDate || schedule.repeat_type !== 'once';

        if (timeMatch && dateMatch) {
            // Cari announcement terkait
            const announcement = announcementDatabase.find(
                (a) => a.id === schedule.announcement_id,
            );

            if (announcement && announcement.audio_url) {
                console.log(
                    `\n📢 [SCHEDULER] Jadwal pengumuman aktif: ${announcement.title}`,
                );

                // Extract filename dari URL atau gunakan path langsung
                let audioPath = announcement.audio_url;
                if (audioPath.startsWith('http')) {
                    const filename = audioPath.split('/').pop();
                    audioPath = path.join(tempDir, filename);
                } else if (!audioPath.startsWith('/')) {
                    audioPath = path.join(tempDir, audioPath);
                }

                playAudioOnServer(
                    audioPath,
                    `Pengumuman: ${announcement.title}`,
                );
                hasPlayed = true;
            }
        }
    });

    // ============ CHECK QURAN SCHEDULES ============
    quranScheduleDatabase.forEach((schedule) => {
        // Cek apakah jadwal cocok
        const timeMatch = schedule.time === currentTime;
        const dateMatch =
            schedule.date === currentDate || schedule.repeat_type !== 'once';

        if (timeMatch && dateMatch) {
            console.log(
                `\n📖 [SCHEDULER] Jadwal Quran aktif: ${schedule.surah_name || 'Surah ' + schedule.surah_number}`,
            );

            if (schedule.audio_url) {
                // ✅ PERBAIKAN: Langsung gunakan audio_url (ffplay bisa stream URL)
                playAudioOnServer(
                    schedule.audio_url,
                    `Quran: ${schedule.surah_name || schedule.surah_number}`,
                );
                hasPlayed = true;
            }
        }
    });

    // Update tracking key jika ada yang diputar
    if (hasPlayed) {
        lastPlayedScheduleKey = minuteKey;
        console.log(`✅ [SCHEDULER] Audio diputar pada ${currentTime} WIB`);
    }
}, 60000); // Jalankan setiap 60 detik

console.log('⏰ Server-side scheduler aktif (interval: 60 detik)');

// Gunakan '0.0.0.0' agar kontainer Docker bisa diakses melalui jaringan
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Backend aktif pada port ${PORT}`);
    console.log(`🌍 URL Publik: https://server-aslab.tail294b4a.ts.net`);
});
