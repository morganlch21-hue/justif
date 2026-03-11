/**
 * Gmail Watcher - Google Apps Script
 *
 * Ce script surveille un compte Gmail toutes les 15 minutes
 * et envoie les factures détectées vers l'app Compta.
 *
 * INSTALLATION :
 * 1. Aller sur https://script.google.com
 * 2. Créer un nouveau projet
 * 3. Coller ce code
 * 4. Aller dans Paramètres du projet > Propriétés du script
 * 5. Ajouter :
 *    - API_ENDPOINT : https://votre-app.vercel.app/api/gmail/receive
 *    - API_SECRET : le même secret que GMAIL_WEBHOOK_SECRET dans .env
 * 6. Exécuter createTrigger() une fois pour créer le déclencheur automatique
 *
 * RÉPÉTER pour chaque compte Gmail qui reçoit des factures.
 */

// Configuration
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    API_ENDPOINT: props.getProperty('API_ENDPOINT'),
    API_SECRET: props.getProperty('API_SECRET'),
    LABEL_PROCESSED: 'Compta/Traite',
    LABEL_DOUBT: 'Compta/Doute',
    LABEL_IGNORED: 'Compta/Ignore',
    // Recherche : emails avec PJ, non traités, des 7 derniers jours
    SEARCH_QUERY: 'has:attachment -label:Compta/Traite -label:Compta/Ignore -label:Compta/Doute newer_than:7d',
  };
}

// Mots-clés indiquant une facture
var INVOICE_KEYWORDS = [
  'facture', 'invoice', 'reçu', 'receipt', 'avoir', 'credit note',
  'note d\'honoraires', 'debit note', 'relevé', 'statement',
  'commande', 'order confirmation', 'paiement', 'payment',
  'abonnement', 'subscription', 'renouvellement', 'renewal',
  'pro forma', 'proforma', 'bon de commande', 'purchase order',
  'récapitulatif', 'summary', 'montant', 'amount due',
  'échéance', 'due date', 'solde', 'balance',
];

// Extensions de fichiers acceptées
var ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'];

// Extensions à ignorer (signatures, logos, etc.)
var IGNORED_PATTERNS = [
  'signature', 'logo', 'banner', 'header', 'footer',
  'unsubscribe', 'tracking', 'pixel', 'image00', 'image01',
];

/**
 * Fonction principale : traite les nouveaux emails
 */
function processNewInvoices() {
  var config = getConfig();
  var threads = GmailApp.search(config.SEARCH_QUERY, 0, 50);

  var labelProcessed = getOrCreateLabel(config.LABEL_PROCESSED);
  var labelDoubt = getOrCreateLabel(config.LABEL_DOUBT);
  var labelIgnored = getOrCreateLabel(config.LABEL_IGNORED);

  var emailAccount = Session.getActiveUser().getEmail();

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();

    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      var subject = message.getSubject() || '';
      var body = message.getPlainBody() || '';
      var sender = message.getFrom() || '';
      var attachments = message.getAttachments();

      // Filtrer les PJ valides (PDF, images)
      var validAttachments = filterAttachments(attachments);

      if (validAttachments.length === 0) {
        thread.addLabel(labelIgnored);
        continue;
      }

      // Analyser si c'est une facture
      var analysis = analyzeEmail(subject, body, sender, validAttachments);

      for (var a = 0; a < validAttachments.length; a++) {
        var attachment = validAttachments[a];

        var payload = {
          messageId: message.getId(),
          subject: subject,
          sender: sender,
          receivedAt: message.getDate().toISOString(),
          fileName: attachment.getName(),
          fileBase64: Utilities.base64Encode(attachment.getBytes()),
          fileType: attachment.getContentType(),
          emailAccount: emailAccount,
          confidence: analysis.confidence,
          isInvoice: analysis.isInvoice,
          matchedKeywords: analysis.matchedKeywords,
        };

        try {
          var response = UrlFetchApp.fetch(config.API_ENDPOINT, {
            method: 'POST',
            contentType: 'application/json',
            headers: { 'Authorization': 'Bearer ' + config.API_SECRET },
            payload: JSON.stringify(payload),
            muteHttpExceptions: true,
          });

          var code = response.getResponseCode();
          if (code === 200 || code === 201) {
            if (analysis.isInvoice) {
              thread.addLabel(labelProcessed);
            } else {
              thread.addLabel(labelDoubt);
            }
          } else if (code === 409) {
            // Déjà traité (doublon)
            thread.addLabel(labelProcessed);
          } else {
            Logger.log('Erreur API (' + code + '): ' + response.getContentText());
          }
        } catch (e) {
          Logger.log('Erreur envoi: ' + e.message);
        }
      }
    }
  }
}

/**
 * Analyse un email pour déterminer s'il contient une facture
 */
function analyzeEmail(subject, body, sender, attachments) {
  var text = (subject + ' ' + body + ' ' + sender).toLowerCase();
  var matchedKeywords = [];

  for (var i = 0; i < INVOICE_KEYWORDS.length; i++) {
    if (text.indexOf(INVOICE_KEYWORDS[i].toLowerCase()) !== -1) {
      matchedKeywords.push(INVOICE_KEYWORDS[i]);
    }
  }

  // Vérifier les noms des PJ
  for (var a = 0; a < attachments.length; a++) {
    var name = attachments[a].getName().toLowerCase();
    for (var k = 0; k < INVOICE_KEYWORDS.length; k++) {
      if (name.indexOf(INVOICE_KEYWORDS[k].toLowerCase()) !== -1) {
        matchedKeywords.push('filename:' + INVOICE_KEYWORDS[k]);
      }
    }
  }

  // Score de confiance
  var uniqueKeywords = matchedKeywords.filter(function(v, i, a) { return a.indexOf(v) === i; });
  var confidence = Math.min(uniqueKeywords.length / 3, 1); // 0 à 1

  return {
    isInvoice: uniqueKeywords.length >= 1,
    confidence: confidence,
    matchedKeywords: uniqueKeywords,
  };
}

/**
 * Filtre les pièces jointes pour ne garder que les fichiers pertinents
 */
function filterAttachments(attachments) {
  var valid = [];

  for (var i = 0; i < attachments.length; i++) {
    var att = attachments[i];
    var name = att.getName().toLowerCase();
    var type = att.getContentType().toLowerCase();

    // Vérifier l'extension
    var hasValidExtension = false;
    for (var e = 0; e < ACCEPTED_EXTENSIONS.length; e++) {
      if (name.endsWith(ACCEPTED_EXTENSIONS[e])) {
        hasValidExtension = true;
        break;
      }
    }

    if (!hasValidExtension) continue;

    // Exclure les petits fichiers (< 5KB = probablement un logo/pixel)
    if (att.getSize() < 5000 && type.indexOf('image') !== -1) continue;

    // Exclure les patterns de fichiers non-factures
    var isIgnored = false;
    for (var p = 0; p < IGNORED_PATTERNS.length; p++) {
      if (name.indexOf(IGNORED_PATTERNS[p]) !== -1) {
        isIgnored = true;
        break;
      }
    }
    if (isIgnored) continue;

    valid.push(att);
  }

  return valid;
}

/**
 * Récupère ou crée un label Gmail
 */
function getOrCreateLabel(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
  }
  return label;
}

/**
 * Crée le déclencheur automatique (exécuter une seule fois)
 */
function createTrigger() {
  // Supprimer les anciens triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  // Créer un nouveau trigger toutes les 15 minutes
  ScriptApp.newTrigger('processNewInvoices')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('Trigger créé : processNewInvoices toutes les 15 minutes');
}

/**
 * Test manuel
 */
function testRun() {
  processNewInvoices();
  Logger.log('Test terminé');
}
