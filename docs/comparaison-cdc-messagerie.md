# Écarts avec le cahier CDC-ANIF-MSG-2025

- **Document comparé :** *Cahier des Charges — Application de Messagerie Interne & Gestion de Tickets SI* (CDC-ANIF-MSG-2025-v1.0, 20 pages).
- **Référence du pilote :** le *Cahier des charges ANIF Gabon* (voir `comparaison-cahiers-des-charges.md`). Les deux cahiers ne disent pas la même chose sur plusieurs points ; ceux-là sont des décisions à prendre, pas des tâches.
- **Date :** 11 novembre 2026.

## Décisions à prendre avant d'aller plus loin

| Sujet | Pilote (en place) | CDC-ANIF-MSG | Conséquence d'un alignement |
| --- | --- | --- | --- |
| **Niveaux d'habilitation** | N1 à N5 : N1 Direction, N2 analyste, N3 SSI et support, N4 services d'appui, N5 auditeur temporaire | N0 à N6 : N0 super-administrateur, N1 administrateur SI, N2 Direction générale, N3 chef de département, N4 agent opérationnel, N5 agent restreint, N6 invité externe | Les mêmes codes ne désignent pas les mêmes personnes (N1, N2 et N5 changent de sens). Tout le contrôle d'accès du serveur, le journal des habilitations et les tests en dépendent. |
| **SLA par priorité** | P1 15 min / 2 h · P2 30 min / 4 h · P3 2 h / 8 h · P4 4 h / 48 h | Critique 15 min / 4 h · Haute 1 h / 8 h · Moyenne 4 h / 24 h · Faible 8 h / 72 h, avec escalade automatique après 2 h, 4 h, 12 h et 48 h sans intervention | Changer les délais change les dépassements, les escalades et le taux SLA du tableau de bord. |
| **Cycle de vie d'un ticket** | Nouveau → Pris en compte → En cours → En attente → Résolu → Clos (ou Rejeté) | Création → Triage → Affectation → En cours → Résolution → Validation → Fermé | Le pilote fusionne triage et affectation dans « Pris en compte », et la validation dans la confirmation du demandeur. |
| **Catégories** | Applications, Poste de travail, Équipement, Réseau, Accès | Matériel, Logiciel, Réseau, Accès, Sécurité, Autre | Les volumes par catégorie du tableau de bord changent de libellés. |
| **Priorité** | Déduite de l'impact et de l'urgence (matrice ITIL) | Choisie dans une liste, plus un booléen « urgence déclarée » | Le pilote calcule ; le cahier fait saisir. |

## Déjà couvert

- **Tickets :** les quatre types ITIL, la création depuis l'interface et depuis le canal support (conversion d'un message), l'escalade automatique sur dépassement de SLA, la validation des changements par le CAB et la clôture confirmée par le demandeur.
- **Indicateurs ITIL (§ 6.5) :** MTTR, MTBF, taux de respect du SLA de résolution, volume par catégorie et par technicien, satisfaction après résolution (note de 1 à 5 donnée à la clôture), export du rapport en CSV depuis le tableau de bord (§ 4.5 ; le PDF et l’Excel restent à faire).
- **Détection de récurrence (§ 6.3) :** à partir de 3 incidents sur un même service et une même catégorie en 7 jours, la file des tickets propose d’ouvrir un ticket Problème prérempli ; le serveur enregistre les incidents liés à la création et ne les laisse plus modifier.
- **Demandes préformatées (§ 6.5) :** trois modèles (réinitialisation de mot de passe, création de compte, installation de logiciel) préremplissent le formulaire. Seule la réinitialisation de mot de passe est une demande standard prise en compte automatiquement ; le serveur tient la liste des modèles autorisés et vérifie la catégorie.
- **Base de connaissances :** article KEDB créé à la clôture, assistant de diagnostic qui propose les fiches, et suggestion des erreurs connues proches pendant la saisie du sujet d’un nouveau ticket (§ 6.5).
- **Messagerie :** conversations de groupe et bilatérales, salons restreints, annonces réservées à la Direction, canaux temporaires pour les externes, messages éphémères, pièces jointes simulées avec contrôle des formats, saisie hors ligne, correction d’un message par son auteur pendant 5 minutes et suppression à tout moment (§ 4.1, § 10.1) : le serveur seul applique ces changements, la conversation garde les versions précédentes et le journal enregistre l’empreinte SHA-256 du texte avant et après, sans copier le contenu. Un message converti en incident ne peut plus changer. Réponse avec citation (§ 4.1) : le serveur ne garde que la référence au message cité, qui s’affiche selon son état actuel (un message supprimé n’est plus cité). Épinglage de 5 messages au plus par conversation, affichés en tête ; chaque épingle et désépingle est journalisée, et un message supprimé ou expiré est désépinglé. Transfert d’un message : le serveur reprend le texte et l’auteur du message d’origine et journalise le transfert ; seuls les messages durables des conversations internes se transfèrent, jamais vers un canal temporaire ouvert à des externes. Mentions @utilisateur et @tous (§ 4.1) : un menu « @ » du composeur insère le nom d’un membre ou @tous, les mentions ressortent dans le texte, et toute mention de l’agent ou de @tous dans un message d’un autre devient une notification qui ouvre ce message (casse et accents ignorés ; une adresse e-mail n’est pas une mention). Accusés de lecture (§ 4.1) : sous chacun de ses messages, l’auteur voit qui l’a lu. Le serveur retient pour chaque agent l’heure du dernier message lu ; ce repère ne recule jamais (« marquer non lu » ne retire pas l’accusé) et reste juste après la purge des messages éphémères. Seuls les agents qui ont écrit dans une conversation reçoivent ses accusés, et le navigateur ne peut pas les fabriquer. Heures silencieuses (§ 4.4) : dans les Préférences, une plage quotidienne en heure de Libreville (par exemple 18:00 → 07:30) pendant laquelle la cloche ne compte plus que les délais SLA dépassés ; les autres notifications restent consultables. Réglage propre au navigateur.
- **Audit (§ 10.1) :** journal en ajout seul, chaîné par empreintes, arbre de Merkle, horodatage RFC 3161, flux SIEM, export CSV.
- **Interface :** mode clair et sombre, raccourcis clavier listés dans les Préférences (Ctrl+K pour la recherche ; Alt+Maj+T, M et D à la place de Ctrl+N et Ctrl+T, réservés par le navigateur ; § 8.3), choix de la police, taille du texte réglable (100 %, 115 %, 130 % ; § 8.5), icônes Lucide, mise en page utilisable sur téléphone.

## Manquant et réalisable dans le pilote web

Classé par valeur pour le pilote, du plus utile au moins utile.

| Exigence | Section | Ce qu'il faudrait faire |
| --- | --- | --- |
| **Accusés « envoyé » et « délivré »** | § 4.1 | Seul l’accusé « lu » existe. Sans connexion temps réel ni application mobile, « délivré » ne se distingue pas de « enregistré par le serveur », que l’envoi confirme déjà. |
| **Fils de discussion** | § 4.1 | Absents. La réponse avec citation et les mentions couvrent l’essentiel du besoin. Les mentions sont calculées dans le navigateur, comme les alertes SLA : aucune notification n’est envoyée hors de l’application. |
| **Statuts de présence** | § 4.1 | Absents. |

## Hors de portée de ce pilote

Comme pour le premier cahier, le pilote ne simule pas ce qui suppose une infrastructure ou des clients natifs : application mobile, gestion documentaire réelle (stockage, versions, recherche plein texte Elasticsearch, filigrane au téléchargement), annuaire synchronisé LDAP/AD et organigramme, MFA par carte PKI et politique de mots de passe (dépendent de Clerk), passerelles e-mail et SMS, haute disponibilité, sauvegardes, supervision Prometheus/Grafana, engagements de performance, intégrations V2.
