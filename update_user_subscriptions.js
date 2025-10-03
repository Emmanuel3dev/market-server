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
 * Met à jour tous les profils utilisateurs avec le statut d'abonnement livraison
 */
async function updateUserDeliverySubscriptions() {
  console.log(`[${new Date().toISOString()}] 🔄 Mise à jour des statuts d'abonnement livraison...`);

  try {
    // Récupérer tous les utilisateurs
    const usersSnapshot = await db.collection('user').get();
    console.log(`📊 ${usersSnapshot.size} utilisateurs trouvés.`);

    let updatedCount = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      // Vérifier si l'utilisateur a un abonnement actif
      const subscriptionQuery = await db.collection('subscriptions')
        .where('userId', '==', userId)
        .where('status', '==', 'active')
        .limit(1)
        .get();

      const hasSubscription = !subscriptionQuery.empty;

      // Mettre à jour le profil utilisateur
      await db.collection('user').doc(userId).update({
        'hasDeliverySubscription': hasSubscription,
        'lastSubscriptionCheck': admin.firestore.FieldValue.serverTimestamp(),
      });

      if (hasSubscription) {
        updatedCount++;
        console.log(`  ✅ ${userData.prenom || 'Utilisateur'} ${userData.nom || userId}: Abonnement actif`);
      }
    }

    console.log(`✅ Mise à jour terminée: ${updatedCount} utilisateurs avec abonnement livraison actif.`);

  } catch (error) {
    console.error('❌ Erreur lors de la mise à jour des abonnements:', error);
  }
}

/**
 * Affiche le statut des abonnements pour tous les utilisateurs
 */
async function showUserSubscriptionStatus() {
  console.log(`[${new Date().toISOString()}] 📋 Statut des abonnements livraison...`);

  try {
    const usersSnapshot = await db.collection('user').get();

    console.log(`📊 ${usersSnapshot.size} utilisateurs :`);
    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      const hasSubscription = userData.hasDeliverySubscription || false;
      const name = `${userData.prenom || 'N/A'} ${userData.nom || userDoc.id}`;

      console.log(`  - ${name}: ${hasSubscription ? '✅ Abonnement actif' : '❌ Pas d\'abonnement'}`);
    }

  } catch (error) {
    console.error('❌ Erreur lors de l\'affichage des statuts:', error);
  }
}

// Fonction principale
async function main() {
  console.log('🔄 Script de mise à jour des abonnements livraison\n');

  const args = process.argv.slice(2);
  const command = args[0] || 'update';

  switch (command) {
    case 'update':
      await updateUserDeliverySubscriptions();
      await showUserSubscriptionStatus();
      break;
    case 'show':
      await showUserSubscriptionStatus();
      break;
    default:
      console.log('❓ Usage: node update_user_subscriptions.js [update|show]');
      console.log('  update: Mettre à jour les statuts d\'abonnement');
      console.log('  show: Afficher les statuts actuels');
      return;
  }

  console.log('\n✅ Opération terminée.');
}

// Exécuter si appelé directement
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { updateUserDeliverySubscriptions, showUserSubscriptionStatus };