const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
        headers: {
            'User-Agent': 'aistudio-build'
        }
    }
});

async function geminiHandler(sock, jid, question) {
    if (!question) {
        await sock.sendMessage(jid, { text: 'Silakan berikan pertanyaan setelah perintah /gemini.' });
        return;
    }

    try {
        await sock.sendMessage(jid, { text: '🤖 Sedang berpikir...' });

        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: question,
        });
        const text = response.text;

        await sock.sendMessage(jid, { text: text || 'Tidak ada tanggapan dari AI.' });
    } catch (error) {
        console.error('Error saat menghubungi Gemini AI:', error);
        await sock.sendMessage(jid, { text: 'Maaf, terjadi kesalahan saat memproses permintaan Anda.' });
    }
}

module.exports = geminiHandler;