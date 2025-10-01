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
 * Remet à zéro les compteurs quotidiens des utilisateurs abonnés.
 * Cette fonction peut être appelée manuellement pour les tests locaux.
 */
async function resetDailyCounters() {
  console.log(`[${new Date().toISOString()}] 🔄 Remise à zéro des compteurs quotidiens...`);
  try {
    const usersSnapshot = await db.collection('user').get();
    const batch = db.batch();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const counterRef = db.collection('user_counters').doc(userId);
      batch.set(counterRef, {
        userId,
        dailyOrdersUsed: 0,
        lastResetDate: admin.firestore.Timestamp.now(),
      }, { merge: true });
    }

    await batch.commit();
    console.log(`✅ Compteurs remis à zéro pour ${usersSnapshot.size} utilisateurs.`);
  } catch (error) {
    console.error('❌ Erreur lors de la remise à zéro des compteurs:', error);
  }
}

/**
 * Vérifie et corrige les abonnements expirés.
 */
async function checkExpiredSubscriptions() {
  console.log(`[${new Date().toISOString()}] 📅 Vérification des abonnements expirés...`);
  try {
    const now = admin.firestore.Timestamp.now();
    const expiredQuery = db.collection('subscriptions')
      .where('status', '==', 'active')
      .where('endDate', '<', now);

    const expiredSnapshot = await expiredQuery.get();
    const batch = db.batch();

    for (const doc of expiredSnapshot.docs) {
      batch.update(doc.ref, { status: 'expired' });
      console.log(`📅 Abonnement expiré mis à jour: ${doc.id}`);
    }

    if (expiredSnapshot.size > 0) {
      await batch.commit();
      console.log(`✅ ${expiredSnapshot.size} abonnements marqués comme expirés.`);
    } else {
      console.log(`✅ Aucun abonnement expiré trouvé.`);
    }
  } catch (error) {
    console.error('❌ Erreur lors de la vérification des abonnements expirés:', error);
  }
}

/**
 * Recalcule et corrige les dates de fin d'abonnement si nécessaire.
 */
async function fixSubscriptionEndDates() {
  console.log(`[${new Date().toISOString()}] 🔧 Vérification des dates de fin d'abonnement...`);
  try {
    const subscriptionsSnapshot = await db.collection('subscriptions').get();
    const batch = db.batch();
    let fixedCount = 0;

    for (const doc of subscriptionsSnapshot.docs) {
      const data = doc.data();
      const startDate = data.startDate?.toDate();
      const endDate = data.endDate?.toDate();

      if (startDate && endDate) {
        // Vérifier si la durée est exactement de 30 jours
        const durationDays = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));

        if (durationDays !== 30) {
          console.log(`🔧 Abonnement ${doc.id}: durée actuelle ${durationDays} jours, correction à 30 jours`);
          const correctEndDate = new Date(startDate);
          correctEndDate.setDate(correctEndDate.getDate() + 30);

          batch.update(doc.ref, {
            endDate: admin.firestore.Timestamp.fromDate(correctEndDate)
          });
          fixedCount++;
        }
      }
    }

    if (fixedCount > 0) {
      await batch.commit();
      console.log(`✅ ${fixedCount} dates de fin d'abonnement corrigées.`);
    } else {
      console.log(`✅ Toutes les dates de fin d'abonnement sont correctes.`);
    }
  } catch (error) {
    console.error('❌ Erreur lors de la correction des dates d\'abonnement:', error);
  }
}

/**
 * Affiche les statistiques des abonnements pour le débogage.
 */
async function showSubscriptionStats() {
  console.log(`[${new Date().toISOString()}] 📊 Statistiques des abonnements...`);
  try {
    const subscriptionsSnapshot = await db.collection('subscriptions').get();
    const countersSnapshot = await db.collection('user_counters').get();

    console.log(`📊 Total abonnements: ${subscriptionsSnapshot.size}`);
    console.log(`📊 Total compteurs: ${countersSnapshot.size}`);

    let activeCount = 0;
    let expiredCount = 0;

    subscriptionsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === 'active') activeCount++;
      if (data.status === 'expired') expiredCount++;
    });

    console.log(`📊 Abonnements actifs: ${activeCount}`);
    console.log(`📊 Abonnements expirés: ${expiredCount}`);

    // Afficher quelques exemples
    console.log(`\n📋 Exemples d'abonnements:`);
    let count = 0;
    subscriptionsSnapshot.forEach(doc => {
      if (count < 3) {
        const data = doc.data();
        const endDate = data.endDate?.toDate();
        const daysLeft = endDate ? Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)) : 'N/A';
        console.log(`  - ${doc.id}: ${data.planType} (${data.status}) - Jours restants: ${daysLeft}`);
        count++;
      }
    });

  } catch (error) {
    console.error('❌ Erreur lors de l\'affichage des statistiques:', error);
  }
}

// Fonction principale
async function main() {
  console.log('🚀 Script de gestion des compteurs d\'abonnement\n');

  const args = process.argv.slice(2);
  const command = args[0] || 'reset';

  switch (command) {
    case 'reset':
      await resetDailyCounters();
      break;
    case 'check':
      await checkExpiredSubscriptions();
      break;
    case 'fix':
      await fixSubscriptionEndDates();
      break;
    case 'stats':
      await showSubscriptionStats();
      break;
    case 'all':
      await resetDailyCounters();
      await checkExpiredSubscriptions();
      await fixSubscriptionEndDates();
      await showSubscriptionStats();
      break;
    default:
      console.log('❓ Usage: node reset_counters.js [reset|check|fix|stats|all]');
      console.log('  reset: Remet à zéro tous les compteurs quotidiens');
      console.log('  check: Vérifie et marque les abonnements expirés');
      console.log('  fix: Corrige les dates de fin d\'abonnement incorrectes');
      console.log('  stats: Affiche les statistiques des abonnements');
      console.log('  all: Exécute toutes les opérations');
      return;
  }

  console.log('\n✅ Opération terminée.');
}

// Exécuter si appelé directement
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { resetDailyCounters, checkExpiredSubscriptions, fixSubscriptionEndDates, showSubscriptionStats };