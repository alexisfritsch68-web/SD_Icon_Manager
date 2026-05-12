use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;

use crate::commands::storage::{
    get_library_path, get_output_packs_path, get_packs_file_path, icon_exists,
};

const PACK_AUTHOR: &str = "Arckanics_Reiko";
const PACK_VERSION: &str = "1.0.0";
const STREAM_DECK_ICON_PACK_EXTENSION: &str = "streamDeckIconPack";
const DEFAULT_PACK_DESCRIPTION: &str = "Pack d'icônes généré avec SD Icon Manager.";
const DEFAULT_PACK_CATEGORY: &str = "Gaming";
const DEFAULT_PACK_LICENSE: &str =
    "Generated icon pack. Icons remain the property of their respective owners.";
const PACK_LICENSE_FILE: &str = "license.txt";
const PACK_ICON_FILE: &str = "icon.png";

#[derive(Serialize, Deserialize, Clone)]
pub struct PackMetadata {
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub license: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PackData {
    pub icons: Vec<String>,
    pub metadata: PackMetadata,
}

#[derive(Serialize, Deserialize, Default)]
pub struct PacksData {
    pub packs: BTreeMap<String, PackData>,
}

#[derive(Deserialize, Default)]
struct LegacyPacksData {
    pub packs: BTreeMap<String, Vec<String>>,
}

#[derive(Serialize)]
pub struct PackInfo {
    pub name: String,
    pub icons: Vec<String>,
    pub metadata: PackMetadata,
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

    match serde_json::from_str::<PacksData>(&content) {
        Ok(packs_data) => Ok(packs_data),
        Err(new_format_error) => {
            let legacy_packs_data =
                serde_json::from_str::<LegacyPacksData>(&content).map_err(|legacy_error| {
                    format!(
                        "Fichier packs.json invalide : {new_format_error}. Migration ancien format impossible : {legacy_error}"
                    )
                })?;

            let packs_data = PacksData {
                packs: legacy_packs_data
                    .packs
                    .into_iter()
                    .map(|(name, icons)| {
                        (
                            name.clone(),
                            PackData {
                                icons,
                                metadata: default_pack_metadata(&name),
                            },
                        )
                    })
                    .collect(),
            };

            save_packs_data(app, &packs_data)?;

            Ok(packs_data)
        }
    }
}

fn save_packs_data(app: &AppHandle, packs_data: &PacksData) -> Result<(), String> {
    let packs_path = get_packs_file_path(app)?;

    if let Some(parent) = packs_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Impossible de créer le dossier des packs : {error}"))?;
    }

    let content = serde_json::to_string_pretty(packs_data)
        .map_err(|error| format!("Impossible de sérialiser les packs : {error}"))?;

    fs::write(&packs_path, content)
        .map_err(|error| format!("Impossible d'enregistrer les packs : {error}"))
}

fn default_pack_metadata(name: &str) -> PackMetadata {
    PackMetadata {
        name: name.to_string(),
        author: PACK_AUTHOR.to_string(),
        version: PACK_VERSION.to_string(),
        description: DEFAULT_PACK_DESCRIPTION.to_string(),
        category: DEFAULT_PACK_CATEGORY.to_string(),
        tags: vec![DEFAULT_PACK_CATEGORY.to_string()],
        license: DEFAULT_PACK_LICENSE.to_string(),
    }
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
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn clean_export_icon_stem(value: &str) -> String {
    let cleaned = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if cleaned.is_empty() {
        "icon".to_string()
    } else {
        cleaned
    }
}

fn export_icon_file_name(icon_id: &str, index: usize) -> Result<String, String> {
    let stem = Path::new(icon_id)
        .file_stem()
        .ok_or_else(|| format!("Nom de fichier d'icône invalide : {icon_id}"))?
        .to_string_lossy();

    let cleaned = clean_export_icon_stem(&stem);

    if index == 1 {
        Ok(format!("{cleaned}.png"))
    } else {
        Ok(format!("{cleaned}-{index}.png"))
    }
}

fn export_icon_display_name(icon_file_name: &str) -> String {
    Path::new(icon_file_name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .replace('-', " ")
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

fn clean_metadata_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn clean_metadata_tags(tags: Vec<String>) -> Vec<String> {
    let mut cleaned = Vec::new();

    for tag in tags {
        let tag = clean_metadata_text(&tag);

        if !tag.is_empty() && !cleaned.contains(&tag) {
            cleaned.push(tag);
        }
    }

    if cleaned.is_empty() {
        cleaned.push(DEFAULT_PACK_CATEGORY.to_string());
    }

    cleaned
}

fn validate_pack_metadata(metadata: PackMetadata) -> Result<PackMetadata, String> {
    let name = clean_metadata_text(&metadata.name);
    let author = clean_metadata_text(&metadata.author);
    let version = clean_metadata_text(&metadata.version);
    let description = clean_metadata_text(&metadata.description);
    let category = clean_metadata_text(&metadata.category);
    let license = metadata.license.trim().to_string();

    if name.is_empty() {
        return Err("Le nom du pack est vide.".to_string());
    }

    if author.is_empty() {
        return Err("L'auteur du pack est vide.".to_string());
    }

    if version.is_empty() {
        return Err("La version du pack est vide.".to_string());
    }

    if description.is_empty() {
        return Err("La description du pack est vide.".to_string());
    }

    if category.is_empty() {
        return Err("La catégorie du pack est vide.".to_string());
    }

    if license.is_empty() {
        return Err("La licence du pack est vide.".to_string());
    }

    Ok(PackMetadata {
        name,
        author,
        version,
        description,
        category,
        tags: clean_metadata_tags(metadata.tags),
        license,
    })
}

fn clean_bundle_identifier_part(value: &str, fallback: &str) -> String {
    let cleaned = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '.'
            }
        })
        .collect::<String>()
        .split('.')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".");

    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn pack_bundle_id(metadata: &PackMetadata) -> String {
    let author = clean_bundle_identifier_part(&metadata.author, "author");
    let pack_name = clean_bundle_identifier_part(&metadata.name, "pack");

    format!("com.{author}.{pack_name}")
}

fn pack_bundle_folder_name(metadata: &PackMetadata) -> String {
    format!("{}.sdIconPack", pack_bundle_id(metadata))
}

fn bundle_path(bundle_folder: &str, path: &str) -> String {
    format!("{bundle_folder}/{path}")
}

fn icon_pack_manifest_path(bundle_folder: &str) -> String {
    bundle_path(bundle_folder, "manifest.json")
}

fn icon_pack_icons_json_path(bundle_folder: &str) -> String {
    bundle_path(bundle_folder, "icons.json")
}

fn icon_pack_license_path(bundle_folder: &str) -> String {
    bundle_path(bundle_folder, PACK_LICENSE_FILE)
}

fn icon_pack_icon_path(bundle_folder: &str) -> String {
    bundle_path(bundle_folder, PACK_ICON_FILE)
}

fn ensure_streamdeck_icon_pack_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_some_and(|extension| {
        extension
            .to_string_lossy()
            .eq_ignore_ascii_case(STREAM_DECK_ICON_PACK_EXTENSION)
    }) {
        path
    } else {
        path.with_extension(STREAM_DECK_ICON_PACK_EXTENSION)
    }
}

fn validate_icon_id(icon_id: &str) -> Result<(), String> {
    if icon_id.trim().is_empty() {
        return Err("Identifiant d'icône vide.".to_string());
    }

    let path = Path::new(icon_id);

    if path.is_absolute() {
        return Err(format!("Identifiant d'icône invalide : {icon_id}"));
    }

    let mut components = path.components();

    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => {}
        _ => return Err(format!("Identifiant d'icône invalide : {icon_id}")),
    }

    if path.file_name().is_none() || path.file_stem().is_none() {
        return Err(format!("Nom de fichier d'icône invalide : {icon_id}"));
    }

    if !path
        .extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("png"))
    {
        return Err(format!(
            "Format d'icône non supporté dans le pack : {icon_id}. Seuls les fichiers PNG sont acceptés."
        ));
    }

    Ok(())
}

fn icon_name_from_id(icon_id: &str) -> Result<String, String> {
    let icon_name = Path::new(icon_id)
        .file_stem()
        .ok_or_else(|| format!("Nom de fichier d'icône invalide : {icon_id}"))?
        .to_string_lossy()
        .trim()
        .to_string();

    if icon_name.is_empty() {
        Err(format!("Nom d'icône vide pour : {icon_id}"))
    } else {
        Ok(icon_name)
    }
}

fn temporary_output_path(output_file: &Path) -> Result<PathBuf, String> {
    let file_name = output_file
        .file_name()
        .ok_or_else(|| "Chemin d'export invalide.".to_string())?
        .to_string_lossy();

    let mut temporary_file = output_file.to_path_buf();
    temporary_file.set_file_name(format!("{file_name}.tmp"));

    Ok(temporary_file)
}

fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|error| format!("Impossible de remplacer le pack existant : {error}"))?;
    }

    fs::rename(source, destination)
        .map_err(|error| format!("Impossible de déplacer le pack final : {error}"))
}

fn create_pack_icon_svg(pack_name: &str) -> String {
    let first_letter = pack_name
        .chars()
        .find(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_uppercase())
        .unwrap_or('S');

    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
  <rect width="56" height="56" rx="12" fill="#202124"/>
  <rect x="4" y="4" width="48" height="48" rx="10" fill="#2f3136"/>
  <text x="28" y="36" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" fill="#ffffff">{first_letter}</text>
</svg>
"##
    )
}

fn create_pack_archive(
    metadata: &PackMetadata,
    icon_ids: &[String],
    library_path: &Path,
    output_file: &Path,
) -> Result<usize, String> {
    if icon_ids.is_empty() {
        return Err("Le pack est vide.".to_string());
    }

    if let Some(parent) = output_file.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Impossible de créer le dossier d'export : {error}"))?;
    }

    let temporary_file = temporary_output_path(output_file)?;

    if temporary_file.exists() {
        fs::remove_file(&temporary_file)
            .map_err(|error| format!("Impossible de nettoyer un export temporaire précédent : {error}"))?;
    }

    let build_result = (|| {
        let file = File::create(&temporary_file)
            .map_err(|error| format!("Impossible de créer le pack temporaire : {error}"))?;

        let mut zip = zip::ZipWriter::new(file);

        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let bundle_id = pack_bundle_id(metadata);
        let bundle_folder = format!("{bundle_id}.sdIconPack");

        zip.add_directory(format!("{bundle_folder}/"), options)
            .map_err(|error| format!("Impossible de créer le dossier du pack : {error}"))?;

        zip.add_directory(bundle_path(&bundle_folder, "icons/"), options)
            .map_err(|error| format!("Impossible de créer le dossier des icônes : {error}"))?;

        let mut seen_icon_ids = BTreeSet::new();
        let mut used_export_file_names = BTreeSet::new();
        let mut icons_metadata = Vec::new();
        let mut pack_icon_bytes: Option<Vec<u8>> = None;

        for icon_id in icon_ids {
            validate_icon_id(icon_id)?;

            if !seen_icon_ids.insert(icon_id.clone()) {
                continue;
            }

            let icon_path = library_path.join(icon_id);

            if !icon_path.is_file() {
                return Err(format!("Icône introuvable dans l'iconothèque : {icon_id}"));
            }

            let bytes = fs::read(&icon_path)
                .map_err(|error| format!("Impossible de lire l'icône {icon_id} : {error}"))?;

            if pack_icon_bytes.is_none() {
                pack_icon_bytes = Some(bytes.clone());
            }

            let mut export_index = 1;
            let export_icon_file_name = loop {
                let candidate = export_icon_file_name(icon_id, export_index)?;

                if used_export_file_names.insert(candidate.clone()) {
                    break candidate;
                }

                export_index += 1;
            };

            let relative_icon_path = export_icon_file_name.clone();
            let root_zip_icon_path = bundle_path(&bundle_folder, &export_icon_file_name);
            let icons_folder_zip_icon_path = bundle_path(
                &bundle_folder,
                &format!("icons/{export_icon_file_name}"),
            );

            zip.start_file(&root_zip_icon_path, options)
                .map_err(|error| format!("Impossible d'ajouter l'icône {icon_id} au pack : {error}"))?;

            zip.write_all(&bytes)
                .map_err(|error| format!("Impossible d'écrire l'icône {icon_id} dans le pack : {error}"))?;

            zip.start_file(&icons_folder_zip_icon_path, options)
                .map_err(|error| format!("Impossible d'ajouter la copie d'icône {icon_id} au pack : {error}"))?;

            zip.write_all(&bytes)
                .map_err(|error| format!("Impossible d'écrire la copie d'icône {icon_id} dans le pack : {error}"))?;

            icons_metadata.push(serde_json::json!({
                "path": relative_icon_path,
                "name": export_icon_display_name(&export_icon_file_name),
                "tags": metadata.tags
            }));
        }

        if icons_metadata.is_empty() {
            return Err("Aucune icône valide à exporter dans ce pack.".to_string());
        }

        let manifest = serde_json::json!({
            "Author": metadata.author,
            "Description": metadata.description,
            "Name": metadata.name,
            "URL": "",
            "Version": metadata.version,
            "Icon": PACK_ICON_FILE,
            "Tags": metadata.tags.join(", "),
            "StreamdeckID": bundle_id
        });

        zip.start_file(icon_pack_manifest_path(&bundle_folder), options)
            .map_err(|error| format!("Impossible de créer le manifest : {error}"))?;

        let manifest_content = serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("Impossible de générer le manifest : {error}"))?;

        zip.write_all(manifest_content.as_bytes())
            .map_err(|error| format!("Impossible d'écrire le manifest : {error}"))?;

        zip.start_file(icon_pack_icons_json_path(&bundle_folder), options)
            .map_err(|error| format!("Impossible de créer icons.json : {error}"))?;

        let icons_content = serde_json::to_string_pretty(&icons_metadata)
            .map_err(|error| format!("Impossible de générer icons.json : {error}"))?;

        zip.write_all(icons_content.as_bytes())
            .map_err(|error| format!("Impossible d'écrire icons.json : {error}"))?;

        zip.start_file(icon_pack_license_path(&bundle_folder), options)
            .map_err(|error| format!("Impossible de créer la licence : {error}"))?;

        zip.write_all(metadata.license.as_bytes())
            .map_err(|error| format!("Impossible d'écrire la licence : {error}"))?;

        zip.start_file(icon_pack_icon_path(&bundle_folder), options)
            .map_err(|error| format!("Impossible de créer l'icône du pack : {error}"))?;

        let pack_icon_bytes = pack_icon_bytes
            .ok_or_else(|| "Impossible de générer l'icône du pack.".to_string())?;

        zip.write_all(&pack_icon_bytes)
            .map_err(|error| format!("Impossible d'écrire l'icône du pack : {error}"))?;

        zip.finish()
            .map_err(|error| format!("Impossible de finaliser le pack : {error}"))?;

        Ok(icons_metadata.len())
    })();

    match build_result {
        Ok(icon_count) => {
            replace_file(&temporary_file, output_file)?;
            Ok(icon_count)
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary_file);
            Err(error)
        }
    }
}

fn build_pack_at_path(
    app: &AppHandle,
    pack_name: String,
    output_file: PathBuf,
) -> Result<BuildPackResult, String> {
    let output_file = ensure_streamdeck_icon_pack_extension(output_file);
    let packs_data = load_packs_data(app)?;
    let library_path = get_library_path(app)?;

    let pack = packs_data
        .packs
        .get(&pack_name)
        .ok_or_else(|| "Pack introuvable.".to_string())?;

    let icon_count = create_pack_archive(
        &pack.metadata,
        &pack.icons,
        &library_path,
        &output_file,
    )?;

    Ok(BuildPackResult {
        pack_name: pack.metadata.name.clone(),
        icon_count,
        output_path: output_file.to_string_lossy().to_string(),
    })
}

pub fn remove_icons_from_all_packs(app: &AppHandle, icon_ids: &[String]) -> Result<(), String> {
    if icon_ids.is_empty() {
        return Ok(());
    }

    let mut packs_data = load_packs_data(app)?;
    let icon_ids_to_remove = icon_ids.iter().collect::<BTreeSet<_>>();

    for pack in packs_data.packs.values_mut() {
        pack.icons
            .retain(|icon_id| !icon_ids_to_remove.contains(icon_id));
    }

    save_packs_data(app, &packs_data)
}

#[tauri::command]
pub fn get_packs(app: AppHandle) -> Result<Vec<PackInfo>, String> {
    let packs_data = load_packs_data(&app)?;

    Ok(packs_data
        .packs
        .into_iter()
        .map(|(name, pack)| PackInfo {
            name,
            icons: pack.icons,
            metadata: pack.metadata,
        })
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

    packs_data.packs.insert(
        name.clone(),
        PackData {
            icons: Vec::new(),
            metadata: default_pack_metadata(&name),
        },
    );

    save_packs_data(&app, &packs_data)?;

    get_packs(app)
}

#[tauri::command]
pub fn delete_pack(app: AppHandle, name: String) -> Result<Vec<PackInfo>, String> {
    let mut packs_data = load_packs_data(&app)?;

    if packs_data.packs.remove(&name).is_none() {
        return Err("Pack introuvable.".to_string());
    }

    save_packs_data(&app, &packs_data)?;

    get_packs(app)
}

#[tauri::command]
pub fn update_pack_metadata(
    app: AppHandle,
    pack_name: String,
    metadata: PackMetadata,
) -> Result<Vec<PackInfo>, String> {
    let mut packs_data = load_packs_data(&app)?;
    let metadata = validate_pack_metadata(metadata)?;

    if metadata.name != pack_name && packs_data.packs.contains_key(&metadata.name) {
        return Err("Un pack avec ce nom existe déjà.".to_string());
    }

    let mut pack = packs_data
        .packs
        .remove(&pack_name)
        .ok_or_else(|| "Pack introuvable.".to_string())?;

    pack.metadata = metadata.clone();

    packs_data.packs.insert(metadata.name.clone(), pack);
    save_packs_data(&app, &packs_data)?;

    get_packs(app)
}

#[tauri::command]
pub fn add_icons_to_pack(
    app: AppHandle,
    pack_name: String,
    icon_ids: Vec<String>,
) -> Result<Vec<PackInfo>, String> {
    if icon_ids.is_empty() {
        return get_packs(app);
    }

    let mut packs_data = load_packs_data(&app)?;

    {
        let pack = packs_data
            .packs
            .get_mut(&pack_name)
            .ok_or_else(|| "Pack introuvable.".to_string())?;

        for icon_id in icon_ids {
            validate_icon_id(&icon_id)?;

            if !icon_exists(&app, &icon_id) {
                return Err(format!("Icône introuvable dans l'iconothèque : {icon_id}"));
            }

            if !pack.icons.contains(&icon_id) {
                pack.icons.push(icon_id);
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
    if icon_ids.is_empty() {
        return get_packs(app);
    }

    let mut packs_data = load_packs_data(&app)?;

    {
        let pack = packs_data
            .packs
            .get_mut(&pack_name)
            .ok_or_else(|| "Pack introuvable.".to_string())?;

        let icon_ids_to_remove = icon_ids.iter().collect::<BTreeSet<_>>();

        pack.icons
            .retain(|icon_id| !icon_ids_to_remove.contains(icon_id));
    }

    save_packs_data(&app, &packs_data)?;

    get_packs(app)
}

#[tauri::command]
pub fn build_pack(app: AppHandle, pack_name: String) -> Result<BuildPackResult, String> {
    let output_path = get_output_packs_path(&app)?;

    let output_file = output_path.join(format!(
        "{}.{}",
        clean_output_file_name(&pack_name),
        STREAM_DECK_ICON_PACK_EXTENSION
    ));

    build_pack_at_path(&app, pack_name, output_file)
}

#[tauri::command]
pub fn build_pack_to_path(
    app: AppHandle,
    pack_name: String,
    output_path: String,
) -> Result<BuildPackResult, String> {
    let output_path = output_path.trim();

    if output_path.is_empty() {
        return Err("Chemin d'export vide.".to_string());
    }

    build_pack_at_path(&app, pack_name, PathBuf::from(output_path))
}