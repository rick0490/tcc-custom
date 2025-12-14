/**
 * Platform Admin JavaScript
 * Superuser tools and platform management
 */

// State
let currentTab = 'users';
let usersData = [];
let keysData = [];
let tournamentsData = [];
let auditData = [];
let backupsData = [];
let announcementsData = [];
let platformSettings = {};
let auditOffset = 0;
const AUDIT_LIMIT = 50;

// Media management state
let flyersData = [];
let flyersUsers = {};
let sponsorsData = [];
let sponsorsUsers = {};
let previewState = {
    type: null,     // 'flyer' or 'sponsor'
    item: null,     // current item data
    ownerId: null,
    filename: null
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    FrontendDebug.log('PlatformAdmin', 'Initializing...');

    // Check if user is superadmin
    await checkSuperadminAccess();

    // Check impersonation status
    await checkImpersonationStatus();

    // Setup form handlers
    setupFormHandlers();

    // Load initial data for users tab
    await loadUsers();

    // Initialize WebSocket
    initWebSocket();
});

/**
 * Check if current user has superadmin access
 */
async function checkSuperadminAccess() {
    try {
        const response = await csrfFetch('/api/auth/status');
        const data = await response.json();

        if (!data.isSuperadmin) {
            showAlert('Access denied. Superadmin privileges required.', 'error');
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
            return;
        }

        FrontendDebug.log('PlatformAdmin', 'Superadmin access confirmed');
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to verify access', error);
        showAlert('Failed to verify access', 'error');
    }
}

/**
 * Check current impersonation status
 */
async function checkImpersonationStatus() {
    try {
        const response = await csrfFetch('/api/admin/impersonation-status');
        const data = await response.json();

        if (data.success && data.impersonation) {
            document.getElementById('impersonationBanner').classList.remove('hidden');
            document.getElementById('impersonatingUser').textContent = data.impersonation.targetUsername;
        } else {
            document.getElementById('impersonationBanner').classList.add('hidden');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to check impersonation status', error);
    }
}

/**
 * Setup form event handlers
 */
function setupFormHandlers() {
    // Create key form
    document.getElementById('createKeyForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createInviteKey();
    });

    // Create announcement form
    document.getElementById('createAnnouncementForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createAnnouncement();
    });

    // Subscription form
    document.getElementById('subscriptionForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateSubscription();
    });

    // Impersonate form
    document.getElementById('impersonateForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await startImpersonation();
    });

    // Platform settings form
    document.getElementById('platformSettingsForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await savePlatformSettings();
    });

    // Search on Enter
    document.getElementById('tournamentSearch')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchTournaments();
    });
}

/**
 * Initialize WebSocket for real-time updates
 */
function initWebSocket() {
    if (!WebSocketManager.init()) {
        FrontendDebug.warn('PlatformAdmin', 'WebSocket not available');
        return;
    }

    WebSocketManager.subscribeMany({
        'announcement:broadcast': handleAnnouncementBroadcast,
        'user:updated': () => loadUsers(),
        'user:created': () => loadUsers()
    });
}

// ============================================
// TAB NAVIGATION
// ============================================

/**
 * Switch between tabs
 */
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.platform-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');

    currentTab = tabName;
    FrontendDebug.log('PlatformAdmin', `Switched to tab: ${tabName}`);

    // Load tab data if needed
    switch (tabName) {
        case 'users':
            if (usersData.length === 0) loadUsers();
            break;
        case 'keys':
            if (keysData.length === 0) loadKeys();
            break;
        case 'database':
            loadDatabaseStatus();
            loadBackups();
            break;
        case 'announcements':
            loadAnnouncements();
            break;
        case 'settings':
            loadPlatformSettings();
            break;
        case 'audit':
            // Load users for filter dropdown
            loadAuditUserFilter();
            break;
        case 'systemHealth':
            loadSystemHealth();
            break;
        case 'monitoring':
            loadMonitoringStatus();
            loadSavedReports();
            // Phase 2: Initialize real-time metrics and alerts
            initPhase2Monitoring();
            loadAlertHistory();
            loadMetricsHistory();
            break;
        case 'displays':
            initDisplaysTab();
            break;
        case 'flyers':
            if (flyersData.length === 0) loadFlyers();
            break;
        case 'sponsors':
            if (sponsorsData.length === 0) loadSponsors();
            break;
        case 'statistics':
            loadPlatformStats();
            break;
        case 'liveFeed':
            loadLiveFeed();
            break;
        case 'query':
            // Initialize query tab if needed
            break;
    }
}

// ============================================
// USERS TAB
// ============================================

/**
 * Load all users
 */
async function loadUsers() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading users');
        const response = await csrfFetch('/api/admin/users');
        const data = await response.json();

        if (data.success) {
            usersData = data.users;
            renderUsers(data.users);
            updateUserStats(data.stats);

            // Also update owner filter in tournaments tab
            updateOwnerFilter(data.users);
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load users', error);
        showAlert('Failed to load users', 'error');
    }
}

/**
 * Render users table
 */
function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');

    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No users found</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${user.id}</td>
            <td>
                <span class="font-medium">${escapeHtml(user.username)}</span>
                ${user.isSuperadmin ? '<span class="badge badge-purple ml-2">Super</span>' : ''}
            </td>
            <td>
                <span class="badge ${user.is_active ? 'badge-green' : 'badge-red'}">
                    ${user.is_active ? 'Active' : 'Disabled'}
                </span>
            </td>
            <td>
                <span class="badge ${getSubscriptionBadgeClass(user.subscription_status)}">
                    ${user.subscription_status || 'none'}
                </span>
                ${user.subscription_expires_at ? `<br><span class="text-xs text-gray-400">${formatDate(user.subscription_expires_at)}</span>` : ''}
            </td>
            <td class="text-sm text-gray-400">
                ${user.last_login_at ? formatDate(user.last_login_at) : 'Never'}
            </td>
            <td class="text-right">
                <div class="flex justify-end gap-2">
                    <button onclick="viewUserProfile(${user.id})" class="text-blue-400 hover:text-blue-300 text-sm">
                        View
                    </button>
                    ${!user.isSuperadmin ? `
                        <button onclick="showImpersonateModal(${user.id}, '${escapeHtml(user.username)}')" class="text-yellow-400 hover:text-yellow-300 text-sm">
                            Impersonate
                        </button>
                        <button onclick="toggleUserStatus(${user.id}, ${!user.is_active})" class="text-${user.is_active ? 'red' : 'green'}-400 hover:text-${user.is_active ? 'red' : 'green'}-300 text-sm">
                            ${user.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button onclick="showSubscriptionModal(${user.id})" class="text-purple-400 hover:text-purple-300 text-sm">
                            Subscription
                        </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Update user stats display
 */
function updateUserStats(stats) {
    if (!stats) return;
    document.getElementById('statTotalUsers').textContent = stats.total || 0;
    document.getElementById('statActiveUsers').textContent = stats.active || 0;
    document.getElementById('statTrialUsers').textContent = stats.trial || 0;
    document.getElementById('statExpiredUsers').textContent = stats.expired || 0;
}

/**
 * Get badge class for role
 */
function getRoleBadgeClass(role) {
    switch (role) {
        case 'admin': return 'badge-blue';
        case 'user': return 'badge-gray';
        case 'viewer': return 'badge-gray';
        default: return 'badge-gray';
    }
}

/**
 * Get badge class for subscription status
 */
function getSubscriptionBadgeClass(status) {
    switch (status) {
        case 'active': return 'badge-green';
        case 'trial': return 'badge-yellow';
        case 'expired': return 'badge-red';
        case 'suspended': return 'badge-red';
        default: return 'badge-gray';
    }
}

/**
 * View user details
 */
async function viewUserDetails(userId) {
    try {
        const response = await csrfFetch(`/api/admin/users/${userId}`);
        const data = await response.json();

        if (data.success) {
            const user = data.user;
            document.getElementById('userDetailContent').innerHTML = `
                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <div class="text-sm text-gray-400">Username</div>
                            <div class="text-white font-medium">${escapeHtml(user.username)}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Type</div>
                            <div><span class="badge ${user.isSuperadmin ? 'badge-purple' : 'badge-gray'}">${user.isSuperadmin ? 'Superadmin' : 'User'}</span></div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Email</div>
                            <div class="text-white">${user.email || 'Not set'}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Status</div>
                            <div><span class="badge ${user.is_active ? 'badge-green' : 'badge-red'}">${user.is_active ? 'Active' : 'Disabled'}</span></div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Subscription</div>
                            <div><span class="badge ${getSubscriptionBadgeClass(user.subscription_status)}">${user.subscription_status || 'none'}</span></div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Expires</div>
                            <div class="text-white">${user.subscription_expires_at ? formatDate(user.subscription_expires_at) : 'N/A'}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Created</div>
                            <div class="text-white">${formatDate(user.created_at)}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Last Login</div>
                            <div class="text-white">${user.last_login_at ? formatDate(user.last_login_at) : 'Never'}</div>
                        </div>
                    </div>
                    ${user.invite_key_used ? `
                        <div>
                            <div class="text-sm text-gray-400">Invite Key Used</div>
                            <div class="text-white font-mono">${escapeHtml(user.invite_key_used)}</div>
                        </div>
                    ` : ''}
                </div>
            `;
            document.getElementById('userDetailModal').classList.remove('hidden');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load user details', error);
        showAlert('Failed to load user details', 'error');
    }
}

function closeUserDetailModal() {
    document.getElementById('userDetailModal').classList.add('hidden');
}

/**
 * Toggle user active status
 */
async function toggleUserStatus(userId, isActive) {
    try {
        const response = await csrfFetch(`/api/admin/users/${userId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive })
        });

        const data = await response.json();

        if (data.success) {
            showAlert(data.message, 'success');
            loadUsers();
        } else {
            showAlert(data.error || 'Failed to update user', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to toggle user status', error);
        showAlert('Failed to update user status', 'error');
    }
}

/**
 * Show subscription modal
 */
function showSubscriptionModal(userId) {
    const user = usersData.find(u => u.id === userId);
    if (!user) return;

    document.getElementById('subUserId').value = userId;
    document.getElementById('subStatus').value = user.subscription_status || 'active';
    document.getElementById('subExpiresAt').value = user.subscription_expires_at ?
        user.subscription_expires_at.split('T')[0] : '';
    document.getElementById('subNote').value = '';
    document.getElementById('subscriptionModal').classList.remove('hidden');
}

function closeSubscriptionModal() {
    document.getElementById('subscriptionModal').classList.add('hidden');
}

/**
 * Update user subscription
 */
async function updateSubscription() {
    const userId = document.getElementById('subUserId').value;
    const status = document.getElementById('subStatus').value;
    const expiresAt = document.getElementById('subExpiresAt').value;
    const note = document.getElementById('subNote').value;

    try {
        const response = await csrfFetch(`/api/admin/users/${userId}/subscription`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, expiresAt, note })
        });

        const data = await response.json();

        if (data.success) {
            showAlert(data.message, 'success');
            closeSubscriptionModal();
            loadUsers();
        } else {
            showAlert(data.error || 'Failed to update subscription', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to update subscription', error);
        showAlert('Failed to update subscription', 'error');
    }
}

/**
 * Show impersonate modal
 */
function showImpersonateModal(userId, username) {
    document.getElementById('impersonateUserId').value = userId;
    document.getElementById('impersonateUsername').textContent = username;
    document.getElementById('impersonateReason').value = '';
    document.getElementById('impersonateModal').classList.remove('hidden');
}

function closeImpersonateModal() {
    document.getElementById('impersonateModal').classList.add('hidden');
}

/**
 * Start impersonation
 */
async function startImpersonation() {
    const userId = document.getElementById('impersonateUserId').value;
    const reason = document.getElementById('impersonateReason').value;

    if (!reason.trim()) {
        showAlert('Please provide a reason for impersonation', 'error');
        return;
    }

    try {
        const response = await csrfFetch(`/api/admin/impersonate/${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Impersonation started', 'success');
            closeImpersonateModal();
            // Redirect to dashboard as the impersonated user
            window.location.href = '/';
        } else {
            showAlert(data.error || 'Failed to start impersonation', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to start impersonation', error);
        showAlert('Failed to start impersonation', 'error');
    }
}

/**
 * Stop impersonation
 */
async function stopImpersonation() {
    try {
        const response = await csrfFetch('/api/admin/stop-impersonation', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Impersonation stopped', 'success');
            document.getElementById('impersonationBanner').classList.add('hidden');
            // Refresh page to restore original session
            window.location.reload();
        } else {
            showAlert(data.error || 'Failed to stop impersonation', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to stop impersonation', error);
        showAlert('Failed to stop impersonation', 'error');
    }
}

// ============================================
// INVITE KEYS TAB
// ============================================

/**
 * Load all invite keys
 */
async function loadKeys() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading invite keys');
        const response = await csrfFetch('/api/admin/invite-keys');
        const data = await response.json();

        if (data.success) {
            keysData = data.keys;
            renderKeys(data.keys);
            updateKeyStats(data.keys);
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load keys', error);
        showAlert('Failed to load invite keys', 'error');
    }
}

/**
 * Render keys table
 */
function renderKeys(keys) {
    const tbody = document.getElementById('keysTableBody');

    if (!keys || keys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No invite keys found</td></tr>';
        return;
    }

    tbody.innerHTML = keys.map(key => `
        <tr>
            <td>
                <span class="key-code">${maskKeyCode(key.key_code)}</span>
                <button onclick="copyKeyCode('${key.key_code}')" class="ml-2 text-blue-400 hover:text-blue-300 text-sm">
                    Copy
                </button>
            </td>
            <td>${escapeHtml(key.name || 'Unnamed')}</td>
            <td>
                <span class="badge ${getKeyTypeBadgeClass(key.key_type)}">${key.key_type}</span>
            </td>
            <td>
                ${key.key_type === 'unlimited' ?
                    `<span class="text-gray-400">Unlimited</span>` :
                    `${key.total_uses || 0} / ${key.key_type === 'single' ? 1 : (key.uses_remaining + (key.total_uses || 0))}`
                }
            </td>
            <td>
                <span class="badge ${key.is_active ? 'badge-green' : 'badge-red'}">
                    ${key.is_active ? 'Active' : 'Inactive'}
                </span>
                ${key.expires_at && new Date(key.expires_at) < new Date() ?
                    '<span class="badge badge-yellow ml-1">Expired</span>' : ''}
            </td>
            <td class="text-sm text-gray-400">${key.created_by_username || 'System'}</td>
            <td class="text-right">
                <div class="flex justify-end gap-2">
                    <button onclick="viewKeyUsage(${key.id})" class="text-blue-400 hover:text-blue-300 text-sm">
                        Usage
                    </button>
                    ${key.is_active ? `
                        <button onclick="deactivateKey(${key.id})" class="text-red-400 hover:text-red-300 text-sm">
                            Deactivate
                        </button>
                    ` : `
                        <button onclick="reactivateKey(${key.id})" class="text-green-400 hover:text-green-300 text-sm">
                            Reactivate
                        </button>
                    `}
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Update key stats display
 */
function updateKeyStats(keys) {
    const stats = {
        total: keys.length,
        active: keys.filter(k => k.is_active).length,
        unlimited: keys.filter(k => k.key_type === 'unlimited').length,
        registrations: keys.reduce((sum, k) => sum + (k.total_uses || 0), 0)
    };

    document.getElementById('statTotalKeys').textContent = stats.total;
    document.getElementById('statActiveKeys').textContent = stats.active;
    document.getElementById('statUnlimitedKeys').textContent = stats.unlimited;
    document.getElementById('statTotalRegistrations').textContent = stats.registrations;
}

/**
 * Get badge class for key type
 */
function getKeyTypeBadgeClass(type) {
    switch (type) {
        case 'unlimited': return 'badge-purple';
        case 'multi': return 'badge-blue';
        case 'single': return 'badge-gray';
        default: return 'badge-gray';
    }
}

/**
 * Mask key code for display
 */
function maskKeyCode(code) {
    if (!code) return '';
    return code.substring(0, 4) + '...' + code.substring(code.length - 4);
}

/**
 * Copy key code to clipboard
 */
function copyKeyCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        showAlert('Key code copied to clipboard', 'success', 2000);
    }).catch(() => {
        showAlert('Failed to copy key code', 'error');
    });
}

/**
 * Update key type options visibility
 */
function updateKeyTypeOptions() {
    const keyType = document.getElementById('keyType').value;
    const usesField = document.getElementById('usesAllowedField');
    usesField.classList.toggle('hidden', keyType !== 'multi');
}

/**
 * Create new invite key
 */
async function createInviteKey() {
    const name = document.getElementById('keyName').value;
    const keyType = document.getElementById('keyType').value;
    const usesRemaining = document.getElementById('usesAllowed').value;
    const expiresAt = document.getElementById('keyExpires').value;

    try {
        const response = await csrfFetch('/api/admin/invite-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, keyType, usesRemaining, expiresAt: expiresAt || null })
        });

        const data = await response.json();

        if (data.success) {
            showAlert(`Key created: ${data.key.key_code}`, 'success');
            copyKeyCode(data.key.key_code);
            loadKeys();

            // Reset form
            document.getElementById('keyName').value = '';
            document.getElementById('keyType').value = 'unlimited';
            document.getElementById('keyExpires').value = '';
            updateKeyTypeOptions();
        } else {
            showAlert(data.error || 'Failed to create key', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to create key', error);
        showAlert('Failed to create invite key', 'error');
    }
}

/**
 * View key usage history
 */
async function viewKeyUsage(keyId) {
    try {
        const response = await csrfFetch(`/api/admin/invite-keys/${keyId}/usage`);
        const data = await response.json();

        if (data.success) {
            const usage = data.usage;
            document.getElementById('keyUsageContent').innerHTML = usage.length === 0 ?
                '<div class="text-center py-8 text-gray-400">No usage history</div>' :
                `<table class="data-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Email</th>
                            <th>IP Address</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${usage.map(u => `
                            <tr>
                                <td>${escapeHtml(u.username)}</td>
                                <td>${escapeHtml(u.email || 'N/A')}</td>
                                <td class="font-mono text-sm">${u.ip_address || 'N/A'}</td>
                                <td>${formatDate(u.used_at)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>`;
            document.getElementById('keyUsageModal').classList.remove('hidden');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load key usage', error);
        showAlert('Failed to load usage history', 'error');
    }
}

function closeKeyUsageModal() {
    document.getElementById('keyUsageModal').classList.add('hidden');
}

/**
 * Deactivate key
 */
async function deactivateKey(keyId) {
    if (!confirm('Are you sure you want to deactivate this key?')) return;

    try {
        const response = await csrfFetch(`/api/admin/invite-keys/${keyId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Key deactivated', 'success');
            loadKeys();
        } else {
            showAlert(data.error || 'Failed to deactivate key', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to deactivate key', error);
        showAlert('Failed to deactivate key', 'error');
    }
}

/**
 * Reactivate key
 */
async function reactivateKey(keyId) {
    try {
        const response = await csrfFetch(`/api/admin/invite-keys/${keyId}/reactivate`, {
            method: 'PUT'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Key reactivated', 'success');
            loadKeys();
        } else {
            showAlert(data.error || 'Failed to reactivate key', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to reactivate key', error);
        showAlert('Failed to reactivate key', 'error');
    }
}

// ============================================
// TOURNAMENTS TAB
// ============================================

/**
 * Update owner filter dropdown
 */
function updateOwnerFilter(users) {
    const select = document.getElementById('tournamentOwner');
    if (!select) return;

    select.innerHTML = '<option value="">All Owners</option>' +
        users.map(u => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join('');
}

/**
 * Search tournaments
 */
async function searchTournaments() {
    const search = document.getElementById('tournamentSearch').value;
    const state = document.getElementById('tournamentState').value;
    const userId = document.getElementById('tournamentOwner').value;

    try {
        FrontendDebug.api('PlatformAdmin', 'Searching tournaments');

        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (state) params.append('state', state);
        if (userId) params.append('userId', userId);

        const response = await csrfFetch(`/api/admin/tournaments?${params}`);
        const data = await response.json();

        if (data.success) {
            tournamentsData = data.tournaments;
            renderTournaments(data.tournaments);
        } else {
            showAlert(data.error || 'Search failed', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to search tournaments', error);
        showAlert('Failed to search tournaments', 'error');
    }
}

/**
 * Render tournament results
 */
function renderTournaments(tournaments) {
    const container = document.getElementById('tournamentResults');

    if (!tournaments || tournaments.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-400">No tournaments found</div>';
        return;
    }

    container.innerHTML = `
        <div class="overflow-x-auto">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Owner</th>
                        <th>Game</th>
                        <th>Type</th>
                        <th>State</th>
                        <th>Participants</th>
                        <th>Created</th>
                        <th class="text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${tournaments.map(t => `
                        <tr>
                            <td>
                                <span class="font-medium">${escapeHtml(t.name)}</span>
                                <br><span class="text-xs text-gray-400">${t.url_slug}</span>
                            </td>
                            <td>${escapeHtml(t.owner_username || 'Unknown')}</td>
                            <td>${escapeHtml(t.game_name || 'N/A')}</td>
                            <td class="text-sm">${t.tournament_type || 'N/A'}</td>
                            <td>
                                <span class="badge ${getStateBadgeClass(t.state)}">${t.state}</span>
                            </td>
                            <td>${t.participant_count || 0}</td>
                            <td class="text-sm text-gray-400">${formatDate(t.created_at)}</td>
                            <td class="text-right">
                                <button onclick="viewTournamentDetails(${t.id})" class="text-blue-400 hover:text-blue-300 text-sm">
                                    Details
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Get badge class for state
 */
function getStateBadgeClass(state) {
    switch (state) {
        case 'pending': return 'badge-yellow';
        case 'underway': return 'badge-green';
        case 'complete': return 'badge-blue';
        case 'awaiting_review': return 'badge-purple';
        default: return 'badge-gray';
    }
}

/**
 * View tournament details
 */
async function viewTournamentDetails(tournamentId) {
    try {
        const response = await csrfFetch(`/api/admin/tournaments/${tournamentId}/details`);
        const data = await response.json();

        if (data.success) {
            const t = data.tournament;
            const participants = data.participants || [];

            document.getElementById('tournamentDetailContent').innerHTML = `
                <div class="space-y-6">
                    <!-- Tournament Info -->
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                            <div class="text-sm text-gray-400">Name</div>
                            <div class="text-white font-medium">${escapeHtml(t.name)}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">URL Slug</div>
                            <div class="text-white font-mono text-sm">${t.url_slug}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Owner</div>
                            <div class="text-white">${escapeHtml(data.owner?.username || 'Unknown')}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Game</div>
                            <div class="text-white">${escapeHtml(t.game_name || 'N/A')}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Format</div>
                            <div class="text-white">${t.tournament_type || 'N/A'}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">State</div>
                            <div><span class="badge ${getStateBadgeClass(t.state)}">${t.state}</span></div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Participants</div>
                            <div class="text-white">${participants.length} / ${t.signup_cap || 'Unlimited'}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Created</div>
                            <div class="text-white">${formatDate(t.created_at)}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-400">Starts At</div>
                            <div class="text-white">${t.starts_at ? formatDate(t.starts_at) : 'Not set'}</div>
                        </div>
                    </div>

                    <!-- Participants Preview -->
                    ${participants.length > 0 ? `
                        <div>
                            <div class="text-sm text-gray-400 mb-2">Participants (${participants.length})</div>
                            <div class="max-h-48 overflow-y-auto bg-gray-700/50 rounded-lg p-3">
                                <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                                    ${participants.slice(0, 30).map(p => `
                                        <div class="text-sm">
                                            <span class="text-gray-400">#${p.seed || '?'}</span>
                                            <span class="text-white ml-1">${escapeHtml(p.name)}</span>
                                            ${p.checked_in ? '<span class="text-green-400 ml-1">✓</span>' : ''}
                                        </div>
                                    `).join('')}
                                    ${participants.length > 30 ? `<div class="text-gray-400 text-sm">...and ${participants.length - 30} more</div>` : ''}
                                </div>
                            </div>
                        </div>
                    ` : ''}

                    <!-- Actions -->
                    <div class="flex gap-3 pt-4 border-t border-gray-700">
                        <a href="/tournament.html?id=${t.id}" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm">
                            Open in Editor
                        </a>
                        ${data.owner ? `
                            <button onclick="showImpersonateModal(${data.owner.id}, '${escapeHtml(data.owner.username)}'); closeTournamentDetailModal();"
                                class="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-md text-sm">
                                View as Owner
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
            document.getElementById('tournamentDetailModal').classList.remove('hidden');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load tournament details', error);
        showAlert('Failed to load tournament details', 'error');
    }
}

function closeTournamentDetailModal() {
    document.getElementById('tournamentDetailModal').classList.add('hidden');
}

// ============================================
// AUDIT LOG TAB
// ============================================

/**
 * Load users for audit filter
 */
async function loadAuditUserFilter() {
    if (usersData.length === 0) {
        await loadUsers();
    }

    const select = document.getElementById('auditUser');
    select.innerHTML = '<option value="">All Users</option>' +
        usersData.map(u => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join('');
}

/**
 * Load audit log
 */
async function loadAuditLog(append = false) {
    const userId = document.getElementById('auditUser').value;
    const action = document.getElementById('auditAction').value;
    const from = document.getElementById('auditFrom').value;
    const to = document.getElementById('auditTo').value;

    if (!append) {
        auditOffset = 0;
        auditData = [];
    }

    try {
        FrontendDebug.api('PlatformAdmin', 'Loading audit log');

        const params = new URLSearchParams();
        if (userId) params.append('userId', userId);
        if (action) params.append('action', action);
        if (from) params.append('from', from);
        if (to) params.append('to', to);
        params.append('limit', AUDIT_LIMIT);
        params.append('offset', auditOffset);

        const response = await csrfFetch(`/api/admin/activity-log?${params}`);
        const data = await response.json();

        if (data.success) {
            if (append) {
                auditData = [...auditData, ...data.activities];
            } else {
                auditData = data.activities;
            }
            renderAuditLog(auditData, data.total);
            auditOffset += AUDIT_LIMIT;
        } else {
            showAlert(data.error || 'Failed to load audit log', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load audit log', error);
        showAlert('Failed to load audit log', 'error');
    }
}

/**
 * Render audit log table
 */
function renderAuditLog(activities, total) {
    const tbody = document.getElementById('auditTableBody');

    if (!activities || activities.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400">No activity found</td></tr>';
        document.getElementById('auditPagination').innerHTML = '';
        return;
    }

    tbody.innerHTML = activities.map(a => `
        <tr>
            <td class="text-sm">${formatDate(a.timestamp)}</td>
            <td>${escapeHtml(a.username || 'System')}</td>
            <td>
                <span class="badge ${getActionBadgeClass(a.action)}">${a.action}</span>
            </td>
            <td class="text-sm">${escapeHtml(a.target || '')}</td>
            <td class="text-sm text-gray-400">
                ${a.details ? `<button onclick="toggleAuditDetails(this)" class="text-blue-400 hover:text-blue-300">Show</button>
                    <pre class="hidden mt-2 text-xs bg-gray-700 p-2 rounded max-w-md overflow-x-auto">${escapeHtml(JSON.stringify(a.details, null, 2))}</pre>` : ''}
            </td>
        </tr>
    `).join('');

    // Pagination
    const hasMore = activities.length >= AUDIT_LIMIT && auditOffset < total;
    document.getElementById('auditPagination').innerHTML = hasMore ?
        `<button onclick="loadAuditLog(true)" class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md">
            Load More (${activities.length} of ${total})
        </button>` :
        `<span class="text-gray-400">Showing ${activities.length} of ${total} activities</span>`;
}

/**
 * Get badge class for action type
 */
function getActionBadgeClass(action) {
    if (action?.includes('login')) return 'badge-green';
    if (action?.includes('logout')) return 'badge-gray';
    if (action?.includes('tournament')) return 'badge-blue';
    if (action?.includes('participant')) return 'badge-yellow';
    if (action?.includes('match')) return 'badge-purple';
    if (action?.includes('impersonation')) return 'badge-red';
    return 'badge-gray';
}

/**
 * Toggle audit details visibility
 */
function toggleAuditDetails(btn) {
    const pre = btn.nextElementSibling;
    pre.classList.toggle('hidden');
    btn.textContent = pre.classList.contains('hidden') ? 'Show' : 'Hide';
}

/**
 * Export audit log to CSV
 */
async function exportAuditLog() {
    const userId = document.getElementById('auditUser').value;
    const action = document.getElementById('auditAction').value;
    const from = document.getElementById('auditFrom').value;
    const to = document.getElementById('auditTo').value;

    try {
        const params = new URLSearchParams();
        if (userId) params.append('userId', userId);
        if (action) params.append('action', action);
        if (from) params.append('from', from);
        if (to) params.append('to', to);
        params.append('format', 'csv');

        const response = await csrfFetch(`/api/admin/activity-log/export?${params}`);

        if (response.ok) {
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            showAlert('Export downloaded', 'success');
        } else {
            showAlert('Failed to export audit log', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to export audit log', error);
        showAlert('Failed to export audit log', 'error');
    }
}

// ============================================
// DATABASE TAB
// ============================================

/**
 * Load database status
 */
async function loadDatabaseStatus() {
    const indicator = document.getElementById('dbConnectionIndicator');
    const statusText = document.getElementById('dbConnectionStatus');

    try {
        FrontendDebug.api('PlatformAdmin', 'Loading database status');
        const response = await csrfFetch('/api/admin/database/status');
        const data = await response.json();

        if (data.success) {
            // Update connection status
            if (indicator && statusText) {
                indicator.classList.remove('bg-gray-500', 'bg-green-500', 'bg-red-500');
                indicator.classList.add('bg-green-500');
                statusText.textContent = 'Connected';
            }

            // Update database cards
            data.databases.forEach(db => {
                const card = document.getElementById(`db-${db.name}`);
                if (card) {
                    card.querySelector('.text-2xl').textContent = formatFileSize(db.size);
                    card.querySelector('.text-sm').textContent = `${db.tableCount} tables`;
                }
            });
        } else {
            // Connection failed
            if (indicator && statusText) {
                indicator.classList.remove('bg-gray-500', 'bg-green-500', 'bg-red-500');
                indicator.classList.add('bg-red-500');
                statusText.textContent = 'Connection failed';
            }
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load database status', error);
        // Connection error
        if (indicator && statusText) {
            indicator.classList.remove('bg-gray-500', 'bg-green-500', 'bg-red-500');
            indicator.classList.add('bg-red-500');
            statusText.textContent = 'Connection error';
        }
    }
}

/**
 * Load backups list
 */
async function loadBackups() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading backups');
        const response = await csrfFetch('/api/admin/database/backups');
        const data = await response.json();

        if (data.success) {
            backupsData = data.backups;
            renderBackups(data.backups);
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load backups', error);
    }
}

/**
 * Render backups table
 */
function renderBackups(backups) {
    const tbody = document.getElementById('backupsTableBody');

    if (!backups || backups.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-400">No backups found</td></tr>';
        return;
    }

    tbody.innerHTML = backups.map(b => `
        <tr>
            <td class="font-mono text-sm">${escapeHtml(b.filename)}</td>
            <td>${escapeHtml(b.database)}</td>
            <td>${formatFileSize(b.size)}</td>
            <td class="text-sm text-gray-400">${formatDate(b.createdAt)}</td>
            <td class="text-right">
                <button onclick="downloadBackup('${escapeHtml(b.filename)}')" class="text-blue-400 hover:text-blue-300 text-sm mr-2">
                    Download
                </button>
                <button onclick="deleteBackup('${escapeHtml(b.filename)}')" class="text-red-400 hover:text-red-300 text-sm">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');
}

/**
 * Create database backup
 */
async function createBackup(database) {
    try {
        showAlert(`Creating backup for ${database}...`, 'info');

        const response = await csrfFetch('/api/admin/database/backup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ database })
        });

        const data = await response.json();

        if (data.success) {
            showAlert(`Backup created: ${data.filename}`, 'success');
            loadBackups();
        } else {
            showAlert(data.error || 'Failed to create backup', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to create backup', error);
        showAlert('Failed to create backup', 'error');
    }
}

/**
 * Download backup file
 */
function downloadBackup(filename) {
    window.location.href = `/api/admin/database/backups/${encodeURIComponent(filename)}`;
}

/**
 * Delete backup file
 */
async function deleteBackup(filename) {
    if (!confirm(`Are you sure you want to delete backup: ${filename}?`)) return;

    try {
        const response = await csrfFetch(`/api/admin/database/backups/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Backup deleted', 'success');
            loadBackups();
        } else {
            showAlert(data.error || 'Failed to delete backup', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to delete backup', error);
        showAlert('Failed to delete backup', 'error');
    }
}

/**
 * Export all data as JSON
 */
async function exportAllData() {
    showAlert('Exporting all data...', 'info');
    window.location.href = '/api/admin/database/export';
}

/**
 * Clear cache database
 */
async function clearCacheDb() {
    if (!confirm('Are you sure you want to clear the cache database? This is safe and will not affect any tournament data.')) return;

    try {
        const response = await csrfFetch('/api/admin/database/clear-cache', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Cache cleared', 'success');
            loadDatabaseStatus();
        } else {
            showAlert(data.error || 'Failed to clear cache', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to clear cache', error);
        showAlert('Failed to clear cache', 'error');
    }
}

/**
 * Vacuum all databases
 */
async function vacuumDatabases() {
    if (!confirm('This will optimize all databases. Continue?')) return;

    try {
        showAlert('Vacuuming databases...', 'info');

        const response = await csrfFetch('/api/admin/database/vacuum', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Databases optimized', 'success');
            loadDatabaseStatus();
        } else {
            showAlert(data.error || 'Failed to vacuum databases', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to vacuum databases', error);
        showAlert('Failed to vacuum databases', 'error');
    }
}

/**
 * Run integrity check
 */
async function runIntegrityCheck() {
    try {
        showAlert('Running integrity check...', 'info');

        const response = await csrfFetch('/api/admin/database/integrity-check', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            if (data.issues && data.issues.length > 0) {
                showAlert(`Integrity check found ${data.issues.length} issues`, 'warning');
            } else {
                showAlert('All databases passed integrity check', 'success');
            }
        } else {
            showAlert(data.error || 'Integrity check failed', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to run integrity check', error);
        showAlert('Failed to run integrity check', 'error');
    }
}

// ============================================
// ANNOUNCEMENTS TAB
// ============================================

/**
 * Load announcements
 */
async function loadAnnouncements() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading announcements');
        const response = await csrfFetch('/api/admin/announcements');
        const data = await response.json();

        if (data.success) {
            announcementsData = data.announcements;
            renderActiveAnnouncements(data.announcements.filter(a => a.is_active));
            renderAnnouncementHistory(data.announcements.filter(a => !a.is_active));
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load announcements', error);
    }
}

/**
 * Render active announcements
 */
function renderActiveAnnouncements(announcements) {
    const container = document.getElementById('activeAnnouncements');

    if (!announcements || announcements.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-center py-4">No active announcements</div>';
        return;
    }

    container.innerHTML = announcements.map(a => `
        <div class="p-4 rounded-lg border ${getAnnouncementBorderClass(a.type)}">
            <div class="flex items-start justify-between">
                <div>
                    <span class="badge ${getAnnouncementBadgeClass(a.type)} mb-2">${a.type}</span>
                    <p class="text-white">${escapeHtml(a.message)}</p>
                    <p class="text-sm text-gray-400 mt-1">
                        Created ${formatDate(a.created_at)}
                        ${a.expires_at ? ` · Expires ${formatDate(a.expires_at)}` : ' · No expiration'}
                    </p>
                </div>
                <button onclick="deleteAnnouncement(${a.id})" class="text-red-400 hover:text-red-300">
                    Dismiss
                </button>
            </div>
        </div>
    `).join('');
}

/**
 * Render announcement history
 */
function renderAnnouncementHistory(announcements) {
    const tbody = document.getElementById('announcementHistoryBody');

    if (!announcements || announcements.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-400">No history</td></tr>';
        return;
    }

    tbody.innerHTML = announcements.slice(0, 20).map(a => `
        <tr>
            <td class="max-w-xs truncate">${escapeHtml(a.message)}</td>
            <td><span class="badge ${getAnnouncementBadgeClass(a.type)}">${a.type}</span></td>
            <td class="text-sm text-gray-400">${formatDate(a.created_at)}</td>
            <td class="text-sm text-gray-400">${a.expires_at ? formatDate(a.expires_at) : 'Manual'}</td>
            <td class="text-sm text-gray-400">${escapeHtml(a.created_by_username || 'System')}</td>
        </tr>
    `).join('');
}

/**
 * Get announcement border class
 */
function getAnnouncementBorderClass(type) {
    switch (type) {
        case 'info': return 'border-blue-500 bg-blue-500/10';
        case 'warning': return 'border-yellow-500 bg-yellow-500/10';
        case 'alert': return 'border-red-500 bg-red-500/10';
        default: return 'border-gray-500 bg-gray-500/10';
    }
}

/**
 * Get announcement badge class
 */
function getAnnouncementBadgeClass(type) {
    switch (type) {
        case 'info': return 'badge-blue';
        case 'warning': return 'badge-yellow';
        case 'alert': return 'badge-red';
        default: return 'badge-gray';
    }
}

/**
 * Create announcement
 */
async function createAnnouncement() {
    const message = document.getElementById('announcementMessage').value.trim();
    const type = document.getElementById('announcementType').value;
    const durationHours = parseInt(document.getElementById('announcementDuration').value) || 0;

    if (!message) {
        showAlert('Please enter a message', 'error');
        return;
    }

    try {
        const response = await csrfFetch('/api/admin/announcements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, type, durationHours })
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Announcement broadcast', 'success');
            document.getElementById('announcementMessage').value = '';
            document.getElementById('announcementDuration').value = '0';
            loadAnnouncements();
        } else {
            showAlert(data.error || 'Failed to create announcement', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to create announcement', error);
        showAlert('Failed to create announcement', 'error');
    }
}

/**
 * Delete/dismiss announcement
 */
async function deleteAnnouncement(id) {
    try {
        const response = await csrfFetch(`/api/admin/announcements/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Announcement dismissed', 'success');
            loadAnnouncements();
        } else {
            showAlert(data.error || 'Failed to dismiss announcement', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to dismiss announcement', error);
        showAlert('Failed to dismiss announcement', 'error');
    }
}

/**
 * Handle announcement broadcast from WebSocket
 */
function handleAnnouncementBroadcast(data) {
    FrontendDebug.ws('PlatformAdmin', 'Announcement received', data);
    if (currentTab === 'announcements') {
        loadAnnouncements();
    }
}

// ============================================
// PLATFORM SETTINGS TAB
// ============================================

/**
 * Load platform settings
 */
async function loadPlatformSettings() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading platform settings');
        const response = await csrfFetch('/api/admin/platform-settings');
        const data = await response.json();

        if (data.success) {
            platformSettings = data.settings;
            populatePlatformSettings(data.settings);
        }

        // Also load Claude API key status
        loadClaudeApiKeyStatus();
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load platform settings', error);
    }
}

/**
 * Populate settings form
 */
function populatePlatformSettings(settings) {
    document.getElementById('allowSignups').checked = settings.allowSignups ?? true;
    document.getElementById('requireInviteKey').checked = settings.requireInviteKey ?? false;
    document.getElementById('trialDurationDays').value = settings.trialDurationDays ?? 14;
    document.getElementById('maintenanceMode').checked = settings.maintenanceMode ?? false;
    document.getElementById('maintenanceMessage').value = settings.maintenanceMessage || '';
}

/**
 * Save platform settings
 */
async function savePlatformSettings() {
    const settings = {
        allowSignups: document.getElementById('allowSignups').checked,
        requireInviteKey: document.getElementById('requireInviteKey').checked,
        trialDurationDays: parseInt(document.getElementById('trialDurationDays').value) || 14,
        maintenanceMode: document.getElementById('maintenanceMode').checked,
        maintenanceMessage: document.getElementById('maintenanceMessage').value
    };

    try {
        const response = await csrfFetch('/api/admin/platform-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Settings saved', 'success');
            platformSettings = data.settings;
        } else {
            showAlert(data.error || 'Failed to save settings', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to save settings', error);
        showAlert('Failed to save settings', 'error');
    }
}

// ============================================
// CLAUDE API KEY MANAGEMENT
// ============================================

/**
 * Load Claude API key status
 */
async function loadClaudeApiKeyStatus() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading Claude API key status');
        const response = await csrfFetch('/api/admin/claude-api-key');
        const data = await response.json();

        if (data.success) {
            updateClaudeApiKeyStatus(data);
        } else {
            updateClaudeApiKeyStatus({ configured: false });
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load Claude API key status', error);
        updateClaudeApiKeyStatus({ configured: false, error: true });
    }
}

/**
 * Update Claude API key status display
 */
function updateClaudeApiKeyStatus(data) {
    const statusEl = document.getElementById('claudeKeyStatus');
    const sourceEl = document.getElementById('claudeKeySource');
    const inputEl = document.getElementById('claudeApiKey');
    const removeBtn = document.getElementById('removeClaudeKeyBtn');
    const testBtn = document.getElementById('testClaudeKeyBtn');

    if (!statusEl) return;

    if (data.error) {
        statusEl.innerHTML = `
            <span class="inline-block w-3 h-3 rounded-full bg-red-500"></span>
            <span class="text-red-400">Error checking status</span>
        `;
        sourceEl.textContent = '';
        return;
    }

    if (data.configured) {
        statusEl.innerHTML = `
            <span class="inline-block w-3 h-3 rounded-full bg-green-500"></span>
            <span class="text-green-400">Configured</span>
            <span class="text-gray-400 ml-2">(${data.maskedKey || '****'})</span>
        `;
        sourceEl.textContent = data.source === 'encrypted' ? 'Encrypted storage' : 'Environment variable';
        if (inputEl) inputEl.placeholder = 'Enter new key to replace...';
        if (removeBtn) removeBtn.classList.remove('hidden');
        if (testBtn) testBtn.disabled = false;
    } else {
        statusEl.innerHTML = `
            <span class="inline-block w-3 h-3 rounded-full bg-yellow-500"></span>
            <span class="text-yellow-400">Not Configured</span>
        `;
        sourceEl.textContent = '';
        if (inputEl) inputEl.placeholder = 'sk-ant-api03-...';
        if (removeBtn) removeBtn.classList.add('hidden');
        if (testBtn) testBtn.disabled = true;
    }
}

/**
 * Toggle API key visibility
 */
function toggleApiKeyVisibility() {
    const input = document.getElementById('claudeApiKey');
    const eyeIcon = document.getElementById('eyeIcon');
    const eyeOffIcon = document.getElementById('eyeOffIcon');

    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        eyeIcon.classList.add('hidden');
        eyeOffIcon.classList.remove('hidden');
    } else {
        input.type = 'password';
        eyeIcon.classList.remove('hidden');
        eyeOffIcon.classList.add('hidden');
    }
}

/**
 * Save Claude API key
 */
async function saveClaudeApiKey() {
    const apiKey = document.getElementById('claudeApiKey')?.value?.trim();

    if (!apiKey) {
        showAlert('Please enter an API key', 'error');
        return;
    }

    // Basic format validation
    if (!apiKey.startsWith('sk-ant-')) {
        showAlert('API key must start with sk-ant-', 'error');
        return;
    }

    const saveBtn = document.getElementById('saveClaudeKeyBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        FrontendDebug.api('PlatformAdmin', 'Saving Claude API key');

        const response = await csrfFetch('/api/admin/claude-api-key', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, validate: true })
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Claude API key saved successfully', 'success');
            document.getElementById('claudeApiKey').value = '';
            loadClaudeApiKeyStatus();
        } else {
            showAlert(data.error || 'Failed to save API key', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to save Claude API key', error);
        showAlert('Failed to save API key', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Key';
        }
    }
}

/**
 * Test Claude API key connection
 */
async function testClaudeApiKey() {
    const testBtn = document.getElementById('testClaudeKeyBtn');
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';
    }

    try {
        FrontendDebug.api('PlatformAdmin', 'Testing Claude API key');

        const response = await csrfFetch('/api/analytics/ai-seeding/status');
        const data = await response.json();

        if (data.success && data.available) {
            showAlert('Claude API connection successful', 'success');
        } else {
            showAlert(data.reason || 'API connection test failed', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to test Claude API key', error);
        showAlert('Failed to test API connection', 'error');
    } finally {
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.textContent = 'Test Connection';
        }
    }
}

/**
 * Remove Claude API key
 */
async function removeClaudeApiKey() {
    if (!confirm('Are you sure you want to remove the Claude API key? AI features will be disabled.')) {
        return;
    }

    const removeBtn = document.getElementById('removeClaudeKeyBtn');
    if (removeBtn) {
        removeBtn.disabled = true;
        removeBtn.textContent = 'Removing...';
    }

    try {
        FrontendDebug.api('PlatformAdmin', 'Removing Claude API key');

        const response = await csrfFetch('/api/admin/claude-api-key', {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Claude API key removed', 'success');
            loadClaudeApiKeyStatus();
        } else {
            showAlert(data.error || 'Failed to remove API key', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to remove Claude API key', error);
        showAlert('Failed to remove API key', 'error');
    } finally {
        if (removeBtn) {
            removeBtn.disabled = false;
            removeBtn.textContent = 'Remove Key';
        }
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Format file size
 */
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format date helper (relative or absolute)
 */
function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    // Less than 24 hours - show relative
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        if (hours < 1) {
            const mins = Math.floor(diff / 60000);
            return mins < 1 ? 'Just now' : `${mins}m ago`;
        }
        return `${hours}h ago`;
    }

    // Less than 7 days - show day and time
    if (diff < 604800000) {
        return date.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    }

    // Otherwise show full date
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============================================
// FLYERS TAB
// ============================================

/**
 * Load all flyers from platform API
 */
async function loadFlyers() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading flyers');
        const response = await csrfFetch('/api/admin/flyers');
        const data = await response.json();

        if (data.success) {
            flyersData = data.flyers;
            flyersUsers = data.users;
            renderFlyers(data.flyers);
            updateFlyerStats(data.stats);
        } else {
            showAlert(data.error || 'Failed to load flyers', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load flyers', error);
        showAlert('Failed to load flyers', 'error');
    }
}

/**
 * Render flyers grid
 */
function renderFlyers(flyers) {
    const grid = document.getElementById('flyersGrid');
    if (!grid) return;

    if (!flyers || flyers.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-8 text-gray-400">No flyers found</div>';
        return;
    }

    grid.innerHTML = flyers.map(flyer => {
        const isVideo = flyer.type === 'video' || flyer.filename.match(/\.(mp4|webm|mov)$/i);
        const isLegacy = flyer.isLegacy;
        const ownerName = flyersUsers[flyer.ownerId] || `User ${flyer.ownerId}`;
        const previewUrl = isLegacy
            ? `/api/flyers/preview/${encodeURIComponent(flyer.filename)}`
            : `/api/flyers/preview/${flyer.ownerId}/${encodeURIComponent(flyer.filename)}`;

        return `
            <div class="media-card">
                <div class="media-thumbnail-container" onclick="showImagePreview('flyer', ${JSON.stringify(flyer).replace(/"/g, '&quot;')})">
                    ${isVideo ? `
                        <video src="${previewUrl}" class="media-thumbnail" muted></video>
                        <span class="media-video-badge">Video</span>
                        <span class="media-play-icon">
                            <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"/>
                            </svg>
                        </span>
                    ` : `
                        <img src="${previewUrl}" alt="${escapeHtml(flyer.filename)}" class="media-thumbnail" loading="lazy">
                    `}
                </div>
                <div class="media-info">
                    <div class="media-filename" title="${escapeHtml(flyer.filename)}">${escapeHtml(flyer.filename)}</div>
                    <div class="media-meta">
                        ${isLegacy ? `
                            <span class="media-legacy-badge">Legacy</span>
                        ` : `
                            <span class="media-owner-badge">${escapeHtml(ownerName)}</span>
                        `}
                        <span class="media-size">${formatFileSize(flyer.size)}</span>
                    </div>
                    <div class="media-actions">
                        <button onclick="deleteFlyerAdmin('${flyer.ownerId}', '${escapeHtml(flyer.filename)}')" class="media-action-btn delete">
                            Delete
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Update flyer stats display
 */
function updateFlyerStats(stats) {
    if (!stats) return;
    const totalEl = document.getElementById('statTotalFlyers');
    const sizeEl = document.getElementById('statFlyersSize');
    const usersEl = document.getElementById('statFlyersUsers');

    if (totalEl) totalEl.textContent = stats.total || 0;
    if (sizeEl) sizeEl.textContent = formatFileSize(stats.totalSize || 0);
    if (usersEl) usersEl.textContent = stats.userCount || 0;
}

/**
 * Filter flyers by user
 */
function filterFlyers() {
    const userId = document.getElementById('flyerUserFilter')?.value || '';
    const search = document.getElementById('flyerSearch')?.value?.toLowerCase() || '';

    let filtered = flyersData;

    if (userId) {
        filtered = filtered.filter(f => String(f.ownerId) === userId);
    }

    if (search) {
        filtered = filtered.filter(f => f.filename.toLowerCase().includes(search));
    }

    renderFlyers(filtered);
}

/**
 * Delete flyer (admin)
 */
async function deleteFlyerAdmin(userId, filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
        const response = await csrfFetch(`/api/admin/flyers/${userId}/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Flyer deleted', 'success');
            closeImagePreview();
            loadFlyers();
        } else {
            showAlert(data.error || 'Failed to delete flyer', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to delete flyer', error);
        showAlert('Failed to delete flyer', 'error');
    }
}

// ============================================
// SPONSORS TAB
// ============================================

/**
 * Load all sponsors from platform API
 */
async function loadSponsors() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading sponsors');
        const response = await csrfFetch('/api/admin/sponsors');
        const data = await response.json();

        if (data.success) {
            sponsorsData = data.sponsors;
            sponsorsUsers = data.users;
            renderSponsors(data.sponsors);
            updateSponsorStats(data.stats);
        } else {
            showAlert(data.error || 'Failed to load sponsors', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load sponsors', error);
        showAlert('Failed to load sponsors', 'error');
    }
}

/**
 * Render sponsors grid
 */
function renderSponsors(sponsors) {
    const grid = document.getElementById('sponsorsGrid');
    if (!grid) return;

    if (!sponsors || sponsors.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-8 text-gray-400">No sponsors found</div>';
        return;
    }

    grid.innerHTML = sponsors.map(sponsor => {
        const ownerName = sponsorsUsers[sponsor.ownerId] || `User ${sponsor.ownerId}`;
        const previewUrl = `/api/sponsors/preview/${sponsor.ownerId}/${encodeURIComponent(sponsor.filename)}`;

        return `
            <div class="media-card ${sponsor.active ? 'sponsor-active' : ''}">
                <div class="media-thumbnail-container" onclick="showImagePreview('sponsor', ${JSON.stringify(sponsor).replace(/"/g, '&quot;')})">
                    <img src="${previewUrl}" alt="${escapeHtml(sponsor.name)}" class="media-thumbnail" loading="lazy">
                    ${sponsor.active ? '<span class="sponsor-active-badge">Active</span>' : ''}
                </div>
                <div class="media-info">
                    <div class="media-filename" title="${escapeHtml(sponsor.name)}">${escapeHtml(sponsor.name)}</div>
                    <div class="media-meta">
                        <span class="media-owner-badge">${escapeHtml(ownerName)}</span>
                        <span class="sponsor-position-badge">${escapeHtml(sponsor.position || 'Unassigned')}</span>
                    </div>
                    <div class="media-actions">
                        <button onclick="deleteSponsorAdmin('${sponsor.ownerId}', '${escapeHtml(sponsor.id)}')" class="media-action-btn delete">
                            Delete
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Update sponsor stats display
 */
function updateSponsorStats(stats) {
    if (!stats) return;
    const totalEl = document.getElementById('statTotalSponsors');
    const activeEl = document.getElementById('statActiveSponsors');
    const usersEl = document.getElementById('statSponsorsUsers');

    if (totalEl) totalEl.textContent = stats.totalSponsors || stats.total || 0;
    if (activeEl) activeEl.textContent = stats.activeSponsors || stats.active || 0;
    if (usersEl) usersEl.textContent = stats.userCount || 0;
}

/**
 * Filter sponsors by user
 */
function filterSponsors() {
    const userId = document.getElementById('sponsorUserFilter')?.value || '';
    const search = document.getElementById('sponsorSearch')?.value?.toLowerCase() || '';

    let filtered = sponsorsData;

    if (userId) {
        filtered = filtered.filter(s => String(s.ownerId) === userId);
    }

    if (search) {
        filtered = filtered.filter(s =>
            s.name.toLowerCase().includes(search) ||
            s.filename.toLowerCase().includes(search)
        );
    }

    renderSponsors(filtered);
}

/**
 * Delete sponsor (admin)
 */
async function deleteSponsorAdmin(userId, sponsorId) {
    if (!confirm('Are you sure you want to delete this sponsor?')) return;

    try {
        const response = await csrfFetch(`/api/admin/sponsors/${userId}/${encodeURIComponent(sponsorId)}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Sponsor deleted', 'success');
            closeImagePreview();
            loadSponsors();
        } else {
            showAlert(data.error || 'Failed to delete sponsor', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to delete sponsor', error);
        showAlert('Failed to delete sponsor', 'error');
    }
}

// ============================================
// IMAGE PREVIEW MODAL
// ============================================

/**
 * Show image preview modal
 */
function showImagePreview(type, item) {
    previewState = {
        type,
        item,
        ownerId: item.ownerId,
        filename: type === 'flyer' ? item.filename : item.filename
    };

    const modal = document.getElementById('imagePreviewModal');
    const container = document.getElementById('previewImageContainer');
    const infoPanel = document.getElementById('previewInfoPanel');

    if (!modal || !container || !infoPanel) return;

    let mediaUrl, isVideo = false;

    if (type === 'flyer') {
        isVideo = item.type === 'video' || item.filename.match(/\.(mp4|webm|mov)$/i);
        mediaUrl = item.isLegacy
            ? `/api/flyers/preview/${encodeURIComponent(item.filename)}`
            : `/api/flyers/preview/${item.ownerId}/${encodeURIComponent(item.filename)}`;
    } else {
        mediaUrl = `/api/sponsors/preview/${item.ownerId}/${encodeURIComponent(item.filename)}`;
    }

    // Render media
    if (isVideo) {
        container.innerHTML = `
            <video src="${mediaUrl}" class="preview-image" controls autoplay loop muted></video>
        `;
    } else {
        container.innerHTML = `
            <img src="${mediaUrl}" alt="${escapeHtml(item.filename || item.name)}" class="preview-image">
        `;
    }

    // Render info panel
    const ownerName = type === 'flyer'
        ? (flyersUsers[item.ownerId] || `User ${item.ownerId}`)
        : (sponsorsUsers[item.ownerId] || `User ${item.ownerId}`);

    infoPanel.innerHTML = `
        <div class="preview-info-row">
            <span class="preview-info-label">Filename:</span>
            <span class="preview-info-value">${escapeHtml(item.filename || item.name)}</span>
        </div>
        ${item.name && item.name !== item.filename ? `
            <div class="preview-info-row">
                <span class="preview-info-label">Name:</span>
                <span class="preview-info-value">${escapeHtml(item.name)}</span>
            </div>
        ` : ''}
        <div class="preview-info-row">
            <span class="preview-info-label">Owner:</span>
            <span class="preview-info-value">${item.isLegacy ? 'Legacy (root)' : escapeHtml(ownerName)}</span>
        </div>
        ${item.size ? `
            <div class="preview-info-row">
                <span class="preview-info-label">Size:</span>
                <span class="preview-info-value">${formatFileSize(item.size)}</span>
            </div>
        ` : ''}
        ${item.modified ? `
            <div class="preview-info-row">
                <span class="preview-info-label">Modified:</span>
                <span class="preview-info-value">${formatDate(item.modified)}</span>
            </div>
        ` : ''}
        ${type === 'sponsor' && item.position ? `
            <div class="preview-info-row">
                <span class="preview-info-label">Position:</span>
                <span class="preview-info-value">${escapeHtml(item.position)}</span>
            </div>
        ` : ''}
        ${type === 'sponsor' ? `
            <div class="preview-info-row">
                <span class="preview-info-label">Status:</span>
                <span class="preview-info-value">${item.active ? '<span class="text-green-400">Active</span>' : '<span class="text-gray-400">Inactive</span>'}</span>
            </div>
        ` : ''}
        <div class="mt-4">
            <button onclick="deleteFromPreview()" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm w-full">
                Delete
            </button>
        </div>
    `;

    modal.classList.remove('hidden');

    // Add escape key handler
    document.addEventListener('keydown', handlePreviewEscape);
}

/**
 * Close image preview modal
 */
function closeImagePreview() {
    const modal = document.getElementById('imagePreviewModal');
    if (modal) {
        modal.classList.add('hidden');
    }

    // Clear container
    const container = document.getElementById('previewImageContainer');
    if (container) {
        container.innerHTML = '';
    }

    previewState = {
        type: null,
        item: null,
        ownerId: null,
        filename: null
    };

    document.removeEventListener('keydown', handlePreviewEscape);
}

/**
 * Handle escape key for preview modal
 */
function handlePreviewEscape(e) {
    if (e.key === 'Escape') {
        closeImagePreview();
    }
}

/**
 * Delete from preview modal
 */
function deleteFromPreview() {
    if (!previewState.type || !previewState.item) return;

    if (previewState.type === 'flyer') {
        deleteFlyerAdmin(previewState.item.ownerId || 'legacy', previewState.item.filename);
    } else {
        deleteSponsorAdmin(previewState.item.ownerId, previewState.item.id);
    }
}

// ============================================
// SYSTEM HEALTH TAB
// ============================================

/**
 * Load system health information
 */
async function loadSystemHealth() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading system health');

        const response = await csrfFetch('/api/status');
        const statusData = await response.json();

        // Update module status
        if (statusData.success) {
            updateModuleStatus('match', statusData.modules?.match);
            updateModuleStatus('bracket', statusData.modules?.bracket);
            updateModuleStatus('flyer', statusData.modules?.flyer);

            // Update server info
            if (statusData.server) {
                document.getElementById('serverHostname').textContent = statusData.server.hostname || '-';
                document.getElementById('serverNodeVersion').textContent = statusData.server.nodeVersion || '-';
                document.getElementById('serverUptime').textContent = formatUptime(statusData.server.uptime) || '-';
                document.getElementById('serverMemory').textContent = statusData.server.memoryUsage
                    ? `${Math.round(statusData.server.memoryUsage.rss / 1024 / 1024)} MB`
                    : '-';
            }
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load system health', error);
    }
}

/**
 * Update module status display
 */
function updateModuleStatus(module, moduleData) {
    const indicator = document.getElementById(`${module}ModuleIndicator`);
    const statusText = document.getElementById(`${module}ModuleStatus`);

    if (!indicator || !statusText) return;

    indicator.classList.remove('bg-gray-500', 'bg-green-500', 'bg-red-500', 'bg-yellow-500');

    // moduleData has structure: { status: { running: bool, response/error }, state, port }
    const status = moduleData?.status;

    if (status?.running) {
        indicator.classList.add('bg-green-500');
        statusText.textContent = 'Online';
        statusText.classList.remove('text-red-400', 'text-yellow-400');
        statusText.classList.add('text-green-400');
    } else if (status?.error) {
        indicator.classList.add('bg-red-500');
        statusText.textContent = 'Error: ' + (status.error || 'Unknown');
        statusText.classList.remove('text-green-400', 'text-yellow-400');
        statusText.classList.add('text-red-400');
    } else {
        indicator.classList.add('bg-red-500');
        statusText.textContent = 'Offline';
        statusText.classList.remove('text-green-400', 'text-yellow-400');
        statusText.classList.add('text-red-400');
    }
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds) {
    if (!seconds) return '-';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.join(' ') || '< 1m';
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================
// MONITORING TAB
// ============================================

let monitoringInterval = null;

/**
 * Load monitoring status
 */
async function loadMonitoringStatus() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading monitoring status');
        const response = await csrfFetch('/api/monitoring/status');
        const data = await response.json();

        const statusEl = document.getElementById('monitoringSessionStatus');
        const startBtn = document.getElementById('startMonitoringBtn');
        const stopBtn = document.getElementById('stopMonitoringBtn');
        const generateBtn = document.getElementById('generateReportBtn');

        if (data.success && data.isActive) {
            const elapsed = Math.floor((Date.now() - new Date(data.startedAt).getTime()) / 1000);
            statusEl.innerHTML = `
                <span class="text-green-400">Active session</span>
                <br><span class="text-gray-400">${data.samplesCollected} samples collected · ${formatUptime(elapsed)} elapsed</span>
            `;
            startBtn.disabled = true;
            stopBtn.disabled = false;
            generateBtn.disabled = false;

            // Start polling for updates
            if (!monitoringInterval) {
                monitoringInterval = setInterval(loadMonitoringStatus, 5000);
            }
        } else {
            statusEl.textContent = 'No active monitoring session';
            startBtn.disabled = false;
            stopBtn.disabled = true;
            generateBtn.disabled = true;

            // Stop polling
            if (monitoringInterval) {
                clearInterval(monitoringInterval);
                monitoringInterval = null;
            }
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load monitoring status', error);
    }
}

/**
 * Start monitoring session
 */
async function startMonitoringSession() {
    const durationMinutes = parseInt(document.getElementById('monitoringDuration').value);

    try {
        FrontendDebug.api('PlatformAdmin', 'Starting monitoring session');

        const response = await csrfFetch('/api/monitoring/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ durationMinutes })
        });

        const data = await response.json();

        if (data.success) {
            showAlert(`Monitoring started for ${durationMinutes} minutes`, 'success');
            loadMonitoringStatus();
        } else {
            showAlert(data.error || 'Failed to start monitoring', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to start monitoring', error);
        showAlert('Failed to start monitoring', 'error');
    }
}

/**
 * Stop monitoring session
 */
async function stopMonitoringSession() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Stopping monitoring session');

        const response = await csrfFetch('/api/monitoring/stop', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Monitoring stopped', 'success');
            loadMonitoringStatus();
        } else {
            showAlert(data.error || 'Failed to stop monitoring', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to stop monitoring', error);
        showAlert('Failed to stop monitoring', 'error');
    }
}

/**
 * Run quick system check
 */
async function runQuickCheck() {
    const btn = document.getElementById('quickCheckBtn');
    const resultsDiv = document.getElementById('quickCheckResults');
    const outputEl = document.getElementById('quickCheckOutput');

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Running...';
    }

    try {
        FrontendDebug.api('PlatformAdmin', 'Running quick system check');

        const response = await csrfFetch('/api/monitoring/quick-check');
        const data = await response.json();

        if (data.success) {
            resultsDiv.classList.remove('hidden');
            outputEl.textContent = formatQuickCheckResults(data);
        } else {
            showAlert(data.error || 'Quick check failed', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to run quick check', error);
        showAlert('Failed to run quick check', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Quick System Check';
        }
    }
}

/**
 * Format quick check results for display
 */
function formatQuickCheckResults(data) {
    let output = `System Check - ${new Date(data.timestamp).toLocaleString()}\n`;
    output += '='.repeat(50) + '\n\n';

    // Services
    output += 'SERVICES:\n';
    data.services?.forEach(s => {
        const status = s.status === 'running' ? '✓' : '✗';
        output += `  ${status} ${s.name}: ${s.status}`;
        if (s.uptime) output += ` (${s.uptime})`;
        output += '\n';
    });
    output += '\n';

    // APIs
    output += 'API ENDPOINTS:\n';
    data.apis?.forEach(a => {
        const status = a.status === 'ok' ? '✓' : '✗';
        output += `  ${status} ${a.name}: ${a.status}`;
        if (a.responseTime) output += ` (${a.responseTime}ms)`;
        output += '\n';
    });
    output += '\n';

    // System
    if (data.system) {
        output += 'SYSTEM RESOURCES:\n';
        if (data.system.memory) {
            const pct = data.system.memory.percentage || 0;
            output += `  Memory: ${pct}% used\n`;
        }
        if (data.system.cpu) {
            output += `  CPU Load: ${data.system.cpu.loadAverage?.join(', ') || 'N/A'}\n`;
        }
        if (data.system.disk) {
            output += `  Disk: ${data.system.disk.percentage}% used\n`;
        }
        output += '\n';
    }

    // Pi Displays
    if (data.piDisplays?.length > 0) {
        output += 'PI DISPLAYS:\n';
        data.piDisplays.forEach(p => {
            const status = p.status === 'online' ? '✓' : '✗';
            output += `  ${status} ${p.hostname}: ${p.status}`;
            if (p.cpuTemp) output += ` (CPU: ${p.cpuTemp}°C)`;
            output += '\n';
        });
        output += '\n';
    }

    // Issues
    if (data.issues?.length > 0) {
        output += 'ISSUES DETECTED:\n';
        data.issues.forEach(i => {
            output += `  [${i.severity?.toUpperCase() || 'WARN'}] ${i.message}\n`;
        });
    } else {
        output += 'No issues detected.\n';
    }

    return output;
}

/**
 * Generate monitoring report
 */
async function generateMonitoringReport() {
    const btn = document.getElementById('generateReportBtn');
    const copyBtn = document.getElementById('copyReportBtn');
    const outputDiv = document.getElementById('monitoringReportOutput');
    const contentEl = document.getElementById('reportContent');

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Generating...';
    }

    try {
        FrontendDebug.api('PlatformAdmin', 'Generating monitoring report');

        const response = await csrfFetch('/api/monitoring/report');
        const data = await response.json();

        if (data.success) {
            outputDiv.classList.remove('hidden');
            contentEl.textContent = JSON.stringify(data.report, null, 2);
            copyBtn.disabled = false;
            showAlert('Report generated', 'success');
            loadSavedReports();
        } else {
            showAlert(data.error || 'Failed to generate report', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to generate report', error);
        showAlert('Failed to generate report', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Generate Report';
        }
    }
}

/**
 * Copy report to clipboard
 */
function copyReportToClipboard() {
    const contentEl = document.getElementById('reportContent');
    if (!contentEl) return;

    navigator.clipboard.writeText(contentEl.textContent).then(() => {
        showAlert('Report copied to clipboard', 'success');
    }).catch(() => {
        showAlert('Failed to copy report', 'error');
    });
}

/**
 * Load saved reports list
 */
async function loadSavedReports() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading saved reports');

        const response = await csrfFetch('/api/monitoring/reports');
        const data = await response.json();

        const listEl = document.getElementById('savedReportsList');
        if (!listEl) return;

        if (data.success && data.reports?.length > 0) {
            listEl.innerHTML = data.reports.slice(0, 10).map(r => `
                <div class="flex items-center justify-between py-2 border-b border-gray-700">
                    <div>
                        <span class="text-white font-mono text-sm">${escapeHtml(r.filename)}</span>
                        <br><span class="text-gray-400 text-xs">${formatFileSize(r.size)} · ${formatDate(r.createdAt)}</span>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="viewSavedReport('${escapeHtml(r.filename)}')" class="text-blue-400 hover:text-blue-300 text-sm">View</button>
                        <button onclick="deleteSavedReport('${escapeHtml(r.filename)}')" class="text-red-400 hover:text-red-300 text-sm">Delete</button>
                    </div>
                </div>
            `).join('');
        } else {
            listEl.innerHTML = '<div class="text-gray-400">No saved reports</div>';
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load saved reports', error);
    }
}

/**
 * View saved report
 */
async function viewSavedReport(filename) {
    try {
        const response = await csrfFetch(`/api/monitoring/reports/${encodeURIComponent(filename)}`);
        const data = await response.json();

        if (data.success) {
            const outputDiv = document.getElementById('monitoringReportOutput');
            const contentEl = document.getElementById('reportContent');
            const copyBtn = document.getElementById('copyReportBtn');

            outputDiv.classList.remove('hidden');
            contentEl.textContent = JSON.stringify(data.report, null, 2);
            copyBtn.disabled = false;
        } else {
            showAlert(data.error || 'Failed to load report', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to view report', error);
        showAlert('Failed to load report', 'error');
    }
}

/**
 * Delete saved report
 */
async function deleteSavedReport(filename) {
    if (!confirm(`Delete report: ${filename}?`)) return;

    try {
        const response = await csrfFetch(`/api/monitoring/reports/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Report deleted', 'success');
            loadSavedReports();
        } else {
            showAlert(data.error || 'Failed to delete report', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to delete report', error);
        showAlert('Failed to delete report', 'error');
    }
}

/**
 * Open service logs modal
 */
function openServiceLogsModal() {
    const modal = document.getElementById('serviceLogsModal');
    if (modal) {
        modal.classList.remove('hidden');
        refreshServiceLogs();
    }
}

/**
 * Close service logs modal
 */
function closeServiceLogsModal() {
    const modal = document.getElementById('serviceLogsModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Refresh service logs
 */
async function refreshServiceLogs() {
    const service = document.getElementById('serviceLogSelect')?.value || 'control-center-admin';
    const lines = document.getElementById('logLinesSelect')?.value || 100;
    const outputEl = document.getElementById('serviceLogsContent');

    if (!outputEl) return;

    outputEl.textContent = 'Loading logs...';

    try {
        const response = await csrfFetch(`/api/monitoring/logs?service=${encodeURIComponent(service)}&lines=${lines}`);
        const data = await response.json();

        if (data.success) {
            outputEl.textContent = data.logs || 'No logs available';
        } else {
            outputEl.textContent = 'Failed to load logs: ' + (data.error || 'Unknown error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load service logs', error);
        outputEl.textContent = 'Failed to load logs';
    }
}

// ============================================
// PHASE 2: PERFORMANCE MONITORING
// ============================================

let metricsAutoRefreshInterval = null;
let metricsCollectionEnabled = false;

/**
 * Load active alerts from metrics system
 */
async function loadActiveAlerts() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading active alerts');
        const response = await csrfFetch('/api/admin/alerts');
        const data = await response.json();

        const banner = document.getElementById('alertsBanner');
        const countEl = document.getElementById('alertCount');
        const listEl = document.getElementById('alertsList');

        if (!banner || !countEl || !listEl) return;

        if (data.success && data.alerts?.length > 0) {
            banner.classList.remove('hidden');
            countEl.textContent = data.alerts.length;

            listEl.innerHTML = data.alerts.map(alert => `
                <div class="flex items-center justify-between bg-gray-800/50 rounded p-2 mt-2">
                    <div>
                        <span class="inline-block px-2 py-0.5 rounded text-xs ${alert.severity === 'critical' ? 'bg-red-600' : 'bg-yellow-600'}">${alert.severity?.toUpperCase()}</span>
                        <span class="ml-2 text-white">${escapeHtml(alert.message)}</span>
                        <span class="text-gray-400 text-sm ml-2">${formatTimeAgo(alert.created_at)}</span>
                    </div>
                    <button onclick="acknowledgeAlert(${alert.id})" class="text-blue-400 hover:text-blue-300 text-sm">Acknowledge</button>
                </div>
            `).join('');
        } else {
            banner.classList.add('hidden');
            listEl.innerHTML = '';
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load alerts', error);
    }
}

/**
 * Acknowledge a single alert
 */
async function acknowledgeAlert(alertId) {
    try {
        const response = await csrfFetch(`/api/admin/alerts/${alertId}/acknowledge`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.success) {
            showAlert('Alert acknowledged', 'success');
            loadActiveAlerts();
            loadAlertHistory();
        } else {
            showAlert(data.error || 'Failed to acknowledge alert', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to acknowledge alert', error);
        showAlert('Failed to acknowledge alert', 'error');
    }
}

/**
 * Acknowledge all active alerts
 */
async function acknowledgeAllAlerts() {
    if (!confirm('Acknowledge all active alerts?')) return;

    try {
        const response = await csrfFetch('/api/admin/alerts/acknowledge-all', {
            method: 'POST'
        });
        const data = await response.json();

        if (data.success) {
            showAlert(`${data.acknowledged || 0} alerts acknowledged`, 'success');
            loadActiveAlerts();
            loadAlertHistory();
        } else {
            showAlert(data.error || 'Failed to acknowledge alerts', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to acknowledge alerts', error);
        showAlert('Failed to acknowledge alerts', 'error');
    }
}

/**
 * Load current metrics snapshot
 */
async function loadCurrentMetrics() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading current metrics');
        const response = await csrfFetch('/api/admin/metrics/current');
        const data = await response.json();

        if (data.success && data.snapshot) {
            const snapshot = data.snapshot;

            // Update system metrics
            updateMetricCard('cpuValue', 'cpuProgress', snapshot.system?.cpu_usage_system || 0, '%');
            updateMetricCard('memoryValue', 'memoryProgress', snapshot.system?.memory_usage_system || 0, '%');
            updateMetricCard('diskValue', 'diskProgress', snapshot.system?.disk_usage_root || 0, '%');

            // Update display metrics
            const displaysOnline = snapshot.displays?.display_online || 0;
            const displaysOffline = snapshot.displays?.display_offline || 0;
            const displayTotal = displaysOnline + displaysOffline;
            const displayPct = displayTotal > 0 ? (displaysOnline / displayTotal * 100) : 0;
            updateMetricCard('displaysValue', 'displaysProgress', displayPct, '', `${displaysOnline}/${displayTotal}`);

            // Update API latency metrics
            updateApiCard('matchLatency', 'matchStatus', snapshot.api?.match_display);
            updateApiCard('bracketLatency', 'bracketStatus', snapshot.api?.bracket_display);
            updateApiCard('flyerLatency', 'flyerStatus', snapshot.api?.flyer_display);

            // Update timestamp
            const timestampEl = document.getElementById('metricsTimestamp');
            if (timestampEl) {
                timestampEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
            }
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load current metrics', error);
    }
}

/**
 * Update a metric card with value and progress bar
 */
function updateMetricCard(valueId, progressId, value, suffix, displayValue) {
    const valueEl = document.getElementById(valueId);
    const progressEl = document.getElementById(progressId);

    if (valueEl) {
        valueEl.textContent = displayValue || `${value.toFixed(1)}${suffix}`;
    }
    if (progressEl) {
        progressEl.style.width = `${Math.min(100, value)}%`;
        // Color coding
        if (value >= 90) {
            progressEl.className = 'h-full bg-red-500 rounded-full transition-all';
        } else if (value >= 70) {
            progressEl.className = 'h-full bg-yellow-500 rounded-full transition-all';
        } else {
            progressEl.className = 'h-full bg-blue-500 rounded-full transition-all';
        }
    }
}

/**
 * Update API latency card
 */
function updateApiCard(latencyId, statusId, apiData) {
    const latencyEl = document.getElementById(latencyId);
    const statusEl = document.getElementById(statusId);

    if (latencyEl) {
        if (apiData?.latencyMs !== undefined) {
            latencyEl.textContent = `${apiData.latencyMs}ms`;
        } else {
            latencyEl.textContent = 'N/A';
        }
    }
    if (statusEl) {
        if (apiData?.online) {
            statusEl.textContent = 'Online';
            statusEl.className = 'text-xs text-green-400';
        } else {
            statusEl.textContent = 'Offline';
            statusEl.className = 'text-xs text-red-400';
        }
    }
}

/**
 * Refresh metrics now (manual refresh button)
 */
function refreshMetricsNow() {
    loadCurrentMetrics();
    loadActiveAlerts();
}

/**
 * Toggle auto-refresh for metrics
 */
function toggleMetricsAutoRefresh() {
    const toggle = document.getElementById('metricsAutoRefresh');

    if (toggle?.checked) {
        // Start auto-refresh every 10 seconds
        if (!metricsAutoRefreshInterval) {
            metricsAutoRefreshInterval = setInterval(() => {
                loadCurrentMetrics();
                loadActiveAlerts();
            }, 10000);
        }
    } else {
        // Stop auto-refresh
        if (metricsAutoRefreshInterval) {
            clearInterval(metricsAutoRefreshInterval);
            metricsAutoRefreshInterval = null;
        }
    }
}

/**
 * Toggle metrics collection service
 */
async function toggleMetricsCollection() {
    const toggle = document.getElementById('metricsCollectionToggle');
    const statusEl = document.getElementById('collectionStatus');

    try {
        const action = toggle?.checked ? 'start' : 'stop';
        const response = await csrfFetch(`/api/admin/metrics/collection/${action}`, {
            method: 'POST'
        });
        const data = await response.json();

        if (data.success) {
            metricsCollectionEnabled = toggle?.checked;
            if (statusEl) {
                statusEl.textContent = toggle?.checked ? 'Running' : 'Stopped';
                statusEl.className = toggle?.checked ? 'text-green-400' : 'text-gray-400';
            }
            showAlert(`Metrics collection ${action}ed`, 'success');
        } else {
            // Revert toggle
            if (toggle) toggle.checked = !toggle.checked;
            showAlert(data.error || `Failed to ${action} collection`, 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to toggle metrics collection', error);
        if (toggle) toggle.checked = !toggle.checked;
        showAlert('Failed to toggle metrics collection', 'error');
    }
}

/**
 * Load metrics collection status
 */
async function loadMetricsCollectionStatus() {
    try {
        const response = await csrfFetch('/api/admin/metrics/collection/status');
        const data = await response.json();

        if (data.success) {
            const toggle = document.getElementById('metricsCollectionToggle');
            const statusEl = document.getElementById('collectionStatus');

            if (toggle) toggle.checked = data.isRunning;
            if (statusEl) {
                statusEl.textContent = data.isRunning ? 'Running' : 'Stopped';
                statusEl.className = data.isRunning ? 'text-green-400' : 'text-gray-400';
            }
            metricsCollectionEnabled = data.isRunning;
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load metrics collection status', error);
    }
}

/**
 * Load metrics history for charts
 */
async function loadMetricsHistory(hours = 24) {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading metrics history');
        const response = await csrfFetch(`/api/admin/metrics/history?hours=${hours}`);
        const data = await response.json();

        const contentEl = document.getElementById('historyContent');
        if (!contentEl) return;

        if (data.success && data.metrics) {
            // Render simple text-based history (can be enhanced with charts later)
            let html = '<div class="space-y-4">';

            for (const [metricType, records] of Object.entries(data.metrics)) {
                if (records.length === 0) continue;

                const latest = records[records.length - 1];
                const avg = records.reduce((sum, r) => sum + r.value, 0) / records.length;
                const max = Math.max(...records.map(r => r.value));
                const min = Math.min(...records.map(r => r.value));

                html += `
                    <div class="bg-gray-700/50 rounded-lg p-3">
                        <h4 class="text-white font-medium">${formatMetricType(metricType)}</h4>
                        <div class="grid grid-cols-4 gap-2 mt-2 text-sm">
                            <div><span class="text-gray-400">Latest:</span> <span class="text-white">${latest.value.toFixed(1)}</span></div>
                            <div><span class="text-gray-400">Avg:</span> <span class="text-white">${avg.toFixed(1)}</span></div>
                            <div><span class="text-gray-400">Min:</span> <span class="text-white">${min.toFixed(1)}</span></div>
                            <div><span class="text-gray-400">Max:</span> <span class="text-white">${max.toFixed(1)}</span></div>
                        </div>
                        <div class="text-gray-400 text-xs mt-1">${records.length} samples</div>
                    </div>
                `;
            }

            html += '</div>';
            contentEl.innerHTML = html;
        } else {
            contentEl.innerHTML = '<div class="text-gray-400">No historical data available</div>';
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load metrics history', error);
    }
}

/**
 * Format metric type for display
 */
function formatMetricType(type) {
    const names = {
        'memory_usage': 'Memory Usage',
        'cpu_usage': 'CPU Usage',
        'disk_usage': 'Disk Usage',
        'api_latency': 'API Latency',
        'api_status': 'API Status',
        'display_online': 'Displays Online',
        'display_offline': 'Displays Offline',
        'database_size': 'Database Size'
    };
    return names[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Open thresholds configuration modal
 */
function openThresholdsModal() {
    const modal = document.getElementById('thresholdsModal');
    if (modal) {
        modal.classList.remove('hidden');
        loadThresholds();
    }
}

/**
 * Close thresholds modal
 */
function closeThresholdsModal() {
    const modal = document.getElementById('thresholdsModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Load alert thresholds
 */
async function loadThresholds() {
    const contentEl = document.getElementById('thresholdsContent');
    if (!contentEl) return;

    contentEl.innerHTML = '<div class="text-gray-400">Loading thresholds...</div>';

    try {
        const response = await csrfFetch('/api/admin/alert-thresholds');
        const data = await response.json();

        if (data.success && data.thresholds) {
            contentEl.innerHTML = data.thresholds.map(t => `
                <div class="bg-gray-700/50 rounded-lg p-3 mb-3" data-metric="${escapeHtml(t.metric_type)}">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-white font-medium">${formatMetricType(t.metric_type)}</span>
                        <label class="flex items-center">
                            <input type="checkbox" class="threshold-enabled mr-2" ${t.enabled ? 'checked' : ''}>
                            <span class="text-gray-400 text-sm">Enabled</span>
                        </label>
                    </div>
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <label class="text-gray-400">Warning Threshold</label>
                            <input type="number" class="threshold-warning mt-1 w-full bg-gray-600 border border-gray-500 rounded px-2 py-1 text-white" value="${t.warning_threshold ?? ''}" placeholder="e.g., 70">
                        </div>
                        <div>
                            <label class="text-gray-400">Critical Threshold</label>
                            <input type="number" class="threshold-critical mt-1 w-full bg-gray-600 border border-gray-500 rounded px-2 py-1 text-white" value="${t.critical_threshold ?? ''}" placeholder="e.g., 90">
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            contentEl.innerHTML = '<div class="text-gray-400">No thresholds configured</div>';
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load thresholds', error);
        contentEl.innerHTML = '<div class="text-red-400">Failed to load thresholds</div>';
    }
}

/**
 * Save alert thresholds
 */
async function saveThresholds() {
    const contentEl = document.getElementById('thresholdsContent');
    if (!contentEl) return;

    const thresholdDivs = contentEl.querySelectorAll('[data-metric]');
    const updates = [];

    thresholdDivs.forEach(div => {
        const metricType = div.dataset.metric;
        const enabled = div.querySelector('.threshold-enabled')?.checked;
        const warning = div.querySelector('.threshold-warning')?.value;
        const critical = div.querySelector('.threshold-critical')?.value;

        updates.push({
            metricType,
            enabled,
            warningThreshold: warning ? parseFloat(warning) : null,
            criticalThreshold: critical ? parseFloat(critical) : null
        });
    });

    try {
        const response = await csrfFetch('/api/admin/alert-thresholds', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thresholds: updates })
        });
        const data = await response.json();

        if (data.success) {
            showAlert('Thresholds saved', 'success');
            closeThresholdsModal();
        } else {
            showAlert(data.error || 'Failed to save thresholds', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to save thresholds', error);
        showAlert('Failed to save thresholds', 'error');
    }
}

/**
 * Load alert history
 */
async function loadAlertHistory() {
    const contentEl = document.getElementById('alertHistoryContent');
    if (!contentEl) return;

    try {
        FrontendDebug.api('PlatformAdmin', 'Loading alert history');
        const response = await csrfFetch('/api/admin/alerts/history?limit=50');
        const data = await response.json();

        if (data.success && data.alerts?.length > 0) {
            contentEl.innerHTML = `
                <table class="w-full">
                    <thead>
                        <tr class="text-left text-gray-400 text-sm">
                            <th class="pb-2">Time</th>
                            <th class="pb-2">Severity</th>
                            <th class="pb-2">Message</th>
                            <th class="pb-2">Status</th>
                        </tr>
                    </thead>
                    <tbody class="text-sm">
                        ${data.alerts.map(a => `
                            <tr class="border-t border-gray-700">
                                <td class="py-2 text-gray-400">${formatTimeAgo(a.created_at)}</td>
                                <td class="py-2">
                                    <span class="px-2 py-0.5 rounded text-xs ${a.severity === 'critical' ? 'bg-red-600' : 'bg-yellow-600'}">${a.severity}</span>
                                </td>
                                <td class="py-2 text-white">${escapeHtml(a.message)}</td>
                                <td class="py-2 ${a.acknowledged ? 'text-green-400' : 'text-gray-400'}">${a.acknowledged ? 'Acknowledged' : 'Active'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            contentEl.innerHTML = '<div class="text-gray-400">No alert history</div>';
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load alert history', error);
    }
}

/**
 * Cleanup old metrics data
 */
async function cleanupOldMetrics() {
    if (!confirm('This will delete metrics older than 7 days. Continue?')) return;

    try {
        const response = await csrfFetch('/api/admin/metrics/cleanup', {
            method: 'POST'
        });
        const data = await response.json();

        if (data.success) {
            showAlert(`Cleaned up ${data.deletedCount || 0} old metric records`, 'success');
            loadMetricsHistory();
        } else {
            showAlert(data.error || 'Failed to cleanup metrics', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to cleanup metrics', error);
        showAlert('Failed to cleanup metrics', 'error');
    }
}

/**
 * Initialize Phase 2 monitoring features
 */
function initPhase2Monitoring() {
    // Load metrics collection status
    loadMetricsCollectionStatus();

    // Load active alerts
    loadActiveAlerts();

    // Load current metrics
    loadCurrentMetrics();

    // Setup auto-refresh toggle listener
    const autoRefreshToggle = document.getElementById('metricsAutoRefresh');
    if (autoRefreshToggle) {
        autoRefreshToggle.addEventListener('change', toggleMetricsAutoRefresh);
        // Enable auto-refresh by default
        autoRefreshToggle.checked = true;
        toggleMetricsAutoRefresh();
    }

    // Setup metrics collection toggle listener
    const collectionToggle = document.getElementById('metricsCollectionToggle');
    if (collectionToggle) {
        collectionToggle.addEventListener('change', toggleMetricsCollection);
    }
}

// ============================================
// PHASE 2: DISPLAY FLEET MANAGEMENT
// ============================================

let fleetDisplaysData = [];
let fleetFilteredData = [];

/**
 * Load fleet displays (all tenants)
 */
async function loadFleetDisplays() {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading fleet displays');
        const response = await csrfFetch('/api/admin/displays');
        const data = await response.json();

        if (data.success) {
            fleetDisplaysData = data.displays || [];
            fleetFilteredData = [...fleetDisplaysData];
            renderFleetDisplays();
            updateFleetStats();
            populateUserFilter();
        } else {
            showAlert(data.error || 'Failed to load displays', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load fleet displays', error);
        showAlert('Failed to load displays', 'error');
    }
}

/**
 * Refresh fleet displays
 */
function refreshFleetDisplays() {
    loadFleetDisplays();
    loadCommandHistory();
}

/**
 * Update fleet statistics
 */
function updateFleetStats() {
    const total = fleetDisplaysData.length;
    const online = fleetDisplaysData.filter(d => d.status === 'online').length;
    const offline = total - online;
    const types = new Set(fleetDisplaysData.map(d => d.currentView || d.assignedView)).size;

    document.getElementById('fleetTotalDisplays').textContent = total;
    document.getElementById('fleetOnlineDisplays').textContent = online;
    document.getElementById('fleetOfflineDisplays').textContent = offline;
    document.getElementById('fleetDisplayTypes').textContent = types;
}

/**
 * Populate user filter dropdown
 */
function populateUserFilter() {
    const select = document.getElementById('fleetFilterUser');
    if (!select) return;

    // Get unique user IDs
    const userIds = [...new Set(fleetDisplaysData.map(d => d.userId).filter(Boolean))];

    // Keep the first "All Users" option and add user options
    select.innerHTML = '<option value="">All Users</option>' +
        userIds.map(id => `<option value="${id}">User ${id}</option>`).join('');
}

/**
 * Filter fleet displays based on dropdowns
 */
function filterFleetDisplays() {
    const userId = document.getElementById('fleetFilterUser')?.value;
    const status = document.getElementById('fleetFilterStatus')?.value;
    const type = document.getElementById('fleetFilterType')?.value;

    fleetFilteredData = fleetDisplaysData.filter(d => {
        if (userId && String(d.userId) !== userId) return false;
        if (status && d.status !== status) return false;
        if (type) {
            const displayType = d.currentView || d.assignedView || '';
            if (displayType !== type) return false;
        }
        return true;
    });

    renderFleetDisplays();
}

/**
 * Render fleet displays grid
 */
function renderFleetDisplays() {
    const grid = document.getElementById('fleetDisplaysGrid');
    if (!grid) return;

    if (fleetFilteredData.length === 0) {
        grid.innerHTML = '<div class="text-gray-400 col-span-full text-center py-8">No displays found</div>';
        return;
    }

    grid.innerHTML = fleetFilteredData.map(d => {
        const isOnline = d.status === 'online';
        const statusColor = isOnline ? 'bg-green-500' : 'bg-red-500';
        const displayType = d.currentView || d.assignedView || 'unknown';
        const lastSeen = d.lastHeartbeat ? formatTimeAgo(d.lastHeartbeat) : 'Never';

        return `
            <div class="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <span class="w-3 h-3 rounded-full ${statusColor}"></span>
                        <span class="font-medium text-white">${escapeHtml(d.hostname || d.id)}</span>
                    </div>
                    <span class="text-xs px-2 py-1 rounded ${getTypeColor(displayType)}">${displayType}</span>
                </div>
                <div class="space-y-1 text-sm text-gray-400">
                    <div>User: <span class="text-white">${d.userId || 'N/A'}</span></div>
                    <div>IP: <span class="text-white">${escapeHtml(d.ip || 'N/A')}</span></div>
                    <div>Last Seen: <span class="text-white">${lastSeen}</span></div>
                    ${d.systemInfo ? `
                        <div>CPU: <span class="${getTempColor(d.systemInfo.cpuTemp)}">${d.systemInfo.cpuTemp || 'N/A'}°C</span></div>
                        <div>Memory: <span class="text-white">${d.systemInfo.memoryUsage || 'N/A'}%</span></div>
                    ` : ''}
                </div>
                <div class="flex gap-2 mt-3">
                    <button onclick="sendDisplayCommand('${d.id}', 'reboot')" class="text-xs bg-yellow-600 hover:bg-yellow-700 text-white px-2 py-1 rounded">
                        Reboot
                    </button>
                    <button onclick="sendDisplayCommand('${d.id}', 'refresh')" class="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded">
                        Refresh
                    </button>
                    <button onclick="toggleDisplayDebug('${d.id}', ${!d.debugMode})" class="text-xs ${d.debugMode ? 'bg-purple-600' : 'bg-gray-600'} hover:opacity-80 text-white px-2 py-1 rounded">
                        Debug ${d.debugMode ? 'On' : 'Off'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Get display type badge color
 */
function getTypeColor(type) {
    switch (type) {
        case 'match': return 'bg-red-600';
        case 'bracket': return 'bg-blue-600';
        case 'flyer': return 'bg-purple-600';
        default: return 'bg-gray-600';
    }
}

/**
 * Get temperature color
 */
function getTempColor(temp) {
    if (!temp) return 'text-white';
    if (temp >= 70) return 'text-red-400';
    if (temp >= 60) return 'text-yellow-400';
    return 'text-green-400';
}

/**
 * Send command to a single display
 */
async function sendDisplayCommand(displayId, command) {
    try {
        const response = await csrfFetch(`/api/admin/displays/${displayId}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
        const data = await response.json();

        if (data.success) {
            showAlert(`${command} command sent to display`, 'success');
            loadCommandHistory();
        } else {
            showAlert(data.error || 'Failed to send command', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to send display command', error);
        showAlert('Failed to send command', 'error');
    }
}

/**
 * Toggle display debug mode
 */
async function toggleDisplayDebug(displayId, enabled) {
    try {
        const response = await csrfFetch(`/api/admin/displays/${displayId}/debug`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const data = await response.json();

        if (data.success) {
            showAlert(`Debug mode ${enabled ? 'enabled' : 'disabled'}`, 'success');
            loadFleetDisplays();
        } else {
            showAlert(data.error || 'Failed to toggle debug', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to toggle debug mode', error);
        showAlert('Failed to toggle debug mode', 'error');
    }
}

/**
 * Reboot all displays
 */
async function rebootAllDisplays() {
    if (!confirm('Reboot ALL displays? This will affect all tenants.')) return;

    try {
        const response = await csrfFetch('/api/admin/displays/reboot-all', {
            method: 'POST'
        });
        const data = await response.json();

        if (data.success) {
            showAlert(`Reboot queued for ${data.count || 0} displays`, 'success');
            loadCommandHistory();
        } else {
            showAlert(data.error || 'Failed to reboot displays', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to reboot all displays', error);
        showAlert('Failed to reboot displays', 'error');
    }
}

/**
 * Open broadcast modal
 */
function openBroadcastModal() {
    const modal = document.getElementById('broadcastModal');
    if (modal) {
        modal.classList.remove('hidden');
        document.getElementById('broadcastMessage').value = '';
        document.getElementById('broadcastCharCount').textContent = '0';

        // Setup character counter
        const textarea = document.getElementById('broadcastMessage');
        textarea.addEventListener('input', () => {
            document.getElementById('broadcastCharCount').textContent = textarea.value.length;
        });
    }
}

/**
 * Close broadcast modal
 */
function closeBroadcastModal() {
    const modal = document.getElementById('broadcastModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

/**
 * Send broadcast message to all displays
 */
async function sendBroadcastMessage() {
    const message = document.getElementById('broadcastMessage')?.value?.trim();
    const duration = parseInt(document.getElementById('broadcastDuration')?.value) || 10;
    const toMatch = document.getElementById('broadcastToMatch')?.checked;
    const toBracket = document.getElementById('broadcastToBracket')?.checked;

    if (!message) {
        showAlert('Please enter a message', 'error');
        return;
    }

    try {
        const response = await csrfFetch('/api/admin/displays/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, duration, targets: { match: toMatch, bracket: toBracket } })
        });
        const data = await response.json();

        if (data.success) {
            showAlert('Broadcast sent successfully', 'success');
            closeBroadcastModal();
            loadCommandHistory();
        } else {
            showAlert(data.error || 'Failed to send broadcast', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to send broadcast', error);
        showAlert('Failed to send broadcast', 'error');
    }
}

/**
 * Load command history
 */
async function loadCommandHistory() {
    try {
        const response = await csrfFetch('/api/admin/displays/commands?limit=20');
        const data = await response.json();

        const listEl = document.getElementById('commandHistoryList');
        if (!listEl) return;

        if (data.success && data.commands?.length > 0) {
            listEl.innerHTML = data.commands.map(cmd => `
                <div class="flex items-center justify-between py-2 border-b border-gray-600 last:border-0">
                    <div>
                        <span class="text-white">${escapeHtml(cmd.command)}</span>
                        <span class="text-gray-400 text-sm ml-2">→ ${escapeHtml(cmd.display_id)}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-xs px-2 py-0.5 rounded ${cmd.status === 'executed' ? 'bg-green-600' : cmd.status === 'pending' ? 'bg-yellow-600' : 'bg-red-600'}">${cmd.status}</span>
                        <div class="text-xs text-gray-400">${formatTimeAgo(cmd.issued_at)}</div>
                    </div>
                </div>
            `).join('');
        } else {
            listEl.innerHTML = '<div class="text-gray-400">No recent commands</div>';
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load command history', error);
    }
}

/**
 * Initialize Displays tab
 */
function initDisplaysTab() {
    loadFleetDisplays();
    loadCommandHistory();
}

// ============================================
// STATISTICS TAB
// ============================================

let platformStatsData = null;

/**
 * Load platform statistics
 */
async function loadPlatformStats() {
    const contentEl = document.getElementById('statisticsContent');
    if (!contentEl) return;

    // Show loading state
    contentEl.innerHTML = `
        <div class="flex justify-center items-center py-20">
            <div class="text-gray-400">Loading platform statistics...</div>
        </div>
    `;

    try {
        FrontendDebug.api('PlatformAdmin', 'Loading platform statistics');
        const response = await csrfFetch('/api/admin/platform-stats');
        const data = await response.json();

        if (data.success) {
            platformStatsData = data.stats;
            renderPlatformStats(data.stats);
        } else {
            contentEl.innerHTML = `<div class="text-red-400 p-4">Failed to load statistics: ${data.error || 'Unknown error'}</div>`;
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load platform statistics', error);
        contentEl.innerHTML = `<div class="text-red-400 p-4">Failed to load statistics</div>`;
    }
}

/**
 * Render platform statistics
 */
function renderPlatformStats(stats) {
    const contentEl = document.getElementById('statisticsContent');
    if (!contentEl) return;

    const { users, tournaments, matches, players, games, displays, topPlayers } = stats;

    contentEl.innerHTML = `
        <!-- Main Stats Cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div class="text-3xl font-bold text-white">${users.total}</div>
                <div class="text-gray-400 text-sm">Total Users</div>
                <div class="text-xs text-green-400 mt-1">+${users.newThisMonth} this month</div>
            </div>
            <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div class="text-3xl font-bold text-white">${tournaments.total}</div>
                <div class="text-gray-400 text-sm">Total Tournaments</div>
                <div class="text-xs text-blue-400 mt-1">${tournaments.completed} completed</div>
            </div>
            <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div class="text-3xl font-bold text-white">${matches.total}</div>
                <div class="text-gray-400 text-sm">Total Matches</div>
                <div class="text-xs text-purple-400 mt-1">${matches.completionRate}% completion</div>
            </div>
            <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <div class="text-3xl font-bold text-white">${players.total}</div>
                <div class="text-gray-400 text-sm">Total Players</div>
                <div class="text-xs text-yellow-400 mt-1">${players.activeLastMonth} active last month</div>
            </div>
        </div>

        <!-- Secondary Stats Row -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-gray-700/50 rounded-lg p-4">
                <div class="text-2xl font-bold text-green-400">${users.active}</div>
                <div class="text-gray-400 text-sm">Active Users</div>
            </div>
            <div class="bg-gray-700/50 rounded-lg p-4">
                <div class="text-2xl font-bold text-yellow-400">${users.trial}</div>
                <div class="text-gray-400 text-sm">Trial Users</div>
            </div>
            <div class="bg-gray-700/50 rounded-lg p-4">
                <div class="text-2xl font-bold text-blue-400">${displays.online}/${displays.total}</div>
                <div class="text-gray-400 text-sm">Displays Online</div>
            </div>
            <div class="bg-gray-700/50 rounded-lg p-4">
                <div class="text-2xl font-bold text-purple-400">${games.total}</div>
                <div class="text-gray-400 text-sm">Games Configured</div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Tournament Stats -->
            <div class="bg-gray-700/50 rounded-lg p-4">
                <h3 class="text-lg font-semibold text-white mb-4">Tournament Overview</h3>
                <div class="space-y-3">
                    <div class="flex justify-between items-center">
                        <span class="text-gray-400">Completion Rate</span>
                        <div class="flex items-center gap-2">
                            <div class="w-32 bg-gray-700 rounded-full h-2">
                                <div class="bg-green-500 h-2 rounded-full" style="width: ${tournaments.completionRate}%"></div>
                            </div>
                            <span class="text-white">${tournaments.completionRate}%</span>
                        </div>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Average Participants</span>
                        <span class="text-white">${tournaments.averageParticipants}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Pending</span>
                        <span class="text-gray-300">${tournaments.pending}</span>
                    </div>
                </div>

                <h4 class="text-sm font-medium text-gray-300 mt-6 mb-3">By Format</h4>
                <div class="space-y-2">
                    ${renderFormatBar('Single Elim', tournaments.byFormat.single_elimination, tournaments.total)}
                    ${renderFormatBar('Double Elim', tournaments.byFormat.double_elimination, tournaments.total)}
                    ${renderFormatBar('Round Robin', tournaments.byFormat.round_robin, tournaments.total)}
                    ${renderFormatBar('Swiss', tournaments.byFormat.swiss, tournaments.total)}
                </div>
            </div>

            <!-- Top Players -->
            <div class="bg-gray-700/50 rounded-lg p-4">
                <h3 class="text-lg font-semibold text-white mb-4">Top Players by Elo</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="border-b border-gray-600">
                                <th class="text-left py-2 text-gray-400">#</th>
                                <th class="text-left py-2 text-gray-400">Player</th>
                                <th class="text-left py-2 text-gray-400">Game</th>
                                <th class="text-right py-2 text-gray-400">Elo</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${topPlayers && topPlayers.length > 0 ? topPlayers.map((p, i) => `
                                <tr class="border-b border-gray-700">
                                    <td class="py-2 text-gray-400">${i + 1}</td>
                                    <td class="py-2 font-medium text-white">${escapeHtml(p.name || p.display_name || 'Unknown')}</td>
                                    <td class="py-2 text-gray-400">${escapeHtml(p.gameName || p.game_name || 'Unknown')}</td>
                                    <td class="py-2 text-right text-yellow-400 font-mono">${p.elo || p.elo_rating || 0}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="4" class="text-center py-4 text-gray-400">No player data available</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <!-- Popular Games -->
            <div class="bg-gray-700/50 rounded-lg p-4">
                <h3 class="text-lg font-semibold text-white mb-4">Most Popular Games</h3>
                <div class="space-y-2">
                    ${games.mostPopular.length > 0 ? games.mostPopular.map(g => `
                        <div class="flex justify-between items-center py-2 border-b border-gray-600">
                            <span class="text-white">${escapeHtml(g.name)}</span>
                            <span class="text-gray-400">${g.tournamentCount} tournaments</span>
                        </div>
                    `).join('') : '<div class="text-gray-400">No games configured yet</div>'}
                </div>
            </div>

            <!-- User Metrics -->
            <div class="bg-gray-700/50 rounded-lg p-4">
                <h3 class="text-lg font-semibold text-white mb-4">User Metrics</h3>
                <div class="space-y-3">
                    <div class="flex justify-between">
                        <span class="text-gray-400">New This Week</span>
                        <span class="text-green-400">+${users.newThisWeek}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">New This Month</span>
                        <span class="text-green-400">+${users.newThisMonth}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Expired Subscriptions</span>
                        <span class="text-red-400">${users.expired}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-400">Display Distribution</span>
                        <span class="text-gray-300">Match: ${displays.byType?.match || 0} | Bracket: ${displays.byType?.bracket || 0} | Flyer: ${displays.byType?.flyer || 0}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Helper to render format bar
 */
function renderFormatBar(label, count, total) {
    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
        <div class="flex items-center gap-3">
            <span class="text-gray-400 w-28 text-sm">${label}</span>
            <div class="flex-1 bg-gray-700 rounded-full h-2">
                <div class="bg-blue-500 h-2 rounded-full" style="width: ${percentage}%"></div>
            </div>
            <span class="text-white text-sm w-12 text-right">${count}</span>
        </div>
    `;
}

// ============================================
// LIVE FEED TAB
// ============================================

let liveFeedData = [];
let liveFeedFilter = 'all';

/**
 * Load live activity feed
 */
async function loadLiveFeed() {
    const feedContainer = document.getElementById('liveFeedList');
    if (!feedContainer) return;

    try {
        FrontendDebug.api('PlatformAdmin', 'Loading live feed');
        const response = await csrfFetch('/api/admin/live-feed');
        const data = await response.json();

        if (data.success) {
            liveFeedData = data.feed;
            renderLiveFeed();
        } else {
            feedContainer.innerHTML = `<div class="text-red-400 p-4">Failed to load feed: ${data.error}</div>`;
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load live feed', error);
        feedContainer.innerHTML = `<div class="text-red-400 p-4">Failed to load activity feed</div>`;
    }
}

/**
 * Filter live feed by event type
 */
function filterLiveFeed(eventType) {
    liveFeedFilter = eventType;

    // Update filter button styles
    document.querySelectorAll('#liveFeedFilter option').forEach(opt => {
        opt.selected = opt.value === eventType;
    });

    renderLiveFeed();
}

/**
 * Render the live feed
 */
function renderLiveFeed() {
    const feedContainer = document.getElementById('liveFeedList');
    if (!feedContainer) return;

    // Apply filter
    let filteredFeed = liveFeedData;
    if (liveFeedFilter !== 'all') {
        filteredFeed = liveFeedData.filter(item => item.type.startsWith(liveFeedFilter));
    }

    if (filteredFeed.length === 0) {
        feedContainer.innerHTML = `<div class="text-gray-400 text-center py-8">No activity to display</div>`;
        return;
    }

    feedContainer.innerHTML = filteredFeed.map(item => `
        <div class="flex items-start gap-3 py-3 border-b border-gray-700 hover:bg-gray-800 px-2 rounded">
            <div class="w-8 h-8 rounded-full flex items-center justify-center ${getActivityIconClass(item.type)}">
                ${getActivityIcon(item.type)}
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-white text-sm">${formatActivityMessage(item)}</div>
                <div class="text-gray-500 text-xs mt-1">
                    ${item.user ? `<span class="text-gray-400">${escapeHtml(item.user)}</span> · ` : ''}
                    ${formatTimeAgo(item.timestamp)}
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Get icon class for activity type
 */
function getActivityIconClass(type) {
    if (type.startsWith('tournament')) return 'bg-blue-900 text-blue-400';
    if (type.startsWith('match')) return 'bg-green-900 text-green-400';
    if (type.startsWith('user')) return 'bg-purple-900 text-purple-400';
    if (type.startsWith('participant')) return 'bg-yellow-900 text-yellow-400';
    if (type.startsWith('display')) return 'bg-cyan-900 text-cyan-400';
    return 'bg-gray-700 text-gray-400';
}

/**
 * Get icon SVG for activity type
 */
function getActivityIcon(type) {
    if (type.startsWith('tournament')) {
        return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
    }
    if (type.startsWith('match')) {
        return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>';
    }
    if (type.startsWith('user')) {
        return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>';
    }
    if (type.startsWith('participant')) {
        return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
    }
    if (type.startsWith('display')) {
        return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>';
    }
    return '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
}

/**
 * Format activity message
 */
function formatActivityMessage(item) {
    switch (item.type) {
        case 'tournament_created':
            return `Tournament <strong>${escapeHtml(item.tournament || 'Unknown')}</strong> was created`;
        case 'tournament_started':
            return `Tournament <strong>${escapeHtml(item.tournament || 'Unknown')}</strong> has started`;
        case 'tournament_completed':
            return `Tournament <strong>${escapeHtml(item.tournament || 'Unknown')}</strong> was completed`;
        case 'match_scored':
            return `Match scored in <strong>${escapeHtml(item.tournament || 'Unknown')}</strong>${item.winner ? ` - Winner: ${escapeHtml(item.winner)}` : ''}`;
        case 'user_login':
            return `User logged in${item.ip ? ` from ${item.ip.replace(/\.\d+$/, '.x')}` : ''}`;
        case 'user_created':
            return `New user registered`;
        case 'participant_registered':
            return `<strong>${escapeHtml(item.player || 'A player')}</strong> registered for ${escapeHtml(item.tournament || 'a tournament')}`;
        case 'display_connected':
            return `Display <strong>${escapeHtml(item.displayId || 'Unknown')}</strong> connected (${item.displayType || 'unknown'})`;
        case 'display_disconnected':
            return `Display <strong>${escapeHtml(item.displayId || 'Unknown')}</strong> disconnected`;
        default:
            return item.details || item.type.replace(/_/g, ' ');
    }
}

// ============================================
// QUERY PLAYGROUND TAB
// ============================================

let queryResults = null;

/**
 * Execute SQL query
 */
async function executeQuery() {
    const database = document.getElementById('queryDatabase').value;
    const query = document.getElementById('queryInput').value.trim();
    const resultsDiv = document.getElementById('queryResults');
    const executeBtn = document.getElementById('executeQueryBtn');

    if (!query) {
        showAlert('Please enter a query', 'warning');
        return;
    }

    // Show loading state
    executeBtn.disabled = true;
    executeBtn.textContent = 'Executing...';
    resultsDiv.innerHTML = '<div class="text-gray-400 p-4">Executing query...</div>';

    try {
        FrontendDebug.api('PlatformAdmin', 'Executing query', { database, query: query.substring(0, 50) });

        const response = await csrfFetch('/api/admin/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ database, query })
        });

        const data = await response.json();

        if (data.success) {
            queryResults = data;
            renderQueryResults(data);
        } else {
            resultsDiv.innerHTML = `
                <div class="text-red-400 p-4">
                    <strong>Error:</strong> ${escapeHtml(data.error)}
                </div>
            `;
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Query execution failed', error);
        resultsDiv.innerHTML = `<div class="text-red-400 p-4">Query execution failed</div>`;
    } finally {
        executeBtn.disabled = false;
        executeBtn.textContent = 'Execute';
    }
}

/**
 * Render query results
 */
function renderQueryResults(data) {
    const resultsDiv = document.getElementById('queryResults');

    if (!data.results || data.results.length === 0) {
        resultsDiv.innerHTML = `
            <div class="p-4">
                <div class="text-gray-400 mb-2">Query executed successfully</div>
                <div class="text-gray-500 text-sm">0 rows returned (${data.executionTime}ms)</div>
            </div>
        `;
        return;
    }

    const columns = data.columns || Object.keys(data.results[0]);

    resultsDiv.innerHTML = `
        <div class="p-2 bg-gray-700 flex justify-between items-center text-sm">
            <span class="text-gray-300">${data.rowCount} rows (${data.executionTime}ms)</span>
            <button onclick="exportQueryResults()" class="text-blue-400 hover:text-blue-300">
                Export CSV
            </button>
        </div>
        <div class="overflow-x-auto max-h-96 overflow-y-auto">
            <table class="data-table w-full text-sm">
                <thead class="sticky top-0 bg-gray-800">
                    <tr>
                        ${columns.map(col => `<th class="text-left whitespace-nowrap">${escapeHtml(col)}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${data.results.map(row => `
                        <tr class="hover:bg-gray-700">
                            ${columns.map(col => `
                                <td class="whitespace-nowrap max-w-xs truncate" title="${escapeHtml(String(row[col] ?? ''))}">
                                    ${formatCellValue(row[col])}
                                </td>
                            `).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

/**
 * Format cell value for display
 */
function formatCellValue(value) {
    if (value === null || value === undefined) {
        return '<span class="text-gray-500">NULL</span>';
    }
    if (typeof value === 'object') {
        return `<span class="text-purple-400">${escapeHtml(JSON.stringify(value))}</span>`;
    }
    return escapeHtml(String(value));
}

/**
 * Load preset query into textarea
 */
function loadPresetQuery(presetName) {
    const presets = {
        'top_players': 'SELECT p.display_name, pr.elo_rating, g.name as game\nFROM players p\nJOIN player_ratings pr ON p.id = pr.player_id\nJOIN games g ON pr.game_id = g.id\nORDER BY pr.elo_rating DESC\nLIMIT 10',
        'tournament_stats': 'SELECT \n  state,\n  COUNT(*) as count,\n  AVG(participant_count) as avg_participants\nFROM tournaments\nGROUP BY state',
        'match_duration': 'SELECT \n  t.name as tournament,\n  AVG((julianday(m.completed_at) - julianday(m.underway_at)) * 24 * 60) as avg_minutes\nFROM tcc_matches m\nJOIN tcc_tournaments t ON m.tournament_id = t.id\nWHERE m.state = \'complete\' AND m.underway_at IS NOT NULL\nGROUP BY t.id\nORDER BY avg_minutes DESC\nLIMIT 10',
        'display_health': 'SELECT \n  hostname,\n  status,\n  current_view,\n  datetime(last_heartbeat/1000, \'unixepoch\') as last_seen\nFROM displays\nORDER BY last_heartbeat DESC',
        'recent_activity': 'SELECT \n  action,\n  user_id,\n  details,\n  datetime(created_at) as timestamp\nFROM activity_log\nORDER BY created_at DESC\nLIMIT 50'
    };

    const query = presets[presetName];
    if (query) {
        document.getElementById('queryInput').value = query;

        // Set appropriate database
        if (presetName === 'top_players' || presetName === 'tournament_stats') {
            document.getElementById('queryDatabase').value = 'players';
        } else if (presetName === 'match_duration') {
            document.getElementById('queryDatabase').value = 'tournaments';
        } else if (presetName === 'display_health' || presetName === 'recent_activity') {
            document.getElementById('queryDatabase').value = 'system';
        }
    }
}

/**
 * Export query results to CSV
 */
function exportQueryResults() {
    if (!queryResults || !queryResults.results || queryResults.results.length === 0) {
        showAlert('No results to export', 'warning');
        return;
    }

    const columns = queryResults.columns || Object.keys(queryResults.results[0]);

    // Build CSV
    let csv = columns.join(',') + '\n';
    queryResults.results.forEach(row => {
        csv += columns.map(col => {
            const value = row[col];
            if (value === null || value === undefined) return '';
            if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        }).join(',') + '\n';
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query_results_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showAlert('Results exported to CSV', 'success');
}

/**
 * Load table schemas
 */
async function loadTableSchemas() {
    const modal = document.getElementById('schemaModal');
    const content = document.getElementById('schemaContent');

    if (!modal || !content) return;

    content.innerHTML = '<div class="text-gray-400">Loading schemas...</div>';
    modal.classList.remove('hidden');

    try {
        const response = await csrfFetch('/api/admin/table-schemas');
        const data = await response.json();

        if (data.success) {
            content.innerHTML = Object.entries(data.schemas).map(([db, tables]) => `
                <div class="mb-6">
                    <h3 class="text-lg font-semibold text-white mb-3">${escapeHtml(db)}</h3>
                    <div class="space-y-2">
                        ${tables.map(table => `
                            <div class="bg-gray-700 rounded p-3">
                                <div class="font-mono text-blue-400 mb-2">${escapeHtml(table.name)}</div>
                                <div class="text-xs text-gray-400 space-y-1">
                                    ${table.columns.map(col => `
                                        <div><span class="text-gray-300">${escapeHtml(col.name)}</span> <span class="text-gray-500">${escapeHtml(col.type)}</span></div>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        } else {
            content.innerHTML = `<div class="text-red-400">Failed to load schemas: ${data.error}</div>`;
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load schemas', error);
        content.innerHTML = `<div class="text-red-400">Failed to load schemas</div>`;
    }
}

/**
 * Close schema modal
 */
function closeSchemaModal() {
    const modal = document.getElementById('schemaModal');
    if (modal) modal.classList.add('hidden');
}

// ============================================
// USER PROFILE DEEP DIVE
// ============================================

/**
 * View comprehensive user profile
 */
async function viewUserProfile(userId) {
    try {
        FrontendDebug.api('PlatformAdmin', 'Loading user profile', { userId });

        const response = await csrfFetch(`/api/admin/users/${userId}/profile`);
        const data = await response.json();

        if (data.success) {
            renderUserProfileModal(data.user);
        } else {
            showAlert(data.error || 'Failed to load user profile', 'error');
        }
    } catch (error) {
        FrontendDebug.error('PlatformAdmin', 'Failed to load user profile', error);
        showAlert('Failed to load user profile', 'error');
    }
}

/**
 * Render user profile modal
 */
function renderUserProfileModal(user) {
    const { stats, recentTournaments, storage, activitySummary } = user;

    document.getElementById('userDetailContent').innerHTML = `
        <div class="space-y-6">
            <!-- Header -->
            <div class="flex items-center gap-4 pb-4 border-b border-gray-700">
                <div class="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center text-2xl text-white font-bold">
                    ${(user.username || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                    <h2 class="text-xl font-bold text-white">${escapeHtml(user.username)}</h2>
                    <div class="flex gap-2 mt-1">
                        <span class="badge ${user.is_active ? 'badge-green' : 'badge-red'}">${user.is_active ? 'Active' : 'Disabled'}</span>
                        <span class="badge ${getSubscriptionBadgeClass(user.subscription_status)}">${user.subscription_status || 'none'}</span>
                        ${user.isSuperadmin ? '<span class="badge badge-purple">Super</span>' : ''}
                    </div>
                </div>
            </div>

            <!-- Stats Grid -->
            <div class="grid grid-cols-4 gap-3">
                <div class="bg-gray-700 rounded p-3 text-center">
                    <div class="text-2xl font-bold text-blue-400">${stats.tournamentsCreated}</div>
                    <div class="text-xs text-gray-400">Tournaments</div>
                </div>
                <div class="bg-gray-700 rounded p-3 text-center">
                    <div class="text-2xl font-bold text-green-400">${stats.tournamentsCompleted}</div>
                    <div class="text-xs text-gray-400">Completed</div>
                </div>
                <div class="bg-gray-700 rounded p-3 text-center">
                    <div class="text-2xl font-bold text-purple-400">${stats.totalParticipants}</div>
                    <div class="text-xs text-gray-400">Participants</div>
                </div>
                <div class="bg-gray-700 rounded p-3 text-center">
                    <div class="text-2xl font-bold text-yellow-400">${stats.totalMatches}</div>
                    <div class="text-xs text-gray-400">Matches</div>
                </div>
            </div>

            <!-- Additional Stats -->
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <h4 class="text-sm font-medium text-gray-300 mb-2">Resources</h4>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-400">Games Configured</span>
                            <span class="text-white">${stats.gamesConfigured}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-400">Flyers Uploaded</span>
                            <span class="text-white">${stats.flyersUploaded}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-400">Sponsors</span>
                            <span class="text-white">${stats.sponsorsConfigured}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-400">Displays</span>
                            <span class="text-white">${stats.displaysRegistered}</span>
                        </div>
                    </div>
                </div>
                <div>
                    <h4 class="text-sm font-medium text-gray-300 mb-2">Activity</h4>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-400">Last Week</span>
                            <span class="text-white">${activitySummary.lastWeek} actions</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-400">Last Month</span>
                            <span class="text-white">${activitySummary.lastMonth} actions</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-400">Most Active</span>
                            <span class="text-white">${activitySummary.mostActiveDay || 'N/A'}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Storage -->
            <div>
                <h4 class="text-sm font-medium text-gray-300 mb-2">Storage Usage</h4>
                <div class="bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div class="bg-blue-500 h-full" style="width: ${Math.min(100, (storage.flyersSize / 52428800) * 100)}%"></div>
                </div>
                <div class="text-xs text-gray-400 mt-1">
                    ${formatFileSize(storage.flyersSize)} used (${storage.flyerCount} files)
                </div>
            </div>

            <!-- Recent Tournaments -->
            <div>
                <h4 class="text-sm font-medium text-gray-300 mb-2">Recent Tournaments</h4>
                ${recentTournaments.length > 0 ? `
                    <div class="space-y-2">
                        ${recentTournaments.slice(0, 5).map(t => `
                            <div class="flex justify-between items-center py-2 border-b border-gray-700">
                                <div>
                                    <span class="text-white">${escapeHtml(t.name)}</span>
                                    <span class="badge ${t.state === 'complete' ? 'badge-green' : t.state === 'underway' ? 'badge-yellow' : 'badge-gray'} ml-2">${t.state}</span>
                                </div>
                                <span class="text-gray-400 text-sm">${t.participantCount} players</span>
                            </div>
                        `).join('')}
                    </div>
                ` : '<div class="text-gray-400">No tournaments yet</div>'}
            </div>

            <!-- Quick Actions -->
            <div class="flex gap-2 pt-4 border-t border-gray-700">
                ${!user.isSuperadmin ? `
                    <button onclick="showImpersonateModal(${user.id}, '${escapeHtml(user.username)}')" class="btn btn-yellow text-sm">
                        Impersonate
                    </button>
                    <button onclick="showSubscriptionModal(${user.id})" class="btn btn-purple text-sm">
                        Manage Subscription
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    document.getElementById('userDetailModal').classList.remove('hidden');
}
