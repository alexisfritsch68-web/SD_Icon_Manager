use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;

use crate::commands::library::{save_image_bytes_as_icon, IconEntry};
use crate::commands::storage::get_steamgriddb_config_path;

const STEAMGRIDDB_API_BASE_URL: &str = "https://www.steamgriddb.com/api/v2";

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

#[derive(Deserialize)]
struct SteamGridDbApiResponse<T> {
    success: bool,
    data: T,
}

// ... existing code ...

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