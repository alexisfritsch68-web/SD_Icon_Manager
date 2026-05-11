use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use tauri::AppHandle;
use zip::write::SimpleFileOptions;

use crate::commands::storage::{
    get_library_path,
    get_output_packs_path,
    get_packs_file_path,
    icon_exists,
};

const PACK_AUTHOR: &str = "Arckanics_Reiko";

#[derive(Serialize, Deserialize, Default)]
pub struct PacksData {
    pub packs: BTreeMap<String, Vec<String>>,
}

#[derive(Serialize)]
pub struct PackInfo {
    pub name: String,
    pub icons: Vec<String>,
}

#[derive(Serialize)]
pub struct BuildPackResult {
    pub pack_name: String,
    pub icon_count: usize,
    pub output_path: String,
}

fn load_packs_data(app: &AppHandle) -> Result<PacksData, String> {
    let packs_path = get_packs_file_path(app)?;

    if !packs_path.exists() {
        return Ok(PacksData::default());
    }

    let content = fs::read_to_string(&packs_path)
        .map_err(|error| format!("Impossible de lire les packs : {error}"))?;

    serde_json::from_str(&content)
        .map_err(|error| format!("Fichier packs.json invalide : {error}"))
}

fn save_packs_data(app: &AppHandle, packs_data: &PacksData) -> Result<(), String> {
    let packs_path = get_packs_file_path(app)?;

    let content = serde_json::to_string_pretty(packs_data)
        .map_err(|error| format!("Impossible de sérialiser les packs : {error}"))?;

    fs::write(&packs_path, content)
        .map_err(|error| format!("Impossible d'enregistrer les packs : {error}"))
}

fn clean_pack_name(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'
                || character == ' '
            {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn clean_output_file_name(name: &str) -> String {
    let cleaned = clean_pack_name(name).replace(' ', "_");

    if cleaned.is_empty() {
        "pack".to_string()
    } else {
        cleaned
    }
}

pub fn remove_icons_from_all_packs(app: &AppHandle, icon_ids: &[String]) -> Result<(), String> {
    let mut packs_data = load_packs_data(app)?;

    for pack in packs_data.packs.values_mut() {
        pack.retain(|icon_id| !icon_ids.contains(icon_id));
    }

    save_packs_data(app, &packs_data)
}

#[tauri::command]
pub fn get_packs(app: AppHandle) -> Result<Vec<PackInfo>, String> {
    let packs_data = load_packs_data(&app)?;

    Ok(packs_data
        .packs
        .into_iter()
        .map(|(name, icons)| PackInfo { name, icons })
        .collect())
}

#[tauri::command]
pub fn create_pack(app: AppHandle, name: String) -> Result<Vec<PackInfo>, String> {
    let name = clean_pack_name(&name);

    if name.is_empty() {
        return Err("Le nom du pack est vide.".to_string());
    }

    let mut packs_data = load_packs_data(&app)?;

    if packs_data.packs.contains_key(&name) {
        return Err("Un pack avec ce nom existe déjà.".to_string());
    }

    packs_data.packs.insert(name, Vec::new());
    save_packs_data(&app, &packs_data)?;

    get_packs(app)
}

#[tauri::command]
pub fn delete_pack(app: AppHandle, name: String) -> Result<Vec<PackInfo>, String> {
    let mut packs_data = load_packs_data(&app)?;

    packs_data.packs.remove(&name);
    save_packs_data(&app, &packs_data)?;

    get_packs(app)
}

#[tauri::command]
pub fn add_icons_to_pack(
    app: AppHandle,
    pack_name: String,
    icon_ids: Vec<String>,
) -> Result<Vec<PackInfo>, String> {
    let mut packs_data = load_packs_data(&app)?;

    {
        let pack = packs_data
            .packs
            .get_mut(&pack_name)
            .ok_or_else(|| "Pack introuvable.".to_string())?;

        for icon_id in icon_ids {
            if icon_exists(&app, &icon_id) && !pack.contains(&icon_id) {
                pack.push(icon_id);
            }
        }
    }

    save_packs_data(&app, &packs_data)?;

    get_packs(app)
}

#[tauri::command]
pub fn remove_icons_from_pack(
    app: AppHandle,
    pack_name: String,
    icon_ids: Vec<String>,
) -> Result<Vec<PackInfo>, String> {
    let mut packs_data = load_packs_data(&app)?;

    {
        let pack = packs_data
            .packs
            .get_mut(&pack_name)
            .ok_or_else(|| "Pack introuvable.".to_string())?;

        pack.retain(|icon_id| !icon_ids.contains(icon_id));
    }

    save_packs_data(&app, &packs_data)?;

    get_packs(app)
}

#[tauri::command]
pub fn build_pack(app: AppHandle, pack_name: String) -> Result<BuildPackResult, String> {
    let packs_data = load_packs_data(&app)?;
    let library_path = get_library_path(&app)?;
    let output_path = get_output_packs_path(&app)?;

    let icons = packs_data
        .packs
        .get(&pack_name)
        .ok_or_else(|| "Pack introuvable.".to_string())?;

    if icons.is_empty() {
        return Err("Le pack est vide.".to_string());
    }

    let output_file = output_path.join(format!(
        "{}.streamDeckIcons",
        clean_output_file_name(&pack_name)
    ));

    let file = File::create(&output_file)
        .map_err(|error| format!("Impossible de créer le pack : {error}"))?;

    let mut zip = zip::ZipWriter::new(file);

    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut manifest_icons = Vec::new();
    let mut icon_count = 0;

    for icon_id in icons {
        let icon_path = library_path.join(icon_id);

        if !icon_path.exists() {
            continue;
        }

        let zip_icon_path = format!("icons/{icon_id}");

        zip.start_file(&zip_icon_path, options)
            .map_err(|error| format!("Impossible d'ajouter une icône au pack : {error}"))?;

        let bytes = fs::read(&icon_path)
            .map_err(|error| format!("Impossible de lire une icône : {error}"))?;

        zip.write_all(&bytes)
            .map_err(|error| format!("Impossible d'écrire une icône dans le pack : {error}"))?;

        let icon_name = Path::new(icon_id)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        manifest_icons.push(serde_json::json!({
            "Name": icon_name,
            "Category": pack_name,
            "Tags": ["Gaming"],
            "Files": [
                {
                    "Path": zip_icon_path
                }
            ]
        }));

        icon_count += 1;
    }

    let manifest = serde_json::json!({
        "Name": pack_name,
        "Author": PACK_AUTHOR,
        "Version": "1.0.0",
        "Icons": manifest_icons
    });

    zip.start_file("manifest.json", options)
        .map_err(|error| format!("Impossible de créer le manifest : {error}"))?;

    let manifest_content = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("Impossible de générer le manifest : {error}"))?;

    zip.write_all(manifest_content.as_bytes())
        .map_err(|error| format!("Impossible d'écrire le manifest : {error}"))?;

    zip.finish()
        .map_err(|error| format!("Impossible de finaliser le pack : {error}"))?;

    Ok(BuildPackResult {
        pack_name,
        icon_count,
        output_path: output_file.to_string_lossy().to_string(),
    })
}