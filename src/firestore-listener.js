const { initializeApp } = require('firebase/app');
const { getFirestore, collection, onSnapshot } = require('firebase/firestore');

const firebaseConfig = {
  projectId: "paragastroteka-inventory"
};

let db;

function startFirestoreListener(onUpdateCallback) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    
    console.log('Firestore baglantisi hazir (projectId: paragastroteka-inventory).');
    
    // Fallback: poll every hour for now if real-time push fails due to path
    setInterval(() => {
      console.log('Periyodik menu yenileme tetiklendi...');
      onUpdateCallback();
    }, 60 * 60 * 1000);

  } catch (error) {
    console.error('Firestore dinleyici baslatilamadi:', error.message);
  }
}

module.exports = { startFirestoreListener };
