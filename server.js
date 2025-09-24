const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();
const admin = require('firebase-admin');

// --- Initialisation Firebase Admin SDK (Sécurisée pour la production) ---
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

const app = express();
app.use(cors());
app.use(express.json());

// --- Cloudinary config ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- Multer config ---

// Créer le dossier 'uploads' s'il n'existe pas
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
  console.log(`✅ Dossier '${uploadDir}' créé.`);
}
const upload = multer({ dest: 'uploads/' });

// ====================
// === ROUTES IMAGE ===
// ====================
// Route de bienvenue pour tester si le serveur est en ligne
app.get('/', (req, res) => {
  res.status(200).send('🚀 Bienvenue sur l\'API Market ! Le serveur fonctionne.');
});
// Upload image vers Cloudinary avec compression
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const inputPath = req.file.path;
    const compressedPath = `uploads/compressed_${Date.now()}.jpg`;

    await sharp(inputPath)
      .resize({ width: 1024 })
      .jpeg({ quality: 80 })
      .toFile(compressedPath);

    const result = await cloudinary.uploader.upload(compressedPath);

    fs.unlinkSync(inputPath);
    fs.unlinkSync(compressedPath);

    res.status(200).json({ imageUrl: result.secure_url, publicId: result.public_id });
  } catch (err) {
    console.error('Erreur lors de l’upload vers Cloudinary:', err);
    res.status(500).json({ error: 'Échec de l’upload' });
  }
});

// Supprimer une image Cloudinary
app.delete('/delete/:publicId', async (req, res) => {
  try {
    const publicId = req.params.publicId;
    await cloudinary.uploader.destroy(publicId);
    res.status(200).json({ message: 'Image supprimée' });
  } catch (err) {
    console.error('Erreur suppression Cloudinary:', err);
    res.status(500).json({ error: 'Erreur suppression' });
  }
});

// Supprimer image + produits associés dans Firestore (version optimisée et fortifiée)
app.post('/delete-product', async (req, res) => {
  const { publicId } = req.body;

  // ✅ 1. Validation des données d'entrée
  if (!publicId) {
    return res.status(400).json({ error: 'Le champ publicId est requis.' });
  }

  // ✅ 2. Bloc try...catch pour une gestion d'erreur globale
  try {
    // ✅ 3. Suppression de l'image sur Cloudinary
    const cloudinaryResult = await cloudinary.uploader.destroy(publicId);
    
    // On vérifie si la suppression a réussi ou si l'image n'existait pas.
    // Dans les deux cas, on continue pour nettoyer la base de données.
    if (cloudinaryResult.result !== 'ok' && cloudinaryResult.result !== 'not found') {
        console.warn(`Avertissement Cloudinary: ${cloudinaryResult.result} pour publicId ${publicId}. Tentative de nettoyage de la base de données quand même.`);
    } else {
        console.log(`✅ Image supprimée (ou non trouvée) sur Cloudinary: ${publicId}`);
    }

    // ✅ 4. Utilisation d'une requête collectionGroup pour trouver tous les produits
    const productsQuery = db.collectionGroup('produits').where('publicId', '==', publicId);
    const productsSnapshot = await productsQuery.get();

    if (productsSnapshot.empty) {
      return res.status(200).json({
        message: 'Image traitée sur Cloudinary. Aucun produit correspondant trouvé dans la base de données.',
      });
    }

    // ✅ 5. Utilisation d'un batch pour supprimer tous les documents en une seule fois
    const batch = db.batch();
    let totalDeleted = 0;

    productsSnapshot.forEach(doc => {
      // Supprime le produit de la sous-collection (ex: categories/.../boutiques/.../produits)
      batch.delete(doc.ref);
      
      // Supprime le produit de la collection dénormalisée `produits` à la racine
      const denormalizedProductRef = db.collection('produits').doc(doc.id);
      batch.delete(denormalizedProductRef);

      totalDeleted++;
      console.log(`🗑️ Produit marqué pour suppression (ID: ${doc.id})`);
    });

    await batch.commit();
    console.log(`🔥 ${totalDeleted} produit(s) supprimé(s) de Firestore.`);

    // ✅ 6. Réponse de succès standardisée
    res.status(200).json({
      message: `Image et ${totalDeleted} produit(s) associé(s) supprimés avec succès.`,
    });
  } catch (err) {
    // ✅ 7. Réponse d'erreur standardisée
    console.error('❌ Erreur lors de la suppression complète du produit:', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la suppression du produit.' });
  }
});

// =====================
// === ROUTES STORIES ====
// =====================

// Route pour créer une story (image ou texte)
app.post('/stories/create', upload.single('storyImage'), async (req, res) => {
  // ✅ 1. Bloc try...catch pour une gestion d'erreur globale
  let publicId; // Déclaré ici pour être accessible dans le bloc catch
  try {
    const {
      boutiqueId,
      categorieId,
      storyType,
      content,
      styleInfo,
      price,
      description,
      availability,
      proprietaireId,
    } = req.body;

    // ✅ 2. Validation des données essentielles
    if (!boutiqueId || !categorieId || !storyType || !proprietaireId) {
      return res.status(400).json({
        error: 'Les champs boutiqueId, categorieId, storyType et proprietaireId sont requis.',
      });
    }

    let imageUrl;

    // ✅ 3. Logique spécifique au type de story
    if (storyType === 'image') {
      if (!req.file) {
        return res.status(400).json({ error: 'Un fichier image est requis pour une story de type image.' });
      }
      // Upload sur Cloudinary
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'stories',
      });
      imageUrl = result.secure_url;
      publicId = result.public_id;
      // Supprime le fichier temporaire du serveur
      fs.unlinkSync(req.file.path);
    } else if (storyType === 'text') {
      if (!content) {
        return res.status(400).json({ error: 'Le champ content est requis pour une story de type texte.' });
      }
    } else {
      return res.status(400).json({ error: 'storyType invalide.' });
    }

    // ✅ 4. Préparation des données pour Firestore
    const storyData = {
      storyType,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)), // Expire dans 24h
      views: [],
      likes: [],
      categorieId: categorieId,
      proprietaireId: proprietaireId,
    };

    // Ajout des champs spécifiques au type
    if (storyType === 'image') {
      storyData.imageUrl = imageUrl;
      storyData.publicId = publicId;
      if (price) storyData.price = parseFloat(price);
      if (description) storyData.description = description;
      if (availability) storyData.availability = parseInt(availability, 10);
    } else { // 'text'
      storyData.content = content;
      if (styleInfo) storyData.styleInfo = JSON.parse(styleInfo);
    }

    // ✅ 5. Écriture dans la base de données
    await db.collection('categories').doc(categorieId).collection('boutiques').doc(boutiqueId).collection('stories').add(storyData);

    // ✅ 6. Réponse de succès standardisée
    return res.status(201).json({ message: 'Story créée avec succès' });

  } catch (error) {
    console.error('❌ Erreur lors de la création de la story:', error);

    // Si une image a été uploadée mais que l'écriture Firestore a échoué,
    // on essaie de la supprimer de Cloudinary pour ne pas laisser de "fantômes".
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId);
        console.log(`🧹 Nettoyage de l'image Cloudinary ${publicId} réussi.`);
      } catch (cleanupError) {
        console.error(`❌ Échec du nettoyage de l'image Cloudinary ${publicId}:`, cleanupError);
      }
    }
    
    // ✅ 7. Réponse d'erreur standardisée
    return res.status(500).json({ error: 'Une erreur interne est survenue sur le serveur.' });
  }
});

// Route pour supprimer une story
app.post('/stories/delete', async (req, res) => {
  try {
    const { storyId, boutiqueId, categoryId, publicId } = req.body;

    // Validation
    if (!storyId || !boutiqueId || !categoryId) {
      return res.status(400).json({ error: 'Les IDs de story, boutique et catégorie sont requis.' });
    }

    // 1. Supprimer le document de Firestore
    const storyRef = db.collection('categories').doc(categoryId).collection('boutiques').doc(boutiqueId).collection('stories').doc(storyId);
    await storyRef.delete();
    console.log(`🔥 Story ${storyId} supprimée de Firestore.`);

    // 2. Si la story avait une image, la supprimer de Cloudinary
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId);
        console.log(`☁️ Image ${publicId} associée à la story supprimée de Cloudinary.`);
      } catch (cloudinaryError) {
        // On ne bloque pas la réponse si la suppression Cloudinary échoue, mais on le signale.
        console.error(`⚠️ Erreur lors de la suppression de l'image Cloudinary ${publicId}:`, cloudinaryError);
      }
    }

    return res.status(200).json({ message: 'Story supprimée avec succès.' });

  } catch (error) {
    console.error('❌ Erreur lors de la suppression de la story:', error);
    return res.status(500).json({ error: 'Une erreur interne est survenue sur le serveur.' });
  }
});


// ===========================
// === ROUTE NOTIFICATION ====
// ===========================

// Envoyer une notification FCM à un token unique
app.post('/send-notification', async (req, res) => {
  const { token, title, body, recipientId, scheduleAt } = req.body;

  // ✅ 1. Validation des données d'entrée
  if (!token || !title || !body) {
    return res.status(400).json({ error: 'Les champs token, title, et body sont requis.' });
  }

  // ✅ 2. Bloc try...catch global
  try {
    // Sauvegarder la notification dans Firestore pour l'utilisateur destinataire
    if (recipientId) {
      try {
        await db.collection('user').doc(recipientId).collection('notifications').add({
          title,
          body,
          read: false,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`✅ Notification sauvegardée pour l'utilisateur: ${recipientId}`);
      } catch (dbError) {
        // On ne bloque pas l'envoi de la notif si la sauvegarde échoue, mais on le signale.
        console.error(`❌ Erreur de sauvegarde de la notification pour ${recipientId}:`, dbError);
      }
    }

    const message = {
      notification: { title, body },
      token,
    };

    // Si une date de planification est fournie
    if (scheduleAt) {
      const scheduleTime = new Date(scheduleAt);
      const now = new Date();
      const delay = scheduleTime.getTime() - now.getTime();

      if (delay > 0) {
        // NOTE: setTimeout n'est pas persistant. Si le serveur redémarre, la notification planifiée sera perdue.
        // Pour une solution robuste, utiliser un service de cron-job (ex: node-cron, ou un service cloud).
        setTimeout(async () => {
          try {
            await admin.messaging().send(message);
            console.log(`✅ Notification planifiée envoyée à ${token}`);
          } catch (error) {
            console.error(`❌ Erreur envoi notif planifiée à ${token}:`, error);
            if (error.code === 'messaging/registration-token-not-registered') {
              cleanupInvalidToken(token);
            }
          }
        }, delay);
        // ✅ 3. Réponse JSON standardisée
        return res.status(202).json({ message: 'Notification planifiée avec succès.' }); // 202 Accepted
      } else {
        // Si l'heure est déjà passée, on envoie immédiatement
        await admin.messaging().send(message);
        return res.status(200).json({ message: 'Notification envoyée (heure planifiée passée).' });
      }
    } else {
      // Envoi immédiat
      await admin.messaging().send(message);
      return res.status(200).json({ message: 'Notification envoyée avec succès.' });
    }
  } catch (error) {
    // ✅ 4. Gestion d'erreur centralisée
    if (error.code === 'messaging/registration-token-not-registered') {
      console.warn(`Token FCM invalide détecté: ${token}. Il sera supprimé.`);
      cleanupInvalidToken(token); // Tâche de fond
      return res.status(404).json({ error: "Le token de l'appareil n'est plus valide." });
    } else {
      console.error('❌ Erreur lors de l\'envoi de la notification:', error);
      return res.status(500).json({ error: 'Une erreur interne est survenue lors de l\'envoi de la notification.' });
    }
  }
});

// Envoyer notification globale à tous les utilisateurs
app.post('/send-global-users', async (req, res) => {
  const { title, body } = req.body;

  // ✅ 1. Validation
  if (!title || !body) {
    return res.status(400).json({ error: 'Les champs title et body sont requis.' });
  }

  // ✅ 2. Bloc try...catch
  try {
    const usersSnapshot = await db.collection('user').get();
    const tokens = [];
    const userIds = [];
    const tokenToUserIdMap = {}; // Pour retrouver le doc.id à partir du token

    usersSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.token) {
        tokens.push(data.token);
        userIds.push(doc.id);
        tokenToUserIdMap[data.token] = doc.id;
      }
    });

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'Aucun utilisateur avec un token FCM trouvé.' });
    }

    const message = {
      notification: { title, body },
      tokens,
    };

    const response = await admin.messaging().sendMulticast(message);

    // Sauvegarde des notifications en batch
    if (userIds.length > 0) {
      const batch = db.batch();
      const notificationPayload = {
        title,
        body,
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };
      userIds.forEach(userId => {
        const notifRef = db.collection('user').doc(userId).collection('notifications').doc();
        batch.set(notifRef, notificationPayload);
      });
      await batch.commit();
      console.log(`✅ Notifications globales sauvegardées pour ${userIds.length} utilisateurs.`);
    }

    // Nettoyage des tokens invalides
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error.code === 'messaging/registration-token-not-registered') {
          const invalidToken = tokens[idx];
          failedTokens.push(invalidToken);
          const userId = tokenToUserIdMap[invalidToken];
          if (userId) {
            console.log(`Token invalide pour l'utilisateur ${userId}. Suppression en arrière-plan...`);
            // On ne bloque pas la réponse pour la suppression
            db.collection('user').doc(userId).update({ token: admin.firestore.FieldValue.delete() });
          }
        }
      });
      console.log('Nettoyage de tokens invalides terminé pour:', failedTokens);
    }

    // ✅ 3. Réponse JSON standardisée
    return res.status(200).json({
      message: `Notification globale envoyée.`,
      successCount: response.successCount,
      failureCount: response.failureCount,
      totalTokens: tokens.length,
    });

  } catch (error) {
    // ✅ 4. Gestion d'erreur centralisée
    console.error('❌ Erreur lors de l\'envoi de la notification globale aux utilisateurs:', error);
    return res.status(500).json({ error: 'Une erreur interne est survenue.' });
  }
});

// Envoyer notification globale à toutes les boutiques
app.post('/send-global-boutiques', async (req, res) => {
  const { title, body } = req.body;

  try {
    // ✅ Utilise collectionGroup pour trouver toutes les boutiques
    const boutiquesSnapshot = await db.collectionGroup('boutiques').get();
    const tokens = [];
    const ownerIds = new Set(); // ✅ Utiliser un Set pour éviter les doublons de propriétaires
    const tokenMap = {}; // Pour retrouver le doc.ref à partir du token
    boutiquesSnapshot.forEach(doc => {
      const data = doc.data();
      const token = data.token;
      const ownerId = data.proprietaireId; // ✅
      if (token && ownerId) {
        tokens.push(token);
        ownerIds.add(ownerId); // ✅
        tokenMap[token] = doc.ref;
      }
    });

    if (tokens.length === 0) {
      return res.status(400).send('Aucune boutique avec token FCM');
    }

    const message = {
      notification: { title, body },
      tokens,
    };

    const response = await admin.messaging().sendMulticast(message);

    // ✅ Sauvegarder la notification pour chaque propriétaire de boutique
    if (ownerIds.size > 0) {
      const batch = db.batch();
      const notificationPayload = {
        title,
        body,
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };
      ownerIds.forEach(ownerId => {
        const notifRef = db.collection('user').doc(ownerId).collection('notifications').doc();
        batch.set(notifRef, notificationPayload);
      });
      await batch.commit();
      console.log(`✅ Notifications globales sauvegardées pour ${ownerIds.size} propriétaires de boutique.`);
    }

    // ✅ Nettoyage des tokens invalides
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error.code === 'messaging/registration-token-not-registered') {
          const invalidToken = tokens[idx];
          failedTokens.push(invalidToken);
          const boutiqueRef = tokenMap[invalidToken];
          if (boutiqueRef) {
            console.log(`Token invalide pour la boutique ${boutiqueRef.path}. Suppression...`);
            boutiqueRef.update({ token: admin.firestore.FieldValue.delete() });
          }
        }
      });
      console.log('Tokens invalides supprimés:', failedTokens);
    }

    res.status(200).send(`✅ Notification globale envoyée à ${response.successCount}/${tokens.length} boutiques`);
  } catch (error) {
    console.error('❌ Erreur envoi global boutiques:', error);
    res.status(500).send('❌ Erreur serveur');
  }
});

// Envoyer notification à une boutique spécifique
app.post('/send-to-boutique/:id', async (req, res) => {
  const { id } = req.params;
  const { title, body } = req.body;

  try {
    // ✅ Utilise collectionGroup pour trouver la boutique par son ID sans connaître sa catégorie
    // Note: Firestore peut vous demander de créer un index pour cette requête.
    const boutiqueQuery = await db.collectionGroup('boutiques').where(admin.firestore.FieldPath.documentId(), '==', id).limit(1).get();

    if (boutiqueQuery.empty) {
      return res.status(404).send('Boutique non trouvée');
    }
    const boutiqueDoc = boutiqueQuery.docs[0];

    const token = boutiqueDoc.data().token;
    if (!token) {
      return res.status(400).send('Aucun token FCM pour cette boutique');
    }

    const message = {
      notification: { title, body },
      token,
    };

    await admin.messaging().send(message);
    res.status(200).send('✅ Notification envoyée à la boutique');
  } catch (error) {
    console.error('❌ Erreur envoi à boutique:', error);
    res.status(500).send('❌ Erreur serveur');
  }
});

// Envoyer une notification pour un like sur une story
app.post('/notify/story-like', async (req, res) => {
  const { boutiqueOwnerId, likerName, boutiqueName } = req.body;
  if (!boutiqueOwnerId || !likerName || !boutiqueName) {
    return res.status(400).json({ error: 'boutiqueOwnerId, likerName, et boutiqueName sont requis.' });
  }

  try {
    const userDoc = await db.collection('user').doc(boutiqueOwnerId).get();
    if (!userDoc.exists) return res.status(404).send('Propriétaire de boutique non trouvé.');

    const token = userDoc.data().token;
    if (!token) return res.status(400).send('Le propriétaire de la boutique n\'a pas de token FCM.');

    const message = {
      notification: {
        title: '❤️ Nouveau like !',
        body: `${likerName} a aimé votre story pour ${boutiqueName}.`
      },
      token,
    };

    await admin.messaging().send(message);
    res.status(200).send('✅ Notification de like de story envoyée.');

  } catch (error) {
    console.error('❌ Erreur envoi notif story like:', error);
    res.status(500).send('❌ Erreur serveur');
  }
});

// Envoyer une notification pour un like sur un commentaire de story
app.post('/notify/comment-like', async (req, res) => {
  const { commentOwnerId, boutiqueName } = req.body;
  if (!commentOwnerId || !boutiqueName) {
    return res.status(400).json({ error: 'commentOwnerId et boutiqueName sont requis.' });
  }

  try {
    const userDoc = await db.collection('user').doc(commentOwnerId).get();
    if (!userDoc.exists) return res.status(404).send('Auteur du commentaire non trouvé.');

    const token = userDoc.data().token;
    if (!token) return res.status(400).send('L\'auteur du commentaire n\'a pas de token FCM.');

    const message = {
      notification: {
        title: `❤️ ${boutiqueName} a réagi`,
        body: `${boutiqueName} a aimé votre commentaire.`
      },
      token,
    };

    await admin.messaging().send(message);
    res.status(200).send('✅ Notification de like de commentaire envoyée.');

  } catch (error) {
    console.error('❌ Erreur envoi notif comment like:', error);
    res.status(500).send('❌ Erreur serveur');
  }
});

/**
 * Cherche et supprime un token FCM invalide dans les collections 'user' et 'boutiques'.
 * Note: Cette fonction peut nécessiter la création d'index dans Firestore.
 * @param {string} token Le token à supprimer.
 */
async function cleanupInvalidToken(token) {
  if (!token) return;
  try {
    // Chercher dans la collection 'user'
    const userQuery = db.collection('user').where('token', '==', token).limit(1);
    const userSnapshot = await userQuery.get();
    userSnapshot.forEach(async (doc) => {
      console.log(`Suppression du token invalide pour l'utilisateur: ${doc.id}`);
      await doc.ref.update({ token: admin.firestore.FieldValue.delete() });
    });

    // Chercher dans les sous-collections 'boutiques'
    const boutiquesQuery = db.collectionGroup('boutiques').where('token', '==', token).limit(1);
    const boutiquesSnapshot = await boutiquesQuery.get();
    boutiquesSnapshot.forEach(async (doc) => {
      console.log(`Suppression du token invalide pour la boutique: ${doc.id}`);
      await doc.ref.update({ token: admin.firestore.FieldValue.delete() });
    });
  } catch (e) {
    console.error(`Erreur lors du nettoyage du token ${token}:`, e);
  }
}
// ========================
// === ROUTES LECTURE API ===
// ========================

// --- Obtenir les produits (avec filtres et pagination) ---
app.get('/products', async (req, res) => {
  try {
    const { categorieId, search, page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    let query = db.collection('produits').where('disponibe', '==', true);

    // Filtre par catégorie
    if (categorieId) {
      query = query.where('categorieId', '==', categorieId);
    }

    // Filtre par recherche (commence par...)
    if (search) {
      const searchTerm = search.toLowerCase();
      query = query
        .where('nomLowercase', '>=', searchTerm)
        .where('nomLowercase', '<=', searchTerm + '\uf8ff')
        .orderBy('nomLowercase'); // L'orderBy est nécessaire pour un filtre de plage
    } else {
      // Tri par défaut : les produits premium d'abord, puis les plus récents
      query = query.orderBy('isPremium', 'desc').orderBy('timestamp', 'desc');
    }

    // Pagination (Note: pour de très grandes collections, l'offset peut devenir lent)
    query = query.limit(limitNum).offset((pageNum - 1) * limitNum);

    const snapshot = await query.get();
    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(products);
  } catch (error) {
    console.error('❌ Erreur lors de la récupération des produits:', error);
    return res.status(500).json({ error: 'Une erreur interne est survenue.' });
  }
});

// --- Obtenir les boutiques (pour la recherche) ---
app.get('/boutiques', async (req, res) => {
  try {
    const { search, limit = 25 } = req.query;
    const limitNum = parseInt(limit, 10);

    // On commence par la collection `rechercheboutique` qui est optimisée pour ça.
    let query = db.collection('rechercheboutique');

    // On ne veut que les boutiques actives.
    // Note: Firestore peut demander un index pour cette requête composée.
    query = query.where('boutique_active', '==', true);

    // Filtre par recherche (commence par...)
    if (search && search.trim() !== '') {
      const searchTerm = search.toLowerCase();
      query = query
        .where('nomLowercase', '>=', searchTerm)
        .where('nomLowercase', '<=', searchTerm + '\uf8ff');
    }

    const snapshot = await query.limit(limitNum).get();
    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const boutiques = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.status(200).json(boutiques);
  } catch (error) {
    console.error('❌ Erreur lors de la recherche des boutiques:', error);
    return res.status(500).json({ error: 'Une erreur interne est survenue.' });
  }
});

// --- Obtenir les détails d'une boutique (infos + produits) ---
app.get('/categories/:categorieId/boutiques/:boutiqueId', async (req, res) => {
  try {
    const { categorieId, boutiqueId } = req.params;
    if (!categorieId || !boutiqueId) {
      return res.status(400).json({ error: 'Un ID de catégorie et de boutique sont requis.' });
    }

    // 1. Trouver la boutique avec un chemin direct (plus efficace)
    const boutiqueRef = db.collection('categories').doc(categorieId).collection('boutiques').doc(boutiqueId);
    const boutiqueDoc = await boutiqueRef.get();

    if (!boutiqueDoc.exists) {
      return res.status(404).json({ error: 'Boutique non trouvée.' });
    }

    const boutiqueData = boutiqueDoc.data();

    // 2. Récupérer les produits de cette boutique, triés par épingle puis par date
    const produitsSnapshot = await boutiqueDoc.ref.collection('produits').orderBy('epingle', 'desc').orderBy('timestamp', 'desc').get();
    
    const produits = produitsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 3. Combiner les informations et renvoyer
    const responseData = {
      ...boutiqueData,
      id: boutiqueDoc.id, // S'assurer que l'ID est bien dans la réponse
      produits: produits,
    };

    // Convertir les Timestamps en chaînes ISO pour la cohérence JSON
    if (responseData.activationExpiryDate && responseData.activationExpiryDate.toDate) {
      responseData.activationExpiryDate = responseData.activationExpiryDate.toDate().toISOString();
    }

    return res.status(200).json(responseData);

  } catch (error) {
    console.error('❌ Erreur lors de la récupération des détails de la boutique:', error);
    if (error.message && error.message.includes('index')) {
        return res.status(500).json({ error: 'Une configuration de base de données (index) est requise. Veuillez consulter les logs du serveur.' });
    }
    return res.status(500).json({ error: 'Une erreur interne est survenue.' });
  }
});

// --- Obtenir toutes les annonces actives ---
app.get('/annonces', async (req, res) => {
  try {
    // On récupère les annonces en les triant par date de création.
    const snapshot = await db.collection('annonces').orderBy('timestamp', 'desc').get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const annonces = snapshot.docs.map(doc => {
      const data = doc.data();
      // Convertir le timestamp en chaîne ISO pour le JSON pour la cohérence
      if (data.timestamp && data.timestamp.toDate) {
        data.timestamp = data.timestamp.toDate().toISOString();
      }
      return { id: doc.id, ...data };
    });

    return res.status(200).json(annonces);

  } catch (error) {
    console.error('❌ Erreur lors de la récupération des annonces:', error);
    return res.status(500).json({ error: 'Une erreur interne est survenue.' });
  }
});

// --- Obtenir une annonce par son ID ---
app.get('/annonces/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Un ID d\'annonce est requis.' });
    }

    const docRef = db.collection('annonces').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Annonce non trouvée.' });
    }

    const annonceData = doc.data();
    // Convertir le timestamp Firestore en chaîne ISO pour le JSON
    if (annonceData.timestamp && annonceData.timestamp.toDate) {
      annonceData.timestamp = annonceData.timestamp.toDate().toISOString();
    }

    return res.status(200).json({ id: doc.id, ...annonceData });
  } catch (error) {
    console.error('❌ Erreur lors de la récupération de l\'annonce:', error);
    return res.status(500).json({ error: 'Une erreur interne est survenue.' });
  }
});


// --- Obtenir les statistiques d'une boutique ---
app.get('/categories/:categorieId/boutiques/:boutiqueId/stats', async (req, res) => {
  try {
    const { categorieId, boutiqueId } = req.params;
    if (!categorieId || !boutiqueId) {
      return res.status(400).json({ error: 'Un ID de catégorie et de boutique sont requis.' });
    }

    // 1. Trouver la boutique avec un chemin direct
    const boutiqueRef = db.collection('categories').doc(categorieId).collection('boutiques').doc(boutiqueId);
    const boutiqueDoc = await boutiqueRef.get();

    if (!boutiqueDoc.exists) {
      return res.status(404).json({ error: 'Boutique non trouvée.' });
    }

    // 2. Lancer toutes les requêtes de statistiques en parallèle pour l'efficacité
    const [
      abonnesSnapshot,
      produitsSnapshot,
      commandesSnapshot,
      storiesSnapshot
    ] = await Promise.all([
      boutiqueRef.collection('abonnes').get(),
      boutiqueRef.collection('produits').get(),
      boutiqueRef.collection('commandes').get(),
      boutiqueRef.collection('stories').where('expiresAt', '>', admin.firestore.Timestamp.now()).get()
    ]);

    // 3. Calculer les statistiques à partir des snapshots
    
    // Statistiques de base
    const nombreAbonnes = abonnesSnapshot.size;
    const nombreProduits = produitsSnapshot.size;
    const nombreCommandes = commandesSnapshot.size;

    // Statistiques sur les commandes
    let revenusTotal = 0;
    let totalNotes = 0;
    let nombreNotes = 0;
    const commandesParStatut = {
      'en attente': 0,
      'traité': 0,
      'expédié': 0,
      'livré': 0,
      'reçu': 0,
    };

    commandesSnapshot.forEach(doc => {
      const commande = doc.data();
      
      if (commande.statut === 'reçu' && commande.prixTotal) {
        revenusTotal += Number(commande.prixTotal) || 0;
      }

      if (commande.note && commande.note > 0) {
        totalNotes += Number(commande.note) || 0;
        nombreNotes++;
      }

      if (commande.statut && commandesParStatut.hasOwnProperty(commande.statut)) {
        commandesParStatut[commande.statut]++;
      }
    });

    const noteMoyenne = nombreNotes > 0 ? totalNotes / nombreNotes : 0;

    // Statistiques sur les stories
    let totalVuesStories = 0;
    let totalLikesStories = 0;
    storiesSnapshot.forEach(doc => {
        const story = doc.data();
        if (story.views && Array.isArray(story.views)) {
            totalVuesStories += story.views.length;
        }
        if (story.likes && Array.isArray(story.likes)) {
            totalLikesStories += story.likes.length;
        }
    });

    // 4. Assembler la réponse
    const stats = {
      nombreAbonnes,
      nombreProduits,
      nombreCommandes,
      revenusTotal,
      noteMoyenne: parseFloat(noteMoyenne.toFixed(2)),
      nombreAvis: nombreNotes,
      repartitionCommandes: commandesParStatut,
      totalVuesStories,
      totalLikesStories,
      lastUpdated: new Date().toISOString(),
    };

    return res.status(200).json(stats);

  } catch (error) {
   console.error(`❌ Erreur lors de la récupération des statistiques pour la boutique ${req.params.boutiqueId}:`, error);
    if (error.message && error.message.includes('index')) {
        return res.status(500).json({ error: 'Une configuration de base de données (index) est requise. Veuillez consulter les logs du serveur.' });
    }
    return res.status(500).json({ error: 'Une erreur interne est survenue.' });
  }
});

// ========================
// === TÂCHES PLANIFIÉES ===
// ========================

/**
 * Nettoie les stories expirées de toutes les boutiques.
 * Cette fonction supprime également les images associées sur Cloudinary.
 */
async function cleanupExpiredStories() {
  console.log(`[${new Date().toISOString()}] 🧹 Lancement du nettoyage des stories expirées...`);
  const now = admin.firestore.Timestamp.now();
  let storiesSupprimees = 0;

  try {
    // Utilise une collectionGroup pour trouver toutes les stories expirées dans l'ensemble de la base de données.
    // Note: Firestore peut vous demander de créer un index pour cette requête. Suivez le lien dans le message d'erreur du terminal si nécessaire.
    const expiredStoriesQuery = db.collectionGroup('stories').where('expiresAt', '<', now);
    const snapshot = await expiredStoriesQuery.get();

    if (snapshot.empty) {
      console.log("🧹 Aucune story expirée à nettoyer.");
      return;
    }

    const batch = db.batch();
    const cloudinaryPublicIds = [];

    snapshot.forEach(doc => {
      const storyData = doc.data();
      // Marque le document pour suppression dans le batch
      batch.delete(doc.ref);
      storiesSupprimees++;

      // Si la story a une image sur Cloudinary, on stocke son publicId pour la supprimer
      if (storyData.publicId) {
        cloudinaryPublicIds.push(storyData.publicId);
      }
    });

    // Exécute la suppression en batch dans Firestore
    await batch.commit();
    console.log(`🔥 ${storiesSupprimees} stories supprimées de Firestore.`);

    // Supprime les images associées sur Cloudinary
    if (cloudinaryPublicIds.length > 0) {
      await cloudinary.api.delete_resources(cloudinaryPublicIds);
      console.log(`☁️ ${cloudinaryPublicIds.length} images associées supprimées de Cloudinary.`);
    }

  } catch (error) {
    console.error('❌ Erreur lors du nettoyage des stories expirées:', error);
  }
}
// ====================
// === DEMARRAGE ======
// ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
  // Lance le nettoyage immédiatement au démarrage, puis toutes les heures.
  cleanupExpiredStories();
  setInterval(cleanupExpiredStories, 60 * 60 * 1000); // 1 heure
});