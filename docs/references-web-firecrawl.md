# Références web sur les tickets (Firecrawl)

Un agent peut joindre à un ticket une page web publique : bulletin d’un éditeur,
page de documentation, avis de sécurité. L’API récupère la page via
[Firecrawl](https://github.com/firecrawl/firecrawl), la convertit en texte et
ajoute un extrait sourcé à l’historique du ticket.

## Appel

```http
POST /api/itsm/tickets/INC-2401/web-reference
Content-Type: application/json

{ "url": "https://support.example.com/kb/42", "note": "Lien fourni par l’éditeur" }
```

Réponse `200` :

```json
{
  "ticketId": "INC-2401",
  "url": "https://support.example.com/kb/42",
  "title": "Avis de sécurité",
  "update": { "author": "user_…", "body": "Référence web ajoutée : …", "at": "…", "time": "10:15" },
  "version": 42
}
```

L’historique du ticket reçoit une mise à jour de cette forme :

```text
Référence web ajoutée : Avis de sécurité
Source : https://support.example.com/kb/42
Note : Lien fourni par l’éditeur

Extrait récupéré automatiquement (contenu externe, non vérifié) :

…texte de la page, tronqué pour tenir dans 5 000 caractères…
```

Le journal reçoit un événement `itsm.ticket.web_reference` (portée
`Ticket INC-2401`, avec l’URL). La version de l’espace augmente : les autres
onglets ouverts se resynchronisent comme après toute écriture serveur.

## Qui peut l’utiliser

Les mêmes règles que pour gérer un ticket (`manageTicket`) :

| Rôle | Accès |
|------|-------|
| N3 | Tous les tickets ouverts |
| N4 | Tickets de ses services uniquement ; les autres répondent `404` |
| N1, N2 | `403` |
| N5 | `404` (les tickets ne font pas partie de son périmètre) |

Un ticket `Clos` ou `Rejeté` répond `409`, de même qu’un ticket qui compte déjà
20 références web. Les droits sont vérifiés **avant** l’appel à Firecrawl, puis
de nouveau sous le verrou PostgreSQL de l’espace, car le ticket peut avoir été
clos pendant la récupération de la page.

## Adresses acceptées

Seules les pages publiques en `https` sont acceptées : pas d’adresse IP, de
`localhost`, de nom sans domaine ni de suffixe interne (`.local`, `.internal`,
`.lan`…), pas d’identifiants dans l’adresse, pas d’autre port que 443. Le
fragment (`#…`) est retiré. Ces règles protègent surtout une instance
Firecrawl auto-hébergée contre l’accès au réseau interne.

## Configuration

| Variable | Rôle |
|----------|------|
| `FIRECRAWL_API_KEY` | Clé de l’API hébergée. Lue côté serveur seulement, jamais envoyée au navigateur. |
| `FIRECRAWL_API_URL` | Facultatif : adresse d’une instance auto-hébergée (sans clé possible). |

Sans aucune des deux, la route répond `503` avec un message explicite.

L’appel utilise l’API REST `POST {FIRECRAWL_API_URL}/v2/scrape` avec
`formats: ["markdown"]` et `onlyMainContent: true`. Aucun SDK n’est ajouté.

## Erreurs

| Statut | Cause |
|--------|-------|
| `400` | URL absente, non `https` ou interne ; note de plus de 500 caractères |
| `429` | Plus de 10 références en 10 minutes pour un même compte (limite en mémoire, par processus) |
| `502` | Page introuvable, vide ou en erreur côté site |
| `503` | Fonctionnalité non configurée, clé refusée ou quota Firecrawl atteint |
| `504` | Firecrawl n’a pas répondu en 45 secondes |

## Limites à connaître avant production

- **Sortie de données.** Avec l’API hébergée, chaque URL soumise est envoyée à
  Firecrawl, hors de l’infrastructure de l’ANIF. N’y soumettez que des pages
  publiques, jamais d’adresse contenant un identifiant d’enquête ou de dossier.
  Pour un hébergement souverain, utilisez une instance auto-hébergée
  (`FIRECRAWL_API_URL`). Firecrawl est sous licence AGPL-3.0.
- **Contenu non vérifié.** L’extrait reflète la page au moment de la
  récupération. Il est marqué comme externe et ne remplace pas la lecture de la
  source.
- **Pas d’alimentation de la KEDB.** La KEDB reste alimentée uniquement par les
  tickets clos après confirmation du demandeur.

## Interface

Dans l’écran Tickets, les comptes N3 et N4 voient le bouton « Ajouter une
référence web » sur un ticket ouvert. La fenêtre demande l’adresse (contrôle
https côté navigateur, règles complètes côté API) et une note facultative, puis
recharge l’espace partagé dès l’ajout. Dans l’historique, les entrées qui
commencent par « Référence web ajoutée » s’affichent comme une carte : titre,
lien vers la source, note, extrait marqué « contenu externe, non vérifié ». Le
découpage est dans `artifacts/anif-secure-desk/src/lib/web-reference.ts` et
doit suivre le format produit par l’API (`webReferenceUpdateBody`).
