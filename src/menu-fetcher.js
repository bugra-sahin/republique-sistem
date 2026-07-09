const axios = require('axios');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { optimizeImage } = require('./image-optimizer');

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const MENU_FILE = path.join(DATA_DIR, 'menu.json');

const CUSTOMER_ID = 'republique-tunali';
const BRANCH_ID = 'republique-tunali';
const PRIMARY_URL = 'https://europe-west3-paragastroteka-inventory.cloudfunctions.net/getQrMenu';

let cachedMenu = null;

async function fetchMenuDirect() {
  console.log('Katman 1: getQrMenu dogrudan cekiliyor...');
  const response = await axios.post(PRIMARY_URL, {
    customerId: CUSTOMER_ID,
    branchId: BRANCH_ID
  });
  return response.data;
}

async function fetchMenuFallback() {
  console.log('Katman 2: Puppeteer ile headless tarayicidan cekiliyor...');
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  let menuData = null;
  
  await page.setRequestInterception(true);
  page.on('request', request => request.continue());
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('getQrMenu') && response.request().method() === 'POST') {
      try {
        menuData = await response.json();
      } catch (e) {}
    }
  });

  await page.goto(`https://menu.pionpos.com/?customerId=${CUSTOMER_ID}&branchId=${BRANCH_ID}`, {
    waitUntil: 'networkidle2'
  });
  
  await browser.close();
  
  if (!menuData) {
    throw new Error('Tarayici uzerinden de menu verisi yakalanamadi.');
  }
  return menuData;
}

async function processMenuImages(menuData) {
  async function traverseAndOptimize(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'string' && obj[key].includes('firebasestorage.googleapis.com')) {
        const matches = obj[key].match(/([^/?#]+)(?:[?#]|$)/);
        let filename = matches ? matches[1] : `img_${Date.now()}`;
        filename = filename.replace(/%2F/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
        
        obj[key] = await optimizeImage(obj[key], filename);
      } else if (typeof obj[key] === 'object') {
        await traverseAndOptimize(obj[key]);
      }
    }
  }

  await traverseAndOptimize(menuData);
  return menuData;
}

async function updateMenu() {
  let menuData = null;
  
  try {
    menuData = await fetchMenuDirect();
  } catch (error) {
    console.warn(`Dogrudan cekim basarisiz: ${error.message}. Tarayici yedegine geciliyor...`);
    try {
      menuData = await fetchMenuFallback();
    } catch (fallbackError) {
      console.error(`Tarayici yedegi de basarisiz: ${fallbackError.message}`);
    }
  }

  if (menuData) {
    console.log('Menu verisi alindi. Gorseller optimize ediliyor...');
    menuData = await processMenuImages(menuData);
    
    fs.writeFileSync(MENU_FILE, JSON.stringify(menuData, null, 2));
    cachedMenu = menuData;
    console.log('Menu basariyla data/menu.json dosyasina kaydedildi.');
  } else {
    console.log('Katman 3: Son basarili yerel dosya kullanilacak.');
    if (fs.existsSync(MENU_FILE)) {
      cachedMenu = JSON.parse(fs.readFileSync(MENU_FILE, 'utf-8'));
    } else {
      console.error('Kritik Hata: Yerel menu.json yedegi de yok. Menu su an bos!');
    }
  }
}

function getCachedMenu() {
  if (!cachedMenu && fs.existsSync(MENU_FILE)) {
    cachedMenu = JSON.parse(fs.readFileSync(MENU_FILE, 'utf-8'));
  }
  return cachedMenu;
}

module.exports = { updateMenu, getCachedMenu };
