const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.join(__dirname, '../public/images');

if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

async function optimizeImage(url, filename) {
  try {
    const targetPath = path.join(IMAGES_DIR, `${filename}.webp`);
    if (fs.existsSync(targetPath)) return `/images/${filename}.webp`;

    const response = await axios({ url, responseType: 'arraybuffer' });
    await sharp(response.data)
      .webp({ quality: 80 })
      .toFile(targetPath);
    
    return `/images/${filename}.webp`;
  } catch (error) {
    console.error(`Gorsel optimize edilemedi (${url}):`, error.message);
    return url; // fallback to original
  }
}

module.exports = { optimizeImage };
