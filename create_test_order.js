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
 * Crée une commande de test dans la boutique de test
 */
async function createTestOrder() {
  console.log(`[${new Date().toISOString()}] 📦 Création d'une commande de test...`);

  const testOrder = {
    id: 'test_order_' + Date.now(),
    nomProduit: 'Ordinateur Portable Gaming',
    quantite: 1,
    prixTotal: 750000, // Prix total
    prixLivraison: 0, // Sera calculé par le système
    statut: 'en attente',
    clientId: 'test_client_123',
    nomClient: 'Jean Test',
    categorieId: 'test_category',
    boutiqueId: 'test_boutique_1',
    produitId: 'test_product_123',
    produitImage: 'https://example.com/laptop.jpg',
    position: new admin.firestore.GeoPoint(5.35, -4.01), // Position client proche
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    commentaireClient: null,
    note: null,
  };

  try {
    // Créer la commande côté boutique
    const boutiqueOrderRef = db.collection('categories')
      .doc('test_category')
      .collection('boutiques')
      .doc('test_boutique_1')
      .collection('commandes')
      .doc(testOrder.id);

    await boutiqueOrderRef.set(testOrder);

    // Créer la commande côté client
    const clientOrderRef = db.collection('user')
      .doc(testOrder.clientId)
      .collection('commandes')
      .doc(testOrder.id);

    await clientOrderRef.set({
      ...testOrder,
      nomboutique: 'Boutique Test Market',
    });

    console.log(`✅ Commande de test créée avec succès.`);
    console.log(`   ID: ${testOrder.id}`);
    console.log(`   Produit: ${testOrder.nomProduit}`);
    console.log(`   Client: ${testOrder.nomClient}`);
    console.log(`   Statut: ${testOrder.statut}`);
    console.log(`   Position client: ${testOrder.position.latitude}, ${testOrder.position.longitude}`);

  } catch (error) {
    console.error('❌ Erreur lors de la création de la commande:', error);
  }
}

/**
 * Liste les commandes d'une boutique
 */
async function listOrders(categorieId, boutiqueId) {
  console.log(`[${new Date().toISOString()}] 📋 Liste des commandes...`);

  try {
    const ordersSnapshot = await db.collection('categories')
      .doc(categorieId)
      .collection('boutiques')
      .doc(boutiqueId)
      .collection('commandes')
      .orderBy('timestamp', 'desc')
      .get();

    if (ordersSnapshot.empty) {
      console.log('❌ Aucune commande trouvée.');
      return;
    }

    console.log(`📊 ${ordersSnapshot.size} commande(s) trouvée(s) :`);
    ordersSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`  📦 ${doc.id}: ${data.nomProduit} - ${data.statut} - ${data.nomClient}`);
    });

  } catch (error) {
    console.error('❌ Erreur lors de la récupération des commandes:', error);
  }
}

// Fonction principale
async function main() {
  console.log('📦 Script de gestion des commandes de test\n');

  const args = process.argv.slice(2);
  const command = args[0] || 'create';

  switch (command) {
    case 'create':
      await createTestOrder();
      await listOrders('test_category', 'test_boutique_1');
      break;
    case 'list':
      const categorieId = args[1] || 'test_category';
      const boutiqueId = args[2] || 'test_boutique_1';
      await listOrders(categorieId, boutiqueId);
      break;
    default:
      console.log('❓ Usage: node create_test_order.js [create|list]');
      console.log('  create: Créer une commande de test');
      console.log('  list: Lister les commandes d\'une boutique');
      return;
  }

  console.log('\n✅ Opération terminée.');
}

// Exécuter si appelé directement
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { createTestOrder, listOrders };