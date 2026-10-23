# Passage Photos — Google Takeout vers pCloud, dans le navigateur

**[Ouvrir l'application sur GitHub Pages](https://dev75008.github.io/empty_gphotos/)**

Le transfert web ne nécessite aucune installation, aucun Python ni compagnon local. La page lit les ZIP que vous choisissez, puis envoie leurs fichiers directement à pCloud. GitHub héberge le code de la page ; il ne reçoit pas vos photos, vos vidéos ni votre jeton pCloud. Le nettoyage propose un script à copier dans la console Google Photos ou une extension Chrome/Edge à installer séparément.

## Démarrer

Utilisez **Chrome ou Edge récent sur ordinateur**, hors navigation privée.

1. Ouvrez [Passage Photos](https://dev75008.github.io/empty_gphotos/).
2. Dans **Connecter pCloud**, ouvrez **Configurer mon application pCloud**.
3. Connectez-vous au portail [pCloud Developers / My Apps](https://docs.pcloud.com/my_apps/) et créez une application personnelle.
4. Ajoutez exactement cette URI aux redirections autorisées :

   ```text
   https://dev75008.github.io/empty_gphotos/
   ```

5. Copiez le **Client ID / App Key public** dans le champ du site et enregistrez-le. **Aucun Client Secret n'est demandé ni utilisé.**
6. Cliquez sur **Connecter mon compte pCloud**, puis autorisez votre application sur la page pCloud. Vous revenez automatiquement à l'interface.
7. Cliquez sur **Choisir les ZIP**, sélectionnez vos archives Takeout sans les décompresser, puis cliquez sur **Analyser les archives**.
8. Saisissez le nom du dossier pCloud, puis cliquez sur **Lancer le transfert**.

Le flux OAuth pCloud `response_type=token` est celui documenté pour les applications entièrement côté navigateur. Le retour vérifie un `state` aléatoire et sa durée de validité ; le serveur US/Europe est contrôlé contre une liste fermée. Le jeton est immédiatement retiré du fragment de l'URL et gardé dans `sessionStorage`, séparément du journal et du code. Il n'est jamais exporté dans les rapports. Un Client ID n'est pas un secret. [Documentation OAuth pCloud](https://docs.pcloud.com/methods/oauth_2.0/authorize.html).

Si le portail pCloud affiche une erreur de redirection, vérifiez l'URI exacte, notamment le slash final. Une révocation de l'autorisation nécessite une nouvelle connexion ; pCloud ne fournit pas de jeton de renouvellement dans ce flux.

## Obtenir toute la bibliothèque Google Photos

Google Photos Library API ne permet plus d'énumérer une photothèque existante depuis les restrictions entrées en vigueur en mars 2025. Elle est limitée aux contenus créés par l'application. Picker exige une sélection explicite et les vidéos téléchargées par son API sont transcodées. La solution implémentée utilise donc **Google Takeout**. Aucun projet Google Cloud ni identifiant OAuth Google n'est requis. [Changements Google](https://developers.google.com/photos/support/updates), [Picker](https://developers.google.com/photos/picker/guides/media-items).

1. Ouvrez [Google Takeout](https://takeout.google.com/).
2. Désélectionnez tout, puis sélectionnez **Google Photos** et toutes les années/albums souhaités.
3. Demandez un export unique au format **ZIP**, livré par lien de téléchargement.
4. Choisissez des parties de **2 ou 4 Go** si votre disque est limité.
5. Notez le nombre total et les noms des parties annoncées par Google.
6. Téléchargez les ZIP. Attendez la fin du téléchargement ; ne les décompressez pas.

Le téléchargement des ZIP se fait dans le navigateur via la page Google. L'application n'automatise ni cette connexion ni ces liens authentifiés. Les liens Takeout expirent généralement après environ sept jours, avec un nombre limité de téléchargements par archive. [Aide Google Takeout](https://support.google.com/accounts/answer/3024190?hl=fr).

Les octets exportés sont conservés sans conversion ni recompression. Takeout ne peut pas restituer un original antérieur si Google ne conserve qu'une version compressée par « Économiseur de stockage ». L'export peut omettre des éléments seulement partagés, non enregistrés dans votre bibliothèque, et des changements intervenus après sa demande. Contrôlez le périmètre de votre export dans Google.

## Interrompre et reprendre

- Pendant le transfert, gardez **cet onglet ouvert** et l'ordinateur éveillé. Le site demande un verrou de veille si le navigateur le permet, mais ne garantit pas une exécution en arrière-plan.
- **Mettre en pause** interrompt le fichier en cours. Les transactions du journal déjà validées sont conservées.
- Après rechargement ou fermeture, ouvrez la même URL avec **le même navigateur et le même profil**.
- Reconnectez pCloud si la session a expiré, puis **sélectionnez de nouveau les ZIP nécessaires**. Le navigateur ne peut pas rouvrir des fichiers privés sans votre sélection.
- Cliquez sur **Reprendre le transfert**. Les objets déjà vérifiés ne sont ni relus dans les ZIP ni renvoyés. Si un envoi avait été reçu mais sa réponse perdue, son contenu est d'abord retrouvé et vérifié sur pCloud.

La reprise se fait **au fichier**, pas à l'octet. Une vidéo interrompue avant réception complète repart du début. La fermeture du navigateur arrête le traitement : GitHub Pages n'exécute aucun transfert à votre place.

Le journal est dans **IndexedDB**, sous le nom `passage-photos-browser-v1`. Le bouton **Protéger le journal de reprise** demande au navigateur un stockage persistant. Ce droit peut être refusé. Même accordé, il ne protège pas contre une suppression manuelle des données du site, la perte du profil ou une panne de disque.

**Sauvegardez régulièrement le journal de reprise en JSON**, conservez-le hors des données du navigateur et gardez les ZIP jusqu'à validation. **Restaurer un journal** permet de le réimporter, y compris dans un autre profil. Une restauration remet les objets en attente afin de vérifier à nouveau leur présence distante ; elle ne les renvoie pas s'ils sont retrouvés intacts. Le jeton pCloud ne figure jamais dans cette sauvegarde.

Le journal du navigateur et le SQLite de l'ancienne version Python sont indépendants. Le navigateur n'importe pas les fichiers SQLite. Une copie déjà présente dans les anciens sous-dossiers techniques peut être réconciliée par ses empreintes avant un nouvel envoi.

## Fiabilité et absence de doublons

1. Chaque entrée du ZIP est lue en flux, contrôlée par **CRC**, puis identifiée par **SHA-256, SHA-1 et taille**. Les ZIP64 sont pris en charge par zip.js ; pas les ensembles de volumes `.z01`/`.zip.001` ni les ZIP chiffrés.
2. L'objet et sa provenance sont enregistrés ensemble dans une transaction IndexedDB à durabilité stricte. Une archive interrompue reste incomplète et bloque le transfert jusqu'à la fin de son analyse.
3. Des octets identiques, y compris les copies d'albums, partagent un seul objet. Les provenances et noms originaux restent dans le manifeste.
4. Le résultat final permet une consultation directe dans pCloud :

   ```text
   Dossier choisi/IMG_0001.jpg
   Dossier choisi/VIDEO_0001.mp4
   Dossier choisi/Métadonnées Takeout/IMG_0001.jpg.json
   Dossier choisi/Autres fichiers/...
   ```

5. Pour sécuriser l'envoi, un fichier passe provisoirement par `Fichiers/préfixe/SHA256/nom`. Avant chaque envoi et nouvelle tentative, cette copie est recherchée et contrôlée. Une réception dont la réponse a été perdue n'entraîne pas un second envoi.
6. La copie reçue est publiée côté pCloud vers son nom final avec `copyfile(noover=1)`. Le nom et les identifiants de l'opération sont enregistrés dans le journal avant cette étape. Après vérification de la copie finale, son nouvel identifiant est enregistré avant le retrait de l'ancienne copie technique. Une interruption pendant la copie ou ce retrait se réconcilie à la reprise. La destination n'est jamais écrasée ; une réponse de copie perdue se résout par contrôle du nom exact enregistré. [Copie sans écrasement pCloud](https://docs.pcloud.com/methods/file/copyfile.html).
7. Un objet est marqué **vérifié** uniquement après comparaison de sa taille et de ses empreintes. En Europe, pCloud fournit SHA-256. Aux États-Unis, la page relit le téléchargement distant pour calculer SHA-256. **Relire aussi tous les octets distants** impose cette relecture même en Europe.
8. Un verrou Web Locks empêche deux onglets de cette application d'effectuer simultanément des opérations sur le même journal. Le compte pCloud et sa région sont liés à la destination.

Le dossier principal reste suivi par son `folderid`. Vous pouvez le renommer librement sur pCloud. L'interface conserve son nom initial à titre indicatif. Pendant la migration, ne déplacez pas les fichiers ou sous-dossiers techniques depuis un autre outil. La copie finale protège contre un nom déjà occupé, mais aucun verrou ne peut empêcher un autre client de modifier un fichier après son contrôle.

Les photos et vidéos reconnues sont regroupées directement dans le dossier choisi. Les noms ordinaires et accents sont conservés. Si un nom est déjà pris par un autre contenu, un suffixe stable contenant le SHA-256 complet distingue le fichier, par exemple `IMG_0001 [empreinte].jpg`. Les caractères interdits et les noms dépassant 1000 octets UTF-8 sont adaptés ; le manifeste conserve le chemin original exact. Les albums ne sont pas recréés comme fonctions pCloud. Les JSON restent conservés, à part, car ils peuvent contenir des dates et informations absentes des médias.

### Corriger un transfert commencé avec l'ancien rangement

1. Mettez le transfert en pause et sauvegardez le journal de reprise.
2. Rechargez le site avec **Ctrl + F5**, dans le même navigateur et le même profil. Fermez les autres anciens onglets de l'application.
3. Reconnectez le même compte pCloud si nécessaire.
4. Cliquez sur **Regrouper les fichiers déjà reçus**. Les copies connues sont regroupées côté pCloud, sans renvoi depuis les ZIP. Les JSON vont dans leur dossier séparé. L'opération peut être interrompue puis relancée.
5. S'il reste des fichiers à transférer, sélectionnez de nouveau leurs ZIP et reprenez le transfert. La reprise applique aussi le nouveau rangement aux copies déjà reçues.
6. Refaites le contrôle final et exportez un nouveau journal : les identifiants des fichiers finaux ont changé. Un ancien journal restauré doit réconcilier ces copies avant tout envoi, comme vérifié dans les tests.

Une copie et sa source technique peuvent coexister brièvement pendant la validation. Prévoyez au moins la place d'un fichier supplémentaire sur pCloud. Les anciennes copies techniques sont retirées après contrôle, mais leurs révisions ou éléments en corbeille suivent les règles de conservation pCloud ; l'application ne vide pas cette corbeille. Elle ne supprime jamais récursivement un dossier : seuls les dossiers techniques vides sont retirés. Un sous-dossier contenant un fichier ajouté manuellement reste en place.

Le regroupement ne retélécharge pas les ZIP et ne renvoie pas les médias, mais ses vérifications peuvent relire les fichiers distants, notamment pour SHA-256 aux États-Unis. Si vous devez revenir à l'ancien code, le journal et les fichiers restent lisibles ; conservez la sauvegarde d'avant regroupement et les ZIP. Cette sauvegarde peut être restaurée dans la version actuelle pour réconcilier les nouveaux identifiants sans recréer les anciennes copies.

## Disque, mémoire et gros volumes

Les ZIP choisis sont lus par tranches, sans charger une archive complète en mémoire ni l'extraire entièrement.

Pour envoyer un média, la page en prépare **un seul à la fois** dans l'espace disque privé du navigateur (OPFS). Le fichier temporaire est contrôlé contre l'inventaire avant envoi, puis supprimé de cet espace. Après un arrêt brutal, ce temporaire est nettoyé au début de l'opération suivante. Vos ZIP source ne sont jamais modifiés ni effacés.

Il faut donc la place des ZIP téléchargés, du journal, et du **plus gros fichier individuel**. Le quota disque accordé au site peut être inférieur à l'espace libre total de l'ordinateur. Une insuffisance de quota provoque un arrêt sûr, pas une validation du fichier.

Sans OPFS, le mode de secours garde un seul fichier en mémoire avec une limite de **128 Mo par fichier**. Utilisez Chrome ou Edge récent pour les grosses vidéos. Les métadonnées ZIP et le journal augmentent avec le nombre de fichiers ; aucune promesse de RAM strictement constante n'est faite.

Si toute la bibliothèque ne tient pas localement, traitez les parties une à une : choisissez une partie, analysez, transférez, vérifiez, puis sauvegardez le journal et libérez la place en déplaçant cette partie sur un disque de sauvegarde. Le journal garde les parties précédentes. Les données de date ajoutées par une partie ultérieure ne modifient pas rétroactivement la date d'un fichier déjà vérifié.

## Dates et métadonnées

- Aucun média n'est réencodé. EXIF, RAW et pistes vidéo présents dans l'export restent inchangés.
- Les JSON Takeout sont transférés comme les autres fichiers.
- Les JSON d'au plus 4 Mo contenant `photoTakenTime.timestamp` sont associés par répertoire et titre exacts. Une date univoque renseigne `ctime` et `mtime` pCloud au premier envoi.
- Noms tronqués, associations ambiguës et dates contradictoires ne sont pas devinés ; les JSON originaux restent disponibles. Une absence de date laisse la date d'envoi pCloud.
- Les corrections de dates faites uniquement dans Google Photos peuvent exister seulement dans les JSON. La page ne réécrit pas les EXIF.
- Albums, reconnaissance faciale, favoris et partages ne sont pas recréés comme fonctions pCloud. Live Photos, Motion Photos et autres fichiers sont conservés tels qu'exportés, sans recomposition.

## Vérifier l'arrivée de tous les fichiers

1. Cliquez sur **Vérifier les fichiers sur pCloud**. Activez la relecture de tous les octets pour un contrôle supplémentaire.
2. Exigez zéro fichier restant/en erreur et un contrôle terminé sans message d'échec.
3. Téléchargez le **bilan JSON**. Chaque archive doit être complète et avoir `unverified_entries: 0`.
4. Comparez la liste des archives avec **toutes les parties annoncées par Google Takeout**.
5. Téléchargez le **manifeste CSV**, qui associe chaque provenance à son SHA-256, sa taille, son statut et son `fileid` pCloud.
6. Ouvrez manuellement un échantillon de photos, RAW et vidéos reçus, puis conservez le journal de reprise exporté.

Les compteurs portent sur les fichiers uniques, y compris les JSON. Leur nombre n'est donc pas directement comparable au compteur de photos Google. Un bilan ne prouve que le transfert des ZIP fournis, jamais la complétude de ce que Google a choisi d'exporter.

## Nettoyer Google Photos après vérification

La section **Après le transfert : nettoyer Google Photos** propose un guide de suppression et une extension Chrome/Edge. L’API officielle ne propose aucune méthode pour supprimer les médias de la bibliothèque ; retirer un média d’un album ne le supprime pas du compte. L’extension automatise les clics dans Google Photos, séparément du site. [Référence officielle de l’API](https://developers.google.com/photos/library/reference/rest).

1. Cliquez sur **Contrôler intégralement avant nettoyage**. Chaque fichier distant est relu et comparé aux empreintes de l’export. Le contrôle doit réussir sans fichier restant ni erreur.
2. Téléchargez et conservez le **dossier de contrôle**, qui contient le journal de reprise et le bilan.
3. Indiquez le nombre total de parties annoncé par Google Takeout. Il doit correspondre au nombre de ZIP inventoriés.
4. Confirmez le périmètre de l’export, la conservation des copies, l’ouverture d’un échantillon sur pCloud et les effets sur les appareils synchronisés.
5. Ouvrez le guide puis Google Photos. Vérifiez le bon compte et supprimez manuellement les médias transférés, par lots, en tenant compte des éléments ajoutés depuis l’export.

Le contrôle expire après 24 heures. Une nouvelle analyse, un transfert, un nouveau contrôle ou une restauration du journal invalide l’autorisation précédente. Les confirmations doivent être refaites après rechargement de la page. Ce dispositif vérifie **les ZIP fournis**, pas la couverture de toute la photothèque Google : le nombre de parties reste une déclaration utilisateur.

Vérifiez vos copies avant de vider la corbeille. Une suppression peut se répercuter sur les appareils avec sauvegarde activée ; la suppression définitive est irréversible. Consultez les règles actuelles et la procédure dans [l’aide Google Photos](https://support.google.com/photos/answer/6128858?hl=fr&co=GENIE.Platform%3DDesktop).

## Extension de nettoyage Chrome/Edge

**Automatisation expérimentale, dépendante de l’interface Google en français ou anglais.** Les tests couvrent un simulateur d’interface ; aucune suppression dans un véritable compte Google n’a été effectuée pendant le développement. Commencez par le test sur un média et vérifiez vous-même sa présence dans la corbeille. Si Google change ses boutons, l’extension doit s’arrêter ; transmettez le message d’erreur, sans exporter vos cookies ni vos jetons.

### Installer une fois

1. Sur le site, téléchargez **l’extension Chrome/Edge**, puis décompressez le ZIP dans un dossier que vous conserverez.
2. Dans Chrome, ouvrez `chrome://extensions`. Dans Edge, ouvrez `edge://extensions`.
3. Activez **Mode développeur**.
4. Cliquez sur **Charger l’extension non empaquetée** et sélectionnez le dossier `passage-photos-extension` contenant `manifest.json`.
5. Épinglez **Passage Photos — nettoyage Google Photos** dans le menu des extensions du navigateur.

Pour passer à la version **1.1.0**, téléchargez à nouveau le ZIP depuis le site, remplacez les fichiers du dossier de l’extension déjà chargée, puis cliquez sur **Recharger** (flèche circulaire) sur sa fiche dans `chrome://extensions` ou `edge://extensions`. Actualisez ensuite l’onglet Google Photos pour retirer les anciennes commandes. Une extension chargée manuellement ne se met pas à jour toute seule.

Aucun serveur ni logiciel compagnon n’est requis. L’extension ne demande que `activeTab`, `scripting` et `storage`. L’accès à la page est accordé quand vous cliquez sur son icône ; elle ne s’installe pas toute seule depuis GitHub Pages, ne lit pas vos cookies et ne reçoit aucun jeton pCloud. Aucun script distant ni appel à une API privée Google n’est utilisé. [Permission activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).

### Placer les médias dans la corbeille

1. Sur Passage Photos, terminez le **contrôle intégral avant nettoyage**, puis téléchargez le **dossier de contrôle** JSON. Ce contrôle reste valable 24 heures ; refaites-le s’il a expiré.
2. Ouvrez [Google Photos](https://photos.google.com/) dans le bon compte. Choisissez la langue français ou anglais et la vue **Photos**, sans recherche ni album ouvert.
3. Cliquez sur l’icône de l’extension. Importez le dossier de contrôle JSON, saisissez l’adresse exacte du compte Google et confirmez la couverture de l’export et vos copies.
4. Cliquez sur **Ouvrir les commandes dans cet onglet**, puis **Examiner cette vue sans supprimer**. L’extension vérifie l’adresse affichée par Google ; si elle ne peut pas la lire, elle refuse de continuer.
5. Cliquez sur **Tester sur 1 média** et confirmez. Vérifiez le média dans la corbeille. Revenez à Photos, examinez à nouveau la vue, puis cliquez sur **Continuer par lots de 25** et confirmez.
6. Gardez cet onglet visible. L’extension sélectionne les médias chargés, confirme uniquement leur mise à la corbeille et attend la disparition des identifiants sélectionnés avant de poursuivre. Elle s’arrête sur un doute, un changement de compte, une confirmation inattendue ou une absence de progression. Une erreur après l’envoi ne provoque jamais une nouvelle confirmation destructive automatique.
7. Quand Photos est vide, ouvrez **Archive** dans Google Photos et répétez l’examen puis le traitement. Si Google recharge complètement la page, rouvrez l’extension et importez à nouveau le contrôle. Vérifiez séparément le **dossier verrouillé**, les éléments partagés et toute vue non prise en charge. Un arrêt faute de média reconnu ne signifie pas que tout le compte est vide.

**Arrêter** interrompt les prochains clics. Un ordre déjà envoyé à Google peut encore aboutir. Un clic, une touche ou un défilement manuel hors du panneau, ainsi que le masquage de l’onglet, arrête aussi le traitement. Vérifiez et annulez une sélection résiduelle avant de reprendre. Après une fermeture ou un rechargement, aucun traitement ne redémarre automatiquement ; les médias déjà à la corbeille ne figurent plus dans la vue source.

Le panneau permet de télécharger le journal des commandes. Le dernier traitement et ses 200 derniers événements sont aussi conservés dans le stockage local de l’extension ; les sessions anciennes ne sont pas toutes archivées automatiquement. Les événements listent des commandes et des confirmations d’interface, pas une preuve cryptographique de suppression Google.

### Vider définitivement la corbeille

Par défaut, cette action reste manuelle. La version 1.1.0 permet aussi d’autoriser son enchaînement à la fin des lots. Dans les deux cas, elle supprime aussi les éléments déjà présents avant la migration, qui peuvent ne pas être sauvegardés dans votre export.

**Pour enchaîner automatiquement après le dernier traitement :**

1. Après le test sur un média, vérifiez que vous avez traité Photos et prévu le traitement d’Archive. L’option concerne uniquement la vue en cours : elle ne traite pas Archive ni le dossier verrouillé à votre place. Activez-la pour votre **dernier traitement**.
2. Examinez la vue. Dépliez **Vider définitivement la corbeille**, puis cochez **Vider automatiquement la corbeille après cette vue**.
3. Cochez la confirmation concernant les anciens éléments et vos copies, puis saisissez `VIDER LA CORBEILLE`.
4. Cliquez sur **Continuer par lots de 25**. La confirmation de lancement nomme le compte et précise le vidage définitif de toute la corbeille. Une fois autorisé, aucun deuxième accord n’est demandé en fin de traitement.
5. L’extension attend que Google indique la vue vide, confirme cet état une seconde fois sans chargement visible, ouvre la corbeille via son lien Google et exécute le vidage. Le compte, la validité du contrôle et les confirmations Google restent vérifiés à chaque étape.

Un arrêt, une erreur, un compte différent, un contrôle expiré, un lien de corbeille absent ou une confirmation ambiguë empêche le vidage. L’autorisation est effacée à la fin de chaque opération et n’est jamais restaurée après un rechargement. Si la navigation Google recharge complètement la page, l’automatisation s’arrête : rouvrez les commandes pour vérifier le résultat. Gardez l’onglet visible jusqu’à l’indication de corbeille vide.

**Pour vider manuellement :**

1. Vérifiez vos copies et le contenu complet de la corbeille. Ouvrez la vue **Corbeille** de Google Photos, puis examinez-la avec le panneau de l’extension.
2. Dépliez **Vider définitivement la corbeille**. Cochez la confirmation des anciens éléments et saisissez exactement `VIDER LA CORBEILLE`.
3. Cliquez sur **Vider définitivement la corbeille** et confirmez l’action irréversible. L’extension contrôle à nouveau le compte, reconnaît la confirmation Google puis attend l’indication de corbeille vide. Si cette indication n’est pas reconnue, elle s’arrête sans nouvelle tentative ; vérifiez le résultat directement dans Google Photos.

Le dossier de contrôle est vérifié localement (inventaire, empreinte, compte pCloud, statuts et date). Ce n’est ni un certificat signé de Google, ni une nouvelle vérification distante de pCloud. Il ne permet pas d’associer avec certitude chaque identifiant Google à son fichier Takeout. L’extension supprime les médias de la vue choisie, y compris d’éventuels ajouts postérieurs à l’export : vous devez avoir inclus ceux-ci avant de lancer.

## Limites réseau et erreurs

- Les appels pCloud utilisent HTTPS et des requêtes POST. Aucun jeton n'est placé dans une URL d'API ni envoyé à GitHub. Aucun proxy tiers n'est utilisé.
- Les API US et Europe répondent aux requêtes inter-origines testées. La disponibilité des téléchargements signés pour une relecture dépend aussi des règles CORS des serveurs de téléchargement pCloud. Si cette relecture est bloquée, la page indique un échec et **ne déclare pas le fichier vérifié**.
- Les erreurs transitoires ont six tentatives avec attente exponentielle et respect de `Retry-After` jusqu'à une heure. Un envoi ambigu est réconcilié avant sa nouvelle tentative. Les coupures durables, quotas saturés, jetons refusés et conflits sont visibles dans le journal.
- Une application navigateur ne peut pas renouveler un droit OAuth révoqué. Reconnectez pCloud pour reprendre.
- `Lancer le transfert` ignore les fichiers déjà vérifiés. Utilisez le contrôle final pour détecter une suppression ou corruption distante ultérieure.
- Pas de pCloud Crypto, pas de synchronisation continue et pas de récupération de corbeille Google. Le transfert ne supprime aucune source ; l’extension de nettoyage distincte exige une activation et des confirmations.
- La navigation privée, l'effacement des données du site et le changement de profil peuvent faire perdre le journal local. Conservez son export.
- Aucune garantie contre la perte d'un compte ou une panne de stockage : gardez plusieurs copies jusqu'à la validation finale.

À 10 Mbit/s d'envoi, 1 To décimal nécessite environ **9,3 jours** de transmission seule ; à 100 Mbit/s, environ **22,2 heures**. Ajoutez le téléchargement Takeout, la préparation locale, la latence des appels, les reprises et les relectures distantes. Un volume de dizaines de milliers de petits fichiers peut être surtout limité par la latence et le nombre d'appels pCloud. Les 2 To du compte doivent être effectivement libres ; aucun quota d'appels fixe n'est supposé.

## Code et validation

```text
docs/index.html              Interface GitHub Pages
docs/app.js                  Actions utilisateur, états, exports
docs/browser-auth.js         OAuth pCloud navigateur, sans Client Secret
docs/browser-state.js        IndexedDB, sauvegarde et restauration
docs/browser-engine.js       ZIP, empreintes, OPFS et reprise
docs/browser-layout.js       Rangement direct, noms en conflit et reprise du regroupement
docs/browser-pcloud.js       API pCloud, nouvelles tentatives et vérification
docs/vendor/                 zip.js et noble-hashes, versions figées, licences incluses
extension/                   Extension MV3 : contrôle du bilan et commandes Google Photos
scripts/package-extension.py Construction du ZIP installable publié sur Pages
scripts/build-vendor.mjs     Construction reproductible du module distribué
tests/browser-engine.test.mjs Tests de la migration navigateur et de son journal
```

Pour le développement uniquement :

```sh
npm ci
npm test
npm run build:vendor
python scripts/package-extension.py
```

Les bibliothèques sont embarquées avec le site, pas chargées depuis un CDN externe. Le workflow exécute les tests, reconstruit le module et vérifie qu'il correspond à celui versionné avant publication Pages.

Les tests de l’extension valident le dossier de contrôle produit par le vrai moteur, les refus de dossiers altérés/expirés et le parcours de commandes dans un monde JavaScript isolé de Chrome, avec une interface Google simulée et toutes les requêtes interceptées. `playwright-core` est une dépendance de développement uniquement. Ce test d’interface utilise Chrome/Chromium installé (`CHROME_PATH` permet de préciser son exécutable) ; il est signalé comme ignoré si aucun navigateur n’est disponible. Il ne valide pas la compatibilité avec un véritable compte Google ni le chargement manuel de l’extension depuis le gestionnaire Chrome.

Les tests du moteur utilisent IndexedDB simulé, de vrais ZIP et un simulateur pCloud : perte de réponse, reprise sans source après réception, contrôle des empreintes, corruption CRC, homonymes, dates, compte incorrect, restauration et absence de jetons dans le journal exporté. Les contrôles navigateur utilisent le vrai IndexedDB et l'OPFS de Chrome, avec pCloud simulé pour les écritures. Les appels CORS pCloud sans authentification sont également vérifiés. **Aucun transfert vers un compte pCloud réel n'a été validé ici faute d'accès utilisateur.** Commencez par une petite partie Takeout.

L'ancien outil Python reste disponible séparément dans [son guide CLI](README-python.md). Il n'est pas nécessaire pour le site.
## Script console Google Photos

La section **Nettoyer Google Photos avec le script console** propose le nouveau
script fourni par l’utilisateur, dans `docs/google-photos-corbeille.txt`.
Il utilise les cases `role="checkbox"`, avec des lots de 1 000 au départ.
Le fichier téléchargeable est l’original : **SUPPRIMER = false**, sélection seule.

1. Ouvrez Google Photos depuis le site et vérifiez le bon compte.
2. Copiez le script en mode test. Dans Google Photos : F12 → Console. Si Chrome
   bloque le collage, relisez le script puis tapez manuellement `allow pasting`
   et Entrée. Collez le script, puis Entrée pour démarrer.
3. Le test sélectionne jusqu’à 1 000 cases puis s’arrête sans supprimer. Vérifiez
   le nombre affiché par Google et le message « Bouton corbeille trouvé ».
4. Pour envoyer les médias à la corbeille, rechargez Google Photos afin d’annuler
   la sélection du test. Dans Passage Photos, cochez **Activer la mise à la
   corbeille**, puis copiez et lancez à nouveau le script. Cette option change
   uniquement `const SUPPRIMER = false;` en `const SUPPRIMER = true;`.
   Elle est décochée à chaque rechargement du site.

En mode suppression, le script enchaîne les lots et réduit leur taille si la
confirmation échoue. Pour arrêter, rechargez Google Photos ; une action déjà
transmise peut encore aboutir. Ne lancez pas plusieurs copies simultanément.
Le script ne vide pas la corbeille. Les Archives, le dossier verrouillé et les
éléments seulement partagés ne sont pas traités séparément. Les compteurs
mesurent les clics, pas une preuve de suppression ni une couverture exhaustive.

Ce mode est indépendant de l’audit pCloud et ne vérifie aucune sauvegarde. La
connexion reste chez Google ; aucun accès Google ni jeton OAuth n’est transmis
au site. Le site fournit du texte et ne peut pas l’exécuter dans un autre onglet.
Avant le vidage définitif de toute la corbeille, vérifiez vos copies, les anciens
éléments et l’effet sur les appareils synchronisés.
