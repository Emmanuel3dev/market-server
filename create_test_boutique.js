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
 * Crée une boutique de test avec position
 */
async function createTestBoutique() {
  console.log(`[${new Date().toISOString()}] 🏪 Création d'une boutique de test...`);

  const testBoutique = {
    nom: 'Boutique Test Market',
    description: 'Boutique de test pour les livraisons',
    categorieId: 'test_category',
    boutique_active: true,
    position: new admin.firestore.GeoPoint(5.3600, -4.0083), // Abidjan Centre - près des livreurs
    adresse: 'Plateau, Abidjan, Côte d\'Ivoire',
    telephone: '+2250102030405',
    email: 'test@market.ci',
    horaires: {
      lundi: { ouvert: true, debut: '08:00', fin: '18:00' },
      mardi: { ouvert: true, debut: '08:00', fin: '18:00' },
      mercredi: { ouvert: true, debut: '08:00', fin: '18:00' },
      jeudi: { ouvert: true, debut: '08:00', fin: '18:00' },
      vendredi: { ouvert: true, debut: '08:00', fin: '18:00' },
      samedi: { ouvert: true, debut: '09:00', fin: '17:00' },
      dimanche: { ouvert: false, debut: '00:00', fin: '00:00' },
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  try {
    // Créer d'abord la catégorie si elle n'existe pas
    const categoryRef = db.collection('categories').doc('test_category');
    await categoryRef.set({
      nom: 'Catégorie Test',
      image: 'https://example.com/test.jpg',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Créer la boutique
    const boutiqueRef = categoryRef.collection('boutiques').doc('test_boutique_1');
    await boutiqueRef.set(testBoutique);

    console.log(`✅ Boutique de test créée avec succès.`);
    console.log(`   ID: test_boutique_1`);
    console.log(`   Catégorie: test_category`);
    console.log(`   Position: ${testBoutique.position.latitude}, ${testBoutique.position.longitude}`);

  } catch (error) {
    console.error('❌ Erreur lors de la création de la boutique:', error);
  }
}

/**
 * Met à jour la position d'une boutique existante
 */
async function updateBoutiquePosition(categorieId, boutiqueId, latitude, longitude) {
  console.log(`[${new Date().toISOString()}] 📍 Mise à jour position boutique...`);

  try {
    const boutiqueRef = db.collection('categories')
      .doc(categorieId)
      .collection('boutiques')
      .doc(boutiqueId);

    await boutiqueRef.update({
      position: new admin.firestore.GeoPoint(latitude, longitude),
    });

    console.log(`✅ Position mise à jour pour la boutique ${boutiqueId}`);
    console.log(`   Nouvelle position: ${latitude}, ${longitude}`);

  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour:', error);
  }
}

// Fonction principale
async function main() {
  console.log('🏪 Script de gestion des boutiques de test\n');

  const args = process.argv.slice(2);
  const command = args[0] || 'create';

  switch (command) {
    case 'create':
      await createTestBoutique();
      break;
    case 'update':
      if (args.length < 4) {
        console.log('❓ Usage: node create_test_boutique.js update <categorieId> <boutiqueId> <latitude> <longitude>');
        return;
      }
      const categorieId = args[1];
      const boutiqueId = args[2];
      const latitude = parseFloat(args[3]);
      const longitude = parseFloat(args[4]);
      await updateBoutiquePosition(categorieId, boutiqueId, latitude, longitude);
      break;
    default:
      console.log('❓ Usage: node create_test_boutique.js [create|update]');
      console.log('  create: Créer une boutique de test');
      console.log('  update: Mettre à jour la position d\'une boutique existante');
      return;
  }

  console.log('\n✅ Opération terminée.');
}

// Exécuter si appelé directement
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { createTestBoutique, updateBoutiquePosition };