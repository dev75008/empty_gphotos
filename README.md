# Google Photos vers pCloud : migration Takeout fiable

## Lancer l'interface web

L'interface est publiée sur **[Passage Photos](https://dev75008.github.io/empty_gphotos/)**.

1. Sur le site, cliquez sur **Télécharger l'application**, puis décompressez le ZIP dans un dossier permanent.
2. Installez **Python 3.11 ou supérieur** si nécessaire, avec l'option d'ajout au PATH.
3. Double-cliquez sur **`Lancer-interface.cmd`**. Au premier lancement, il prépare l'environnement Python et installe les deux dépendances. Le site s'ouvre ensuite relié à votre ordinateur. Gardez la fenêtre du compagnon ouverte.
4. Dans **Connecter pCloud**, ouvrez **Configurer mon application pCloud**. Créez votre application dans le portail pCloud, ajoutez l'URI affichée, puis saisissez et enregistrez Client ID et Client Secret. Ils sont enregistrés uniquement dans votre `config.json` local.
5. Cliquez sur **Connecter mon compte pCloud** et autorisez l'accès dans le navigateur.
6. Téléchargez vos ZIP depuis Google Takeout, puis cliquez sur **Choisir les ZIP** et **Analyser les archives**. Le bouton ouvre le sélecteur de fichiers de votre ordinateur. La saisie d'un chemin de dossier reste disponible si ce sélecteur ne fonctionne pas.
7. Choisissez le nom du dossier pCloud et cliquez sur **Lancer le transfert**. Le nom est enregistré au lancement ; les fichiers vérifiés ne sont pas renvoyés à la reprise.
8. Utilisez **Mettre en pause**, puis **Reprendre le transfert** si besoin. À la fin, cliquez sur **Vérifier les fichiers sur pCloud**, téléchargez le manifeste et le bilan, puis comparez les parties reçues à la liste Takeout.

**GitHub Pages héberge uniquement l'interface.** Le compagnon Python écoute sur `127.0.0.1:8766`, lit les ZIP et envoie les médias directement à pCloud. Ni les photos, ni `config.json`, ni le journal de reprise ne sont envoyés à GitHub. Les communications avec le compagnon nécessitent une clé de session aléatoire et une origine autorisée. Cette clé est renouvelée à chaque lancement, transmise dans le fragment de l'URL (non envoyé à GitHub), puis retirée de la barre d'adresse. Elle est gardée dans la session de l'onglet pour permettre le rechargement de la page.

Si Chrome ou Edge demande l'accès au réseau local, autorisez-le pour cette interface. Si votre navigateur bloque la liaison depuis GitHub Pages, utilisez **`Lancer-interface-locale.cmd`** : il ouvre exactement la même interface, servie entièrement sur votre ordinateur. Ne désactivez pas les protections du navigateur. La vue mobile permet de consulter le site, mais le compagnon et les ZIP doivent être sur le même ordinateur que le navigateur qui pilote la migration.

Après fermeture du navigateur, le transfert continue tant que le compagnon reste ouvert. Fermer le compagnon interrompt l'opération en cours ; les transactions déjà validées sont conservées. Relancez le même fichier `.cmd` dans le même dossier pour reprendre. Une pause coupe l'envoi du fichier en cours ; la reprise le réconcilie avec pCloud et, s'il n'est pas arrivé en entier, le renvoie depuis le début.

Si le dossier principal est renommé sur pCloud, la destination conserve son identifiant. L'interface affiche le nom initial du journal et indique que le renommage se fait directement dans pCloud.

Pour lancer depuis un terminal, ou réutiliser un journal situé ailleurs :

```powershell
.\.venv\Scripts\python.exe -m photos_pcloud web
# Interface entièrement locale, sans liaison entre origines :
.\.venv\Scripts\python.exe -m photos_pcloud web --local
# Avec un journal existant :
.\.venv\Scripts\python.exe -m photos_pcloud --state "C:\Prive\migration.sqlite3" web
```

Le moteur CLI reste utilisable avec les commandes ci-dessous. Les deux interfaces utilisent le même SQLite. Ne lancez pas simultanément une opération CLI et une opération web sur le même journal.

## Application et garanties

Application Python en ligne de commande, conçue pour une photothèque plus grande que le disque local. Elle lit les fichiers directement dans des ZIP Google Takeout et les envoie à pCloud. Elle n'efface aucun fichier source ni distant.

## Pourquoi Takeout, et pas une connexion Google Photos OAuth ?

Documentation officielle consultée le **20 octobre 2026** :

- Depuis le 31 mars 2025, Google Photos Library API limite la lecture aux contenus créés par l'application. Les anciennes portées `photoslibrary.readonly`, `photoslibrary` et `photoslibrary.sharing` ont été supprimées. Créer un nouveau projet Google Cloud ne permet donc pas de lire votre photothèque existante. [Changements Google](https://developers.google.com/photos/support/updates), [notes de version](https://developers.google.com/photos/support/release-notes).
- Picker API donne accès aux éléments que vous sélectionnez explicitement. Elle ne fournit pas l'énumération automatique de tout le compte. Les téléchargements de vidéos utilisent une version transcodée de haute qualité ; les images téléchargées via les URL d'API ne conservent pas toutes les métadonnées, notamment la localisation. Ces caractéristiques ne conviennent pas à une sauvegarde exhaustive des originaux. [Picker et téléchargements](https://developers.google.com/photos/picker/guides/media-items), [paramètres des téléchargements](https://developers.google.com/photos/library/guides/access-media-items).
- **Takeout est la voie implémentée.** L'application conserve exactement les octets exportés, sans recompression ni conversion. Une image déjà compressée par « Économiseur de stockage » ne retrouve pas son original antérieur. [Export des données Google](https://support.google.com/accounts/answer/3024190?hl=fr).

**Aucun projet Google Cloud, identifiant OAuth Google, activation de facturation ou secret Google n'est nécessaire.** Vous vous connectez à Google dans votre navigateur pour demander et télécharger Takeout. Une connexion Google OAuth dans cette application promettrait un accès qu'elle ne peut pas obtenir.

## Ce qui assure la reprise

1. `scan` lit entièrement chaque entrée ZIP. Python vérifie son CRC ; l'application calcule SHA-256, SHA-1 et la taille. Chaque entrée est enregistrée dans SQLite avant de passer à la suivante.
2. Les fichiers dont les octets sont identiques partagent un seul objet distant, même s'ils apparaissent dans plusieurs albums Takeout. Toutes les provenances restent dans le manifeste CSV.
3. Chaque objet dispose d'un sous-dossier déterministe nommé par son SHA-256 complet. Le nom du fichier reste celui de la première occurrence rencontrée. Deux fichiers différents appelés `IMG_0001.jpg` occupent deux sous-dossiers différents.
4. Avant tout envoi ou nouvel essai, l'application inspecte le sous-dossier. Si le fichier est déjà arrivé, elle vérifie son contenu et reprend sans le renvoyer. Cela couvre une réponse perdue et un arrêt entre l'envoi et l'enregistrement local.
5. `nopartial=1` demande à pCloud de ne pas conserver un envoi incomplet. L'envoi vise toujours le même nom ; aucun renommage automatique en `photo (2).jpg` n'est demandé. Un contenu distant inattendu provoque une erreur, jamais un écrasement volontaire.
6. Un fichier devient `verified` seulement après contrôle de sa taille et de ses empreintes distantes. En Europe, pCloud fournit SHA-256. Aux États-Unis, le programme relit le fichier distant en flux pour calculer SHA-256, car pCloud n'y fournit que SHA-1/MD5.
7. Le compte, la région et l'identifiant du dossier destination sont liés au journal. Vous pouvez **renommer le dossier principal sur pCloud** : la reprise utilise son identifiant, pas son chemin.

Les appels API de lecture ont des tentatives automatiques. Un upload interrompu rouvre son entrée ZIP et commence par une réconciliation distante. Les délais augmentent, avec un aléa, et respectent `Retry-After` jusqu'à une heure. Une panne persistante arrête le programme avec un code non nul pour éviter de répéter la panne sur tous les fichiers.

La structure pCloud est volontairement orientée fiabilité :

```text
Nom choisi/
  Fichiers/
    ab/
      ab...SHA256 complet sur 64 caractères.../
        IMG_0001.jpg
```

Cela crée beaucoup de sous-dossiers et ne reproduit pas les albums dans l'interface pCloud. Le manifeste conserve les chemins d'albums Takeout. C'est le compromis retenu pour garder les noms, dédupliquer les copies d'albums et rendre les envois idempotents. Les JSON et autres fichiers exportés utilisent le même rangement ; aucun type de fichier n'est silencieusement ignoré.

## Installation sous Windows

1. Installez Python **3.11 ou supérieur** depuis [python.org](https://www.python.org/downloads/). Cochez l'ajout de Python au PATH. Le développement et les tests locaux ont utilisé Python 3.14 sous Windows.
2. Copiez tout ce dossier, y compris `photos_pcloud`, `requirements.txt` et `config.example.json`, dans un emplacement permanent.
3. Ouvrez PowerShell dans ce dossier. Exécutez :

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item config.example.json config.json
```

Les exemples appellent Python directement dans l'environnement : aucune modification de la politique d'exécution PowerShell n'est nécessaire.

Sous Linux/macOS, utilisez `python3 -m venv .venv`, puis `.venv/bin/python` à la place de `.\.venv\Scripts\python.exe`. Le verrouillage POSIX est implémenté, mais ces systèmes n'ont pas été testés ici.

## Créer l'application pCloud et se connecter

1. Connectez-vous à votre compte dans [pCloud Developers / My Apps](https://docs.pcloud.com/my_apps/).
2. Créez une application personnelle. Donnez-lui un nom, par exemple `Migration Takeout personnelle`, et renseignez les informations demandées par le portail.
3. Dans les URI de redirection autorisées de cette application, ajoutez exactement :

```text
http://127.0.0.1:8765/callback
```

4. Copiez le **Client ID / App Key** et le **Client Secret** dans `config.json`. Conservez le reste :

```json
{
  "client_id": "votre identifiant",
  "client_secret": "votre secret",
  "redirect_uri": "http://127.0.0.1:8765/callback",
  "hostname": "eapi.pcloud.com",
  "access_token": "",
  "attempts": 6
}
```

5. Lancez :

```powershell
.\.venv\Scripts\python.exe -m photos_pcloud auth
```

6. Votre navigateur ouvre pCloud. Connectez-vous et autorisez votre application. Revenez au terminal après la redirection locale. L'application enregistre le jeton dans `config.json` et vérifie le compte avec `userinfo`.

Le serveur de callback écoute exclusivement sur `127.0.0.1`, pendant cinq minutes. Le paramètre OAuth `state` est vérifié. Le serveur API US ou Europe est obtenu du callback et contrôlé contre une liste fermée. Il n'y a aucun mot de passe pCloud à renseigner dans le programme.

Si le port est occupé, choisissez un autre port dans **les deux endroits** : portail pCloud et `config.json`. Si le portail refuse une URI locale HTTP pour votre type d'application, ne la remplacez pas par un site tiers : vérifiez les réglages de l'application auprès de pCloud. Ce flux dépend de l'acceptation de cette URI par leur portail.

Le flux pCloud documenté ne fournit pas de `refresh_token`. Si le jeton est révoqué, invalide ou expiré, le programme s'arrête : relancez `auth`, puis `run` avec le même journal. Il ne peut pas renouveler automatiquement un droit supprimé. [Autorisation OAuth](https://docs.pcloud.com/methods/oauth_2.0/authorize.html), [échange du code](https://docs.pcloud.com/methods/oauth_2.0/oauth2_token.html).

### Protéger les secrets

`config.json` contient le secret d'application et le jeton d'accès. Il est séparé du code et exclu de Git. Ne le partagez jamais. Il n'est pas chiffré par l'application. Utilisez un compte Windows personnel et BitLocker si disponible.

Vous pouvez limiter les droits NTFS après avoir créé le fichier :

```powershell
$migrationIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls .\config.json /inheritance:r /grant:r "${migrationIdentity}:(F)"
```

La sauvegarde OAuth remplace le fichier atomiquement. Pour que les remplacements héritent également de droits restreints, conservez toute l'application dans un dossier personnel auquel les autres comptes n'ont pas accès. Sous POSIX, le fichier écrit par `auth` reçoit le mode `0600`.

Le journal et les rapports contiennent des noms, des dates, des identifiants pCloud et des empreintes : ce sont aussi des données personnelles.

## Demander Google Takeout

1. Ouvrez [Google Takeout](https://takeout.google.com/) et connectez-vous au compte Google concerné.
2. Cliquez sur **Tout désélectionner**, puis cochez uniquement **Google Photos**.
3. Ouvrez le choix des albums et vérifiez que toutes les années et tous les albums souhaités sont inclus. Vérifiez séparément les éléments partagés et les éléments du dossier verrouillé selon les possibilités actuelles de votre compte. Un élément seulement partagé, non enregistré dans votre bibliothèque, n'est pas une garantie d'export.
4. Choisissez **Exporter une fois**, la livraison par lien de téléchargement et le format **ZIP**. N'utilisez pas TGZ avec ce programme.
5. Choisissez des parties de **2 Go** ou **4 Go** si le disque est petit. Les parties sont des ZIP indépendants ; ce programme ne traite pas les archives multi-volumes `.z01`/`.zip.001`.
6. Créez l'export. Sa préparation peut prendre des heures ou des jours.
7. Sur la page de téléchargement Google, notez le **nombre total de parties** et leur nom. Ce relevé permet de détecter une partie oubliée.
8. Téléchargez les ZIP dans un dossier, par exemple `D:\Takeout`. Attendez la fin du téléchargement avant `scan`. **Ne les décompressez pas et ne les modifiez pas.**

Les liens Takeout expirent généralement après environ sept jours ; chaque archive n'est téléchargeable qu'un nombre limité de fois, indiqué par Google comme cinq. Organisez le téléchargement en conséquence. L'application n'automatise pas la connexion Google ni le téléchargement de ces liens authentifiés. [Aide Google](https://support.google.com/accounts/answer/3024190?hl=fr).

## Inventorier, transférer, reprendre

### Si tous les ZIP tiennent sur le disque

```powershell
# Lecture complète et contrôle des ZIP. Aucun accès à pCloud.
.\.venv\Scripts\python.exe -m photos_pcloud scan "D:\Takeout"

# Saisissez le nom du dossier à l'invite.
.\.venv\Scripts\python.exe -m photos_pcloud run

# Ou fournissez le nom initial explicitement.
# .\.venv\Scripts\python.exe -m photos_pcloud run --folder "Ma phototheque"
```

Le programme affiche chaque fichier en cours et sa taille, la progression en octets pour les gros fichiers, puis les compteurs globaux tous les 25 objets. Le résumé final distingue les objets vérifiés, restants et en erreur. Les compteurs incluent les JSON et autres fichiers, et excluent les copies dédupliquées.

Interrompez avec `Ctrl+C`. Pour reprendre :

```powershell
.\.venv\Scripts\python.exe -m photos_pcloud run
```

Les objets déjà vérifiés ne sont ni relus dans les ZIP ni renvoyés. **Gardez le même `migration.sqlite3`.** Une coupure électrique ne supprime pas les transactions SQLite déjà validées ; l'envoi en cours est réconcilié à la reprise.

Après avoir renommé le dossier principal dans pCloud, relancez `run` sans `--folder`. Le nom initial n'est plus utilisé pour localiser la destination. Ne supprimez pas ce dossier et ne réorganisez pas ses sous-dossiers techniques pendant la migration. Le programme ne fait pas de suppression distante.

### Si un seul ZIP tient sur le disque

Pour chaque partie, en gardant **le même journal et la même configuration** :

```powershell
.\.venv\Scripts\python.exe -m photos_pcloud scan "D:\Takeout\takeout-001.zip"
.\.venv\Scripts\python.exe -m photos_pcloud run
.\.venv\Scripts\python.exe -m photos_pcloud verify
```

Consultez `reports/summary.json`. Pour cette archive, `complete` doit valoir `1` et `unverified_entries` doit valoir `0`. Les commandes `run` et `verify` doivent terminer avec le code `0` (`$LASTEXITCODE` sous PowerShell).

Vous pouvez alors déplacer ce ZIP sur un disque de sauvegarde pour libérer la place locale, puis télécharger la partie suivante. **N'effacez pas votre seule copie exportée avant d'avoir une autre sauvegarde ou d'avoir accepté de dépendre de Google et pCloud.** Le programme n'efface rien automatiquement. Il conserve l'inventaire des parties précédentes même si leur ZIP est absent.

L'espace supplémentaire utilisé pour les médias transférés est nul : lecture ZIP, envoi et éventuelle relecture pCloud se font en flux. Il faut néanmoins la place du ZIP téléchargé, du journal SQLite, de ses fichiers WAL et des rapports. La RAM contient les tables ZIP et quelques tampons ; elle n'est pas strictement constante avec le nombre d'entrées, mais aucun média complet n'y est chargé.

Les JSON d'une partie suivante peuvent compléter les dates des médias **pas encore transférés**. Le programme ne renvoie pas un média déjà vérifié pour modifier sa date pCloud. Pour maximiser la restitution des dates, inventoriez toutes les parties avant `run` si vous disposez d'un disque externe suffisant.

### Emplacements personnalisés

Les options globales se placent **avant** la commande :

```powershell
.\.venv\Scripts\python.exe -m photos_pcloud --config "C:\Prive\config.json" --state "C:\Prive\migration.sqlite3" --reports "C:\Prive\rapports" run
```

Utilisez ensuite ces mêmes options pour toutes les commandes. Les chemins par défaut sont relatifs au dossier courant. Ne lancez pas deux migrations vers la même destination avec des journaux différents. Le verrou empêche deux processus d'utiliser le même journal ; il ne fournit pas de verrou distribué entre plusieurs ordinateurs.

## Dates, noms et métadonnées

- Les octets des photos et vidéos restent inchangés : EXIF, contenu RAW et pistes vidéo présents dans l'export sont conservés.
- Si un JSON Takeout contient `photoTakenTime.timestamp`, le programme associe la date par **répertoire et titre exacts**, y compris entre parties ZIP. Il renseigne les dates de création et modification pCloud lors du premier envoi. [Paramètres pCloud `ctime`/`mtime`](https://docs.pcloud.com/methods/file/uploadfile.html).
- Les noms tronqués ou divergents et les dates contradictoires ne sont pas devinés. Sans correspondance certaine, la date pCloud reste celle de l'envoi. `media_without_date` dans le résumé signale les médias sans date associée. Les métadonnées source restent dans les JSON transférés.
- Les JSON de plus de 4 Mio sont transférés, mais ne sont pas analysés pour les dates.
- Un changement de date fait uniquement dans Google Photos peut n'exister que dans le JSON ; l'application ne réécrit pas l'EXIF, afin de préserver les octets originaux exportés.
- En cas de déduplication, le premier nom est conservé. Les autres noms et appartenances d'albums restent dans `manifest.csv`.
- Les noms ordinaires, accents et extensions sont conservés. Les caractères de contrôle, barres obliques inverses et noms dépassant 1000 octets UTF-8 sont échappés ou raccourcis. Le nom exact exporté reste dans la colonne `member`.
- Favoris, reconnaissance faciale, commentaires, partages et albums Google ne sont pas recréés comme fonctions pCloud. Leurs informations sont conservées uniquement si Takeout les exporte dans les fichiers associés. Live Photos, Motion Photos et montages sont transférés tels qu'exportés ; aucune recomposition n'est tentée.

## Vérifier la migration

```powershell
# Vérification distante de chaque objet : taille, SHA-1 et SHA-256.
.\.venv\Scripts\python.exe -m photos_pcloud verify

# Preuve supplémentaire : relire tous les octets distants, même en Europe.
.\.venv\Scripts\python.exe -m photos_pcloud verify --deep

# Résumé local et régénération des rapports, sans réseau.
.\.venv\Scripts\python.exe -m photos_pcloud status
```

`verify --deep` lit les téléchargements distants en mémoire par blocs. Il n'écrit pas de copie locale. Aux États-Unis, cette relecture SHA-256 est déjà nécessaire pour `verify` et après chaque premier envoi. [Empreintes fournies par pCloud](https://docs.pcloud.com/methods/file/checksumfile.html).

Contrôle final :

1. Comparez les parties dans `summary.json` avec la liste de téléchargement Takeout. Toutes doivent avoir été inventoriées ; aucune ne doit rester à `complete: 0`.
2. Exigez `unverified_entries: 0` pour chaque partie, aucun objet `pending`, `uploading` ou `error`, et un code de sortie `0` pour le dernier `verify`.
3. Ouvrez `manifest.csv` : une ligne correspond à chaque fichier source exporté ; les copies identiques partagent SHA-256 et `fileid`. Les colonnes donnent taille, dates associées, statut, identifiants distants et dernier contrôle réussi.
4. Téléchargez et ouvrez manuellement quelques photos, RAW, longues vidéos et éléments anciens/récents depuis pCloud. Vérifiez aussi les dates et noms d'un échantillon.
5. Gardez le journal et les rapports. Sauvegardez le journal lorsque le programme est arrêté. Si vous le copiez pendant un transfert, il faut aussi une sauvegarde SQLite cohérente de son WAL ; ne copiez pas seulement le fichier principal.

Les rapports prouvent le transfert des **fichiers fournis**. Ils ne peuvent pas prouver que Google a exporté tous les éléments du compte. Un export est un instantané : les ajouts ultérieurs et certaines modifications pendant sa préparation peuvent manquer. Le nombre d'objets pCloud peut être inférieur aux entrées Takeout, à cause de la déduplication, ou supérieur au compteur de photos Google à cause des JSON et fichiers associés.

Codes de sortie : `0` succès de la commande, `2` échec ou migration incomplète, `130` interruption utilisateur. `status` réussit même s'il décrit une migration incomplète : utilisez `verify` pour le contrôle final.

## Erreurs et récupération

| Situation | Comportement / action |
|---|---|
| Réseau, HTTP 429/5xx, erreur serveur transitoire | Tentatives bornées avec attente. Après arrêt, relancez `run`. |
| Jeton refusé | `auth`, puis `run`, sans changer de journal. |
| Espace pCloud insuffisant | Libérez de l'espace ou augmentez la capacité, puis reprenez. Les 2 To annoncés ne sont pas forcément tous libres. |
| ZIP absent pour un objet restant | Remettez-le à disposition et lancez `scan` sur son nouveau chemin, puis `run`. |
| ZIP déplacé | `scan` retrouve son identifiant par l'inventaire interne et actualise le chemin sans réinitialiser les succès. |
| ZIP corrompu / lecture incomplète | Archive marquée incomplète, transfert bloqué. Retéléchargez la même partie, puis relancez `scan`. |
| Fichier distant manquant | `verify` le signale. `run` le renvoie si son sous-dossier existe et si une source est disponible. |
| Empreinte distante incorrecte / contenu inattendu | Aucun écrasement automatique. Inspectez et sauvegardez le contenu en conflit. Déplacez le fichier en conflit hors de son sous-dossier, puis reprenez avec le ZIP source disponible. |
| Sous-dossier technique supprimé | Arrêt sûr. Restaurez le sous-dossier dans la corbeille pCloud avec son identifiant, si possible. Le programme ne réaffecte pas silencieusement les identifiants. |
| Journal perdu | Restaurez sa sauvegarde. Sans journal, le lien avec un dossier principal renommé est perdu. Ne démarrez pas aveuglément une nouvelle migration dans un autre dossier. |

Les objets restent marqués `verified` jusqu'à une vérification explicite ; `run` ne réaudite pas tous les fichiers déjà transférés. Lancez donc `verify` à la fin et après toute manipulation distante suspecte. La colonne `checked` conserve la date du dernier succès ; elle n'est pas une preuve de succès du dernier contrôle si le statut est `error`.

## Limites, quotas et durée

- Pas de synchronisation continue, de récupération depuis la corbeille Google, ni d'effacement automatique de Google Photos après migration.
- Pas de téléchargement automatisé des ZIP depuis Google, pas de support TGZ ni d'archives chiffrées ou multi-volumes. Un ZIP volumineux doit tenir localement ou sur un disque externe avant lecture.
- La reprise se fait **au fichier**, pas à l'octet. Une longue vidéo interrompue avant réception complète doit repartir du début. Une vidéo déjà réceptionnée et retrouvée ne repart pas du début.
- Un seul transfert à la fois limite la mémoire, les courses et la pression API. Des dizaines de milliers de petits objets créent aussi beaucoup de dossiers et d'appels pCloud ; leur latence peut dominer la durée totale.
- Aucun débit ni quota d'appels pCloud fixe n'est supposé. Le service peut limiter le débit ou les appels. Les limites effectives dépendent du compte, du réseau et du service. Les quotas Google Photos API ne s'appliquent pas à cette application Takeout.
- À **10 Mbit/s d'envoi**, 1 To décimal représente environ **9,3 jours** de transmission seule ; à 100 Mbit/s, environ **22,2 heures**. Doublez pour 2 To. Ajoutez préparation Takeout, téléchargement Google, lecture CRC/SHA locale, latence des appels et essais réseau. La validation US ou `--deep` ajoute une relecture complète depuis pCloud, dépendante du débit descendant et des éventuelles limites du service.
- Aucun logiciel ne peut garantir contre une panne de stockage, un compte supprimé ou une suppression manuelle après vérification. La migration utilise TLS, SQLite durable, contrôle CRC et SHA-256 pour détecter les erreurs ; gardez plusieurs copies jusqu'à validation finale.
- Réservez les sous-dossiers techniques à cette application pendant les transferts. Le dossier principal peut être renommé librement. Le protocole ne dispose pas d'un verrou distribué ni d'une écriture conditionnelle empêchant un autre client d'intervenir exactement pendant un envoi.
- Le stockage pCloud Crypto n'est pas pris en charge : la destination est un dossier pCloud standard accessible par l'API.

## Fichiers et tests

```text
config.example.json       Exemple de configuration séparée des secrets
requirements.txt          Deux dépendances HTTP
photos_pcloud/
  __main__.py             CLI et codes de sortie
  auth.py                 OAuth pCloud avec callback local
  pcloud.py               Appels API, flux multipart et contrôles distants
  takeout.py              Inventaire ZIP, empreintes et dates JSON
  state.py                SQLite, verrou et rapports
  migrate.py              Reprise et machine d'état des transferts
  web.py                  Compagnon HTTP local, tâches et sélection des ZIP
docs/                     Interface statique publiée sur GitHub Pages
Lancer-interface.cmd      Lancement Windows avec préparation automatique
Lancer-interface-locale.cmd  Variante entièrement locale
tests/test_migration.py   Tests de fiabilité hors connexion
tests/test_web.py         Contrôles HTTP, sécurité locale et analyse réelle en sous-processus
tests/web-model.test.mjs  États et compteurs de l'interface
```

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --test tests/web-model.test.mjs
```

Tests : réponse perdue après réception, interruption après commit distant et redémarrage, panne avant réception, collision de noms, copies d'albums, corruption distante, CRC invalide, source modifiée, dates ambiguës, ajout de parties, déplacement de ZIP, renommage du dossier principal, verrou, refus d'authentification, contrôle du compte, corps multipart réel en flux et vérification EU/US.

L'interface ajoute des tests HTTP réels sur loopback : clé de session, contrôle d'origine et d'hôte, absence d'exposition des secrets, configuration, analyse réelle de ZIP en sous-processus et téléchargement des rapports. Les tests JavaScript vérifient les états vides, prérequis, erreurs et compteurs. Le workflow GitHub Actions exécute ces tests avant de publier `docs/` sur Pages.

**Limite de validation :** les tests automatisés utilisent un simulateur pCloud et des réponses HTTP simulées. Aucun compte réel n'a été connecté ici. Le flux OAuth et un transfert pCloud réel doivent être validés avec vos accès sur un petit export avant de lancer la photothèque complète.
