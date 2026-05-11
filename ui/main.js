const grid = document.getElementById('icon-grid');
const countBadge = document.querySelector('.badge');

const urlInput = document.getElementById('url-input');
const downloadBtn = document.getElementById('download-btn');
const steamGridDbApiKeyBtn = document.getElementById('steamgriddb-api-key-btn');
const localFilesBtn = document.getElementById('local-files-btn');
const fileInput = document.getElementById('file-input');

const rescanLibraryBtn = document.getElementById('rescan-library-btn');
const deleteSelectionBtn = document.getElementById('delete-selection-btn');

const sgdbSearchInput = document.getElementById('sgdb-search-input');
const sgdbSearchBtn = document.getElementById('sgdb-search-btn');
const sgdbResultsTitle = document.getElementById('sgdb-results-title');
const sgdbResultsGrid = document.getElementById('sgdb-results-grid');
const clearSgdbResultsBtn = document.getElementById('clear-sgdb-results-btn');
const sgdbLoadMoreBtn = document.getElementById('sgdb-load-more-btn');

const searchTabBtn = document.getElementById('search-tab-btn');
const localTabBtn = document.getElementById('local-tab-btn');
const searchTabPanel = document.getElementById('search-tab-panel');
const localTabPanel = document.getElementById('local-tab-panel');

const selectedIconIds = new Set();

const SGDB_PAGE_LIMIT = 50;

let currentSgdbGameName = '';
let currentSgdbPage = 0;
let currentSgdbHasMore = false;
let currentSgdbSearchToken = 0;

function activateTab(tabName) {
    const isSearchTab = tabName === 'search';

    searchTabBtn.classList.toggle('active', isSearchTab);
    localTabBtn.classList.toggle('active', !isSearchTab);

    searchTabPanel.classList.toggle('active', isSearchTab);
    localTabPanel.classList.toggle('active', !isSearchTab);
}

function isSteamGridDbCollectionUrl(url) {
    return url.includes('steamgriddb.com/collection/');
}

function updateCount(count) {
    countBadge.textContent = `${count} ${count > 1 ? 'icônes' : 'icône'}`;
}

function setLibraryLoading(message) {
    grid.innerHTML = `
        <div class="state-message">
            ${message}
        </div>
    `;
}

function setLibraryError(error) {
    grid.innerHTML = `
        <div class="state-message error">
            Erreur : ${error}
        </div>
    `;
}

function setSteamGridDbResultsLoading(message) {
    activateTab('search');

    sgdbResultsGrid.innerHTML = `
        <div class="state-message">
            ${message}
        </div>
    `;
}

function setSteamGridDbResultsError(error) {
    activateTab('search');

    sgdbResultsGrid.innerHTML = `
        <div class="state-message error">
            Erreur : ${error}
        </div>
    `;

    sgdbLoadMoreBtn.hidden = true;
}

function resetSteamGridDbResults() {
    currentSgdbGameName = '';
    currentSgdbPage = 0;
    currentSgdbHasMore = false;
    currentSgdbSearchToken += 1;

    sgdbLoadMoreBtn.hidden = true;
    sgdbLoadMoreBtn.disabled = false;
    sgdbLoadMoreBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">expand_more</span> Charger plus';

    sgdbResultsTitle.textContent = 'Résultats SteamGridDB';
    sgdbResultsGrid.innerHTML = `
        <div class="empty-state">
            <span class="material-symbols-outlined empty-state-icon">travel_explore</span>
            <h2>Recherche SteamGridDB</h2>
            <p>Entre le nom d’un jeu pour trouver directement ses icônes.</p>
        </div>
    `;
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

    steamGridDbApiKeyBtn.disabled = true;
    steamGridDbApiKeyBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">hourglass_empty</span> Test...';

    try {
        await window.__TAURI__.core.invoke('save_steamgriddb_api_key', {
            apiKey: apiKey.trim(),
        });

        const testResult = await window.__TAURI__.core.invoke('test_steamgriddb_api_key');

        alert(testResult);
    } catch (error) {
        console.error('Erreur SteamGridDB:', error);
        alert(`Erreur SteamGridDB : ${error}`);
    } finally {
        steamGridDbApiKeyBtn.disabled = false;
        steamGridDbApiKeyBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">key</span> Clé SGDB';
    }
}

async function loadLibrary() {
    selectedIconIds.clear();
    setLibraryLoading('Chargement de l’iconothèque...');

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

        const fragment = document.createDocumentFragment();

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

            fragment.appendChild(card);
        });

        grid.appendChild(fragment);
    } catch (error) {
        console.error('Erreur lors du chargement de la bibliothèque:', error);
        setLibraryError(error);
    }
}

async function rescanLibrary() {
    rescanLibraryBtn.disabled = true;
    rescanLibraryBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">hourglass_empty</span> Scan...';

    activateTab('local');
    setLibraryLoading('Rescan de l’iconothèque et optimisation des images...');

    try {
        const result = await window.__TAURI__.core.invoke('rescan_library');

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
        setLibraryError(error);
    } finally {
        rescanLibraryBtn.disabled = false;
        rescanLibraryBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">refresh</span> Rescanner';
    }
}

async function importLocalFiles(files) {
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
        return;
    }

    activateTab('local');
    setLibraryLoading(`Import de ${imageFiles.length} fichier${imageFiles.length > 1 ? 's' : ''}...`);

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
        setLibraryError(error);
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
    downloadBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">hourglass_empty</span> Téléchargement...';

    try {
        const command = isSteamGridDbCollectionUrl(url)
            ? 'download_icons_from_steamgriddb_collection'
            : 'download_icon_from_url';

        const result = await window.__TAURI__.core.invoke(command, { url });

        urlInput.value = '';
        activateTab('local');
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
        activateTab('local');
        setLibraryError(error);
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
        setLibraryError(error);
    }
}

function createSteamGridDbIconCard(icon, gameName) {
    const card = document.createElement('div');
    card.className = 'icon-card sgdb-result-card';

    const img = document.createElement('img');
    img.src = icon.thumb || icon.url;
    img.alt = `Icône ${gameName}`;
    img.loading = 'lazy';

    const title = document.createElement('span');
    title.textContent = gameName;

    const downloadButton = document.createElement('button');
    downloadButton.className = 'mui-btn primary sgdb-download-btn';
    downloadButton.innerHTML = '<span class="material-symbols-outlined btn-icon">download</span>';
    downloadButton.title = `Télécharger l’icône de ${gameName}`;

    downloadButton.addEventListener('click', async event => {
        event.stopPropagation();
        await downloadSteamGridDbAsset(icon, gameName, downloadButton);
    });

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(downloadButton);

    return card;
}

function renderSteamGridDbResults(result, append = false) {
    activateTab('search');

    currentSgdbGameName = result.game.name;
    currentSgdbPage = result.page ?? 0;
    currentSgdbHasMore = Boolean(result.has_more);

    sgdbResultsTitle.textContent = `Résultats SteamGridDB — ${result.game.name}`;

    if (!append) {
        sgdbResultsGrid.innerHTML = '';
    }

    if (!result.icons || result.icons.length === 0) {
        if (!append) {
            sgdbResultsGrid.innerHTML = `
                <div class="empty-state">
                    <span class="material-symbols-outlined empty-state-icon">image_not_supported</span>
                    <h2>Aucune icône trouvée</h2>
                    <p>SteamGridDB n’a retourné aucune icône compatible pour ce jeu.</p>
                </div>
            `;
        }

        sgdbLoadMoreBtn.hidden = true;
        return;
    }

    const fragment = document.createDocumentFragment();

    result.icons.forEach(icon => {
        fragment.appendChild(createSteamGridDbIconCard(icon, result.game.name));
    });

    sgdbResultsGrid.appendChild(fragment);

    sgdbLoadMoreBtn.hidden = !currentSgdbHasMore;
}

async function searchSteamGridDbIcons() {
    const gameName = sgdbSearchInput.value.trim();

    if (!gameName) {
        sgdbSearchInput.focus();
        return;
    }

    const searchToken = currentSgdbSearchToken + 1;

    currentSgdbSearchToken = searchToken;
    currentSgdbGameName = gameName;
    currentSgdbPage = 0;
    currentSgdbHasMore = false;

    sgdbLoadMoreBtn.hidden = true;
    sgdbSearchBtn.disabled = true;
    sgdbSearchBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">hourglass_empty</span> Recherche...';

    setSteamGridDbResultsLoading('Recherche du jeu puis récupération des icônes SteamGridDB...');

    try {
        const result = await window.__TAURI__.core.invoke('search_steamgriddb_icon_page', {
            gameName,
            page: 0,
            limit: SGDB_PAGE_LIMIT,
        });

        if (searchToken !== currentSgdbSearchToken) {
            return;
        }

        renderSteamGridDbResults(result, false);
    } catch (error) {
        if (searchToken !== currentSgdbSearchToken) {
            return;
        }

        console.error('Erreur lors de la recherche SteamGridDB:', error);
        setSteamGridDbResultsError(error);
    } finally {
        if (searchToken === currentSgdbSearchToken) {
            sgdbSearchBtn.disabled = false;
            sgdbSearchBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">search</span> Rechercher';
        }
    }
}

async function loadMoreSteamGridDbIcons() {
    if (!currentSgdbGameName || !currentSgdbHasMore || sgdbLoadMoreBtn.disabled) {
        return;
    }

    const nextPage = currentSgdbPage + 1;
    const searchToken = currentSgdbSearchToken;

    sgdbLoadMoreBtn.disabled = true;
    sgdbLoadMoreBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">hourglass_empty</span> Chargement...';

    try {
        const result = await window.__TAURI__.core.invoke('search_steamgriddb_icon_page', {
            gameName: currentSgdbGameName,
            page: nextPage,
            limit: SGDB_PAGE_LIMIT,
        });

        if (searchToken !== currentSgdbSearchToken) {
            return;
        }

        renderSteamGridDbResults(result, true);
    } catch (error) {
        if (searchToken !== currentSgdbSearchToken) {
            return;
        }

        console.error('Erreur lors du chargement des résultats SteamGridDB:', error);
        alert(`Impossible de charger plus de résultats : ${error}`);
    } finally {
        if (searchToken === currentSgdbSearchToken) {
            sgdbLoadMoreBtn.disabled = false;
            sgdbLoadMoreBtn.innerHTML = '<span class="material-symbols-outlined btn-icon">expand_more</span> Charger plus';
            sgdbLoadMoreBtn.hidden = !currentSgdbHasMore;
        }
    }
}

async function downloadSteamGridDbAsset(icon, gameName, button) {
    button.disabled = true;
    button.innerHTML = '<span class="material-symbols-outlined btn-icon">hourglass_empty</span>';

    try {
        await window.__TAURI__.core.invoke('download_steamgriddb_icon_asset', {
            assetId: icon.id,
            url: icon.url,
            gameName,
        });

        await loadLibrary();

        button.innerHTML = '<span class="material-symbols-outlined btn-icon">check</span>';
        button.title = 'Icône téléchargée';
    } catch (error) {
        console.error('Erreur lors du téléchargement SteamGridDB:', error);
        alert(`Impossible de télécharger l’icône : ${error}`);

        button.disabled = false;
        button.innerHTML = '<span class="material-symbols-outlined btn-icon">download</span>';
    }
}

function registerEventListeners() {
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

    sgdbSearchBtn.addEventListener('click', searchSteamGridDbIcons);

    sgdbSearchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            searchSteamGridDbIcons();
        }
    });

    sgdbLoadMoreBtn.addEventListener('click', loadMoreSteamGridDbIcons);

    clearSgdbResultsBtn.addEventListener('click', resetSteamGridDbResults);

    searchTabBtn.addEventListener('click', () => {
        activateTab('search');
    });

    localTabBtn.addEventListener('click', () => {
        activateTab('local');
    });

    rescanLibraryBtn.addEventListener('click', rescanLibrary);

    steamGridDbApiKeyBtn.addEventListener('click', configureSteamGridDbApiKey);

    deleteSelectionBtn.addEventListener('click', deleteSelectedIcons);
}

function init() {
    registerEventListeners();
    activateTab('search');
    resetSteamGridDbResults();
    loadLibrary();
}

init();