const svgCaptcha = require('svg-captcha');
const sharp = require('sharp');

async function generateCaptcha() {
    const captcha = svgCaptcha.create({
        size: 5,
        ignoreChars: '0o1i',
        noise: 3,
        color: true,
        background: '#1e293b',
        width: 1600,
        height: 900,
        fontSize: 600
    });

    try {
        const buffer = await sharp(Buffer.from(captcha.data, 'utf-8'))
            .png({ quality: 100, compressionLevel: 0 })
            .toBuffer();
        return { text: captcha.text, data: buffer };
    } catch (error) {
        console.error('Error converting SVG to PNG:', error.message);
    }
}

module.exports = { generateCaptcha };

