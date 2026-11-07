# Recette fonctionnelle du démonstrateur ANIF

**Périmètre :** vérification de démonstration, données fictives et espace ITSM partagé entre comptes Clerk. Ce document ne vaut ni homologation, ni certification, ni audit de sécurité.

## Vérifications automatisées

- Frontend : `pnpm --filter @workspace/anif-secure-desk run typecheck` et `pnpm --filter @workspace/anif-secure-desk run test`.
- API : `pnpm --filter @workspace/api-server run typecheck` et `pnpm --filter @workspace/api-server run test`.
- Les tests serveur couvrent l’identité et les horodatages attribués par l’API, les transitions, le CAB distinct du demandeur, la confirmation avant clôture/KEDB, la progression d’escalade, l’import sans écrasement et les états de lecture isolés par compte.

Les tests frontend couvrent notamment la matrice impact/urgence, les horloges SLA, les dates WAT, l’échappement CSV, l’application conjointe des filtres du journal (périmètre, dates WAT inclusives et texte), l’égalité entre la sélection exportée et les lignes visibles/compteur, la migration non destructive, la récupération après corruption, la validation CAB avant résolution, la clôture/KEDB unique et la propagation des commentaires.

## Préparation de la recette navigateur

1. Ouvrir le démonstrateur dans deux profils de navigateur de test distincts et se connecter avec deux comptes Clerk. Ne pas utiliser de données réelles.
2. Vérifier que les deux comptes voient le même espace fictif et que les modifications d’un compte apparaissent dans l’autre.
3. Conserver les données locales de test; l’import fusionne les exemples sans écraser les tickets partagés.
4. Pour les essais de corruption locaux, utiliser un profil jetable. La clé legacy est `anif-demo-v1`; une sauvegarde illisible doit rester intacte et ne pas être importée.

## Parcours et critères d’acceptation

| Parcours | Étapes et résultat attendu |
| --- | --- |
| Navigation, états vides, thème et dialogues | Les routes internes fonctionnent; une URL inconnue affiche « Page introuvable ». Le lien ticket ↔ conversation fonctionne dans les deux sens. Les recherches sans résultat dans Messagerie, Tickets, Services, KEDB et Journal affichent un état vide. Dans Préférences, le thème sombre reste actif après rechargement. À 390 px, le menu fonctionne sans débordement horizontal. Dans les dialogues testés, le focus initial, la boucle Tab/Shift+Tab, Échap et le retour du focus au déclencheur sont vérifiés. |
| Conversion support et lien conversation-ticket | Dans Messagerie, filtrer « Support », puis convertir `sup-2`. Vérifier la relecture du résumé et laisser la confirmation décochée : la création est impossible. Modifier le résumé, confirmer explicitement, puis créer. Le ticket apparaît une seule fois, garde l’identifiant du message source, est lié à la conversation et le message source ne propose plus une seconde conversion. Ajouter un commentaire dans le panneau lié : le ticket et la conversation affichent le commentaire rattaché au même ticket. Ouvrir le ticket depuis le lien et revenir à la conversation. |
| Qualification et horloges SLA | Dans Tickets, choisir un ticket ouvert, noter son heure d’ouverture, puis modifier impact/urgence ou niveau de support. Après sauvegarde, le ticket reste ouvert; son heure d’ouverture ne change pas et les échéances sont recalculées depuis cette heure, sans remise à zéro du temps écoulé. |
| Décision CAB | Ouvrir le changement `CHG-2421`, le prendre en charge, puis vérifier que démarrage et résolution restent bloqués avant décision CAB. Dans le dialogue CAB, un rejet sans motif est désactivé. Saisir un motif et rejeter : le statut et le motif sont visibles dans le détail. Dans un autre changement de test, approuver avec une note : le démarrage devient disponible. |
| Résolution, confirmation et KEDB | Sur un incident ouvert, tenter de résoudre sans cause et solution documentées : l’action reste indisponible. Saisir une cause racine et une résolution (10 caractères minimum), puis résoudre : le ticket passe à « Résolu » sans être clos. Dans la confirmation du demandeur, l’action reste bloquée sans accord explicite. Confirmer : le ticket passe à « Clos » et une seule fiche KEDB est créée. La retrouver avec la recherche KEDB, ouvrir la fiche et vérifier les détails et le ticket source. |
| Préremplissage service et équipement | Depuis Services, lancer une demande sur une carte service : le dialogue de création préremplit le type « Demande », le service et le titre. Annuler. Depuis Parc matériel, ouvrir un ticket pour `MAT-0874` : l’incident préremplit l’équipement, le titre, la catégorie et le contexte de description. |
| Export filtré du journal | Les tests automatisés appliquent simultanément un périmètre, une recherche et une journée WAT, y compris les bornes inclusives; ils comparent les événements visibles au compteur et au contenu CSV et vérifient que les lignes hors filtre sont absentes. La protection contre l’injection de formules reste vérifiée. (Vérifié automatiquement.) |
| Comptes et partage | À faire dans deux profils de navigateur : confirmer la visibilité des tickets, conversations et mises à jour; vérifier que le demandeur seul confirme une clôture et qu’un autre compte authentifié approuve le CAB d’un changement créé par le premier. |
| Brouillons et sauvegarde locale | Le brouillon est temporaire. Une sauvegarde locale illisible ne doit pas écraser l’espace partagé ni être importée; le pilote doit rester accessible sans modifier cette clé legacy. |

## Résultats du second navigateur — 31 octobre 2026

Recette rejouée dans Firefox 140.0.4 sous Linux. Les parcours protégés ont été rendus avec une identité Clerk simulée et une API de test en mémoire, sans modifier l’authentification ni les services du produit. Ces résultats valident l’interface et les interactions dans Firefox, pas la connexion Clerk ni le partage réel entre comptes.

| Parcours | Résultat Firefox |
| --- | --- |
| Conversion de `sup-2` | Réussie. Le bouton de création reste désactivé avant confirmation; après relecture et confirmation, un incident lié au message apparaît et le message ne propose plus une seconde conversion. |
| Dialogues au clavier | Réussis sur la conversion et la création de conversation : focus initial dans le premier champ, boucle Tab / Maj+Tab, fermeture avec Échap et retour du focus au déclencheur. |
| Export filtré | Réussi. La recherche « Ticket INC-2418 » affiche un événement sur quatre; Firefox enregistre le CSV, qui contient l’événement sélectionné et exclut les lignes sans correspondance. |
| Thème sombre | Réussi après correction : le thème et la préférence locale restent sombres après rechargement complet. |
| Mise en page mobile | Menu mobile ouvert sans débordement horizontal à la largeur CSS effectivement disponible de 450 px. Le Firefox de test impose une largeur minimale de 450 px; le contrôle exact à 390 px n’a donc pas été rejoué dans ce navigateur. |

WebKitGTK a également été tenté, mais son processus de rendu s’est arrêté avant le chargement de la page (`EGL_BAD_PARAMETER`). Firefox a été retenu pour la recette inter-moteurs. La validation avec de vrais comptes et l’API authentifiée reste à faire avant le pilote.

## Contrôle mobile exact — 1er novembre 2026

Le navigateur Firefox disponible dans l’environnement conserve une largeur CSS minimale de 450 px. Pour tester la largeur demandée sans cette limite, Chromium 152 sous Linux a été lancé en mode headless avec un viewport émulé exactement à 390 × 844 px (échelle 1); `window.innerWidth` confirme 390 px.

| Contrôle | Résultat Chromium à 390 px |
| --- | --- |
| Menu mobile | Réussi. Le menu s’ouvre, reste dans le viewport (bord droit à 250 px), puis se ferme après la navigation. |
| Défilement horizontal | Aucun. La largeur défilable du document et du corps reste à 390 px, menu ouvert comme fermé. |
| Dialogue « Nouvelle conversation » | Réussi. Le dialogue mesure 358 px, entre x=15 et x=373; il reste entièrement visible et sans débordement horizontal. |
| Dialogue « Convertir en incident » | Réussi. Le dialogue mesure 358 px, entre x=15 et x=373; il reste entièrement visible et sans débordement horizontal. |

Le contrôle rend les composants réels `Shell` et `MessagesPage`, avec une identité simulée et un état en mémoire; il ne modifie ni l’authentification ni les services de l’application. Il confirme la mise en page et les interactions à 390 px dans Chromium, mais ne remplace pas un essai Firefox à cette largeur, ni une recette avec Clerk et l’API réels.

## Première tentative sans compte pilote — 31 octobre 2026

**État à cette date : non exécutée avec un compte pilote réel.** Aucun compte de test autorisé ni navigateur Firefox authentifié n’était disponible lors de cette première tentative. L’accès a depuis été initialisé pour le compte de développement; les résultats ultérieurs sont consignés ci-dessous.

Vérifications disponibles dans cet environnement :

| Vérification | Résultat |
| --- | --- |
| Tests frontend | Réussis : 25 tests de règles métier, filtres/export CSV, récupération locale et stockage. Ils ne testent pas une conversion de message dans un navigateur et ne créent pas de session Clerk réelle. |
| Tests API | Réussis : 19 tests de règles et d’autorisations, exécutés en tests unitaires. Ils ne prouvent pas une connexion à la base ni le partage réel entre comptes. |
| Typecheck frontend et API | Bloqué : des types attendus par le client, les routes API et la couche base de données ne sont pas exportés par les paquets partagés. Aucun parcours navigateur ne peut être certifié par ces commandes. |
| Conversion réelle | Non confirmée. Une lecture seule de la base ne trouve aucun ticket issu de `sup-2`; les traces montrent des sauvegardes refusées en `400`. |
| Filtre et export CSV réel | Un appel authentifié à l’API d’export a répondu `200`. Les paramètres de filtre sont masqués dans les journaux et le téléchargement du fichier n’est pas vérifiable côté serveur; le contenu téléchargé reste à contrôler dans Firefox. |
| Thème sombre | Non confirmé après rechargement dans Firefox. La capture fournie le 1er novembre provient de Chrome mobile et montre le thème clair. La préférence est locale au navigateur; le bouton de thème enregistre aussi un événement d’audit partagé pour les rôles autorisés à écrire. |

**Effet serveur à prendre en compte avant le prochain essai :** au chargement, un compte ayant un rôle N1, N2 ou N3 peut déclencher l’import initial des exemples vers l’espace partagé s’il n’a pas encore été importé. La conversion et les modifications du journal enregistrées ensuite sont également des écritures partagées. Il faut donc utiliser un compte pilote autorisé et des données fictives; un changement visible avant confirmation de l’API ne suffit pas à prouver qu’il a été enregistré.

## Reprise après initialisation du compte — 1er novembre 2026

Après l’autorisation du compte de développement, les journaux serveur montrent des lectures authentifiées de l’espace en `200` et des réponses `200` à l’import des exemples. Une lecture seule de la base de développement confirme un espace version 1 avec 7 tickets, 5 conversations, 4 événements d’audit et un compte importé. Aucun ticket issu de `sup-2` n’est présent.

L’export CSV authentifié a répondu `200`, mais les journaux ne conservent pas les filtres soumis et ne prouvent pas le téléchargement ni le contenu du fichier. Les premiers refus `400` venaient d’`INC-2406`, un ticket d’exemple déjà « Résolu » sans cause ni solution; le serveur le revalidait même lorsqu’il n’était pas modifié. Un premier correctif ignore ce ticket lorsqu’il reste inchangé, sans assouplir la validation d’une nouvelle résolution.

Les traces ont ensuite montré deux autres refus `400` : la conversion ajoutait son message de suivi dans une conversation existante. Le premier correctif séparait les messages des métadonnées, mais PostgreSQL réordonne les clés JSONB; la comparaison fondée sur `JSON.stringify` rejetait encore un contenu identique. Le comparateur trie maintenant récursivement les clés d’objets, sans changer l’ordre des tableaux. Le serveur garde l’historique existant non modifiable et normalise le message ajouté. Le test reproduit l’ordre JSONB, vérifie l’association au message source et l’incrément de version. L’exemple local `INC-2406` porte maintenant des champs de résolution valides pour les prochains imports.

Après un rejet de sauvegarde, l’onglet reste en écriture suspendue jusqu’au rechargement de l’espace; la croix masque seulement l’alerte et ne réactive pas la synchronisation. Les changements non confirmés peuvent être perdus au rechargement.

**Résultat rapporté et limites de preuve :** l’utilisateur indique que le ticket reste présent et l’alerte a disparu après rechargement Firefox. Les suites automatisées passent (21 tests API et 25 frontend). Les journaux confirment des sauvegardes authentifiées `200`; une lecture seule de la base montre la version 5, 8 tickets et une conversion partagée. Le ticket `INC-2423` est lié à `sup-1`, pas à `sup-2`; la conversion du signalement fictif d’impression n’est donc pas confirmée. L’historique serveur de `INC-2423` contient l’événement de création et le canal support contient son message de suivi. Le journal d’audit général garde ses 4 événements initiaux et ne contient pas d’entrée de conversion.

L’export authentifié a répondu `200`; l’utilisateur rapporte que le filtre et le téléchargement passent dans Firefox, mais les paramètres ne figurent pas dans les journaux et le fichier n’est pas inspectable ici. L’utilisateur rapporte aussi que le thème sombre reste après rechargement; ce réglage est local au navigateur. Les journaux ne prouvent pas le navigateur utilisé. Les typechecks restent bloqués par des exports générés manquants et des erreurs de nullabilité.

**À confirmer :** si le test devait convertir le message `sup-2` (signalement d’impression), refaire cette sélection dans Firefox; l’écriture observée concernait `sup-1` (message de consigne). Ne pas supprimer le ticket `INC-2423` sans accord : il est maintenant partagé. Le journal d’audit général ne trace pas la conversion, mais l’historique du ticket en conserve la création.

## Couverture automatisée et limites

Les suites automatisent les règles déterministes du domaine et du stockage, mais ne remplacent pas la recette authentifiée dans deux navigateurs. Ces vérifications ne valent pas audit, homologation ou certification de sécurité. Les éléments explicitement notés comme restant à vérifier doivent être validés avant le pilote.
