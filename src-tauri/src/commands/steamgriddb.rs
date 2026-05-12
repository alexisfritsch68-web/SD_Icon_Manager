use regex::Regex;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_ENCODING, AUTHORIZATION, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;

use crate::commands::library::{save_image_bytes_as_icon, IconEntry};
use crate::commands::storage::get_steamgriddb_config_path;

const STEAMGRIDDB_API_BASE_URL: &str = "https://www.steamgriddb.com/api/v2";
const TARGET_ICON_SIZE: u32 = 144;

#[derive(Serialize, Deserialize, Default)]
pub struct SteamGridDbConfig {
    pub api_key: String,
}

#[derive(Serialize)]
pub struct SteamGridDbImportResult {
    pub found: usize,
    pub downloaded: usize,
    pub failed: usize,
    pub icons: Vec<IconEntry>,
}

#[derive(Serialize)]
pub struct SteamGridDbGame {
    pub id: u64,
    pub name: String,
    pub release_date: Option<i64>,
    pub verified: Option<bool>,
}

#[derive(Serialize)]
pub struct SteamGridDbIconAsset {
    pub id: u64,
    pub score: Option<i64>,
    pub style: Option<String>,
    pub url: String,
    pub thumb: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Serialize)]
pub struct SteamGridDbIconSearchResult {
    pub game: SteamGridDbGame,
    pub icons: Vec<SteamGridDbIconAsset>,
}

#[derive(Serialize)]
pub struct SteamGridDbIconPageResult {
    pub game: SteamGridDbGame,
    pub icons: Vec<SteamGridDbIconAsset>,
    pub page: u32,
    pub limit: u32,
    pub has_more: bool,
}

#[derive(Deserialize)]
struct SteamGridDbApiResponse<T> {
    success: bool,
    data: T,
}

#[derive(Deserialize)]
struct SteamGridDbGameResponse {
    id: u64,
    name: String,
    release_date: Option<i64>,
    verified: Option<bool>,
}

#[derive(Deserialize)]
struct SteamGridDbAssetResponse {
    id: u64,
    score: Option<i64>,
    style: Option<String>,
    url: String,
    thumb: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

fn read_steamgriddb_config(app: &AppHandle) -> Result<SteamGridDbConfig, String> {
    let config_path = get_steamgriddb_config_path(app)?;

    if !config_path.exists() {
        return Ok(SteamGridDbConfig::default());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|error| format!("Impossible de lire la configuration SteamGridDB : {error}"))?;

    serde_json::from_str(&content)
        .map_err(|error| format!("Configuration SteamGridDB invalide : {error}"))
}

fn write_steamgriddb_config(app: &AppHandle, config: &SteamGridDbConfig) -> Result<(), String> {
    let config_path = get_steamgriddb_config_path(app)?;

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Impossible de créer le dossier de configuration : {error}"))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|error| format!("Impossible de sérialiser la configuration SteamGridDB : {error}"))?;

    fs::write(&config_path, content)
        .map_err(|error| format!("Impossible d’enregistrer la configuration SteamGridDB : {error}"))
}

fn steamgriddb_api_key(app: &AppHandle) -> Result<String, String> {
    let config = read_steamgriddb_config(app)?;
    let api_key = config.api_key.trim();

    if api_key.is_empty() {
        Err("Clé API SteamGridDB manquante. Utilise le bouton “Clé SGDB” pour la configurer.".to_string())
    } else {
        Ok(api_key.to_string())
    }
}

fn steamgriddb_api_client(api_key: &str) -> Result<reqwest::blocking::Client, String> {
    let mut headers = HeaderMap::new();

    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_key}"))
            .map_err(|error| format!("Clé API SteamGridDB invalide : {error}"))?,
    );
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static("SD Icon Manager"),
    );

    reqwest::blocking::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|error| format!("Impossible de créer le client API SteamGridDB : {error}"))
}

fn ensure_steamgriddb_success<T>(
    response: SteamGridDbApiResponse<T>,
    context: &str,
) -> Result<T, String> {
    if response.success {
        Ok(response.data)
    } else {
        Err(format!("SteamGridDB a refusé la requête : {context}"))
    }
}

fn steamgriddb_search_path(term: &str) -> String {
    let encoded_term = term
        .trim()
        .replace('/', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("%20");

    format!("/search/autocomplete/{encoded_term}")
}
fn search_steamgriddb_games(
    client: &reqwest::blocking::Client,
    term: &str,
) -> Result<Vec<SteamGridDbGameResponse>, String> {
    let search_path = steamgriddb_search_path(term);

    let response = client
        .get(format!("{STEAMGRIDDB_API_BASE_URL}{search_path}"))
        .send()
        .map_err(|error| format!("Recherche SteamGridDB impossible : {error}"))?;

    let status = response.status();

    let body = response
        .text()
        .map_err(|error| format!("Impossible de lire la réponse SteamGridDB : {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "Recherche SteamGridDB refusée : HTTP {status}.\n\nEndpoint appelé : {search_path}\n\nRéponse : {body}"
        ));
    }

    let payload = serde_json::from_str::<SteamGridDbApiResponse<Vec<SteamGridDbGameResponse>>>(&body)
        .map_err(|error| {
            format!(
                "Réponse de recherche SteamGridDB invalide : {error}\n\nEndpoint appelé : {search_path}\n\nRéponse reçue : {body}"
            )
        })?;

    ensure_steamgriddb_success(payload, "recherche de jeu")
}

fn fetch_icons_for_game_page(
    client: &reqwest::blocking::Client,
    game_id: u64,
    page: u32,
    limit: u32,
) -> Result<Vec<SteamGridDbAssetResponse>, String> {
    let endpoint = format!("/icons/game/{game_id}");
    let page = page.min(100);
    let limit = limit.clamp(1, 50);

    let response = client
        .get(format!("{STEAMGRIDDB_API_BASE_URL}{endpoint}"))
        .query(&[
            ("types", "static"),
            ("nsfw", "false"),
            ("humor", "false"),
            ("epilepsy", "false"),
            ("limit", &limit.to_string()),
            ("page", &page.to_string()),
        ])
        .send()
        .map_err(|error| format!("Récupération des icônes SteamGridDB impossible : {error}"))?;

    let status = response.status();

    let body = response
        .text()
        .map_err(|error| format!("Impossible de lire la réponse d’icônes SteamGridDB : {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "Récupération des icônes SteamGridDB refusée : HTTP {status}.\n\nEndpoint appelé : {endpoint}\n\nRéponse : {body}"
        ));
    }

    let payload = serde_json::from_str::<SteamGridDbApiResponse<Vec<SteamGridDbAssetResponse>>>(&body)
        .map_err(|error| {
            format!(
                "Réponse d’icônes SteamGridDB invalide : {error}\n\nEndpoint appelé : {endpoint}\n\nRéponse reçue : {body}"
            )
        })?;

    ensure_steamgriddb_success(payload, "récupération des icônes")
}

fn icon_distance_from_target(asset: &SteamGridDbAssetResponse) -> u32 {
    let width = asset.width.unwrap_or(144);
    let height = asset.height.unwrap_or(144);

    width.abs_diff(144) + height.abs_diff(144)
}

fn sort_icons_by_144_preference(icons: &mut [SteamGridDbAssetResponse]) {
    icons.sort_by(|a, b| {
        let a_is_large_enough = a.width.unwrap_or(0) >= 144 && a.height.unwrap_or(0) >= 144;
        let b_is_large_enough = b.width.unwrap_or(0) >= 144 && b.height.unwrap_or(0) >= 144;

        b_is_large_enough
            .cmp(&a_is_large_enough)
            .then_with(|| icon_distance_from_target(a).cmp(&icon_distance_from_target(b)))
            .then_with(|| b.score.unwrap_or(0).cmp(&a.score.unwrap_or(0)))
    });
}

fn asset_response_to_icon_asset(asset: SteamGridDbAssetResponse) -> SteamGridDbIconAsset {
    SteamGridDbIconAsset {
        id: asset.id,
        score: asset.score,
        style: asset.style,
        url: asset.url,
        thumb: asset.thumb,
        width: asset.width,
        height: asset.height,
    }
}

fn game_response_to_game(game: SteamGridDbGameResponse) -> SteamGridDbGame {
    SteamGridDbGame {
        id: game.id,
        name: game.name,
        release_date: game.release_date,
        verified: game.verified,
    }
}


#[tauri::command]
pub fn save_steamgriddb_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    write_steamgriddb_config(
        &app,
        &SteamGridDbConfig {
            api_key: api_key.trim().to_string(),
        },
    )
}

#[tauri::command]
pub fn get_steamgriddb_api_key(app: AppHandle) -> Result<Option<String>, String> {
    let config = read_steamgriddb_config(&app)?;
    let api_key = config.api_key.trim();

    if api_key.is_empty() {
        Ok(None)
    } else {
        Ok(Some(api_key.to_string()))
    }
}

fn sanitize_download_name(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else if character.is_whitespace() || character == ':' || character == '/' || character == '\\' {
                '_'
            } else {
                '_'
            }
        })
        .collect();

    let sanitized = sanitized
        .split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_");

    if sanitized.is_empty() {
        "SteamGridDB_Icon".to_string()
    } else {
        sanitized
    }
}

fn file_name_from_game_name(game_name: &str, asset_id: u64) -> String {
    let clean_game_name = sanitize_download_name(game_name);

    format!("{clean_game_name}_sgdb_{asset_id}.png")
}
#[tauri::command]
pub fn test_steamgriddb_api_key(app: AppHandle) -> Result<String, String> {
    let api_key = steamgriddb_api_key(&app)?;
    let client = steamgriddb_api_client(&api_key)?;
    let search_path = steamgriddb_search_path("portal");

    let response = client
        .get(format!("{STEAMGRIDDB_API_BASE_URL}{search_path}"))
        .send()
        .map_err(|error| format!("Impossible de tester la clé SteamGridDB : {error}"))?;

    let status = response.status();

    let body = response
        .text()
        .map_err(|error| format!("Impossible de lire la réponse SteamGridDB : {error}"))?;

    if status.is_success() {
        let payload = serde_json::from_str::<SteamGridDbApiResponse<Vec<SteamGridDbGameResponse>>>(&body)
            .map_err(|error| {
                format!(
                    "Réponse de test SteamGridDB invalide : {error}\n\nEndpoint appelé : {search_path}\n\nRéponse reçue : {body}"
                )
            })?;

        if payload.success {
            Ok("Clé SteamGridDB valide.".to_string())
        } else {
            Err("SteamGridDB a refusé la clé API.".to_string())
        }
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        Err("Clé SteamGridDB invalide ou non autorisée.".to_string())
    } else {
        Err(format!(
            "Impossible de valider la clé SteamGridDB : HTTP {status}.\n\nEndpoint appelé : {search_path}\n\nRéponse : {body}"
        ))
    }
}

#[tauri::command]
pub fn search_steamgriddb_icons(
    app: AppHandle,
    game_name: String,
) -> Result<SteamGridDbIconPageResult, String> {
    search_steamgriddb_icon_page(app, game_name, 0, 50)
}

#[tauri::command]
pub fn search_steamgriddb_icon_page(
    app: AppHandle,
    game_name: String,
    page: u32,
    limit: u32,
) -> Result<SteamGridDbIconPageResult, String> {
    let game_name = game_name.trim();

    if game_name.is_empty() {
        return Err("Nom de jeu vide.".to_string());
    }

    let limit = limit.clamp(1, 50);

    let api_key = steamgriddb_api_key(&app)?;
    let client = steamgriddb_api_client(&api_key)?;

    let games = search_steamgriddb_games(&client, game_name)?;

    let game = games
        .into_iter()
        .next()
        .ok_or_else(|| format!("Aucun jeu SteamGridDB trouvé pour “{game_name}”."))?;

    let game_id = game.id;
    let game = game_response_to_game(game);

    let mut icons = fetch_icons_for_game_page(&client, game_id, page, limit)?;
    sort_icons_by_144_preference(&mut icons);

    let has_more = icons.len() == limit as usize;

    Ok(SteamGridDbIconPageResult {
        game,
        icons: icons
            .into_iter()
            .map(asset_response_to_icon_asset)
            .collect(),
        page,
        limit,
        has_more,
    })
}

#[tauri::command]
pub fn download_steamgriddb_icon_asset(
    app: AppHandle,
    asset_id: u64,
    url: String,
    game_name: String,
) -> Result<IconEntry, String> {
    let client = collection_http_client()?;

    let response = client
        .get(&url)
        .send()
        .map_err(|error| format!("Téléchargement de l’icône SteamGridDB impossible : {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Téléchargement de l’icône SteamGridDB refusé : HTTP {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .map_err(|error| format!("Impossible de lire l’image SteamGridDB : {error}"))?;

    let file_name = file_name_from_game_name(&game_name, asset_id);

    save_image_bytes_as_icon(&app, &bytes, &file_name)
}

fn normalize_collection_icons_url(url: &str) -> String {
    let base = url
        .split('?')
        .next()
        .unwrap_or(url)
        .trim()
        .trim_end_matches('/');

    if base.ends_with("/icons") {
        base.to_string()
    } else {
        format!("{base}/icons")
    }
}

fn collection_http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) SD Icon Manager")
        .build()
        .map_err(|error| format!("Impossible de créer le client HTTP SteamGridDB : {error}"))
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("\\/", "/")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
}

fn extract_icon_urls_from_collection_html(html: &str) -> Result<Vec<String>, String> {
    let regex = Regex::new(
        r#"https?://(?:cdn\d*\.)?steamgriddb\.com/[^"'\s<>\\]+?\.(?:png|jpg|jpeg|webp)"#,
    )
    .map_err(|error| format!("Regex SteamGridDB invalide : {error}"))?;

    let mut urls = Vec::new();

    for match_ in regex.find_iter(html) {
        let url = decode_html_entities(match_.as_str());

        let lower_url = url.to_lowercase();

        let looks_like_icon = lower_url.contains("/icon/")
            || lower_url.contains("/icons/")
            || lower_url.contains("icon");

        if looks_like_icon && !urls.contains(&url) {
            urls.push(url);
        }
    }

    Ok(urls)
}

fn file_name_from_steamgriddb_url(url: &str, index: usize) -> String {
    let raw_name = url
        .split('?')
        .next()
        .unwrap_or(url)
        .split('/')
        .last()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("icon.png");

    if raw_name.contains('.') {
        format!("sgdb_{index}_{raw_name}")
    } else {
        format!("sgdb_{index}_{raw_name}.png")
    }
}

fn extract_collection_id(url: &str) -> Result<String, String> {
    let regex = Regex::new(r"steamgriddb\.com/collection/([0-9]+)")
        .map_err(|error| format!("Regex SteamGridDB invalide : {error}"))?;

    regex
        .captures(url)
        .and_then(|captures| captures.get(1))
        .map(|match_| match_.as_str().to_string())
        .ok_or_else(|| "URL de collection SteamGridDB invalide.".to_string())
}

fn download_steamgriddb_collection_from_public_page(
    app: &AppHandle,
    url: &str,
) -> Result<SteamGridDbImportResult, String> {
    let page_url = normalize_collection_icons_url(url);
    let client = collection_http_client()?;

    let response = client
        .get(&page_url)
        .send()
        .map_err(|error| format!("Impossible de charger la collection SteamGridDB : {error}"))?;

    let status = response.status();

    if !status.is_success() {
        let body = response
            .text()
            .unwrap_or_else(|_| "Impossible de lire la réponse SteamGridDB.".to_string());

        return Err(format!(
            "Impossible de charger la collection SteamGridDB : HTTP {status}.\n\nURL appelée : {page_url}\n\nRéponse : {body}"
        ));
    }

    let html = response
        .text()
        .map_err(|error| format!("Impossible de lire la page SteamGridDB : {error}"))?;

    let icon_urls = extract_icon_urls_from_collection_html(&html)?;

    if icon_urls.is_empty() {
        return Err(format!(
            "Aucune icône trouvée dans la page SteamGridDB.\n\nURL appelée : {page_url}\n\nLe site a peut-être changé son HTML ou charge les images dynamiquement."
        ));
    }

    let mut result = SteamGridDbImportResult {
        found: icon_urls.len(),
        downloaded: 0,
        failed: 0,
        icons: Vec::new(),
    };

    for (index, icon_url) in icon_urls.iter().enumerate() {
        match client.get(icon_url).send() {
            Ok(response) if response.status().is_success() => {
                match response.bytes() {
                    Ok(bytes) => {
                        let file_name = file_name_from_steamgriddb_url(icon_url, index + 1);

                        match save_image_bytes_as_icon(app, &bytes, &file_name) {
                            Ok(icon) => {
                                result.downloaded += 1;
                                result.icons.push(icon);
                            }
                            Err(error) => {
                                eprintln!("Impossible d'importer l'icône SteamGridDB {icon_url} : {error}");
                                result.failed += 1;
                            }
                        }
                    }
                    Err(error) => {
                        eprintln!("Impossible de lire l'image SteamGridDB {icon_url} : {error}");
                        result.failed += 1;
                    }
                }
            }
            Ok(response) => {
                eprintln!(
                    "Téléchargement refusé pour {icon_url} : HTTP {}",
                    response.status()
                );
                result.failed += 1;
            }
            Err(error) => {
                eprintln!("Téléchargement impossible pour {icon_url} : {error}");
                result.failed += 1;
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn download_icons_from_steamgriddb_collection(
    app: AppHandle,
    url: String,
) -> Result<SteamGridDbImportResult, String> {
    extract_collection_id(&url)?;

    download_steamgriddb_collection_from_public_page(&app, &url)
}