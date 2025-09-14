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

// Supprimer image + produits associés dans Firestore
app.post('/delete-product', async (req, res) => {
  const { publicId } = req.body;

  if (!publicId) {
    return res.status(400).json({ error: 'publicId requis' });
  }

  try {
    await cloudinary.uploader.destroy(publicId);
    console.log(`✅ Image supprimée de Cloudinary: ${publicId}`);

    const categoriesSnapshot = await db.collection('categories').get();
    let totalDeleted = 0;

    for (const categorieDoc of categoriesSnapshot.docs) {
      const boutiquesSnapshot = await db
        .collection('categories')
        .doc(categorieDoc.id)
        .collection('boutiques')
        .get();

      for (const boutiqueDoc of boutiquesSnapshot.docs) {
        const produitsRef = db
          .collection('categories')
          .doc(categorieDoc.id)
          .collection('boutiques')
          .doc(boutiqueDoc.id)
          .collection('produits');

        const produitsSnapshot = await produitsRef
          .where('publicId', '==', publicId)
          .get();

        for (const produitDoc of produitsSnapshot.docs) {
          await produitsRef.doc(produitDoc.id).delete();
          totalDeleted++;
          console.log(`🗑️ Produit supprimé: ${produitDoc.id}`);
        }
      }
    }

    res.status(200).json({
      message: `✅ Image + ${totalDeleted} produit(s) supprimé(s)`,
    });
  } catch (err) {
    console.error('❌ Erreur de suppression complète:', err);
    res.status(500).json({ error: 'Erreur de suppression' });
  }
});

// =====================
// === ROUTES STORIES ====
// =====================

app.post('/stories/create', upload.single('storyImage'), async (req, res) => {
 
  const imageFile = req.file;

 

  try {
     const {
      boutiqueId,
      categorieId,
      storyType,
      content, // pour le texte
      price, // pour l'image
      description, // pour l'image
      styleInfo, // pour le texte
    } = req.body;

    if (!boutiqueId || !categorieId || !storyType) {
      return res.status(400).json({ error: 'boutiqueId, categorieId, et storyType sont requis.' });
    }
    const boutiqueRef = db.collection('categories').doc(categorieId).collection('boutiques').doc(boutiqueId);
    const boutiqueDoc = await boutiqueRef.get();

    if (!boutiqueDoc.exists) {
      return res.status(404).json({ error: 'Boutique non trouvée.' });
    }

    const boutiqueData = boutiqueDoc.data();
    const isPremium = boutiqueData.premium === true;

    // --- Vérification des limites de stories ---
    if (!isPremium) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const storiesSnapshot = await boutiqueRef.collection('stories')
        .where('timestamp', '>=', today)
        .where('timestamp', '<', tomorrow)
        .get();

      if (storiesSnapshot.size >= 3) {
        return res.status(403).json({ error: 'Limite de 3 stories par jour atteinte pour les comptes non-premium.' });
      }
    }

    // --- Préparation des données de la story ---
    const storyData = {
      storyType,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 heures à partir de maintenant
      views: [],
      likes: [],
    };

    if (storyType === 'image') {
      if (!imageFile) {
        return res.status(400).json({ error: 'Un fichier image est requis pour une story image.' });
      }
      // Traitement et upload de l'image vers Cloudinary
      const compressedPath = `uploads/compressed_story_${Date.now()}.jpg`;
      await sharp(imageFile.path)
        .resize({ width: 1080 }) // Bonne résolution pour les stories
        .jpeg({ quality: 85 })
        .toFile(compressedPath);

      const result = await cloudinary.uploader.upload(compressedPath);

      // Nettoyage des fichiers locaux
      fs.unlinkSync(imageFile.path);
      fs.unlinkSync(compressedPath);

      storyData.imageUrl = result.secure_url;
      storyData.publicId = result.public_id;
      storyData.price = price || null;
      storyData.description = description || null;

    } else if (storyType === 'text') {
      if (!content) {
        return res.status(400).json({ error: 'Le contenu est requis pour une story texte.' });
      }
      storyData.content = content;
      storyData.styleInfo = styleInfo ? JSON.parse(styleInfo) : {}; // ex: { background: 'gradient1', font: 'font3', size: 24 }
    } else {
      return res.status(400).json({ error: 'storyType invalide.' });
    }

    // --- Sauvegarde dans Firestore ---
    await boutiqueRef.collection('stories').add(storyData);

    // --- Notifier les abonnés (optionnel, mais bon pour l'engagement) ---
    console.log(`✅ Story créée pour la boutique ${boutiqueId}. Pensez à notifier les abonnés.`);

    res.status(201).json({ message: 'Story créée avec succès.' });

  } catch (err) {
    console.error('❌ Erreur lors de la création de la story:', err);
    // Nettoyer le fichier uploadé en cas d'erreur s'il existe
    if (imageFile && fs.existsSync(imageFile.path)) {
      fs.unlinkSync(imageFile.path);
    }
     // Renvoyer une erreur JSON claire
    if (!res.headersSent) {
      res.status(500).json({ error: 'Échec de la création de la story.', details: err.message });
    }
  }
});

// ===========================
// === ROUTE NOTIFICATION ====
// ===========================

// Envoyer une notification FCM à un token unique
app.post('/send-notification', async (req, res) => {
  // On récupère aussi `recipientId` pour sauvegarder la notification
  const { token, title, body, recipientId, scheduleAt } = req.body;

  try {
    // ✅ Sauvegarder la notification dans Firestore pour l'utilisateur destinataire
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
        console.error(`❌ Erreur de sauvegarde de la notification pour ${recipientId}:`, dbError);
      }
    }
    const message = {
      notification: {
        title,
        body,
      },
      token,
    };

    // Si une date de planification est fournie
    if (scheduleAt) {
      const scheduleTime = new Date(scheduleAt);
      const now = new Date();
      const delay = scheduleTime.getTime() - now.getTime();

      if (delay > 0) {
        // Planifie l'envoi avec un délai (non persistant si le serveur redémarre)
        setTimeout(async () => {
          try {
            await admin.messaging().send(message);
            console.log(`✅ Notification planifiée envoyée à ${token}`);
          } catch (error) {
            console.error(`❌ Erreur envoi notif planifiée à ${token}:`, error);
          }
        }, delay);
        res.status(200).send('✅ Notification planifiée');
      } else {
        // Si l'heure est déjà passée, on envoie immédiatement
        await admin.messaging().send(message);
        res.status(200).send('✅ Notification envoyée (heure planifiée passée)');
      }
    } else {
      // Envoi immédiat
      await admin.messaging().send(message);
      res.status(200).send('✅ Notification envoyée');
    }
  } catch (error) {
    // ✅ Gérer les tokens invalides
    if (error.code === 'messaging/registration-token-not-registered') {
      console.warn(`Token FCM invalide détecté: ${token}. Il sera supprimé.`);
      // On ne bloque pas la réponse pour la suppression, on le fait en arrière-plan
      cleanupInvalidToken(token);
      res.status(404).send(`Le token de l'appareil n'est plus enregistré.`);
    } else {
      console.error('❌ Erreur envoi notif :', error);
      res.status(500).send('❌ Erreur serveur');
    }
  }
});

// Envoyer notification globale à tous les utilisateurs
app.post('/send-global-users', async (req, res) => {
  const { title, body } = req.body;

  try {
    // ✅ La collection est 'user' (et non 'users')
    const usersSnapshot = await db.collection('user').get();
    const tokens = [];
    const userIds = []; // ✅ Garder les IDs des utilisateurs
    const tokenMap = {}; // Pour retrouver le doc.id à partir du token
    usersSnapshot.forEach(doc => {
      const token = doc.data().token;
      if (token) {
        tokens.push(token);
        userIds.push(doc.id); // ✅
        tokenMap[token] = doc.id;
      }
    });

    if (tokens.length === 0) {
      return res.status(400).send('Aucun utilisateur avec token FCM');
    }

    const message = {
      notification: { title, body },
      tokens,
    };

    const response = await admin.messaging().sendMulticast(message);

    // ✅ Sauvegarder la notification pour chaque utilisateur
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

    // ✅ Nettoyage des tokens invalides
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error.code === 'messaging/registration-token-not-registered') {
          const invalidToken = tokens[idx];
          failedTokens.push(invalidToken);
          const userId = tokenMap[invalidToken];
          if (userId) {
            console.log(`Token invalide pour l'utilisateur ${userId}. Suppression...`);
            db.collection('user').doc(userId).update({ token: admin.firestore.FieldValue.delete() });
          }
        }
      });
      console.log('Tokens invalides supprimés:', failedTokens);
    }

    res.status(200).send(`✅ Notification globale envoyée à ${response.successCount}/${tokens.length} utilisateurs`);
  } catch (error) {
    console.error('❌ Erreur envoi global users:', error);
    res.status(500).send('❌ Erreur serveur');
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
// ====================
// === DEMARRAGE ======
// ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur lancé sur le port ${PORT}`);
});