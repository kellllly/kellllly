# Prototype AI Studio — « ANIF Gabon, Plateforme Souveraine E2EE & ITSM »

Copie du prototype généré dans Google AI Studio (archive transmise le 9 novembre 2026),
analysée puis corrigée. Il sert de **référence visuelle** pour la refonte de
l’application Replit (`artifacts/anif-secure-desk`). Il ne fait pas partie du
workspace pnpm et n’est pas déployé.

## Lancer

```bash
npm install
npm run dev        # serveur Express + Vite sur le port 3000 (PORT pour changer)
npm test           # 43 tests unitaires (node:test via tsx)
npm run lint       # vérification TypeScript
npm run build && npm start   # mode production
```

`GEMINI_API_KEY` (facultatif) active le copilote et l’analyse des menaces par Gemini ;
sans clé, l’interface utilise ses réponses locales et le moteur heuristique.
`GEMINI_MODEL` permet de changer de modèle.

## Contenu

React 19 + Vite 8 + Tailwind 4, `motion`, `recharts`, `three`, serveur Express + WebSocket
en mémoire (`server.ts`). Écrans : cockpit « Bento 360° » (enclave, bouclier WAF,
opposition 48 h, heatmap des blocages, flux financiers), messagerie en canaux,
guichet ITSM (tickets, SLA, conversion message → incident), analyseur de menaces,
matrice OWASP, modale WebAuthn, export d’audit chaîné, filigrane, enclave 3D.
Captures dans `captures/` (`r13-apres-correctifs.png` = état après correctifs).

## Analyse : problèmes trouvés et corrigés

| # | Problème | Correctif |
|---|----------|-----------|
| 1 | `npm install` échouait (conflit esbuild 0.25 / Vite 8) | esbuild ^0.27 |
| 2 | `vite build` échouait : `react-is` manquant (requis par recharts 3) | dépendance ajoutée |
| 3 | Le copilote appelait Gemini **depuis le navigateur** avec `process.env.GEMINI_API_KEY` : la clé aurait été exposée, et `process` n’existe pas dans le navigateur (l’appel échouait toujours) | nouvelle route `POST /api/ai/copilot` ; la clé reste côté serveur |
| 4 | `canalId` libre côté serveur : `__proto__` ou n’importe quel nom créait des entrées dans le stockage (pollution de prototype, croissance illimitée) | liste blanche des canaux + clés interdites |
| 5 | Messages, trames WebSocket et tableaux sans taille maximale ; aucun plafond par canal | limites de longueur, `maxPayload` 64 Ko, 500 messages par canal, 200 connexions |
| 6 | Aucune limitation de débit (REST, WebSocket, IA) | seau à jetons par IP (REST) et par connexion (WebSocket) ; 429 au-delà |
| 7 | WebSocket ouvrable depuis n’importe quel site (détournement inter-origines) | contrôle de l’en-tête `Origin` |
| 8 | `AGENT_JOIN` acceptait n’importe quelle valeur de niveau | matricule, nom et niveau 1–5 vérifiés |
| 9 | SHA-256 de secours : renvoyait 32 octets nuls si aucune API n’était disponible (toute la chaîne d’audit devenait identique) et lisait `hash.buffer` sans tenir compte du décalage | erreur explicite ; copie exacte des 32 octets |
| 10 | `npm start` lançait `node server.ts` (imports `.js` vers des fichiers `.ts` : échec) | `tsx` en production |

## Limites qui demeurent (à ne pas revendiquer)

- **Pas de chiffrement de bout en bout.** Le client envoie au serveur le texte clair
  (`texteClair`) à côté du chiffré ; le serveur le stocke et le rediffuse. Les libellés
  « E2EE », « Zero-Knowledge », « Double Ratchet », « HSM FIPS 140-3 », « WORM »,
  « RFC 3161 » ou « Tier III » sont décoratifs.
- **Pas d’authentification.** L’identité (matricule, niveau) est déclarée par le client.
  WebAuthn est simulé dans l’interface.
- Données en mémoire, perdues au redémarrage ; montants, dossiers et personnes fictifs.

Ces points sont conformes à la règle du projet principal (`replit.md`) : aucun chiffrement
certifié, E2EE, journal inviolable ou hébergement souverain n’est revendiqué.
