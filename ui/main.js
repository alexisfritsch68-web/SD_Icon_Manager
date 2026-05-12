const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const icon = name => `<span class="material-symbols-outlined btn-icon">${name}</span>`;

const DEFAULT_PACK_METADATA = {
    author: 'Arckanics_Reiko',
    version: '1.0.0',
    description: "Pack d'icônes généré avec SD Icon Manager.",
    category: 'Gaming',
    tags: ['Gaming'],
    license: 'Generated icon pack. Icons remain the property of their respective owners.',
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

    packSubnavButtons: $$('.pack-subnav-btn'),
    packViews: $$('.pack-view'),
    packCreateList: $('#pack-create-list'),
    packEditHome: $('#pack-edit-home'),
    packEditDetail: $('#pack-edit-detail'),
    packEditList: $('#pack-edit-list'),
    packEditDetailContent: $('#pack-edit-detail-content'),
    newPackNameInput: $('#new-pack-name-input'),
    createPack: $('#create-pack-btn'),
    refreshPacks: $('#refresh-packs-btn'),
    mergeSourcePackSelect: $('#merge-source-pack-select'),
    mergeTargetPackSelect: $('#merge-target-pack-select'),
    mergePacks: $('#merge-packs-btn'),
    exportPackSelect: $('#export-pack-select'),
    exportPack: $('#export-pack-btn'),
    packExportSummary: $('#pack-export-summary'),

    settingsApiStatus: $('#settings-steamgriddb-api-status'),
    settingsApiStatusLabel: $('#settings-steamgriddb-api-status-label'),
    savedSettingsApiKeyInput: $('#saved-steamgriddb-api-key'),
    savedSettingsApiKeyToggleVisibility: $('#toggle-saved-steamgriddb-api-key-visibility-btn'),
    settingsApiKeyInput: $('#steamgriddb-api-key-input'),
    settingsApiKeySave: $('#save-steamgriddb-api-key-btn'),
    settingsApiKeyTest: $('#test-steamgriddb-api-key-btn'),
    settingsApiKeyToggleVisibility: $('#toggle-steamgriddb-api-key-visibility-btn'),
};

const SGDB_PAGE_LIMIT = 50;

const selectedIconIds = new Set();
const notifications = [];
const sgdbDownloadById = new Map();

let localIcons = [];
let packsCache = [];
let currentPackName = null;
let notificationPanel = null;
let notificationBadge = null;

let sgdb = {
    gameName: '',
    page: 0,
    hasMore: false,
    token: 0,
};

const formatError = error => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function setHtml(target, html) {
    if (target) {
        target.innerHTML = html;
    }
}

function messageState(message, type = '') {
    return `<div class="state-message ${type}">${escapeHtml(message)}</div>`;
}

function emptyState(iconName, title, text) {
    return `
        <div class="empty-state">
            <span class="material-symbols-outlined empty-state-icon">${escapeHtml(iconName)}</span>
            <h2>${escapeHtml(title)}</h2>
            <p>${escapeHtml(text)}</p>
        </div>
    `;
}

function setButton(button, disabled, html) {
    if (!button) return;

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

function onEnter(input, callback) {
    input?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            callback();
        }
    });
}

function bindButtons(root, selector, handler) {
    $$(selector, root).forEach(button => {
        button.onclick = () => handler(button);
    });
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
            <div class="app-dialog ${escapeHtml(type)}" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
                <div class="app-dialog-icon ${danger ? 'danger' : ''}">
                    <span class="material-symbols-outlined">${escapeHtml(iconName)}</span>
                </div>

                <div class="app-dialog-content">
                    <h2 id="dialog-title">${escapeHtml(title)}</h2>
                    <p>${escapeHtml(message)}</p>
                </div>

                <div class="app-dialog-actions">
                    ${cancelText ? `<button type="button" class="mui-btn outlined dialog-cancel-btn">${escapeHtml(cancelText)}</button>` : ''}
                    <button type="button" class="mui-btn ${danger ? 'text danger' : 'primary'} dialog-confirm-btn">
                        ${escapeHtml(confirmText)}
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

        $('.dialog-confirm-btn', overlay).onclick = () => close(true);
        $('.dialog-cancel-btn', overlay)?.addEventListener('click', () => close(false));

        overlay.addEventListener('click', event => {
            if (event.target === overlay && cancelText) {
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

    button.onclick = event => {
        event.stopPropagation();
        notificationPanel.hidden = !notificationPanel.hidden;
    };

    notificationPanel.onclick = event => event.stopPropagation();
    document.addEventListener('click', () => notificationPanel.hidden = true);

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
                <div class="notification-item ${escapeHtml(notification.type)}" style="padding:10px;margin-bottom:8px;border-radius:8px;background:${notification.type === 'error' ? '#3a1515' : '#15301f'};">
                    <strong>${escapeHtml(notification.title)}</strong>
                    <p style="margin:6px 0 0;">${escapeHtml(notification.message)}</p>
                    <small style="display:block;margin-top:6px;opacity:.75;">${escapeHtml(notification.createdAt.toLocaleString())}</small>
                </div>
            `).join('')}
        </div>
    `);

    $('.notification-clear-btn', notificationPanel).onclick = () => {
        notifications.length = 0;
        renderNotifications();
    };
}

function updateApiStatusElement(statusElement, labelElement, status, message) {
    if (!statusElement || !labelElement) return;

    statusElement.classList.remove('unknown', 'checking', 'valid', 'invalid');
    statusElement.classList.add(status);
    statusElement.title = message;
    labelElement.textContent = message;
}

function setSteamGridDbApiStatus(status, message) {
    updateApiStatusElement(el.apiStatus, el.apiStatusLabel, status, message);
    updateApiStatusElement(el.settingsApiStatus, el.settingsApiStatusLabel, status, message);
}

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
        notifyError('Lecture de la clé SteamGridDB impossible', error);
    }
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

function toggleSavedSteamGridDbApiKeyVisibility() {
    const isPassword = el.savedSettingsApiKeyInput.type === 'password';

    el.savedSettingsApiKeyInput.type = isPassword ? 'text' : 'password';
    el.savedSettingsApiKeyToggleVisibility.innerHTML = isPassword
        ? `${icon('visibility_off')} Masquer`
        : `${icon('visibility')} Afficher`;
}

function toggleSteamGridDbApiKeyVisibility() {
    const isPassword = el.settingsApiKeyInput.type === 'password';

    el.settingsApiKeyInput.type = isPassword ? 'text' : 'password';
    el.settingsApiKeyToggleVisibility.innerHTML = isPassword
        ? `${icon('visibility_off')} Masquer`
        : `${icon('visibility')} Afficher`;
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

function setLibraryLoading(message) {
    setHtml(el.grid, messageState(message));
}

function setLibraryError(error) {
    notifyError('Erreur dans l’iconothèque', error);
    setHtml(el.grid, messageState('Une erreur est survenue. Consulte les notifications pour plus de détails.', 'error'));
}

function renderLocalIcons(icons = localIcons) {
    const search = el.localIconSearch?.value.trim().toLowerCase() ?? '';
    const filteredIcons = search
        ? icons.filter(iconData => iconData.name.toLowerCase().includes(search))
        : icons;

    if (icons.length === 0) {
        setHtml(el.grid, emptyState('folder_off', 'Iconothèque vide', 'Utilise le bouton "Fichiers locaux" pour ajouter des icônes.'));
        return;
    }

    if (filteredIcons.length === 0) {
        setHtml(el.grid, emptyState('search_off', 'Aucune icône trouvée', `Aucune icône locale ne correspond à “${el.localIconSearch.value.trim()}”.`));
        return;
    }

    setHtml(el.grid, filteredIcons.map(iconData => `
        <div class="icon-card" data-icon-id="${escapeHtml(iconData.id)}">
            <img src="${escapeHtml(iconData.data_url)}" alt="${escapeHtml(iconData.name)}" loading="lazy">
            <span>${escapeHtml(iconData.name)}</span>
        </div>
    `).join(''));
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

        if ($('#packs-page')?.classList.contains('active')) {
            await renderPacksPage();
        }
    } catch (error) {
        setLibraryError(error);
    }
}

async function rescanLibrary() {
    await withLoading(el.rescan, icon('hourglass_empty'), icon('refresh'), async () => {
        activateTab('local');
        setLibraryLoading('Rescan de l’iconothèque et optimisation des images...');

        try {
            const result = await invoke('rescan_library');

            await loadLibrary();

            const message =
                `Images scannées : ${result.scanned}\n` +
                `Images transformées : ${result.transformed}` +
                (result.failed > 0 ? `\nÉchecs : ${result.failed}` : '');

            result.failed > 0
                ? notifyError('Rescan terminé avec erreurs', message)
                : notifySuccess('Rescan terminé', message);
        } catch (error) {
            setLibraryError(error);
        }
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
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
        message: `Tu es sur le point de supprimer ${iconIds.length} icône${iconIds.length > 1 ? 's' : ''}. Cette action est définitive.`,
        confirmText: 'Supprimer',
        cancelText: 'Annuler',
        danger: true,
    });

    if (!confirmed) {
        return;
    }

    await withLoading(el.deleteSelection, `${icon('hourglass_empty')} Suppression...`, `${icon('delete')} Supprimer la sélection`, async () => {
        try {
            await invoke('delete_icons', { iconIds });

            notifySuccess(
                'Suppression terminée',
                `${iconIds.length} icône${iconIds.length > 1 ? 's ont été supprimées' : ' a été supprimée'}.`
            );

            await loadLibrary();
        } catch (error) {
            setLibraryError(error);
        } finally {
            updateDeleteSelectionButton();
        }
    });
}

function toggleLocalIconSelection(card) {
    const iconId = card.dataset.iconId;
    const selected = card.classList.toggle('selected');

    selected ? selectedIconIds.add(iconId) : selectedIconIds.delete(iconId);
    updateDeleteSelectionButton();
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

    setHtml(el.sgdbGrid, emptyState('travel_explore', 'Recherche SteamGridDB', 'Entre le nom d’un jeu pour trouver directement ses icônes.'));
}

function setSgdbLoading(message) {
    activateTab('search');
    setHtml(el.sgdbGrid, messageState(message));
}

function setSgdbError(error) {
    activateTab('search');
    notifyError('Erreur SteamGridDB', error);
    setHtml(el.sgdbGrid, messageState('Une erreur est survenue. Consulte les notifications pour plus de détails.', 'error'));
    el.sgdbMore.hidden = true;
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
            setHtml(el.sgdbGrid, emptyState('image_not_supported', 'Aucune icône trouvée', 'SteamGridDB n’a retourné aucune icône compatible pour ce jeu.'));
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
                <img src="${escapeHtml(asset.thumb || asset.url)}" alt="Icône ${escapeHtml(result.game.name)}" loading="lazy">
                <span>${escapeHtml(result.game.name)}</span>
                <button class="mui-btn primary sgdb-download-btn" data-asset-id="${escapeHtml(asset.id)}" title="Télécharger l’icône de ${escapeHtml(result.game.name)}">
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

    await withLoading(el.sgdbSearchBtn, `${icon('hourglass_empty')} Recherche...`, `${icon('search')} Rechercher`, async () => {
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
                setSgdbError(error);
            }
        }
    });
}

async function loadMoreSteamGridDbIcons() {
    if (!sgdb.gameName || !sgdb.hasMore || el.sgdbMore.disabled) {
        return;
    }

    const token = sgdb.token;

    await withLoading(el.sgdbMore, `${icon('hourglass_empty')} Chargement...`, `${icon('expand_more')} Charger plus`, async () => {
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
                notifyError('Chargement SteamGridDB impossible', error);
            }
        } finally {
            if (token === sgdb.token) {
                el.sgdbMore.hidden = !sgdb.hasMore;
            }
        }
    });
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

        notifySuccess('Icône téléchargée', `L’icône de ${gameName} a été ajoutée à l’iconothèque.`);
    } catch (error) {
        notifyError('Téléchargement SteamGridDB impossible', error);
        setButton(button, false, icon('download'));
    }
}

const packByName = name => packsCache.find(pack => pack.name === name) ?? null;
const iconById = id => localIcons.find(iconData => iconData.id === id) ?? null;
const packCount = pack => `${pack.icons.length} icône${pack.icons.length > 1 ? 's' : ''}`;

function packMetadata(pack) {
    return {
        name: pack.metadata?.name || pack.name,
        author: pack.metadata?.author || DEFAULT_PACK_METADATA.author,
        version: pack.metadata?.version || DEFAULT_PACK_METADATA.version,
        description: pack.metadata?.description || DEFAULT_PACK_METADATA.description,
        category: pack.metadata?.category || DEFAULT_PACK_METADATA.category,
        tags: Array.isArray(pack.metadata?.tags) && pack.metadata.tags.length > 0
            ? pack.metadata.tags
            : DEFAULT_PACK_METADATA.tags,
        license: pack.metadata?.license || DEFAULT_PACK_METADATA.license,
    };
}

function packOptions(placeholder) {
    return `
        <option value="">${escapeHtml(placeholder)}</option>
        ${packsCache.map(pack => `
            <option value="${escapeHtml(pack.name)}">${escapeHtml(pack.name)} — ${escapeHtml(packCount(pack))}</option>
        `).join('')}
    `;
}

function packListItem(pack, actions) {
    const metadata = packMetadata(pack);

    return `
        <div class="pack-list-item">
            <div class="pack-info">
                <strong>${escapeHtml(metadata.name)}</strong>
                <span>${escapeHtml(packCount(pack))}</span>
                <small>${escapeHtml(metadata.author)} · v${escapeHtml(metadata.version)}</small>
            </div>

            <div class="pack-actions">
                ${actions(pack)}
            </div>
        </div>
    `;
}

function activatePackView(viewName) {
    el.packSubnavButtons.forEach(button => {
        button.classList.toggle('active', button.dataset.packView === viewName);
    });

    el.packViews.forEach(view => {
        view.classList.toggle('active', view.id === `pack-${viewName}-view`);
    });

    renderPacksPage();
}

function openPackEditor(packName) {
    currentPackName = packName;
    el.packEditHome?.classList.remove('active');
    el.packEditDetail?.classList.add('active');
    renderPackEditDetail();
}

function closePackEditor() {
    currentPackName = null;
    el.packEditDetail?.classList.remove('active');
    el.packEditHome?.classList.add('active');
    renderPackEditList();
}

function renderPackIconCard(iconData, packName, isInPack) {
    const action = isInPack
        ? { className: 'text danger remove-icon-from-pack-btn', iconName: 'remove', label: 'Retirer' }
        : { className: 'primary add-icon-to-pack-btn', iconName: 'add', label: 'Ajouter' };

    return `
        <div class="icon-card pack-icon-card ${isInPack ? 'in-pack' : ''}" data-icon-id="${escapeHtml(iconData.id)}">
            <img src="${escapeHtml(iconData.data_url)}" alt="${escapeHtml(iconData.name)}" loading="lazy">
            <span>${escapeHtml(iconData.name)}</span>

            <button
                class="mui-btn ${action.className}"
                type="button"
                data-pack-name="${escapeHtml(packName)}"
                data-icon-id="${escapeHtml(iconData.id)}"
            >
                ${icon(action.iconName)}
                ${escapeHtml(action.label)}
            </button>
        </div>
    `;
}

function renderPackMetadataForm(pack) {
    const metadata = packMetadata(pack);

    return `
        <section class="pack-editor-section pack-metadata-section">
            <div class="pack-section-header">
                <div>
                    <h3>Informations du pack</h3>
                    <p>Ces informations seront utilisées dans le pack Stream Deck exporté.</p>
                </div>
            </div>

            <div class="pack-metadata-grid">
                <label class="pack-metadata-field">
                    <span>Nom du pack</span>
                    <input
                        id="pack-metadata-name-input"
                        type="text"
                        class="mui-input"
                        placeholder="Nom du pack"
                        value="${escapeHtml(metadata.name)}"
                    />
                </label>

                <label class="pack-metadata-field">
                    <span>Version</span>
                    <input
                        id="pack-metadata-version-input"
                        type="text"
                        class="mui-input"
                        placeholder="1.0.0"
                        value="${escapeHtml(metadata.version)}"
                    />
                </label>

                <label class="pack-metadata-field">
                    <span>Auteur</span>
                    <input
                        id="pack-metadata-author-input"
                        type="text"
                        class="mui-input"
                        placeholder="Auteur"
                        value="${escapeHtml(metadata.author)}"
                    />
                </label>

                <label class="pack-metadata-field">
                    <span>Catégorie</span>
                    <input
                        id="pack-metadata-category-input"
                        type="text"
                        class="mui-input"
                        placeholder="Gaming"
                        value="${escapeHtml(metadata.category)}"
                    />
                </label>

                <label class="pack-metadata-field pack-metadata-field-wide">
                    <span>Tags</span>
                    <input
                        id="pack-metadata-tags-input"
                        type="text"
                        class="mui-input"
                        placeholder="Tags séparés par des virgules"
                        value="${escapeHtml(metadata.tags.join(', '))}"
                    />
                </label>

                <label class="pack-metadata-field pack-metadata-field-wide">
                    <span>Description</span>
                    <textarea
                        id="pack-metadata-description-input"
                        class="mui-input pack-metadata-textarea"
                        rows="3"
                        placeholder="Description du pack"
                    >${escapeHtml(metadata.description)}</textarea>
                </label>

                <label class="pack-metadata-field pack-metadata-field-wide">
                    <span>Licence</span>
                    <textarea
                        id="pack-metadata-license-input"
                        class="mui-input pack-metadata-textarea"
                        rows="4"
                        placeholder="Texte de licence"
                    >${escapeHtml(metadata.license)}</textarea>
                </label>
            </div>

            <div class="settings-actions pack-metadata-actions">
                <button
                    id="save-pack-metadata-btn"
                    class="mui-btn primary"
                    type="button"
                    data-pack-name="${escapeHtml(pack.name)}"
                >
                    ${icon('save')}
                    Enregistrer les informations
                </button>
            </div>
        </section>
    `;
}

async function renderPacksPage() {
    try {
        packsCache = await invoke('get_packs');

        renderPackCreateList();
        renderPackEditList();
        renderPackMergeView();
        renderPackExportView();

        if (currentPackName) {
            packByName(currentPackName) ? renderPackEditDetail() : closePackEditor();
        }
    } catch (error) {
        notifyError('Chargement des packs impossible', error);
    }
}

function renderPackCreateList() {
    if (!el.packCreateList) return;

    if (packsCache.length === 0) {
        setHtml(el.packCreateList, emptyState('inventory_2', 'Aucun pack créé', 'Crée ton premier pack pour commencer.'));
        return;
    }

    setHtml(el.packCreateList, packsCache.map(pack => packListItem(pack, item => `
        <button class="mui-btn outlined open-pack-editor-btn" type="button" data-pack-name="${escapeHtml(item.name)}">
            ${icon('edit')}
            Éditer
        </button>
    `)).join(''));

    bindButtons(el.packCreateList, '.open-pack-editor-btn', button => {
        activatePackView('edit');
        openPackEditor(button.dataset.packName);
    });
}

function renderPackEditList() {
    if (!el.packEditList) return;

    if (packsCache.length === 0) {
        setHtml(el.packEditList, emptyState('inventory_2', 'Aucun pack disponible', 'Crée un pack avant de l’éditer.'));
        return;
    }

    setHtml(el.packEditList, packsCache.map(pack => packListItem(pack, item => `
        <button class="mui-btn primary open-pack-editor-btn" type="button" data-pack-name="${escapeHtml(item.name)}">
            ${icon('open_in_new')}
            Ouvrir
        </button>

        <button class="mui-btn text danger delete-pack-btn" type="button" data-pack-name="${escapeHtml(item.name)}">
            ${icon('delete')}
            Supprimer
        </button>
    `)).join(''));

    bindButtons(el.packEditList, '.open-pack-editor-btn', button => openPackEditor(button.dataset.packName));
    bindButtons(el.packEditList, '.delete-pack-btn', button => deletePack(button.dataset.packName, button));
}

function renderPackEditDetail() {
    if (!el.packEditDetailContent || !currentPackName) return;

    const pack = packByName(currentPackName);

    if (!pack) {
        closePackEditor();
        return;
    }

    const metadata = packMetadata(pack);
    const packIconIds = new Set(pack.icons);
    const packIcons = pack.icons.map(iconById).filter(Boolean);
    const availableIcons = localIcons.filter(iconData => !packIconIds.has(iconData.id));

    const packIconsHtml = packIcons.length
        ? packIcons.map(iconData => renderPackIconCard(iconData, pack.name, true)).join('')
        : emptyState('inventory_2', 'Pack vide', 'Ajoute des icônes depuis l’iconothèque ci-dessous.');

    const availableIconsHtml = localIcons.length === 0
        ? emptyState('folder_off', 'Iconothèque vide', 'Importe d’abord des icônes dans ton iconothèque.')
        : availableIcons.length === 0
            ? emptyState('done_all', 'Toutes les icônes sont déjà dans ce pack', 'Il n’y a plus d’icône disponible à ajouter.')
            : availableIcons.map(iconData => renderPackIconCard(iconData, pack.name, false)).join('');

    setHtml(el.packEditDetailContent, `
        <header class="pack-editor-header">
            <div>
                <button id="back-to-pack-list-btn" class="mui-btn text" type="button">
                    ${icon('arrow_back')}
                    Retour aux packs
                </button>

                <p class="eyebrow">Sous-page d’édition</p>
                <h3>${escapeHtml(metadata.name)}</h3>
                <p>${escapeHtml(packCount(pack))} dans ce pack.</p>
            </div>

            <div class="pack-editor-actions">
                <button
                    class="mui-btn primary build-pack-btn"
                    type="button"
                    data-pack-name="${escapeHtml(pack.name)}"
                    ${pack.icons.length === 0 ? 'disabled' : ''}
                >
                    ${icon('archive')}
                    Exporter Stream Deck
                </button>

                <button class="mui-btn text danger delete-pack-btn" type="button" data-pack-name="${escapeHtml(pack.name)}">
                    ${icon('delete')}
                    Supprimer
                </button>
            </div>
        </header>

        ${renderPackMetadataForm(pack)}

        <section class="pack-editor-section">
            <div class="pack-section-header">
                <div>
                    <h3>Contenu du pack</h3>
                    <p>Retire les icônes que tu ne veux plus inclure.</p>
                </div>
            </div>

            <div class="icon-grid pack-editor-grid">
                ${packIconsHtml}
            </div>
        </section>

        <section class="pack-editor-section">
            <div class="pack-section-header">
                <div>
                    <h3>Ajouter des icônes</h3>
                    <p>Ajoute directement des icônes locales à ce pack.</p>
                </div>
            </div>

            <div class="icon-grid pack-editor-grid">
                ${availableIconsHtml}
            </div>
        </section>
    `);

    $('#back-to-pack-list-btn', el.packEditDetailContent).onclick = closePackEditor;

    $('#save-pack-metadata-btn', el.packEditDetailContent).onclick = event => {
        updatePackMetadata(event.currentTarget.dataset.packName, event.currentTarget);
    };

    bindButtons(el.packEditDetailContent, '.add-icon-to-pack-btn', button => {
        updatePackIcons('add_icons_to_pack', button.dataset.packName, [button.dataset.iconId], button);
    });

    bindButtons(el.packEditDetailContent, '.remove-icon-from-pack-btn', button => {
        updatePackIcons('remove_icons_from_pack', button.dataset.packName, [button.dataset.iconId], button);
    });

    bindButtons(el.packEditDetailContent, '.build-pack-btn', button => buildPack(button.dataset.packName, button));
    bindButtons(el.packEditDetailContent, '.delete-pack-btn', button => deletePack(button.dataset.packName, button));
}

function renderPackMergeView() {
    if (!el.mergeSourcePackSelect || !el.mergeTargetPackSelect) return;

    setHtml(el.mergeSourcePackSelect, packOptions('Pack source...'));
    setHtml(el.mergeTargetPackSelect, packOptions('Pack destination...'));
}

function renderPackExportView() {
    if (!el.exportPackSelect) return;

    const previousValue = el.exportPackSelect.value;

    setHtml(el.exportPackSelect, packOptions('Choisir un pack...'));

    if (previousValue && packByName(previousValue)) {
        el.exportPackSelect.value = previousValue;
    }

    updatePackExportSummary();
}

function updatePackExportSummary() {
    if (!el.packExportSummary) {
        return;
    }

    const packName = el.exportPackSelect?.value;
    const pack = packName ? packByName(packName) : null;

    if (packsCache.length === 0) {
        el.packExportSummary.textContent = 'Aucun pack à exporter pour le moment.';
        return;
    }

    if (!pack) {
        el.packExportSummary.textContent = 'Sélectionne un pack à exporter.';
        return;
    }

    const metadata = packMetadata(pack);

    el.packExportSummary.textContent =
        `Pack sélectionné : ${metadata.name} — ${packCount(pack)}. Le fichier exporté sera un .streamDeckIconPack.`;
}

async function createPackFromInput(input, button) {
    const name = input.value.trim();

    if (!name) {
        input.focus();
        notifyError('Création impossible', 'Entre un nom de pack.');
        return;
    }

    await withLoading(button, `${icon('hourglass_empty')} Création...`, `${icon('add_box')} Créer le pack`, async () => {
        try {
            await invoke('create_pack', { name });

            input.value = '';
            currentPackName = name;

            notifySuccess('Pack créé', `Le pack “${name}” a été créé.`);

            await renderPacksPage();
            activatePackView('edit');
            openPackEditor(name);
        } catch (error) {
            notifyError('Création du pack impossible', error);
        }
    });
}

async function updatePackIcons(command, packName, iconIds, button) {
    const normalHtml = command === 'add_icons_to_pack'
        ? `${icon('add')} Ajouter`
        : `${icon('remove')} Retirer`;

    await withLoading(button, icon('hourglass_empty'), normalHtml, async () => {
        try {
            await invoke(command, { packName, iconIds });
            await renderPacksPage();
        } catch (error) {
            notifyError('Modification du pack impossible', error);
        }
    });
}

async function updatePackMetadata(packName, button) {
    const metadata = {
        name: $('#pack-metadata-name-input', el.packEditDetailContent).value.trim(),
        author: $('#pack-metadata-author-input', el.packEditDetailContent).value.trim(),
        version: $('#pack-metadata-version-input', el.packEditDetailContent).value.trim(),
        description: $('#pack-metadata-description-input', el.packEditDetailContent).value.trim(),
        category: $('#pack-metadata-category-input', el.packEditDetailContent).value.trim(),
        tags: $('#pack-metadata-tags-input', el.packEditDetailContent)
            .value
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean),
        license: $('#pack-metadata-license-input', el.packEditDetailContent).value.trim(),
    };

    if (!metadata.name) {
        notifyError('Informations invalides', 'Le nom du pack est obligatoire.');
        return;
    }

    if (!metadata.author) {
        notifyError('Informations invalides', 'L’auteur du pack est obligatoire.');
        return;
    }

    if (!metadata.version) {
        notifyError('Informations invalides', 'La version du pack est obligatoire.');
        return;
    }

    if (!metadata.description) {
        notifyError('Informations invalides', 'La description du pack est obligatoire.');
        return;
    }

    if (!metadata.category) {
        notifyError('Informations invalides', 'La catégorie du pack est obligatoire.');
        return;
    }

    if (metadata.tags.length === 0) {
        metadata.tags = [metadata.category];
    }

    if (!metadata.license) {
        notifyError('Informations invalides', 'La licence du pack est obligatoire.');
        return;
    }

    await withLoading(button, `${icon('hourglass_empty')} Enregistrement...`, `${icon('save')} Enregistrer les informations`, async () => {
        try {
            await invoke('update_pack_metadata', {
                packName,
                metadata,
            });

            currentPackName = metadata.name;

            notifySuccess('Informations enregistrées', `Les informations du pack “${metadata.name}” ont été mises à jour.`);
            await renderPacksPage();
        } catch (error) {
            notifyError('Modification des informations impossible', error);
        }
    });
}

async function mergePacks(button) {
    const sourcePackName = el.mergeSourcePackSelect.value;
    const targetPackName = el.mergeTargetPackSelect.value;

    if (!sourcePackName || !targetPackName) {
        notifyError('Fusion impossible', 'Choisis un pack source et un pack destination.');
        return;
    }

    if (sourcePackName === targetPackName) {
        notifyError('Fusion impossible', 'Le pack source et le pack destination doivent être différents.');
        return;
    }

    const sourcePack = packByName(sourcePackName);

    if (!sourcePack || sourcePack.icons.length === 0) {
        notifyError('Fusion impossible', 'Le pack source est vide ou introuvable.');
        return;
    }

    await withLoading(button, `${icon('hourglass_empty')} Fusion...`, `${icon('call_merge')} Fusionner`, async () => {
        try {
            await invoke('add_icons_to_pack', {
                packName: targetPackName,
                iconIds: sourcePack.icons,
            });

            notifySuccess('Fusion terminée', `Les icônes du pack “${sourcePackName}” ont été ajoutées à “${targetPackName}”.`);
            await renderPacksPage();
        } catch (error) {
            notifyError('Fusion des packs impossible', error);
        }
    });
}

function defaultPackExportFileName(packName) {
    return `${packName.trim().replace(/[^\w\- ]+/g, '_').replace(/\s+/g, '_') || 'pack'}.streamDeckIconPack`;
}

async function choosePackExportPath(packName) {
    const save = window.__TAURI__?.dialog?.save;

    if (!save) {
        throw new Error('Le dialogue de sauvegarde Tauri est indisponible.');
    }

    return await save({
        title: 'Exporter le pack d’icônes Stream Deck',
        defaultPath: defaultPackExportFileName(packName),
        filters: [
            {
                name: 'Pack d’icônes Stream Deck',
                extensions: ['streamDeckIconPack'],
            },
        ],
    });
}

async function buildPack(packName, button) {
    let outputPath = null;

    try {
        outputPath = await choosePackExportPath(packName);
    } catch (error) {
        notifyError('Sélection du fichier impossible', error);
        return;
    }

    if (!outputPath) {
        return;
    }

    await withLoading(button, `${icon('hourglass_empty')} Export...`, `${icon('archive')} Exporter`, async () => {
        try {
            const result = await invoke('build_pack_to_path', {
                packName,
                outputPath,
            });

            notifySuccess(
                'Export Stream Deck terminé',
                `Le pack “${result.pack_name}” contient ${result.icon_count} icône${result.icon_count > 1 ? 's' : ''}.\nFichier : ${result.output_path}`
            );

            if (el.packExportSummary) {
                el.packExportSummary.textContent = `Dernier export : ${result.output_path}`;
            }

            await renderPacksPage();
        } catch (error) {
            notifyError('Export Stream Deck impossible', error);
        }
    });
}

async function exportSelectedPack(button) {
    const packName = el.exportPackSelect.value;

    if (!packName) {
        notifyError('Export impossible', 'Choisis un pack à exporter.');
        return;
    }

    await buildPack(packName, button);
}

async function deletePack(packName, button) {
    const confirmed = await showConfirmDialog({
        type: 'danger',
        iconName: 'delete',
        title: 'Supprimer ce pack ?',
        message: `Tu es sur le point de supprimer le pack “${packName}”. Les icônes locales ne seront pas supprimées.`,
        confirmText: 'Supprimer',
        cancelText: 'Annuler',
        danger: true,
    });

    if (!confirmed) return;

    await withLoading(button, `${icon('hourglass_empty')} Suppression...`, `${icon('delete')} Supprimer`, async () => {
        try {
            await invoke('delete_pack', { name: packName });

            if (currentPackName === packName) {
                closePackEditor();
            }

            notifySuccess('Pack supprimé', `Le pack “${packName}” a été supprimé.`);
            await renderPacksPage();
        } catch (error) {
            notifyError('Suppression du pack impossible', error);
        }
    });
}

async function saveSteamGridDbApiKeyFromSettings() {
    const apiKey = el.settingsApiKeyInput.value.trim();

    if (!apiKey) {
        el.settingsApiKeyInput.focus();
        notifyError('Clé SteamGridDB manquante', 'Colle une clé API SteamGridDB avant d’enregistrer.');
        return;
    }

    await withLoading(el.settingsApiKeySave, `${icon('hourglass_empty')} Test...`, `${icon('save')} Enregistrer et tester`, async () => {
        try {
            await invoke('save_steamgriddb_api_key', { apiKey });

            el.settingsApiKeyInput.value = '';

            await refreshSavedSteamGridDbApiKey();
            await refreshSteamGridDbApiStatus({ notify: true });
        } catch (error) {
            setSteamGridDbApiStatus('invalid', 'Clé SGDB invalide');
            notifyError('Erreur SteamGridDB', error);
        }
    });
}

async function testSteamGridDbApiKeyFromSettings() {
    await withLoading(
        el.settingsApiKeyTest,
        `${icon('hourglass_empty')} Test...`,
        `${icon('science')} Tester la clé actuelle`,
        () => refreshSteamGridDbApiStatus({ notify: true })
    );
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

    el.windowMinimize.onclick = () => appWindow.minimize();
    el.windowMaximize.onclick = () => appWindow.toggleMaximize();
    el.windowClose.onclick = () => appWindow.close();

    el.windowTitlebar.addEventListener('mousedown', event => {
        if (event.target.closest('.window-control-btn') || event.button !== 0) {
            return;
        }

        appWindow.startDragging();
    });

    el.windowTitlebar.addEventListener('dblclick', event => {
        if (!event.target.closest('.window-control-btn')) {
            appWindow.toggleMaximize();
        }
    });
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

    if (el.createPack && el.newPackNameInput) {
        el.createPack.onclick = () => createPackFromInput(el.newPackNameInput, el.createPack);
        onEnter(el.newPackNameInput, () => createPackFromInput(el.newPackNameInput, el.createPack));
    }

    if (el.refreshPacks) {
        el.refreshPacks.onclick = renderPacksPage;
    }

    el.packSubnavButtons.forEach(button => {
        button.onclick = () => activatePackView(button.dataset.packView);
    });

    if (el.mergePacks) {
        el.mergePacks.onclick = () => mergePacks(el.mergePacks);
    }

    if (el.exportPack) {
        el.exportPack.onclick = () => exportSelectedPack(el.exportPack);
    }

    if (el.exportPackSelect) {
        el.exportPackSelect.onchange = updatePackExportSummary;
    }

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

        if (!button) return;

        const entry = sgdbDownloadById.get(button.dataset.assetId);

        if (entry) {
            downloadSteamGridDbAsset(entry.asset, entry.gameName, button);
        }
    });
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