use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn get_app_data_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Impossible de trouver le dossier de données de l'application : {error}"))?;

    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|error| format!("Impossible de créer le dossier de données : {error}"))?;
    }

    fs::canonicalize(&path)
        .map_err(|error| format!("Impossible de résoudre le dossier de données : {error}"))
}

pub fn get_steamgriddb_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = get_app_data_path(app)?;
    path.push("steamgriddb.json");

    Ok(path)
}

pub fn get_library_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = get_app_data_path(app)?;
    path.push("icons");

    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|error| format!("Impossible de créer l'iconothèque : {error}"))?;
    }

    fs::canonicalize(&path)
        .map_err(|error| format!("Impossible de résoudre le chemin de l'iconothèque : {error}"))
}

pub fn get_packs_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = get_app_data_path(app)?;
    path.push("packs.json");

    Ok(path)
}

pub fn get_output_packs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = get_app_data_path(app)?;
    path.push("Output_Packs");

    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|error| format!("Impossible de créer le dossier de sortie des packs : {error}"))?;
    }

    fs::canonicalize(&path)
        .map_err(|error| format!("Impossible de résoudre le dossier de sortie des packs : {error}"))
}

pub fn path_from_icon_id(app: &AppHandle, icon_id: &str) -> Result<PathBuf, String> {
    let library_path = get_library_path(app)?;

    let file_name = Path::new(icon_id)
        .file_name()
        .ok_or_else(|| "Identifiant d'icône invalide.".to_string())?;

    let path = library_path.join(file_name);

    let canonical_path = fs::canonicalize(&path)
        .map_err(|error| format!("Chemin d'icône invalide : {error}"))?;

    if !canonical_path.starts_with(&library_path) {
        return Err("Accès refusé : l'icône demandée n'est pas dans l'iconothèque.".to_string());
    }

    Ok(canonical_path)
}

pub fn icon_exists(app: &AppHandle, icon_id: &str) -> bool {
    path_from_icon_id(app, icon_id).is_ok()
}