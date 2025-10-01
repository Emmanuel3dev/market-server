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
 * Initialise des livreurs de test dans Firestore
 */
async function initTestCouriers() {
  console.log(`[${new Date().toISOString()}] 🚴 Initialisation des livreurs de test...`);

  const testCouriers = [
    {
      id: 'courier_test_1',
      nom: 'Dubois',
      prenom: 'Marie',
      email: 'marie.dubois@test.com',
      telephone: '+2250102030405',
      status: 'available', // disponible
      currentPosition: {
        latitude: 5.3600, // Abidjan, Côte d'Ivoire
        longitude: -4.0083,
      },
      horaires: {
        lundi: { actif: true, debut: '08:00', fin: '18:00' },
        mardi: { actif: true, debut: '08:00', fin: '18:00' },
        mercredi: { actif: true, debut: '08:00', fin: '18:00' },
        jeudi: { actif: true, debut: '08:00', fin: '18:00' },
        vendredi: { actif: true, debut: '08:00', fin: '18:00' },
        samedi: { actif: true, debut: '09:00', fin: '17:00' },
        dimanche: { actif: false, debut: '00:00', fin: '00:00' },
      },
      vehicule: 'scooter',
      zone: 'abidjan_centre',
      rating: 4.8,
      totalDeliveries: 245,
      token: null, // À définir quand le livreur se connecte
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {
      id: 'courier_test_2',
      nom: 'Konan',
      prenom: 'Jean',
      email: 'jean.konan@test.com',
      telephone: '+2250607080910',
      status: 'available',
      currentPosition: {
        latitude: 5.3200, // Abidjan, zone différente
        longitude: -4.0300,
      },
      horaires: {
        lundi: { actif: true, debut: '07:00', fin: '19:00' },
        mardi: { actif: true, debut: '07:00', fin: '19:00' },
        mercredi: { actif: true, debut: '07:00', fin: '19:00' },
        jeudi: { actif: true, debut: '07:00', fin: '19:00' },
        vendredi: { actif: true, debut: '07:00', fin: '19:00' },
        samedi: { actif: true, debut: '08:00', fin: '16:00' },
        dimanche: { actif: false, debut: '00:00', fin: '00:00' },
      },
      vehicule: 'moto',
      zone: 'abidjan_nord',
      rating: 4.6,
      totalDeliveries: 189,
      token: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  ];

  try {
    const batch = db.batch();

    for (const courier of testCouriers) {
      const courierRef = db.collection('couriers').doc(courier.id);
      batch.set(courierRef, courier);
    }

    await batch.commit();
    console.log(`✅ ${testCouriers.length} livreurs de test créés avec succès.`);

    // Afficher les livreurs créés
    console.log('\n📋 Livreurs créés :');
    testCouriers.forEach(courier => {
      console.log(`  - ${courier.prenom} ${courier.nom} (${courier.zone}) - Status: ${courier.status}`);
    });

  } catch (error) {
    console.error('❌ Erreur lors de la création des livreurs de test:', error);
  }
}

/**
 * Affiche les livreurs existants
 */
async function showCouriers() {
  console.log(`[${new Date().toISOString()}] 📊 Liste des livreurs...`);

  try {
    const snapshot = await db.collection('couriers').get();

    if (snapshot.empty) {
      console.log('❌ Aucun livreur trouvé.');
      return;
    }

    console.log(`📊 ${snapshot.size} livreur(s) trouvé(s) :`);
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log(`  - ${doc.id}: ${data.prenom} ${data.nom} (${data.status}) - ${data.zone}`);
    });

  } catch (error) {
    console.error('❌ Erreur lors de la récupération des livreurs:', error);
  }
}

// Fonction principale
async function main() {
  console.log('🚀 Script d\'initialisation des livreurs\n');

  const args = process.argv.slice(2);
  const command = args[0] || 'init';

  switch (command) {
    case 'init':
      await initTestCouriers();
      await showCouriers();
      break;
    case 'show':
      await showCouriers();
      break;
    default:
      console.log('❓ Usage: node init_couriers.js [init|show]');
      console.log('  init: Créer des livreurs de test');
      console.log('  show: Afficher les livreurs existants');
      return;
  }

  console.log('\n✅ Opération terminée.');
}

// Exécuter si appelé directement
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { initTestCouriers, showCouriers };