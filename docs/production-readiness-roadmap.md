# Trajectoire de préparation à la production — ANIF

## Décision de périmètre

Le cahier reçu le 7 novembre 2026 a le même contenu fonctionnel que la première
version. Le projet reste un démonstrateur non homologué. Les parcours actuellement
présents — ITSM, gouvernance N1–N5, SLA, KEDB, conversion message-ticket et journal
chaîné — sont conservés. Le Bot SI ajouté au démonstrateur ne constitue pas une
sonde d’infrastructure ANIF et ne traite aucune donnée réelle.

Cette feuille de route décrit les travaux et preuves nécessaires avant une mise en
production. Elle ne constitue ni un engagement de conformité ni une homologation.
Ne pas utiliser le pilote pour des informations financières, personnelles,
d’enquête ou classifiées.

## Phases, dépendances et critères de sortie

### 0. Cadrage institutionnel et classification

- Valider les exigences avec le SSI, les responsables métier, le RSSI et les
  autorités/conseils compétents.
- Définir les catégories de données, les durées de conservation, les règles
  d’accès, le périmètre des métadonnées et les circuits d’approbation.
- Réconcilier les références réglementaires du cahier avec les textes en vigueur.
- Réaliser un modèle de menace et un dossier d’architecture de sécurité (DAS).

**Sortie attendue :** exigences approuvées, registre des risques, classification
des données et responsabilités d’exploitation nommées.

### 1. Identité, authentification et contrôle d’accès

- Décider et exploiter l’IAM cible, sa fédération avec les annuaires autorisés et
  le cycle de vie des identités.
- Déployer et tester MFA résistant à l’hameçonnage (FIDO2/WebAuthn), récupération
  de compte et révocation des facteurs.
- Concevoir RBAC et ABAC : rôle, habilitation, appareil, réseau et classification
  de l’objet demandé. Documenter les refus par défaut et les accès temporaires.
- Tester l’attribution, la relève, la révocation, la séparation des tâches et les
  cas de concurrence avec deux comptes de rôles réels.

**Sortie attendue :** matrice d’accès approuvée, tests d’autorisation serveur
positifs/négatifs, procédure d’urgence et preuves d’audit. L’instance Clerk du
pilote n’est pas l’IAM souverain cible.

### 2. Messagerie chiffrée et cycle de vie des clés

- Faire choisir par les spécialistes un protocole et une bibliothèque
  cryptographique maintenue et auditée. Le cahier cite Double Ratchet/X3DH et
  MLS : leur combinaison et les cas d’usage doivent être arbitrés, pas
  assemblés par du code applicatif improvisé.
- Définir génération, stockage matériel, rotation, révocation, renouvellement de
  session, récupération et destruction des clés; tester la confidentialité
  persistante et la sécurité après compromission.
- Définir les modèles de groupes, invitations, appareils multiples, messages
  éphémères, métadonnées, recherche locale chiffrée et sauvegarde de clés.
- Mettre en place des tests inter-clients et une revue cryptographique
  indépendante avant toute revendication E2EE.

**Sortie attendue :** revue de conception, modèle de clés, implémentation auditée,
tests d’interopérabilité et procédure de révocation éprouvée. Le serveur du pilote
voit actuellement le contenu partagé; il n’y a pas de chiffrement E2EE.

### 3. Fichiers et prévention des fuites

- Définir le stockage objet autorisé, le chiffrement par fichier, la gestion des
  clés et les règles d’accès temporaires.
- Concevoir et tester nettoyage des métadonnées, analyse antimalware, limites de
  taille/type, prévisualisation isolée et effacement selon la politique retenue.
- Évaluer filigrane et contrôles de capture comme mesures de dissuasion; ne pas
  les présenter comme une protection contre une photographie externe.
- Définir les exigences d’accessibilité et les solutions de repli qui n’exposent
  pas un document sensible.

**Sortie attendue :** chaîne d’import/export testée, rapport de sécurité et règles
de conservation approuvées. Le démonstrateur ne transporte pas de pièce jointe.

### 4. Centre de services et diagnostic opérationnel

- Valider les calendriers SLA, heures ouvrées, astreintes, suspensions, priorités,
  escalades et destinataires d’alertes.
- Configurer des sondes explicitement autorisées et minimales vers les
  dépendances approuvées (réseau, IAM, services); utiliser des comptes de service
  dédiés et documenter les données retournées.
- Ajouter des diagnostics qui n’exposent pas d’identifiants, d’adresses internes,
  de journaux ou de données d’enquête dans les tickets.
- Remplacer les validations simulées de clôture et de CAB par des identités,
  signatures et délégations réellement autorisées.

**État du Bot SI pilote :** seul `/api/healthz` est interrogé; le statut du
catalogue est une donnée de démonstration. Nkok et Keycloak ne sont pas testés.

**Sortie attendue :** catalogue de services vérifié, sondes approuvées,
engagements SLA signés, alertes livrées et recette multi-rôles concluante.

### 5. Journal, WORM, SIEM et horodatage

- Conserver la chaîne SHA-256 actuelle uniquement comme contrôle de cohérence du
  démonstrateur; elle ne protège pas contre un administrateur capable de réécrire
  toute la base.
- Acheminer les événements vers une archive immuable extérieure au domaine
  d’administration de l’application, avec contrôle des rétentions et tests de
  restauration.
- Définir le schéma d’événements, les règles SIEM, les alertes, les accès
  d’auditeur et la réponse aux incidents de journalisation.
- Décider et intégrer un service d’horodatage RFC 3161 et une source de temps
  approuvée; vérifier les signatures, certificats, expirations et pannes.

**Sortie attendue :** export indépendant vérifié, tests de non-réécriture,
alertes SIEM reçues et procédure d’investigation testée.

### 6. Hébergement souverain, disponibilité et reprise

- Faire valider par l’opérateur les sites, zones, réseaux, contraintes
  d’hébergement et responsabilités physiques de Nkok et Libreville.
- Dimensionner et durcir l’orchestration, le maillage mTLS, la segmentation
  réseau, PostgreSQL, le stockage objet, la messagerie événementielle et
  l’observabilité.
- Construire la sauvegarde 3-2-1-1-0, avec une copie hors ligne/immuable, puis
  exécuter des restaurations complètes en environnement isolé.
- Mesurer et démontrer l’objectif de disponibilité de 99,99 %, le RTO < 15 min,
  le RPO = 0, les performances et le basculement inter-sites avant de les
  annoncer comme atteints.

**Sortie attendue :** dossiers d’exploitation et PCA/PRA, résultats d’exercices,
mesures de capacité et validation formelle de l’infrastructure.

### 7. Assurance, pilote et autorisation de mise en service

- Effectuer revue de code indépendante, tests d’intrusion, tests de charge,
  tests de résilience, analyse de dépendances et exercices d’incident.
- Corriger et retester toutes les vulnérabilités majeures/critique; tenir un
  registre des risques résiduels avec approbation explicite.
- Former chaque profil et tester les procédures d’usage, d’administration,
  d’urgence et de récupération.
- Mener un pilote à données fictives, puis une recette de sécurité et une
  décision formelle d’autorisation avant tout traitement réel.

**Sortie attendue :** rapports d’audit, cahier de recette signé, supports de
formation, procès-verbal de décision et plan de maintenance.

## Limites actuelles à ne pas masquer

- L’application conserve les données ITSM partagées dans PostgreSQL et Clerk;
  elle n’est pas déployée sur l’infrastructure souveraine décrite.
- Le rôle applicatif et le journal chaîné ne remplacent ni l’IAM cible, ni une
  archive WORM, ni un horodatage qualifié.
- Le contrôle d’API du Bot SI n’est pas une mesure de disponibilité de Nkok,
  d’Active Directory, d’OpenLDAP ou de Keycloak.
- Les valeurs 99,99 %, RTO < 15 min et RPO = 0 restent des objectifs non mesurés.
- Toute affirmation de conformité ISO, GAFI, Egmont ou d’homologation requiert
  une validation externe compétente.
