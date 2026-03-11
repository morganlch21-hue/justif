/**
 * Gmail Watcher - Google Apps Script
 *
 * Ce script surveille un compte Gmail toutes les 15 minutes
 * et envoie les factures détectées vers l'app Justif.
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
    LABEL_PROCESSED: 'Justif/Traite',
    LABEL_DOUBT: 'Justif/Doute',
    LABEL_IGNORED: 'Justif/Ignore',
    // Recherche : emails avec PJ, non traités, des 90 derniers jours
    SEARCH_QUERY: 'has:attachment -label:Justif/Traite -label:Justif/Ignore -label:Justif/Doute newer_than:90d',
  };
}

// Mots-clés forts (très probablement une facture fournisseur)
var STRONG_KEYWORDS = [
  'facture', 'invoice', 'reçu', 'receipt', 'avoir', 'credit note',
  'note d\'honoraires', 'debit note', 'pro forma', 'proforma',
];

// Mots-clés faibles (contexte facture, mais seuls = pas suffisant)
var WEAK_KEYWORDS = [
  'paiement', 'payment', 'abonnement', 'subscription',
  'montant', 'amount due', 'échéance', 'due date',
  'relevé', 'statement', 'solde', 'balance',
];

// Patterns de fichiers = facture sortante (à EXCLURE)
var OUTGOING_INVOICE_PATTERNS = [
  'ml-consulting', 'ml_consulting', '2603-f-',
];

// Sujets à ignorer (pas des factures)
var IGNORED_SUBJECTS = [
  'cni', 'carte d\'identité', 'passeport', 'autorisation',
  'timesheet', 'feuille de temps', 'planning',
  'cookiebot', 'newsletter', 'webinar', 'inscription',
  'bienvenue', 'welcome', 'café tissé',
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
  var threads = GmailApp.search(config.SEARCH_QUERY, 0, 100);

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

      // Si ce n'est pas une facture, ignorer et passer au suivant
      if (!analysis.isInvoice) {
        thread.addLabel(labelIgnored);
        Logger.log('Ignoré (pas une facture): ' + subject + ' [' + analysis.matchedKeywords.join(', ') + ']');
        continue;
      }

      for (var a = 0; a < validAttachments.length; a++) {
        var attachment = validAttachments[a];

        // Limiter à 3MB pour rester sous la limite Vercel (4.5MB avec base64)
        if (attachment.getSize() > 3 * 1024 * 1024) {
          Logger.log('Fichier trop gros (' + Math.round(attachment.getSize() / 1024 / 1024) + 'MB), ignoré: ' + attachment.getName());
          continue;
        }

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
          category: analysis.category || 'supplier',
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
            thread.addLabel(labelProcessed);
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
  var subjectLower = subject.toLowerCase();
  var strongMatches = [];
  var weakMatches = [];

  // Vérifier si c'est un sujet à ignorer
  for (var s = 0; s < IGNORED_SUBJECTS.length; s++) {
    if (subjectLower.indexOf(IGNORED_SUBJECTS[s]) !== -1) {
      return { isInvoice: false, confidence: 0, matchedKeywords: ['IGNORED:' + IGNORED_SUBJECTS[s]] };
    }
  }

  // Vérifier si c'est une facture sortante (ML-CONSULTING) → catégorie "client"
  for (var a = 0; a < attachments.length; a++) {
    var fileName = attachments[a].getName().toLowerCase();
    for (var o = 0; o < OUTGOING_INVOICE_PATTERNS.length; o++) {
      if (fileName.indexOf(OUTGOING_INVOICE_PATTERNS[o]) !== -1) {
        return { isInvoice: true, confidence: 1, matchedKeywords: ['CLIENT:' + fileName], category: 'client' };
      }
    }
  }

  // Chercher mots-clés forts
  for (var i = 0; i < STRONG_KEYWORDS.length; i++) {
    if (text.indexOf(STRONG_KEYWORDS[i].toLowerCase()) !== -1) {
      strongMatches.push(STRONG_KEYWORDS[i]);
    }
  }

  // Chercher mots-clés faibles
  for (var w = 0; w < WEAK_KEYWORDS.length; w++) {
    if (text.indexOf(WEAK_KEYWORDS[w].toLowerCase()) !== -1) {
      weakMatches.push(WEAK_KEYWORDS[w]);
    }
  }

  // Vérifier les noms des PJ pour mots-clés forts
  for (var a2 = 0; a2 < attachments.length; a2++) {
    var name = attachments[a2].getName().toLowerCase();
    for (var k = 0; k < STRONG_KEYWORDS.length; k++) {
      if (name.indexOf(STRONG_KEYWORDS[k].toLowerCase()) !== -1) {
        strongMatches.push('filename:' + STRONG_KEYWORDS[k]);
      }
    }
  }

  var allMatches = strongMatches.concat(weakMatches);
  var uniqueAll = allMatches.filter(function(v, i, a) { return a.indexOf(v) === i; });

  // Logique : au moins 1 mot-clé fort OU 2+ mots-clés faibles
  var hasStrong = strongMatches.length > 0;
  var hasEnoughWeak = weakMatches.length >= 2;
  var isInvoice = hasStrong || hasEnoughWeak;

  var confidence = hasStrong ? Math.min(0.5 + (uniqueAll.length / 4), 1) : Math.min(weakMatches.length / 4, 0.6);

  return {
    isInvoice: isInvoice,
    confidence: confidence,
    matchedKeywords: uniqueAll,
    category: 'supplier',
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
