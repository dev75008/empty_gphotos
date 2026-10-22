# Passage Photos — extension Chrome/Edge

Décompressez le ZIP, ouvrez `chrome://extensions` (Chrome) ou `edge://extensions` (Edge), activez le mode développeur puis **Charger l’extension non empaquetée**. Sélectionnez le dossier contenant `manifest.json`.

Guide complet : https://github.com/dev75008/empty_gphotos#extension-de-nettoyage-chromeedge

L’extension exige le dossier de contrôle JSON exporté après une vérification intégrale sur https://dev75008.github.io/empty_gphotos/ et l’adresse exacte du compte Google ouvert. Commencez par examiner la vue puis tester un média avant de continuer par lots. Traitez Photos et Archive séparément.

Version 1.1.0 : pour le dernier traitement, dépliez **Vider définitivement la corbeille**, cochez **Vider automatiquement la corbeille après cette vue**, confirmez vos copies et les anciens éléments puis saisissez `VIDER LA CORBEILLE`. Le lancement des lots demande alors un accord incluant le vidage définitif. Celui-ci s’enchaîne seulement après confirmation de la vue vide, sans erreur ni arrêt. L’option reste désactivée par défaut et ne traite pas les autres vues à votre place. Le mode manuel reste disponible.

Mise à jour d’une version installée : remplacez les fichiers de son dossier par ceux du nouveau ZIP, cliquez sur la flèche **Recharger** dans la fiche Chrome/Edge de l’extension, puis actualisez l’onglet Google Photos.

Automatisation expérimentale de l’interface Google en français/anglais. Testée sur un simulateur, sans suppression dans un compte réel. Un changement de l’interface peut arrêter le traitement. Les copies Takeout et pCloud doivent être vérifiées avant toute suppression ; l’export ne prouve pas la couverture de tout le compte. Le vidage définitif est irréversible et concerne aussi les anciens éléments de la corbeille.
