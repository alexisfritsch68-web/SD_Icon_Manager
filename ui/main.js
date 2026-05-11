const grid = document.getElementById('icon-grid');
const countBadge = document.querySelector('.badge');
const urlInput = document.getElementById('url-input');
const downloadBtn = document.getElementById('download-btn');
const steamGridDbApiKeyBtn = document.getElementById('steamgriddb-api-key-btn');
const localFilesBtn = document.getElementById('local-files-btn');
const fileInput = document.getElementById('file-input');
const rescanLibraryBtn = document.getElementById('rescan-library-btn');
const deleteSelectionBtn = document.getElementById('delete-selection-btn');

const selectedIconIds = new Set();

function isSteamGridDbCollectionUrl(url) {
    return url.includes('steamgriddb.com/collection/');
}

async function rescanLibrary() {
    rescanLibraryBtn.disabled = true;
    rescanLibraryBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">hourglass_empty</span> Scan...';

    setLoading('Rescan de l’iconothèque et optimisation des images...');

    try {
        const result = await window.__TAURI__.core.invoke('rescan_library');

        console.log('Résultat du rescan :', result);

        await loadLibrary();

        if (result.failed > 0) {
            alert(
                `Rescan terminé avec erreurs.\n\n` +
                `Images scannées : ${result.scanned}\n` +
                `Images transformées : ${result.transformed}\n` +
                `Échecs : ${result.failed}`
            );
        }
    } catch (error) {
        console.error('Erreur lors du rescan:', error);
        setError(error);
    } finally {
        rescanLibraryBtn.disabled = false;
        rescanLibraryBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">refresh</span> Rescanner';
    }
}

function setLoading(message) {
    grid.innerHTML = `
        <div class="state-message">
            ${message}
        </div>
    `;
}

function setError(error) {
    grid.innerHTML = `
        <div class="state-message error">
            Erreur : ${error}
        </div>
    `;
}

function updateCount(count) {
    countBadge.textContent = `${count} ${count > 1 ? 'icônes' : 'icône'}`;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);

        reader.readAsDataURL(file);
    });
}

async function configureSteamGridDbApiKey() {
    const apiKey = prompt('Colle ta clé API SteamGridDB :');

    if (!apiKey || !apiKey.trim()) {
        return;
    }

    try {
        await window.__TAURI__.core.invoke('save_steamgriddb_api_key', {
            apiKey: apiKey.trim(),
        });

        const testResult = await window.__TAURI__.core.invoke('test_steamgriddb_api_key');

        alert(testResult);
    } catch (error) {
        console.error('Erreur SteamGridDB:', error);
        setError(error);
    }
}

async function loadLibrary() {
    selectedIconIds.clear();
    setLoading('Chargement de l’iconothèque...');

    try {
        const icons = await window.__TAURI__.core.invoke('get_library');

        grid.innerHTML = '';
        updateCount(icons.length);

        if (icons.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined empty-state-icon">folder_off</span>
                    <h2>Iconothèque vide</h2>
                    <p>Utilise le bouton "Fichiers locaux" pour ajouter des icônes.</p>
                </div>
            `;
            return;
        }

        icons.forEach(icon => {
            const card = document.createElement('div');
            card.className = 'icon-card';
            card.dataset.iconId = icon.id;

            const img = document.createElement('img');
            img.src = icon.data_url;
            img.alt = icon.name;
            img.loading = 'lazy';

            const title = document.createElement('span');
            title.textContent = icon.name;

            card.appendChild(img);
            card.appendChild(title);

            card.addEventListener('click', () => {
                const isSelected = card.classList.toggle('selected');

                if (isSelected) {
                    selectedIconIds.add(icon.id);
                } else {
                    selectedIconIds.delete(icon.id);
                }
            });

            grid.appendChild(card);
        });
    } catch (error) {
        console.error('Erreur lors du chargement de la bibliothèque:', error);
        setError(error);
    }
}

async function importLocalFiles(files) {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
        return;
    }

    setLoading(`Import de ${imageFiles.length} fichier${imageFiles.length > 1 ? 's' : ''}...`);

    try {
        for (const file of imageFiles) {
            const dataUrl = await readFileAsDataUrl(file);

            await window.__TAURI__.core.invoke('import_icon_from_data', {
                fileName: file.name,
                dataUrl,
            });
        }

        await loadLibrary();
    } catch (error) {
        console.error('Erreur lors de l’import:', error);
        setError(error);
    } finally {
        fileInput.value = '';
    }
}

async function downloadIconFromUrl() {
    const url = urlInput.value.trim();

    if (!url) {
        urlInput.focus();
        return;
    }

    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Téléchargement...';

    try {
        const command = isSteamGridDbCollectionUrl(url)
            ? 'download_icons_from_steamgriddb_collection'
            : 'download_icon_from_url';

        const result = await window.__TAURI__.core.invoke(command, { url });

        urlInput.value = '';
        await loadLibrary();

        if (result && result.downloaded !== undefined) {
            alert(
                `Téléchargement terminé.\n\n` +
                `Icônes trouvées : ${result.found ?? result.downloaded}\n` +
                `Icônes téléchargées : ${result.downloaded}\n` +
                `Échecs : ${result.failed}`
            );
        }
    } catch (error) {
        console.error('Erreur lors du téléchargement:', error);
        setError(error);
    } finally {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">download</span> Télécharger';
    }
}

async function deleteSelectedIcons() {
    const iconIds = Array.from(selectedIconIds);

    if (iconIds.length === 0) {
        return;
    }

    const confirmed = confirm(
        `Supprimer ${iconIds.length} icône${iconIds.length > 1 ? 's' : ''} sélectionnée${iconIds.length > 1 ? 's' : ''} ?`
    );

    if (!confirmed) {
        return;
    }

    try {
        await window.__TAURI__.core.invoke('delete_icons', { iconIds });
        await loadLibrary();
    } catch (error) {
        console.error('Erreur lors de la suppression:', error);
        setError(error);
    }
}

localFilesBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', () => {
    importLocalFiles(fileInput.files);
});

downloadBtn.addEventListener('click', downloadIconFromUrl);

urlInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        downloadIconFromUrl();
    }
});

rescanLibraryBtn.addEventListener('click', rescanLibrary);

steamGridDbApiKeyBtn.addEventListener('click', configureSteamGridDbApiKey);

urlInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        downloadIconFromUrl();
    }
});

rescanLibraryBtn.addEventListener('click', rescanLibrary);

deleteSelectionBtn.addEventListener('click', deleteSelectedIcons);

loadLibrary();