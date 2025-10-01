const { resetDailyCounters, checkExpiredSubscriptions, fixSubscriptionEndDates } = require('./reset_counters');

/**
 * Script pour planifier la remise à zéro quotidienne des compteurs.
 * Ce script s'exécute une fois et planifie la prochaine exécution à minuit.
 */
async function scheduleDailyReset() {
  console.log(`[${new Date().toISOString()}] ⏰ Planification de la remise à zéro quotidienne...`);

  try {
    // Exécuter immédiatement les tâches
    console.log('🔄 Exécution des tâches quotidiennes...');
    await resetDailyCounters();
    await checkExpiredSubscriptions();
    await fixSubscriptionEndDates();

    // Calculer le délai jusqu'à minuit
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const timeToMidnight = midnight - now;

    console.log(`⏰ Prochaine exécution dans ${Math.round(timeToMidnight / 1000 / 60)} minutes (à minuit).`);

    // Planifier la prochaine exécution
    setTimeout(() => {
      console.log('🔄 Minuit atteint - Réexécution des tâches...');
      scheduleDailyReset(); // Récurse pour continuer indéfiniment
    }, timeToMidnight);

  } catch (error) {
    console.error('❌ Erreur lors de la planification:', error);

    // En cas d'erreur, réessayer dans 1 heure
    console.log('⏰ Nouvelle tentative dans 1 heure...');
    setTimeout(scheduleDailyReset, 60 * 60 * 1000);
  }
}

// Gestion propre de l'arrêt
process.on('SIGINT', () => {
  console.log('\n🛑 Arrêt du planificateur demandé par l\'utilisateur.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Arrêt du planificateur demandé par le système.');
  process.exit(0);
});

// Démarrer le planificateur
console.log('🚀 Démarrage du planificateur de remise à zéro quotidienne...');
scheduleDailyReset();