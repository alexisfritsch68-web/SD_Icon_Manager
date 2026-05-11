

# Documentation API SteamGridDB v2

## 1. Configuration globale

### Base URL 
`
https://www.steamgriddb.com/api/v2
`
### Authentification

L’authentification est obligatoire via un header HTTP.
```
http
Authorization: Bearer <VOTRE_CLE_API>
```
### Format

- Toutes les réponses sont au format JSON.
- Les URLs retournées dans les champs `url` et `thumb` pointent vers le CDN SteamGridDB.
- L’accès aux images du CDN ne nécessite pas le header d’authentification.

---

## 2. Workflow obligatoire

L’API ne permet pas de chercher une image directement avec le nom d’un jeu.

Le workflow correct est toujours en deux étapes :

1. **Recherche du jeu**
   - Utiliser `/games/search`
   - Ou utiliser `/games/steam/{steam_app_id}`
   - Objectif : obtenir l’ID interne SteamGridDB du jeu, appelé `game_id`.

2. **Récupération des assets**
   - Utiliser le `game_id` obtenu.
   - Requêter ensuite les endpoints :
     - `/grids`
     - `/heroes`
     - `/logos`
     - `/icons`

---

## 3. Schémas de données

### 3.1 Enveloppe de réponse standard

Tous les endpoints retournent une structure similaire.

Toujours vérifier `success` avant d’utiliser `data`.
```
json
{
"success": true,
"status": 200,
"data": {}
}
```
---

### 3.2 Objet `Game`
```
json
{
"id": 12345,
"name": "Nom du Jeu",
"release_date": "2023-01-01",
"platforms": ["steam"],
"types": ["game", "mod"],
"verified": true
}
```
#### Champs

| Champ | Type | Description |
|---|---:|---|
| `id` | number | ID interne SteamGridDB |
| `name` | string | Nom du jeu |
| `release_date` | string | Date de sortie |
| `platforms` | string[] | Plateformes associées |
| `types` | string[] | Types associés, par exemple `game`, `mod` |
| `verified` | boolean | Indique si l’entrée est vérifiée |

---

### 3.3 Objet `Asset`

Utilisé pour les grilles, héros, logos et icônes.
```
json
{
"id": 98765,
"score": 42,
"style": "official",
"url": "https://cdn.steamgriddb.com/...",
"thumb": "https://cdn.steamgriddb.com/thumb/...",
"tags": ["cover", "custom"],
"author": {
"name": "Username",
"steam64": "765611980..."
},
"upvotes": 15,
"downvotes": 2,
"language": "en",
"nsfw": false,
"humor": false,
"epilepsy": false,
"notes": null
}
```
#### Champs importants

| Champ | Type | Description |
|---|---:|---|
| `id` | number | ID de l’asset |
| `score` | number | Score de popularité |
| `style` | string | Style de l’image |
| `url` | string | URL CDN de l’image originale |
| `thumb` | string | URL CDN de la miniature |
| `tags` | string[] | Tags associés |
| `author` | object | Auteur de l’asset |
| `upvotes` | number | Nombre de votes positifs |
| `downvotes` | number | Nombre de votes négatifs |
| `language` | string | Langue associée |
| `nsfw` | boolean | Contenu explicite |
| `humor` | boolean | Contenu humoristique |
| `epilepsy` | boolean | Contenu sensible à l’épilepsie |
| `notes` | string \| null | Notes éventuelles |

---

## 4. Endpoints : jeux

## 4.1 Rechercher un jeu par nom
```
http
GET /games/search
```
### Objectif

Trouver le `game_id` SteamGridDB à partir d’un nom de jeu.

### Query parameters

| Paramètre | Type | Requis | Description |
|---|---:|---:|---|
| `term` | string | Oui | Nom du jeu à rechercher |

### Réponse
```
json
{
"success": true,
"status": 200,
"data": [
{
"id": 12345,
"name": "Nom du Jeu",
"release_date": "2023-01-01",
"platforms": ["steam"],
"types": ["game"],
"verified": true
}
]
}
```
### Règle d’utilisation

Si le nom correspond, utiliser :
```
typescript
const gameId = response.data[0].id;
```
---

## 4.2 Rechercher un jeu par AppID Steam
```
http
GET /games/steam/{steam_app_id}
```
### Objectif

Trouver le `game_id` SteamGridDB à partir de l’AppID Steam.

### Path parameters

| Paramètre | Type | Requis | Description |
|---|---:|---:|---|
| `steam_app_id` | integer | Oui | ID de l’application Steam |

### Réponse

`data` contient un tableau d’objets `Game`.

---

## 4.3 Récupérer un jeu par ID SteamGridDB
```
http
GET /games/id/{id}
```
### Objectif

Récupérer les informations d’un jeu via son ID SteamGridDB.

### Path parameters

| Paramètre | Type | Requis | Description |
|---|---:|---:|---|
| `id` | integer | Oui | ID SteamGridDB du jeu |

### Query parameters

| Paramètre | Type | Requis | Description |
|---|---:|---:|---|
| `platform` | string | Non | Filtre par plateforme, par exemple `steam`, `epic` |

### Réponse

`data` contient un objet `Game`.

---

## 5. Endpoints : assets

Les endpoints d’assets utilisent une structure commune.

Remplacer `{asset_type}` par l’un des types suivants :

| Type | Description |
|---|---|
| `grids` | Pochettes / covers |
| `heroes` | Bannières de fond |
| `logos` | Logos transparents |
| `icons` | Icônes |

---

## 5.1 Récupérer les assets d’un jeu
```
http
GET /{asset_type}/game/{game_id}
```
### Objectif

Récupérer une liste d’assets pour un jeu spécifique.

### Path parameters

| Paramètre | Type | Requis | Description |
|---|---:|---:|---|
| `asset_type` | string | Oui | `grids`, `heroes`, `logos` ou `icons` |
| `game_id` | integer | Oui | ID SteamGridDB du jeu |

### Query parameters communs

| Paramètre | Type | Défaut | Description |
|---|---:|---:|---|
| `dimensions` | string | Tous | Filtre par taille, par exemple `460x215` |
| `mimes` | string | Tous | Type MIME, par exemple `image/png`, `image/jpeg`, `image/webp` |
| `types` | string | `static` | Type d’animation : `static` ou `animated` |
| `styles` | string | Tous | Style artistique |
| `nsfw` | boolean | `false` | Inclure le contenu explicite |
| `humor` | boolean | `false` | Inclure le contenu humoristique |
| `epilepsy` | boolean | `false` | Inclure le contenu sensible à l’épilepsie |
| `page` | integer | `0` | Numéro de page |
| `limit` | integer | `50` | Nombre de résultats par page, maximum `50` |
| `order` | string | `desc` | Direction du tri : `asc` ou `desc` |
| `sort` | string | `score` | Champ de tri : `score` ou `age` |

### Valeurs possibles pour `styles`
```
text
official
blurb
white_logo
material
no_logo
```
### Réponse

`data` contient un tableau d’objets `Asset`.

---

## 5.2 Récupérer un asset par ID
```
http
GET /{asset_type}/{asset_id}
```
### Objectif

Récupérer un asset spécifique par son ID.

### Path parameters

| Paramètre | Type | Requis | Description |
|---|---:|---:|---|
| `asset_type` | string | Oui | `grids`, `heroes`, `logos` ou `icons` |
| `asset_id` | integer | Oui | ID de l’asset |

### Réponse

`data` contient un objet `Asset`.

---

## 5.3 Supprimer un asset
```
http
DELETE /{asset_type}/{asset_id}
```
### Objectif

Supprimer un asset.

> Nécessite d’être l’auteur de l’asset.

### Path parameters

| Paramètre | Type | Requis | Description |
|---|---:|---:|---|
| `asset_type` | string | Oui | `grids`, `heroes`, `logos` ou `icons` |
| `asset_id` | integer | Oui | ID de l’asset |

### Réponse

`data` contient l’objet `Asset` supprimé.

---

## 6. Endpoint utilisateur

## 6.1 Profil utilisateur
```
http
GET /user/profile
```
### Objectif

Récupérer le profil de l’utilisateur authentifié avec le token Bearer.

### Réponse
```
json
{
"success": true,
"status": 200,
"data": {
"id": 1,
"name": "Username",
"steam64": "765611980...",
"role": "user",
"banned": false
}
}
```
### Objet `User`
```
json
{
"id": 1,
"name": "Username",
"steam64": "765611980...",
"role": "user",
"banned": false
}
```
---

## 7. Dimensions valides par type d’asset

Pour éviter les erreurs ou les tableaux vides, utiliser uniquement les dimensions suivantes.

---

### 7.1 Grilles — `grids`

#### Vertical / portrait
```
text
600x900
660x930
```
#### Horizontal / paysage
```
text
460x215
920x430
```
---

### 7.2 Héros — `heroes`

#### Standard
```
text
1920x620
3840x1240
```
#### Full HD
```
text
1920x1080
```
> Moins courant.

---

### 7.3 Logos — `logos`

Les logos n’ont pas de dimension fixe.

> Ne pas passer le paramètre `dimensions` pour les logos.

---

### 7.4 Icônes — `icons`
```
text
16x16
24x24
32x32
48x48
64x64
128x128
256x256
512x512
```
---

## 8. Règles de programmation importantes

### 8.1 Validation stricte

Toujours vérifier que la réponse est valide avant d’utiliser `data`.
```
typescript
if (response.success === true && response.data) {
// Utiliser response.data
}
```
---

### 8.2 Recherche d’assets officielle en priorité

Lors de la récupération d’assets, commencer par :
```
text
styles=official
```
Si aucun résultat n’est trouvé :

1. Relancer sans le filtre `styles`.
2. Ou relancer avec :
```
text
styles=blurb
```
---

### 8.3 Ne jamais construire les URLs CDN manuellement

Toujours utiliser les champs retournés par l’API :
```
typescript
asset.url
asset.thumb
```
Ne jamais générer soi-même une URL CDN.

---

### 8.4 Gestion des erreurs 404 et résultats vides

Si un `game_id` ne retourne aucun asset :

- Ne pas faire crasher l’application.
- Retourner `null`.
- Ou utiliser une image placeholder.

---

### 8.5 Pagination

Si le nombre de résultats est égal à `limit`, il peut exister d’autres pages.
```
typescript
if (data.length === limit) {
// Charger la page suivante si nécessaire
}
```
---

### 8.6 Encodage des recherches

Toujours encoder les termes de recherche avec :
```
typescript
encodeURIComponent()
```
Exemple :
```
typescript
const url = `${BASE_URL}/games/search?term=${encodeURIComponent(gameName)}`;
```
---

## 9. Exemple complet en TypeScript
```
typescript
const headers = {
Authorization: "Bearer VOTRE_CLE",
};

const BASE_URL = "https://www.steamgriddb.com/api/v2";

async function getSteamGridImage(gameName: string): Promise<string | null> {
// 1. Recherche du jeu
const searchRes = await fetch(
`${BASE_URL}/games/search?term=${encodeURIComponent(gameName)}`,
{ headers }
);

const searchData = await searchRes.json();

if (!searchData.success || searchData.data.length === 0) {
throw new Error("Jeu non trouvé");
}

const gameId = searchData.data[0].id;

// 2. Récupération de la grille officielle
const gridRes = await fetch(
`${BASE_URL}/grids/game/${gameId}?dimensions=460x215&styles=official&types=static`,
{ headers }
);

const gridData = await gridRes.json();

if (!gridData.success || gridData.data.length === 0) {
// Fallback sans le filtre official
const fallbackRes = await fetch(
`${BASE_URL}/grids/game/${gameId}?dimensions=460x215`,
{ headers }
);

    const fallbackData = await fallbackRes.json();

    if (!fallbackData.success || fallbackData.data.length === 0) {
      return null;
    }

    return fallbackData.data[0]?.url ?? null;
}

// 3. Retour de l’URL de l’image
return gridData.data[0].url;
}
```
---

## 10. Résumé rapide pour implémentation

### Étapes minimales

1. Avoir une clé API SteamGridDB.
2. Appeler `/games/search?term=<nom_du_jeu>`.
3. Vérifier `success`.
4. Récupérer `data[0].id`.
5. Appeler `/icons/game/{game_id}` ou `/grids/game/{game_id}`.
6. Utiliser directement `asset.url`.
7. Prévoir un fallback si aucun asset n’est trouvé.

### Exemple de récupération d’icônes
```
http
GET /icons/game/{game_id}?dimensions=512x512&styles=official&types=static
```
### Exemple de récupération de grille horizontale Steam
```
http
GET /grids/game/{game_id}?dimensions=460x215&styles=official&types=static
```
### Exemple de récupération de héros
```
http
GET /heroes/game/{game_id}?dimensions=1920x620&styles=official&types=static
```
### Exemple de récupération de logos
```
http
GET /logos/game/{game_id}?styles=official&types=static
```
