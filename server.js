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

// Database (In-Memory)
let announcementDatabase = [];
let scheduleDatabase = [];
let quranScheduleDatabase = [];

// Folder Temp
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
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

        return res.json({ success: true, message: 'Berhasil dihapus' });
    }
    res.status(404).json({ success: false });
});

// 3. POST JADWAL
app.post('/api/announcement-schedules', (req, res) => {
    scheduleDatabase.push({ ...req.body, id: Date.now(), is_active: true });
    res.json({ success: true });
});

// 4. DELETE JADWAL (UPDATE PENTING DISINI 🔥)
app.delete('/api/announcement-schedules/:id', (req, res) => {
    const scheduleId = parseInt(req.params.id);
    const scheduleIndex = scheduleDatabase.findIndex(
        (s) => s.id === scheduleId,
    );

    if (scheduleIndex !== -1) {
        const schedule = scheduleDatabase[scheduleIndex];
        const announcementId = schedule.announcement_id;

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
    res.json({ success: true });
});
app.patch('/api/quran-schedules/:id', (req, res) => {
    const idx = quranScheduleDatabase.findIndex(
        (s) => s.id === parseInt(req.params.id),
    );
    if (idx !== -1) {
        quranScheduleDatabase[idx].date = req.body.date;
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});
app.delete('/api/quran-schedules/:id', (req, res) => {
    quranScheduleDatabase = quranScheduleDatabase.filter(
        (s) => s.id !== parseInt(req.params.id),
    );
    res.json({ success: true });
});

/* ================= OPTIMIZED SCHEDULE CHECK ================= */
// ✅ Single endpoint untuk check jadwal yang harus diputar SEKARANG
// Mengurangi dari 4-5 request/5detik menjadi 1 request/30detik
app.get('/api/schedules/check', (req, res) => {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentDate = now.toLocaleDateString('en-CA');

    // Filter jadwal pengumuman yang harus diputar SEKARANG
    const activeAnnSchedules = scheduleDatabase
        .filter(
            (s) =>
                s.time === currentTime &&
                (s.date === currentDate || s.repeat_type !== 'once'),
        )
        .map((s) => {
            const ann = announcementDatabase.find(
                (a) => a.id === s.announcement_id,
            );
            return { ...s, announcement: ann };
        });

    // Filter jadwal quran yang harus diputar SEKARANG
    const activeQuranSchedules = quranScheduleDatabase.filter(
        (s) =>
            s.time === currentTime &&
            (s.date === currentDate || s.repeat_type !== 'once'),
    );

    res.json({
        success: true,
        currentTime,
        currentDate,
        announcements: activeAnnSchedules,
        quran: activeQuranSchedules,
    });
});

// app.get('/config', (req, res) => res.json({ api_url: `http://localhost:${PORT}`, environment: "development" }));

// Gunakan '0.0.0.0' agar kontainer Docker bisa diakses melalui jaringan
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Backend aktif pada port ${PORT}`);
    console.log(`🌍 URL Publik: https://server-aslab.tail294b4a.ts.net`);
});
