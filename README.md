# Passage Photos — Google Takeout vers pCloud, dans le navigateur

**[Ouvrir l'application sur GitHub Pages](https://dev75008.github.io/empty_gphotos/)**

Aucune installation, aucun Python, aucun compagnon local pour la version web. La page lit les ZIP que vous choisissez, puis envoie leurs fichiers directement à pCloud. GitHub héberge le code de la page ; il ne reçoit pas vos photos, vos vidéos ni votre jeton pCloud.

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

Le journal du navigateur et le SQLite de l'ancienne version Python sont indépendants. Le navigateur n'importe pas les fichiers SQLite. La structure distante des contenus reste compatible : un fichier déjà présent dans le même dossier déterministe est vérifié avant tout nouvel envoi.

## Fiabilité et absence de doublons

1. Chaque entrée du ZIP est lue en flux, contrôlée par **CRC**, puis identifiée par **SHA-256, SHA-1 et taille**. Les ZIP64 sont pris en charge par zip.js ; pas les ensembles de volumes `.z01`/`.zip.001` ni les ZIP chiffrés.
2. L'objet et sa provenance sont enregistrés ensemble dans une transaction IndexedDB à durabilité stricte. Une archive interrompue reste incomplète et bloque le transfert jusqu'à la fin de son analyse.
3. Des octets identiques, y compris les copies d'albums, partagent un seul objet. Les provenances et noms originaux restent dans le manifeste.
4. Un sous-dossier déterministe utilise le SHA-256 complet :

   ```text
   Dossier choisi/Fichiers/ab/ab...SHA256 complet.../IMG_0001.jpg
   ```

5. Avant chaque envoi et chaque tentative, le programme inspecte ce sous-dossier. S'il contient le fichier attendu, son contenu est contrôlé puis validé. Un contenu différent provoque une erreur sans écrasement volontaire.
6. L'envoi utilise `nopartial=1` et le même nom déterministe, sans création automatique de noms `photo (2).jpg`. La présence distante est réconciliée après une réponse perdue.
7. Un objet est marqué **vérifié** uniquement après comparaison de sa taille et de ses empreintes. En Europe, pCloud fournit SHA-256. Aux États-Unis, la page relit le téléchargement distant pour calculer SHA-256. **Relire aussi tous les octets distants** impose cette relecture même en Europe.
8. Un verrou Web Locks empêche deux onglets de cette application d'effectuer simultanément des opérations sur le même journal. Le compte pCloud et sa région sont liés à la destination.

Le dossier principal reste suivi par son `folderid`. Vous pouvez le renommer librement sur pCloud. L'interface conserve son nom initial à titre indicatif. Ne supprimez ni ne réorganisez les sous-dossiers techniques pendant la migration. Évitez d'écrire dans cette destination depuis un autre outil pendant les envois : pCloud ne fournit pas ici de verrou distribué ni d'écriture conditionnelle.

Cette structure crée beaucoup de sous-dossiers et ne reproduit pas les albums comme fonctionnalités pCloud. C'est le compromis qui conserve les homonymes tout en rendant les envois idempotents. Les noms ordinaires et accents sont conservés ; caractères interdits et noms dépassant 1000 octets UTF-8 sont adaptés. Le manifeste conserve le chemin original exact.

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

## Limites réseau et erreurs

- Les appels pCloud utilisent HTTPS et des requêtes POST. Aucun jeton n'est placé dans une URL d'API ni envoyé à GitHub. Aucun proxy tiers n'est utilisé.
- Les API US et Europe répondent aux requêtes inter-origines testées. La disponibilité des téléchargements signés pour une relecture dépend aussi des règles CORS des serveurs de téléchargement pCloud. Si cette relecture est bloquée, la page indique un échec et **ne déclare pas le fichier vérifié**.
- Les erreurs transitoires ont six tentatives avec attente exponentielle et respect de `Retry-After` jusqu'à une heure. Un envoi ambigu est réconcilié avant sa nouvelle tentative. Les coupures durables, quotas saturés, jetons refusés et conflits sont visibles dans le journal.
- Une application navigateur ne peut pas renouveler un droit OAuth révoqué. Reconnectez pCloud pour reprendre.
- `Lancer le transfert` ignore les fichiers déjà vérifiés. Utilisez le contrôle final pour détecter une suppression ou corruption distante ultérieure.
- Pas de pCloud Crypto, pas de synchronisation continue, pas de récupération de corbeille Google et aucune suppression automatique de vos sources.
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
docs/browser-pcloud.js       API pCloud, nouvelles tentatives et vérification
docs/vendor/                 zip.js et noble-hashes, versions figées, licences incluses
scripts/build-vendor.mjs     Construction reproductible du module distribué
tests/browser-engine.test.mjs Tests de la migration navigateur et de son journal
```

Pour le développement uniquement :

```sh
npm ci
npm test
npm run build:vendor
```

Les bibliothèques sont embarquées avec le site, pas chargées depuis un CDN externe. Le workflow exécute les tests, reconstruit le module et vérifie qu'il correspond à celui versionné avant publication Pages.

Les tests du moteur utilisent IndexedDB simulé, de vrais ZIP et un simulateur pCloud : perte de réponse, reprise sans source après réception, contrôle des empreintes, corruption CRC, homonymes, dates, compte incorrect, restauration et absence de jetons dans le journal exporté. Les contrôles navigateur utilisent le vrai IndexedDB et l'OPFS de Chrome, avec pCloud simulé pour les écritures. Les appels CORS pCloud sans authentification sont également vérifiés. **Aucun transfert vers un compte pCloud réel n'a été validé ici faute d'accès utilisateur.** Commencez par une petite partie Takeout.

L'ancien outil Python reste disponible séparément dans [son guide CLI](README-python.md). Il n'est pas nécessaire pour le site.
