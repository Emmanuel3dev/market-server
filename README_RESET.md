# Gestion des Abonnements - Scripts de Maintenance

Ce dossier contient des scripts pour gérer les abonnements de livraison en local pendant les tests.

## Problèmes résolus

### 1. Remise à zéro des compteurs quotidiens
**Problème** : Le serveur n'étant pas déployé, les compteurs quotidiens ne se remettent pas à zéro automatiquement à minuit.

**Solution** : Scripts locaux pour gérer les compteurs manuellement.

### 2. Jours restants bloqués
**Problème** : Les jours restants d'abonnement restent figés (ex: 29 jours).

**Cause possible** : Dates de fin incorrectes ou calcul erroné.

**Solution** : Script de correction des dates d'abonnement.

## Scripts disponibles

### `reset_counters.js`
Script principal pour gérer les compteurs et abonnements.

#### Commandes disponibles :
```bash
# Remettre à zéro tous les compteurs quotidiens
node reset_counters.js reset

# Vérifier et marquer les abonnements expirés
node reset_counters.js check

# Corriger les dates de fin d'abonnement incorrectes
node reset_counters.js fix

# Afficher les statistiques des abonnements
node reset_counters.js stats

# Exécuter toutes les opérations
node reset_counters.js all
```

#### Exemples d'utilisation :
```bash
# Après une journée de test, remettre les compteurs à zéro
node reset_counters.js reset

# Vérifier si des abonnements ont expiré
node reset_counters.js check

# Voir l'état actuel des abonnements
node reset_counters.js stats

# Maintenance complète (recommandé quotidiennement)
node reset_counters.js all
```

### `schedule_daily_reset.js`
Script qui s'exécute en continu et planifie automatiquement les tâches quotidiennes.

#### Utilisation :
```bash
# Lancer le planificateur (reste actif jusqu'à arrêt)
node schedule_daily_reset.js
```

Le script :
- S'exécute immédiatement au lancement
- Planifie la prochaine exécution à minuit
- Continue indéfiniment jusqu'à arrêt manuel (Ctrl+C)

## Dépannage

### Les jours restants ne diminuent pas

1. **Vérifier les dates** :
   ```bash
   node reset_counters.js stats
   ```

2. **Corriger si nécessaire** :
   ```bash
   node reset_counters.js fix
   ```

3. **Vérifier dans l'app** : Redémarrer l'app pour forcer le rechargement des données.

### Les compteurs quotidiens ne se remettent pas à zéro

1. **Remise à zéro manuelle** :
   ```bash
   node reset_counters.js reset
   ```

2. **Lancer le planificateur automatique** :
   ```bash
   node schedule_daily_reset.js
   ```

## Structure des données Firestore

### Collection `subscriptions`
```javascript
{
  userId: "string",
  planType: "little|medium|high",
  startDate: Timestamp,
  endDate: Timestamp,
  status: "active|expired",
  renewalDiscountApplied: boolean
}
```

### Collection `user_counters`
```javascript
{
  userId: "string",
  dailyOrdersUsed: number, // 0-16 selon plan
  lastResetDate: Timestamp
}
```

### Collection `subscription_requests`
```javascript
{
  userId: "string",
  requestedPlan: "little|medium|high",
  requestDate: Timestamp,
  status: "pending|approved|rejected",
  adminNotes: "string"
}
```

## Logs et débogage

Les scripts affichent des logs détaillés :
- `✅` : Opération réussie
- `❌` : Erreur
- `🔄` : Remise à zéro
- `📅` : Abonnements
- `📊` : Statistiques

## Recommandations

1. **Test local** : Exécuter `node reset_counters.js all` quotidiennement
2. **Production** : Ces scripts ne sont pas nécessaires une fois le serveur déployé
3. **Sauvegarde** : Faire des sauvegardes Firestore avant les corrections massives

## Support

En cas de problème, vérifier :
1. La connexion Firebase
2. Les permissions du service account
3. Les données Firestore existantes