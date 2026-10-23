# Passage Photos — interface de migration

Question principale : quelle est la prochaine action pour transférer mes photos sans perdre la reprise ?

L'interface présente un parcours réel : connexion pCloud, archives Takeout, dossier destination. Le suivi rassemble une seule barre d'avancement, les fichiers vérifiés/restants/en erreur et l'action en cours. Aucun compteur n'est fictif. Une interface non reliée à l'ordinateur montre une procédure de connexion, pas un faux état connecté.

Direction : Achromatic ledger, seed 645944617, sans nouveau tirage. Mise en page centrée sans barre latérale, adaptée à une tâche personnelle. Le papier gris légèrement bleuté (#f2f4f7) rappelle le rangement de fichiers. Typographie Geist, hébergée avec le site. Texte #0a0a0a, secondaire #60646b, surfaces blanches, séparateurs #e6e6e6. Le bleu #1d5fbf représente uniquement le transfert dans la barre de progression. Les actions principales restent noires.

Signature : le trajet Google Photos / archives Takeout / pCloud devient un petit bordereau de transfert. Les trois étapes sont numérotées car leur ordre est réel. Le nom du dossier choisi apparaît dans la destination et reste associé à son identifiant après renommage.

Grille desktop : largeur maximale 1120 px = 680 px de préparation + 24 px d'espace + 416 px de suivi. Les deux régions se rangent en une seule colonne sous 900 px. Les marges mobiles sont de 20 px. Les contrôles mesurent au moins 44 px et conservent un focus visible.

Le site fonctionne entièrement dans le navigateur. OAuth pCloud utilise le flux token sans Client Secret ; le jeton reste dans la session de l'onglet. Le navigateur lit les ZIP, garde le journal dans IndexedDB et prépare un seul média dans OPFS. Un journal exportable remplace le SQLite du compagnon. Aucun programme local ni accès loopback n'est requis.

Contrôle visuel : captures navigateur aux largeurs 1440, 768, 390 et 375 px, plus parcours connecté avec analyse d'un ZIP réel et mouvement réduit. Le panneau de suivi garde sa hauteur propre et reste collant sur ordinateur ; son bord inférieur ne s'aligne volontairement pas sur la préparation, afin de ne pas créer de vide artificiel dans le suivi. Aucun jeu de données fictif n'est publié.

Extension de nettoyage : le panneau de commandes reprend le papier gris, les boutons sobres et la même hiérarchie de texte. L’adresse du compte et la date du contrôle précèdent les commandes. Examiner, tester un média, puis continuer par lots constituent une progression réelle ; le vidage définitif est isolé dans une section repliée, avec saisie d’une phrase et confirmation distincte. Les tests visuels utilisent un simulateur explicitement marqué comme tel, jamais les photos d’un compte utilisateur.

Le vidage automatique optionnel reste dans la section de suppression définitive. La case est décochée par défaut, précise sa portée à la vue en cours et utilise la même phrase de confirmation que le vidage manuel. La confirmation de lancement annonce l’enchaînement irréversible ; aucun accord n’est réutilisé après un arrêt ou un rechargement.

Le guide console reprend les panneaux existants, sans modifier le transfert. Quatre étapes relient l’ouverture du compte chez Google, la copie du script fourni par l’utilisateur, son lancement dans F12 et la vérification avant vidage manuel. Le bouton copie du texte sans exécuter de code ; le repli affiche une zone de texte sélectionnable si le presse-papiers est bloqué. Ce mode est explicitement indépendant de l’audit pCloud, sans badge de connexion Google ni preuve de sauvegarde inventée.

La version de sélection globale attend le bas stable de la grille puis effectue un second passage de vérification avant une seule demande de mise à la corbeille. Le texte annonce le risque de refus par Google pour une sélection trop grande et l’absence de fractionnement automatique ; le vidage de la corbeille reste manuel.

Rangement pCloud : les photos et vidéos apparaissent directement dans le dossier choisi ; les JSON sont regroupés dans « Métadonnées Takeout ». L’étape de destination explique ce résultat avant le lancement et propose « Regrouper les fichiers déjà reçus » pour les journaux de l’ancien rangement. Le regroupement reste dans le même parcours, avec le verrou, la pause, les erreurs et les bilans existants.
