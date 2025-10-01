const admin = require('firebase-admin');

// --- Initialisation Firebase Admin SDK ---
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  // En production (sur Render), on parse la variable d'environnement
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} else {
  // En développement local, on continue de lire le fichier
  serviceAccount = require('./serviceAccountKey.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

/**
 * Met à jour les positions des livreurs pour les tests
 */
async function updateCourierPositions() {
  console.log(`[${new Date().toISOString()}] 📍 Mise à jour des positions des livreurs...`);

  // Positions réalistes pour Abidjan (Côte d'Ivoire)
  const positions = {
    'courier_test_1': { // Marie Dubois - Abidjan Centre
      latitude: 5.3599,  // Près de la Présidence
      longitude: -4.0083,
    },
    'courier_test_2': { // Jean Konan - Abidjan Nord
      latitude: 5.3800,  // Plateau
      longitude: -4.0300,
    },
    'jg4w8w0BVDOe5IHWhyqW': { // komi Emmanuel - Position par défaut
      latitude: 5.3200,  // Yopougon
      longitude: -4.0800,
    },
  };

  try {
    const batch = db.batch();

    for (const [courierId, position] of Object.entries(positions)) {
      const courierRef = db.collection('couriers').doc(courierId);
      batch.update(courierRef, {
        currentPosition: new admin.firestore.GeoPoint(position.latitude, position.longitude),
        status: 'available',
        zone: courierId.includes('test_1') ? 'abidjan_centre' :
              courierId.includes('test_2') ? 'abidjan_plateau' : 'abidjan_yopougon',
      });
    }

    await batch.commit();
    console.log(`✅ Positions mises à jour pour ${Object.keys(positions).length} livreurs.`);

    // Afficher les nouvelles positions
    console.log('\n📍 Nouvelles positions :');
    for (const [courierId, position] of Object.entries(positions)) {
      console.log(`  - ${courierId}: ${position.latitude}, ${position.longitude}`);
    }

  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour des positions:', error);
  }
}

/**
 * Affiche les livreurs avec leurs positions actuelles
 */
async function showCourierPositions() {
  console.log(`[${new Date().toISOString()}] 📊 Positions actuelles des livreurs...`);

  try {
    const snapshot = await db.collection('couriers').get();

    if (snapshot.empty) {
      console.log('❌ Aucun livreur trouvé.');
      return;
    }

    console.log(`📊 ${snapshot.size} livreur(s) :`);
    snapshot.forEach(doc => {
      const data = doc.data();
      const pos = data.currentPosition;
      console.log(`  - ${doc.id}: ${data.prenom} ${data.nom}`);
      console.log(`    Position: ${pos ? `${pos.latitude}, ${pos.longitude}` : 'Non définie'}`);
      console.log(`    Status: ${data.status}`);
      console.log(`    Zone: ${data.zone || 'Non définie'}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Erreur lors de la récupération des positions:', error);
  }
}

// Fonction principale
async function main() {
  console.log('🚗 Script de mise à jour des positions des livreurs\n');

  const args = process.argv.slice(2);
  const command = args[0] || 'update';

  switch (command) {
    case 'update':
      await updateCourierPositions();
      await showCourierPositions();
      break;
    case 'show':
      await showCourierPositions();
      break;
    default:
      console.log('❓ Usage: node update_courier_positions.js [update|show]');
      console.log('  update: Mettre à jour les positions');
      console.log('  show: Afficher les positions actuelles');
      return;
  }

  console.log('\n✅ Opération terminée.');
}

// Exécuter si appelé directement
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { updateCourierPositions, showCourierPositions };