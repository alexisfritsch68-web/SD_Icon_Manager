use base64::{engine::general_purpose, Engine as _};
use image::{imageops::FilterType, DynamicImage, GenericImageView, RgbaImage};
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

use crate::commands::storage::{get_library_path, path_from_icon_id};

const ICON_SIZE: u32 = 144;
const MIN_DIMENSION: u32 = 72;

#[derive(Serialize)]
pub struct IconEntry {
    pub id: String,
    pub name: String,
    pub data_url: String,
}

#[derive(Serialize)]
pub struct RescanResult {
    pub scanned: usize,
    pub transformed: usize,
    pub failed: usize,
}

fn sanitize_file_stem(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();

    let sanitized: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect();

    let sanitized = sanitized.trim_matches('_');

    if sanitized.is_empty() {
        "icone".to_string()
    } else {
        sanitized.to_string()
    }
}

fn unique_png_path(library_path: &Path, original_name: &str) -> std::path::PathBuf {
    let base_name = sanitize_file_stem(original_name);
    let mut candidate = library_path.join(format!("{base_name}.png"));

    if !candidate.exists() {
        return candidate;
    }

    let mut index = 2;

    loop {
        candidate = library_path.join(format!("{base_name}_{index}.png"));

        if !candidate.exists() {
            return candidate;
        }

        index += 1;
    }
}

fn is_supported_icon_file(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        extension.to_string_lossy().eq_ignore_ascii_case("png")
    })
}

fn normalize_icon_image(image: DynamicImage) -> Result<DynamicImage, String> {
    let image = image.to_rgba8();
    let image = DynamicImage::ImageRgba8(image);

    let (width, height) = image.dimensions();

    if width < MIN_DIMENSION || height < MIN_DIMENSION {
        return Err(format!(
            "Image trop petite : {width}x{height}. Minimum requis : {MIN_DIMENSION}x{MIN_DIMENSION}."
        ));
    }

    let scale = f32::min(
        ICON_SIZE as f32 / width as f32,
        ICON_SIZE as f32 / height as f32,
    );

    let resized_width = (width as f32 * scale).round().max(1.0) as u32;
    let resized_height = (height as f32 * scale).round().max(1.0) as u32;

    let resized = image
        .resize_exact(resized_width, resized_height, FilterType::Lanczos3)
        .to_rgba8();

    let mut canvas = RgbaImage::from_pixel(
        ICON_SIZE,
        ICON_SIZE,
        image::Rgba([0, 0, 0, 0]),
    );

    let x = ((ICON_SIZE - resized_width) / 2) as i64;
    let y = ((ICON_SIZE - resized_height) / 2) as i64;

    image::imageops::overlay(&mut canvas, &resized, x, y);

    Ok(DynamicImage::ImageRgba8(canvas))
}

fn icon_needs_normalization(image: &DynamicImage) -> bool {
    let (width, height) = image.dimensions();

    width != ICON_SIZE || height != ICON_SIZE
}

fn normalize_icon_file(path: &Path) -> Result<bool, String> {
    let image = image::open(path)
        .map_err(|error| format!("Impossible d'ouvrir l'image {:?} : {error}", path))?;

    if !icon_needs_normalization(&image) {
        return Ok(false);
    }

    let normalized_image = normalize_icon_image(image)?;

    normalized_image
        .save_with_format(path, image::ImageFormat::Png)
        .map_err(|error| format!("Impossible de normaliser l'image {:?} : {error}", path))?;

    Ok(true)
}

fn icon_entry_from_path(path: &Path) -> Result<IconEntry, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Impossible de lire l'icône : {error}"))?;

    let encoded = general_purpose::STANDARD.encode(bytes);
    let data_url = format!("data:image/png;base64,{encoded}");

    let id = path
        .file_name()
        .ok_or_else(|| "Nom de fichier d'icône invalide.".to_string())?
        .to_string_lossy()
        .to_string();

    let name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    Ok(IconEntry {
        id,
        name,
        data_url,
    })
}

fn save_image_as_png(
    app: &AppHandle,
    bytes: &[u8],
    original_name: &str,
) -> Result<IconEntry, String> {
    let library_path = get_library_path(app)?;

    let image = image::load_from_memory(bytes)
        .map_err(|error| format!("Image invalide ou format non supporté : {error}"))?;

    let normalized_image = normalize_icon_image(image)?;
    let destination = unique_png_path(&library_path, original_name);

    normalized_image
        .save_with_format(&destination, image::ImageFormat::Png)
        .map_err(|error| format!("Impossible d'enregistrer l'image : {error}"))?;

    icon_entry_from_path(&destination)
}

pub fn save_image_bytes_as_icon(
    app: &AppHandle,
    bytes: &[u8],
    original_name: &str,
) -> Result<IconEntry, String> {
    save_image_as_png(app, bytes, original_name)
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) SD Icon Manager")
        .build()
        .map_err(|error| format!("Impossible de créer le client HTTP : {error}"))
}

fn file_name_from_url(url: &str, fallback: &str) -> String {
    let raw_name = url
        .split('?')
        .next()
        .unwrap_or(url)
        .split('/')
        .last()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(fallback);

    if raw_name.contains('.') {
        raw_name.to_string()
    } else {
        format!("{raw_name}.png")
    }
}

fn download_direct_icon(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    url: &str,
) -> Result<IconEntry, String> {
    let response = client
        .get(url)
        .send()
        .map_err(|error| format!("Téléchargement impossible : {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Téléchargement refusé : HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .map_err(|error| format!("Impossible de lire la réponse : {error}"))?;

    let file_name = file_name_from_url(url, "icone.png");

    save_image_as_png(app, &bytes, &file_name)
}

#[tauri::command]
pub fn get_library(app: AppHandle) -> Result<Vec<IconEntry>, String> {
    let library_path = get_library_path(&app)?;
    let mut icons = Vec::new();

    let entries = fs::read_dir(&library_path)
        .map_err(|error| format!("Impossible de lire l'iconothèque : {error}"))?;

    for entry in entries.flatten() {
        let path = entry.path();

        if is_supported_icon_file(&path) {
            if let Ok(icon) = icon_entry_from_path(&path) {
                icons.push(icon);
            }
        }
    }

    icons.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(icons)
}

#[tauri::command]
pub fn rescan_library(app: AppHandle) -> Result<RescanResult, String> {
    let library_path = get_library_path(&app)?;

    let entries = fs::read_dir(&library_path)
        .map_err(|error| format!("Impossible de lire l'iconothèque : {error}"))?;

    let mut result = RescanResult {
        scanned: 0,
        transformed: 0,
        failed: 0,
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if !is_supported_icon_file(&path) {
            continue;
        }

        result.scanned += 1;

        match normalize_icon_file(&path) {
            Ok(true) => result.transformed += 1,
            Ok(false) => {}
            Err(error) => {
                eprintln!("{error}");
                result.failed += 1;
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn import_icon_from_data(
    app: AppHandle,
    file_name: String,
    data_url: String,
) -> Result<IconEntry, String> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, payload)| payload)
        .ok_or_else(|| "Données d'image invalides.".to_string())?;

    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Impossible de décoder l'image : {error}"))?;

    save_image_as_png(&app, &bytes, &file_name)
}

#[tauri::command]
pub fn download_icon_from_url(app: AppHandle, url: String) -> Result<IconEntry, String> {
    if url.contains("steamgriddb.com/collection/") {
        return Err("Les collections SteamGridDB doivent être importées via le module SteamGridDB.".to_string());
    }

    let client = http_client()?;

    download_direct_icon(&app, &client, &url)
}

#[tauri::command]
pub fn delete_icons(app: AppHandle, icon_ids: Vec<String>) -> Result<usize, String> {
    let mut deleted_count = 0;

    for icon_id in &icon_ids {
        let path = path_from_icon_id(&app, icon_id)?;

        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("Impossible de supprimer l'icône : {error}"))?;

            deleted_count += 1;
        }
    }

    crate::commands::packs::remove_icons_from_all_packs(&app, &icon_ids)?;

    Ok(deleted_count)
}