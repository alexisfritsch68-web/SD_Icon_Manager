const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const icon = name => `<span class="material-symbols-outlined btn-icon">${name}</span>`;

const formatError = error => {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === 'string') {
        return error;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

const el = {
    windowTitlebar: $('.window-titlebar'),
    windowMinimize: $('#window-minimize-btn'),
    windowMaximize: $('#window-maximize-btn'),
    windowClose: $('#window-close-btn'),

    grid: $('#icon-grid'),
    count: $('.badge'),

    apiStatus: $('#steamgriddb-api-status'),
    apiStatusLabel: $('#steamgriddb-api-status-label'),
    localFiles: $('#local-files-btn'),
    file: $('#file-input'),

    rescan: $('#rescan-library-btn'),
    deleteSelection: $('#delete-selection-btn'),
    localIconSearch: $('#local-icon-search-input'),

    sgdbSearch: $('#sgdb-search-input'),
    sgdbSearchBtn: $('#sgdb-search-btn'),
    sgdbTitle: $('#sgdb-results-title'),
    sgdbGrid: $('#sgdb-results-grid'),
    sgdbClear: $('#clear-sgdb-results-btn'),
    sgdbMore: $('#sgdb-load-more-btn'),

    searchTab: $('#search-tab-btn'),
    localTab: $('#local-tab-btn'),
    searchPanel: $('#search-tab-panel'),
    localPanel: $('#local-tab-panel'),

    navItems: $$('.nav-item[data-page]'),
    pages: $$('.app-page'),
    packsPageContent: $('#packs-page-content'),

    settingsApiStatus: $('#settings-steamgriddb-api-status'),
    settingsApiStatusLabel: $('#settings-steamgriddb-api-status-label'),
    savedSettingsApiKeyInput: $('#saved-steamgriddb-api-key'),
    savedSettingsApiKeyToggleVisibility: $('#toggle-saved-steamgriddb-api-key-visibility-btn'),
    settingsApiKeyInput: $('#steamgriddb-api-key-input'),
    settingsApiKeySave: $('#save-steamgriddb-api-key-btn'),
    settingsApiKeyTest: $('#test-steamgriddb-api-key-btn'),
    settingsApiKeyToggleVisibility: $('#toggle-steamgriddb-api-key-visibility-btn'),
};

async function refreshSavedSteamGridDbApiKey() {
    try {
        const apiKey = await invoke('get_steamgriddb_api_key');

        el.savedSettingsApiKeyInput.value = apiKey || '';
        el.savedSettingsApiKeyInput.placeholder = apiKey
            ? 'Clé SteamGridDB enregistrée'
            : 'Aucune clé SteamGridDB enregistrée';

        el.savedSettingsApiKeyToggleVisibility.disabled = !apiKey;
        el.savedSettingsApiKeyInput.type = 'password';
        el.savedSettingsApiKeyToggleVisibility.innerHTML = `${icon('visibility')} Afficher`;
    } catch (error) {
        console.error('Erreur lors du chargement de la clé SteamGridDB:', error);
        notifyError('Lecture de la clé SteamGridDB impossible', error);
    }
}

function toggleSavedSteamGridDbApiKeyVisibility() {
    const isPassword = el.savedSettingsApiKeyInput.type === 'password';

    el.savedSettingsApiKeyInput.type = isPassword ? 'text' : 'password';
    el.savedSettingsApiKeyToggleVisibility.innerHTML = isPassword
        ? `${icon('visibility_off')} Masquer`
        : `${icon('visibility')} Afficher`;
}

const SGDB_PAGE_LIMIT = 50;

const selectedIconIds = new Set();
const notifications = [];
const sgdbDownloadById = new Map();

let localIcons = [];

let notificationPanel = null;
let notificationBadge = null;

let sgdb = {
    gameName: '',
    page: 0,
    hasMore: false,
    token: 0,
};

function setHtml(target, html) {
    target.innerHTML = html;
}

function messageState(message, type = '') {
    return `<div class="state-message ${type}">${message}</div>`;
}

function emptyState(iconName, title, text) {
    return `
        <div class="empty-state">
            <span class="material-symbols-outlined empty-state-icon">${iconName}</span>
            <h2>${title}</h2>
            <p>${text}</p>
        </div>
    `;
}

function setButton(button, disabled, html) {
    button.disabled = disabled;
    button.innerHTML = html;
}

async function withLoading(button, loadingHtml, normalHtml, task) {
    setButton(button, true, loadingHtml);

    try {
        return await task();
    } finally {
        setButton(button, false, normalHtml);
    }
}

function showDialog({
                        type = 'info',
                        iconName = 'info',
                        title,
                        message,
                        confirmText = 'OK',
                        cancelText = null,
                        danger = false,
                    } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';

        overlay.innerHTML = `
            <div class="app-dialog ${type}" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
                <div class="app-dialog-icon ${danger ? 'danger' : ''}">
                    <span class="material-symbols-outlined">${iconName}</span>
                </div>

                <div class="app-dialog-content">
                    <h2 id="dialog-title">${title}</h2>
                    <p>${message}</p>
                </div>

                <div class="app-dialog-actions">
                    ${
            cancelText
                ? `<button type="button" class="mui-btn outlined dialog-cancel-btn">${cancelText}</button>`
                : ''
        }
                    <button type="button" class="mui-btn ${danger ? 'text danger' : 'primary'} dialog-confirm-btn">
                        ${confirmText}
                    </button>
                </div>
            </div>
        `;

        const close = result => {
            overlay.classList.add('closing');

            window.setTimeout(() => {
                overlay.remove();
                resolve(result);
            }, 140);
        };

        document.body.appendChild(overlay);

        const confirmButton = $('.dialog-confirm-btn', overlay);
        const cancelButton = $('.dialog-cancel-btn', overlay);

        confirmButton.focus();

        confirmButton.onclick = () => close(true);

        if (cancelButton) {
            cancelButton.onclick = () => close(false);
        }

        overlay.addEventListener('click', event => {
            if (event.target === overlay && cancelText) {
                close(false);
            }
        });

        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape' && cancelText) {
                close(false);
            }
        });
    });
}

function showConfirmDialog(options) {
    return showDialog({
        cancelText: 'Annuler',
        confirmText: 'Confirmer',
        ...options,
    });
}

function activateTab(tabName) {
    const isSearch = tabName === 'search';

    el.searchTab.classList.toggle('active', isSearch);
    el.localTab.classList.toggle('active', !isSearch);
    el.searchPanel.classList.toggle('active', isSearch);
    el.localPanel.classList.toggle('active', !isSearch);
}

function updateCount(count) {
    el.count.textContent = `${count} ${count > 1 ? 'icônes' : 'icône'}`;
}

function updateDeleteSelectionButton() {
    const count = selectedIconIds.size;

    el.deleteSelection.hidden = false;
    el.deleteSelection.disabled = count === 0;
    el.deleteSelection.innerHTML = `${icon('delete')} Supprimer la sélection${count ? ` (${count})` : ''}`;
}

function notify(type, title, message) {
    notifications.push({
        type,
        title,
        message: formatError(message),
        createdAt: new Date(),
    });

    renderNotifications();
}

const notifyError = (title, error) => notify('error', title, error);
const notifySuccess = (title, message) => notify('success', title, message);

function updateApiStatusElement(statusElement, labelElement, status, message) {
    if (!statusElement || !labelElement) {
        return;
    }

    statusElement.classList.remove('unknown', 'checking', 'valid', 'invalid');
    statusElement.classList.add(status);
    statusElement.title = message;
    labelElement.textContent = message;
}

function createNotificationSystem() {
    const container = document.createElement('div');
    container.className = 'notification-system';

    Object.assign(container.style, {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: '9999',
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mui-btn notification-button';
    button.innerHTML = `
        ${icon('notifications')}
        Notifications
        <span class="notification-badge" hidden>0</span>
    `;

    notificationBadge = $('.notification-badge', button);

    Object.assign(notificationBadge.style, {
        marginLeft: '8px',
        padding: '2px 6px',
        borderRadius: '999px',
        background: '#d32f2f',
        color: '#fff',
        fontSize: '12px',
    });

    notificationPanel = document.createElement('div');
    notificationPanel.className = 'notification-panel';
    notificationPanel.hidden = true;

    Object.assign(notificationPanel.style, {
        position: 'absolute',
        right: '0',
        bottom: '48px',
        width: '360px',
        maxHeight: '420px',
        overflow: 'auto',
        padding: '12px',
        borderRadius: '12px',
        background: '#1f1f1f',
        color: '#fff',
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
    });

    button.addEventListener('click', event => {
        event.stopPropagation();
        notificationPanel.hidden = !notificationPanel.hidden;
    });

    notificationPanel.addEventListener('click', event => {
        event.stopPropagation();
    });

    document.addEventListener('click', () => {
        notificationPanel.hidden = true;
    });

    container.append(notificationPanel, button);
    document.body.appendChild(container);

    renderNotifications();
}

function renderNotifications() {
    if (!notificationPanel || !notificationBadge) {
        return;
    }

    notificationBadge.textContent = String(notifications.length);
    notificationBadge.hidden = notifications.length === 0;

    if (notifications.length === 0) {
        setHtml(notificationPanel, `
            <strong>Notifications</strong>
            <p>Aucune notification pour le moment.</p>
        `);
        return;
    }

    setHtml(notificationPanel, `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;">
            <strong>Notifications</strong>
            <button type="button" class="mui-btn notification-clear-btn">Tout effacer</button>
        </div>
        <div class="notification-list">
            ${notifications.slice().reverse().map(notification => `
                <div class="notification-item ${notification.type}" style="padding:10px;margin-bottom:8px;border-radius:8px;background:${notification.type === 'error' ? '#3a1515' : '#15301f'};">
                    <strong>${notification.title}</strong>
                    <p style="margin:6px 0 0;">${notification.message}</p>
                    <small style="display:block;margin-top:6px;opacity:.75;">${notification.createdAt.toLocaleString()}</small>
                </div>
            `).join('')}
        </div>
    `);

    $('.notification-clear-btn', notificationPanel).onclick = () => {
        notifications.length = 0;
        renderNotifications();
    };
}

function setSteamGridDbApiStatus(status, message) {
    updateApiStatusElement(el.apiStatus, el.apiStatusLabel, status, message);
    updateApiStatusElement(el.settingsApiStatus, el.settingsApiStatusLabel, status, message);
}

async function refreshSteamGridDbApiStatus({ notify: shouldNotify = false } = {}) {
    setSteamGridDbApiStatus('checking', 'Vérification de la clé SGDB...');

    try {
        const result = await invoke('test_steamgriddb_api_key');

        setSteamGridDbApiStatus('valid', 'Clé SGDB valide');

        if (shouldNotify) {
            notifySuccess('Clé SteamGridDB', result);
        }
    } catch (error) {
        const message = formatError(error);

        setSteamGridDbApiStatus(
            'invalid',
            message.includes('manquante') ? 'Clé SGDB absente' : 'Clé SGDB invalide'
        );

        if (shouldNotify) {
            notifyError('Clé SteamGridDB invalide', error);
        }
    }
}

function setLibraryLoading(message) {
    setHtml(el.grid, messageState(message));
}

function setLibraryError(error) {
    notifyError('Erreur dans l’iconothèque', error);
    setHtml(
        el.grid,
        messageState('Une erreur est survenue. Consulte les notifications pour plus de détails.', 'error')
    );
}

function setSgdbLoading(message) {
    activateTab('search');
    setHtml(el.sgdbGrid, messageState(message));
}

function setSgdbError(error) {
    activateTab('search');
    notifyError('Erreur SteamGridDB', error);
    setHtml(
        el.sgdbGrid,
        messageState('Une erreur est survenue. Consulte les notifications pour plus de détails.', 'error')
    );
    el.sgdbMore.hidden = true;
}

function resetSteamGridDbResults() {
    sgdb = {
        gameName: '',
        page: 0,
        hasMore: false,
        token: sgdb.token + 1,
    };

    el.sgdbMore.hidden = true;
    el.sgdbMore.disabled = false;
    el.sgdbMore.innerHTML = `${icon('expand_more')} Charger plus`;
    el.sgdbTitle.textContent = 'Résultats SteamGridDB';

    setHtml(
        el.sgdbGrid,
        emptyState(
            'travel_explore',
            'Recherche SteamGridDB',
            'Entre le nom d’un jeu pour trouver directement ses icônes.'
        )
    );
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function renderLocalIcons(icons = localIcons) {
    const search = el.localIconSearch?.value.trim().toLowerCase() ?? '';

    const filteredIcons = search
        ? icons.filter(iconData => iconData.name.toLowerCase().includes(search))
        : icons;

    if (icons.length === 0) {
        setHtml(
            el.grid,
            emptyState(
                'folder_off',
                'Iconothèque vide',
                'Utilise le bouton "Fichiers locaux" pour ajouter des icônes.'
            )
        );
        return;
    }

    if (filteredIcons.length === 0) {
        setHtml(
            el.grid,
            emptyState(
                'search_off',
                'Aucune icône trouvée',
                `Aucune icône locale ne correspond à “${el.localIconSearch.value.trim()}”.`
            )
        );
        return;
    }

    setHtml(
        el.grid,
        filteredIcons.map(iconData => `
            <div class="icon-card" data-icon-id="${iconData.id}">
                <img src="${iconData.data_url}" alt="${iconData.name}" loading="lazy">
                <span>${iconData.name}</span>
            </div>
        `).join('')
    );
}

async function loadLibrary() {
    selectedIconIds.clear();
    updateDeleteSelectionButton();
    setLibraryLoading('Chargement de l’iconothèque...');

    try {
        localIcons = await invoke('get_library');

        updateCount(localIcons.length);
        renderLocalIcons();
        updateDeleteSelectionButton();
    } catch (error) {
        console.error('Erreur lors du chargement de la bibliothèque:', error);
        setLibraryError(error);
    }
}

async function rescanLibrary() {
    await withLoading(
        el.rescan,
        icon('hourglass_empty'),
        icon('refresh'),
        async () => {
            activateTab('local');
            setLibraryLoading('Rescan de l’iconothèque et optimisation des images...');

            try {
                const result = await invoke('rescan_library');

                await loadLibrary();

                const message =
                    `Images scannées : ${result.scanned}\n` +
                    `Images transformées : ${result.transformed}` +
                    (result.failed > 0 ? `\nÉchecs : ${result.failed}` : '');

                if (result.failed > 0) {
                    notifyError('Rescan terminé avec erreurs', message);
                } else {
                    notifySuccess('Rescan terminé', message);
                }
            } catch (error) {
                console.error('Erreur lors du rescan:', error);
                setLibraryError(error);
            }
        }
    );
}

async function importLocalFiles(files) {
    const imageFiles = [...files].filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
        return;
    }

    activateTab('local');
    setLibraryLoading(`Import de ${imageFiles.length} fichier${imageFiles.length > 1 ? 's' : ''}...`);

    try {
        for (const file of imageFiles) {
            await invoke('import_icon_from_data', {
                fileName: file.name,
                dataUrl: await readFileAsDataUrl(file),
            });
        }

        await loadLibrary();
    } catch (error) {
        console.error('Erreur lors de l’import:', error);
        setLibraryError(error);
    } finally {
        el.file.value = '';
    }
}

async function deleteSelectedIcons() {
    const iconIds = [...selectedIconIds];

    if (iconIds.length === 0) {
        notifyError('Suppression impossible', 'Aucune icône sélectionnée.');
        return;
    }

    const confirmed = await showConfirmDialog({
        type: 'danger',
        iconName: 'delete',
        title: 'Supprimer la sélection ?',
        message:
            `Tu es sur le point de supprimer ${iconIds.length} icône${iconIds.length > 1 ? 's' : ''} sélectionnée${iconIds.length > 1 ? 's' : ''}. ` +
            'Cette action est définitive.',
        confirmText: 'Supprimer',
        cancelText: 'Annuler',
        danger: true,
    });

    if (!confirmed) {
        return;
    }

    await withLoading(
        el.deleteSelection,
        `${icon('hourglass_empty')} Suppression...`,
        `${icon('delete')} Supprimer la sélection`,
        async () => {
            try {
                await invoke('delete_icons', { iconIds });

                notifySuccess(
                    'Suppression terminée',
                    `${iconIds.length} icône${iconIds.length > 1 ? 's ont été supprimées' : ' a été supprimée'}.`
                );

                await loadLibrary();
            } catch (error) {
                console.error('Erreur lors de la suppression:', error);
                setLibraryError(error);
            } finally {
                updateDeleteSelectionButton();
            }
        }
    );
}

function renderSteamGridDbResults(result, append = false) {
    activateTab('search');

    sgdb.gameName = result.game.name;
    sgdb.page = result.page ?? 0;
    sgdb.hasMore = Boolean(result.has_more);

    el.sgdbTitle.textContent = `Résultats SteamGridDB — ${result.game.name}`;

    if (!append) {
        el.sgdbGrid.innerHTML = '';
        sgdbDownloadById.clear();
    }

    if (!result.icons?.length) {
        if (!append) {
            setHtml(
                el.sgdbGrid,
                emptyState(
                    'image_not_supported',
                    'Aucune icône trouvée',
                    'SteamGridDB n’a retourné aucune icône compatible pour ce jeu.'
                )
            );
        }

        el.sgdbMore.hidden = true;
        return;
    }

    const cards = result.icons.map(asset => {
        sgdbDownloadById.set(String(asset.id), {
            asset,
            gameName: result.game.name,
        });

        return `
            <div class="icon-card sgdb-result-card">
                <img src="${asset.thumb || asset.url}" alt="Icône ${result.game.name}" loading="lazy">
                <span>${result.game.name}</span>
                <button class="mui-btn primary sgdb-download-btn" data-asset-id="${asset.id}" title="Télécharger l’icône de ${result.game.name}">
                    ${icon('download')}
                </button>
            </div>
        `;
    }).join('');

    el.sgdbGrid.insertAdjacentHTML('beforeend', cards);
    el.sgdbMore.hidden = !sgdb.hasMore;
}

async function searchSteamGridDbIcons() {
    const gameName = el.sgdbSearch.value.trim();

    if (!gameName) {
        el.sgdbSearch.focus();
        return;
    }

    const token = ++sgdb.token;

    Object.assign(sgdb, {
        gameName,
        page: 0,
        hasMore: false,
    });

    el.sgdbMore.hidden = true;

    await withLoading(
        el.sgdbSearchBtn,
        `${icon('hourglass_empty')} Recherche...`,
        `${icon('search')} Rechercher`,
        async () => {
            setSgdbLoading('Recherche du jeu puis récupération des icônes SteamGridDB...');

            try {
                const result = await invoke('search_steamgriddb_icon_page', {
                    gameName,
                    page: 0,
                    limit: SGDB_PAGE_LIMIT,
                });

                if (token === sgdb.token) {
                    renderSteamGridDbResults(result);
                }
            } catch (error) {
                if (token === sgdb.token) {
                    console.error('Erreur lors de la recherche SteamGridDB:', error);
                    setSgdbError(error);
                }
            }
        }
    );
}

async function loadMoreSteamGridDbIcons() {
    if (!sgdb.gameName || !sgdb.hasMore || el.sgdbMore.disabled) {
        return;
    }

    const token = sgdb.token;

    await withLoading(
        el.sgdbMore,
        `${icon('hourglass_empty')} Chargement...`,
        `${icon('expand_more')} Charger plus`,
        async () => {
            try {
                const result = await invoke('search_steamgriddb_icon_page', {
                    gameName: sgdb.gameName,
                    page: sgdb.page + 1,
                    limit: SGDB_PAGE_LIMIT,
                });

                if (token === sgdb.token) {
                    renderSteamGridDbResults(result, true);
                }
            } catch (error) {
                if (token === sgdb.token) {
                    console.error('Erreur lors du chargement des résultats SteamGridDB:', error);
                    notifyError('Chargement SteamGridDB impossible', error);
                }
            } finally {
                if (token === sgdb.token) {
                    el.sgdbMore.hidden = !sgdb.hasMore;
                }
            }
        }
    );
}

async function downloadSteamGridDbAsset(asset, gameName, button) {
    setButton(button, true, icon('hourglass_empty'));

    try {
        await invoke('download_steamgriddb_icon_asset', {
            assetId: asset.id,
            url: asset.url,
            gameName,
        });

        await loadLibrary();

        button.innerHTML = icon('check');
        button.title = 'Icône téléchargée';

        notifySuccess(
            'Icône téléchargée',
            `L’icône de ${gameName} a été ajoutée à l’iconothèque.`
        );
    } catch (error) {
        console.error('Erreur lors du téléchargement SteamGridDB:', error);
        notifyError('Téléchargement SteamGridDB impossible', error);

        setButton(button, false, icon('download'));
    }
}

function toggleLocalIconSelection(card) {
    const iconId = card.dataset.iconId;
    const selected = card.classList.toggle('selected');

    if (selected) {
        selectedIconIds.add(iconId);
    } else {
        selectedIconIds.delete(iconId);
    }

    updateDeleteSelectionButton();
}

function onEnter(input, callback) {
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            callback();
        }
    });
}

function getCurrentTauriWindow() {
    return window.__TAURI__?.window?.getCurrentWindow?.()
        ?? window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.()
        ?? null;
}

function registerWindowControls() {
    const appWindow = getCurrentTauriWindow();

    if (!appWindow) {
        console.warn('API Tauri Window indisponible.');
        return;
    }

    if (el.windowMinimize) {
        el.windowMinimize.onclick = () => {
            appWindow.minimize();
        };
    }

    if (el.windowMaximize) {
        el.windowMaximize.onclick = async () => {
            await appWindow.toggleMaximize();
        };
    }

    if (el.windowClose) {
        el.windowClose.onclick = () => {
            appWindow.close();
        };
    }

    if (el.windowTitlebar) {
        el.windowTitlebar.addEventListener('mousedown', event => {
            const clickedControl = event.target.closest('.window-control-btn');

            if (clickedControl || event.button !== 0) {
                return;
            }

            appWindow.startDragging();
        });

        el.windowTitlebar.addEventListener('dblclick', event => {
            const clickedControl = event.target.closest('.window-control-btn');

            if (clickedControl) {
                return;
            }

            appWindow.toggleMaximize();
        });
    }
}

function registerEventListeners() {
    el.navItems.forEach(item => {
        item.addEventListener('click', event => {
            event.preventDefault();
            activatePage(item.dataset.page);
        });
    });

    el.localFiles.onclick = () => el.file.click();
    el.file.onchange = () => importLocalFiles(el.file.files);

    el.sgdbSearchBtn.onclick = searchSteamGridDbIcons;
    el.sgdbMore.onclick = loadMoreSteamGridDbIcons;
    el.sgdbClear.onclick = resetSteamGridDbResults;

    el.searchTab.onclick = () => activateTab('search');
    el.localTab.onclick = () => activateTab('local');

    el.rescan.onclick = rescanLibrary;
    el.deleteSelection.onclick = deleteSelectedIcons;

    el.settingsApiKeySave.onclick = saveSteamGridDbApiKeyFromSettings;
    el.settingsApiKeyTest.onclick = testSteamGridDbApiKeyFromSettings;
    el.savedSettingsApiKeyToggleVisibility.onclick = toggleSavedSteamGridDbApiKeyVisibility;
    el.settingsApiKeyToggleVisibility.onclick = toggleSteamGridDbApiKeyVisibility;

    el.localIconSearch.addEventListener('input', () => {
        selectedIconIds.clear();
        renderLocalIcons();
        updateDeleteSelectionButton();
    });

    onEnter(el.sgdbSearch, searchSteamGridDbIcons);
    onEnter(el.settingsApiKeyInput, saveSteamGridDbApiKeyFromSettings);

    el.grid.addEventListener('click', event => {
        const card = event.target.closest('.icon-card[data-icon-id]');

        if (card) {
            toggleLocalIconSelection(card);
        }
    });

    el.sgdbGrid.addEventListener('click', event => {
        const button = event.target.closest('.sgdb-download-btn');

        if (!button) {
            return;
        }

        const entry = sgdbDownloadById.get(button.dataset.assetId);

        if (entry) {
            downloadSteamGridDbAsset(entry.asset, entry.gameName, button);
        }
    });
}

async function renderPacksPage() {
    if (!el.packsPageContent) {
        return;
    }

    try {
        const packs = await invoke('get_packs');

        setHtml(el.packsPageContent, `
            <div class="settings-card">
                <div class="settings-card-header">
                    <span class="material-symbols-outlined settings-card-icon">inventory_2</span>
                    <div>
                        <h2>Mes Packs</h2>
                        <p>Gère tes packs d’icônes Stream Deck.</p>
                    </div>
                </div>

                ${
            packs.length === 0
                ? `<p class="settings-help">Aucun pack créé pour le moment.</p>`
                : `<div class="pack-list">
                            ${packs.map(pack => `
                                <div class="pack-list-item">
                                    <strong>${pack.name}</strong>
                                    <span>${pack.icons.length} icône${pack.icons.length > 1 ? 's' : ''}</span>
                                </div>
                            `).join('')}
                        </div>`
        }
            </div>
        `);
    } catch (error) {
        console.error('Erreur lors du chargement des packs:', error);
        notifyError('Chargement des packs impossible', error);
    }
}

function activatePage(pageName) {
    el.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.page === pageName);
    });

    el.pages.forEach(page => {
        page.classList.toggle('active', page.id === `${pageName}-page`);
    });

    if (pageName === 'packs') {
        renderPacksPage();
    }

    if (pageName === 'settings') {
        refreshSavedSteamGridDbApiKey();
        refreshSteamGridDbApiStatus();
    }
}

async function saveSteamGridDbApiKeyFromSettings() {
    const apiKey = el.settingsApiKeyInput.value.trim();

    if (!apiKey) {
        el.settingsApiKeyInput.focus();
        notifyError('Clé SteamGridDB manquante', 'Colle une clé API SteamGridDB avant d’enregistrer.');
        return;
    }

    await withLoading(
        el.settingsApiKeySave,
        `${icon('hourglass_empty')} Test...`,
        `${icon('save')} Enregistrer et tester`,
        async () => {
            try {
                await invoke('save_steamgriddb_api_key', { apiKey });
                el.settingsApiKeyInput.value = '';

                await refreshSavedSteamGridDbApiKey();
                await refreshSteamGridDbApiStatus({ notify: true });
            } catch (error) {
                console.error('Erreur SteamGridDB:', error);
                setSteamGridDbApiStatus('invalid', 'Clé SGDB invalide');
                notifyError('Erreur SteamGridDB', error);
            }
        }
    );
}

async function testSteamGridDbApiKeyFromSettings() {
    await withLoading(
        el.settingsApiKeyTest,
        `${icon('hourglass_empty')} Test...`,
        `${icon('science')} Tester la clé actuelle`,
        () => refreshSteamGridDbApiStatus({ notify: true })
    );
}

function toggleSteamGridDbApiKeyVisibility() {
    const isPassword = el.settingsApiKeyInput.type === 'password';

    el.settingsApiKeyInput.type = isPassword ? 'text' : 'password';
    el.settingsApiKeyToggleVisibility.innerHTML = isPassword
        ? `${icon('visibility_off')} Masquer`
        : `${icon('visibility')} Afficher`;
}

function init() {
    createNotificationSystem();
    registerWindowControls();
    registerEventListeners();
    activatePage('library');
    activateTab('search');
    resetSteamGridDbResults();
    updateDeleteSelectionButton();
    refreshSavedSteamGridDbApiKey();
    refreshSteamGridDbApiStatus();
    loadLibrary();
}

init();