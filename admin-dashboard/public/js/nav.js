// Shared Navigation Component for Tournament Control Center
// This file creates a consistent sidebar navigation across all pages

// Theme Icons
const THEME_ICONS = {
	sun: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>
	</svg>`,
	moon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>
	</svg>`
};

const NAV_ITEMS = [
	{
		id: 'dashboard',
		label: 'Dashboard',
		href: '/',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
		</svg>`
	},
	{
		id: 'command-center',
		label: 'Command Center',
		href: '/command-center.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"></path>
		</svg>`
	},
	{
		id: 'tournament',
		label: 'Tournament',
		href: '/tournament.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"></path>
		</svg>`
	},
	{
		id: 'matches',
		label: 'Matches',
		href: '/matches.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
		</svg>`
	},
	{
		id: 'bracket-editor',
		label: 'Bracket Editor',
		href: '/bracket-editor.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5h4v4H4V5zm0 10h4v4H4v-4zm12-10h4v4h-4V5zm0 10h4v4h-4v-4zM8 7h4m0 0v10m0-10h4m-4 10h4"></path>
		</svg>`
	},
	{
		id: 'participants',
		label: 'Participants',
		href: '/participants.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
		</svg>`
	},
	{
		id: 'games',
		label: 'Games',
		href: '/games.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"></path>
		</svg>`
	},
	{
		id: 'displays',
		label: 'Displays',
		href: '/displays.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
		</svg>`
	},
	{
		id: 'flyers',
		label: 'Flyers',
		href: '/flyers.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
		</svg>`
	},
	{
		id: 'sponsors',
		label: 'Sponsors',
		href: '/sponsors.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path>
		</svg>`
	},
	{
		id: 'analytics',
		label: 'Analytics',
		href: '/analytics.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
		</svg>`
	},
	{
		id: 'settings',
		label: 'Settings',
		href: '/settings.html',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
		</svg>`
	},
	{
		id: 'platform-admin',
		label: 'Platform Admin',
		href: '/platform-admin.html',
		requireRole: 'superadmin',
		icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
		</svg>`
	}
];

// Current user data (populated on load)
let navCurrentUser = null;
let navIsSuperadmin = false;

// Session monitoring state
let sessionMonitor = {
	expiresAt: null,
	timeoutMs: null,
	checkInterval: null,
	warningShown: false,
	WARNING_THRESHOLD_MS: 5 * 60 * 1000, // Show warning 5 minutes before expiry
	CHECK_INTERVAL_MS: 30 * 1000 // Check every 30 seconds
};

// Detect current page from URL
function getCurrentPageId() {
	const path = window.location.pathname;
	if (path === '/' || path === '/index.html') return 'dashboard';
	const match = path.match(/\/([\w-]+)\.html/);
	return match ? match[1] : 'dashboard';
}

// Create the sidebar HTML
function createSidebarHTML() {
	const currentPage = getCurrentPageId();

	// Filter nav items based on role requirements (initially hide restricted items)
	const visibleItems = NAV_ITEMS.filter(item => !item.requireRole);

	const navItemsHTML = visibleItems.map(item => {
		const isActive = item.id === currentPage;
		const activeClass = isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white';
		return `
			<a href="${item.href}" class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${activeClass}" data-page="${item.id}">
				${item.icon}
				<span class="nav-label">${item.label}</span>
			</a>
		`;
	}).join('');

	return `
		<aside id="sidebar" class="sidebar bg-gray-800 border-r border-gray-700 flex flex-col">
			<!-- Logo/Brand -->
			<div class="p-4 border-b border-gray-700">
				<a href="/" class="flex items-center gap-3">
					<div class="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
						<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"></path>
						</svg>
					</div>
					<div class="nav-label">
						<div class="font-bold text-white text-sm">Tournament</div>
						<div class="text-xs text-gray-400">Admin Panel</div>
					</div>
				</a>
			</div>

			<!-- Navigation -->
			<nav class="flex-1 p-3 space-y-1 overflow-y-auto">
				${navItemsHTML}
			</nav>

			<!-- User Section -->
			<div class="p-3 border-t border-gray-700">
				<div class="flex items-center gap-3 px-3 py-2 text-gray-400">
					<div class="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
						</svg>
					</div>
					<div class="nav-label flex-1 min-w-0">
						<div id="navUsername" class="text-sm font-medium text-white truncate">Loading...</div>
					</div>
				</div>
				<!-- Theme Toggle Button -->
				<button onclick="toggleTheme()" class="nav-item w-full mt-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-white transition-all" title="Toggle theme">
					<span id="themeToggleIcon">${THEME_ICONS.sun}</span>
					<span class="nav-label">Theme</span>
				</button>
				<button onclick="navLogout()" class="nav-item w-full mt-2 flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-all">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
					</svg>
					<span class="nav-label">Logout</span>
				</button>
			</div>

			<!-- Collapse Toggle -->
			<button id="sidebarToggle" onclick="toggleSidebar()" class="absolute -right-3 top-6 w-6 h-6 bg-gray-700 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 transition-all">
				<svg class="w-4 h-4 toggle-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
				</svg>
			</button>
		</aside>
	`;
}

// Create the top header HTML (for mobile and page title)
function createHeaderHTML(pageTitle) {
	return `
		<header id="topHeader" class="bg-gray-800 border-b border-gray-700 px-6 py-4">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-4">
					<button id="mobileMenuBtn" onclick="toggleMobileMenu()" class="lg:hidden p-2 text-gray-400 hover:text-white">
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
						</svg>
					</button>
					<h1 class="text-2xl font-bold text-white">${pageTitle}</h1>
				</div>
				<div id="headerActions" class="flex items-center gap-3">
					<!-- Page-specific actions can be injected here -->
				</div>
			</div>
		</header>
	`;
}

// Initialize navigation
function initNavigation(pageTitle = 'Dashboard') {
	// Check if we're on the login page
	if (window.location.pathname === '/login.html') {
		return;
	}

	// Create the layout structure
	const body = document.body;
	const originalContent = body.innerHTML;

	body.innerHTML = `
		<div id="appLayout" class="app-layout">
			${createSidebarHTML()}
			<div class="main-wrapper">
				${createHeaderHTML(pageTitle)}
				<main id="mainContent" class="main-content">
					${originalContent}
				</main>
			</div>
		</div>
		<!-- Mobile Overlay -->
		<div id="mobileOverlay" class="mobile-overlay hidden" onclick="toggleMobileMenu()"></div>
	`;

	// Load user info
	loadNavUserInfo();

	// Restore sidebar state from localStorage
	const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
	if (sidebarCollapsed) {
		document.getElementById('appLayout').classList.add('sidebar-collapsed');
	}
}

// Toggle sidebar collapse
function toggleSidebar() {
	const layout = document.getElementById('appLayout');
	layout.classList.toggle('sidebar-collapsed');
	localStorage.setItem('sidebarCollapsed', layout.classList.contains('sidebar-collapsed'));
}

// Toggle mobile menu
function toggleMobileMenu() {
	const layout = document.getElementById('appLayout');
	const overlay = document.getElementById('mobileOverlay');
	layout.classList.toggle('mobile-menu-open');
	overlay.classList.toggle('hidden');
}

// Load user information
async function loadNavUserInfo() {
	try {
		const response = await fetch('/api/auth/status');
		if (response.ok) {
			const data = await response.json();
			navCurrentUser = data.user;
			navIsSuperadmin = data.isSuperadmin || false;
			document.getElementById('navUsername').textContent = data.user.username;

			// Add superadmin-only nav items if user is superadmin
			if (navIsSuperadmin) {
				addSuperadminNavItems();
			}

			// Initialize session monitoring with data from server
			if (data.session) {
				initSessionMonitor(data.session);
			}

			// Initialize announcement monitoring after auth check
			initAnnouncementMonitor();
		} else {
			window.location.href = '/login.html';
		}
	} catch (error) {
		console.error('Failed to load user info:', error);
		window.location.href = '/login.html';
	}
}

// Add superadmin-only nav items to sidebar
function addSuperadminNavItems() {
	const nav = document.querySelector('#sidebar nav');
	if (!nav) return;

	const currentPage = getCurrentPageId();

	// Find items that require superadmin role
	const superadminItems = NAV_ITEMS.filter(item => item.requireRole === 'superadmin');

	superadminItems.forEach(item => {
		// Check if item already exists
		if (nav.querySelector(`[data-page="${item.id}"]`)) return;

		const isActive = item.id === currentPage;
		const activeClass = isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700 hover:text-white';

		const link = document.createElement('a');
		link.href = item.href;
		link.className = `nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${activeClass}`;
		link.dataset.page = item.id;
		link.innerHTML = `
			${item.icon}
			<span class="nav-label">${item.label}</span>
		`;

		nav.appendChild(link);
	});
}

// Logout function
async function navLogout() {
	// Clear session monitor interval to prevent memory leaks
	if (sessionMonitor.checkInterval) {
		clearInterval(sessionMonitor.checkInterval);
		sessionMonitor.checkInterval = null;
	}
	try {
		await fetch('/api/auth/logout', { method: 'POST' });
	} catch (error) {
		console.error('Logout error:', error);
	}
	window.location.href = '/login.html';
}

// Helper to set header actions (for page-specific buttons)
function setHeaderActions(html) {
	const container = document.getElementById('headerActions');
	if (container) {
		container.innerHTML = html;
	}
}

// ============================================
// Session Monitoring
// ============================================

/**
 * Initialize session monitoring with server data
 * @param {Object} sessionData - Session data from /api/auth/status
 */
function initSessionMonitor(sessionData) {
	sessionMonitor.timeoutMs = sessionData.timeoutMs;
	sessionMonitor.expiresAt = sessionData.expiresAt;
	sessionMonitor.warningShown = false;

	// Clear any existing interval
	if (sessionMonitor.checkInterval) {
		clearInterval(sessionMonitor.checkInterval);
	}

	// Start periodic session checking
	sessionMonitor.checkInterval = setInterval(checkSessionStatus, sessionMonitor.CHECK_INTERVAL_MS);

	// Also check immediately
	checkSessionStatus();
}

/**
 * Check session status and handle expiry/warning
 */
async function checkSessionStatus() {
	const now = Date.now();
	const timeRemaining = sessionMonitor.expiresAt - now;

	// Session expired - redirect to login
	if (timeRemaining <= 0) {
		handleSessionExpired();
		return;
	}

	// Show warning if within threshold
	if (timeRemaining <= sessionMonitor.WARNING_THRESHOLD_MS && !sessionMonitor.warningShown) {
		showSessionWarning(timeRemaining);
	}

	// Update warning countdown if visible
	if (sessionMonitor.warningShown) {
		updateSessionWarningCountdown(timeRemaining);
	}

	// Verify session is still valid server-side (every 60 seconds)
	// This catches cases where session was invalidated server-side
	if (!sessionMonitor.lastServerCheck || (now - sessionMonitor.lastServerCheck) >= 60000) {
		sessionMonitor.lastServerCheck = now;
		try {
			const response = await fetch('/api/auth/status');
			if (!response.ok) {
				handleSessionExpired();
				return;
			}
			// Update expiry time from server (rolling session)
			const data = await response.json();
			if (data.session) {
				sessionMonitor.expiresAt = data.session.expiresAt;
				// Hide warning if session was extended
				const newTimeRemaining = data.session.expiresAt - Date.now();
				if (newTimeRemaining > sessionMonitor.WARNING_THRESHOLD_MS && sessionMonitor.warningShown) {
					hideSessionWarning();
				}
			}
		} catch (error) {
			console.error('Session check failed:', error);
		}
	}
}

/**
 * Show session expiry warning banner
 * @param {number} timeRemaining - Time remaining in milliseconds
 */
function showSessionWarning(timeRemaining) {
	sessionMonitor.warningShown = true;

	// Create warning banner if it doesn't exist
	let banner = document.getElementById('sessionWarningBanner');
	if (!banner) {
		banner = document.createElement('div');
		banner.id = 'sessionWarningBanner';
		banner.className = 'fixed top-0 left-0 right-0 z-[9999] bg-yellow-600 text-white px-4 py-3 flex items-center justify-center gap-4 shadow-lg';
		banner.innerHTML = `
			<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
			</svg>
			<span>Your session will expire in <strong id="sessionCountdown"></strong>. <a href="#" onclick="extendSession(); return false;" class="underline font-semibold hover:text-yellow-200">Click here to stay logged in</a></span>
			<button onclick="hideSessionWarning()" class="ml-2 p-1 hover:bg-yellow-700 rounded" title="Dismiss">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
				</svg>
			</button>
		`;
		document.body.appendChild(banner);

		// Add padding to body to prevent content from being hidden behind banner
		document.body.style.paddingTop = '52px';
	}

	updateSessionWarningCountdown(timeRemaining);
}

/**
 * Update the countdown text in the warning banner
 * @param {number} timeRemaining - Time remaining in milliseconds
 */
function updateSessionWarningCountdown(timeRemaining) {
	const countdown = document.getElementById('sessionCountdown');
	if (countdown) {
		const minutes = Math.floor(timeRemaining / 60000);
		const seconds = Math.floor((timeRemaining % 60000) / 1000);
		if (minutes > 0) {
			countdown.textContent = `${minutes}m ${seconds}s`;
		} else {
			countdown.textContent = `${seconds}s`;
		}
	}
}

/**
 * Hide session warning banner
 */
function hideSessionWarning() {
	const banner = document.getElementById('sessionWarningBanner');
	if (banner) {
		banner.remove();
		document.body.style.paddingTop = '';
	}
	sessionMonitor.warningShown = false;
}

/**
 * Extend the session by making an API call
 */
async function extendSession() {
	try {
		const response = await fetch('/api/auth/status');
		if (response.ok) {
			const data = await response.json();
			if (data.session) {
				sessionMonitor.expiresAt = data.session.expiresAt;
				hideSessionWarning();
				// Show brief success message
				if (typeof showAlert === 'function') {
					showAlert('Session extended successfully', 'success', 3000);
				}
			}
		} else {
			handleSessionExpired();
		}
	} catch (error) {
		console.error('Failed to extend session:', error);
	}
}

/**
 * Handle session expiration - redirect to login
 */
function handleSessionExpired() {
	// Stop monitoring
	if (sessionMonitor.checkInterval) {
		clearInterval(sessionMonitor.checkInterval);
	}

	// Show message and redirect
	hideSessionWarning();

	// Create expired message overlay
	const overlay = document.createElement('div');
	overlay.id = 'sessionExpiredOverlay';
	overlay.className = 'fixed inset-0 z-[9999] bg-gray-900/90 flex items-center justify-center';
	overlay.innerHTML = `
		<div class="bg-gray-800 rounded-lg p-8 max-w-md mx-4 text-center shadow-2xl border border-gray-700">
			<svg class="w-16 h-16 mx-auto mb-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
			</svg>
			<h2 class="text-xl font-bold text-white mb-2">Session Expired</h2>
			<p class="text-gray-400 mb-6">Your session has timed out due to inactivity. Please log in again to continue.</p>
			<a href="/login.html" class="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors">
				Log In
			</a>
		</div>
	`;
	document.body.appendChild(overlay);

	// Auto-redirect after 3 seconds
	setTimeout(() => {
		window.location.href = '/login.html';
	}, 3000);
}

/**
 * Reset session timer (call when user makes API activity)
 * This is useful when other parts of the app make API calls that extend the session
 */
function resetSessionTimer() {
	if (sessionMonitor.timeoutMs) {
		sessionMonitor.expiresAt = Date.now() + sessionMonitor.timeoutMs;
		if (sessionMonitor.warningShown) {
			const timeRemaining = sessionMonitor.expiresAt - Date.now();
			if (timeRemaining > sessionMonitor.WARNING_THRESHOLD_MS) {
				hideSessionWarning();
			}
		}
	}
}

// ============================================
// Platform Announcements
// ============================================

// Announcement state
let announcementState = {
	currentAnnouncements: [],
	dismissedIds: JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]'),
	checkInterval: null,
	CHECK_INTERVAL_MS: 5 * 60 * 1000 // Check every 5 minutes
};

// Announcement type styling
const ANNOUNCEMENT_STYLES = {
	alert: {
		bgClass: 'bg-red-600',
		textClass: 'text-white',
		icon: `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
		</svg>`
	},
	warning: {
		bgClass: 'bg-yellow-600',
		textClass: 'text-white',
		icon: `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
		</svg>`
	},
	info: {
		bgClass: 'bg-blue-600',
		textClass: 'text-white',
		icon: `<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
		</svg>`
	}
};

/**
 * Fetch and display active platform announcements
 */
async function fetchAnnouncements() {
	try {
		const response = await fetch('/api/announcements/active');
		if (!response.ok) return;

		const data = await response.json();
		if (!data.success) return;

		announcementState.currentAnnouncements = data.announcements || [];
		displayAnnouncements();
	} catch (error) {
		console.error('[Announcements] Failed to fetch:', error);
	}
}

/**
 * Display the announcement banner
 */
function displayAnnouncements() {
	// Remove existing banner
	const existingBanner = document.getElementById('announcementBanner');
	if (existingBanner) {
		existingBanner.remove();
		document.body.style.paddingTop = sessionMonitor.warningShown ? '52px' : '';
	}

	// Filter out dismissed announcements
	const activeAnnouncements = announcementState.currentAnnouncements.filter(
		a => !announcementState.dismissedIds.includes(a.id)
	);

	if (activeAnnouncements.length === 0) return;

	// Get the highest priority announcement (already sorted by priority from server)
	const announcement = activeAnnouncements[0];
	const style = ANNOUNCEMENT_STYLES[announcement.type] || ANNOUNCEMENT_STYLES.info;

	// Create banner
	const banner = document.createElement('div');
	banner.id = 'announcementBanner';
	banner.className = `fixed top-0 left-0 right-0 z-[9998] ${style.bgClass} ${style.textClass} px-4 py-3 flex items-center justify-center gap-4 shadow-lg`;
	banner.style.transition = 'transform 0.3s ease-out';
	banner.innerHTML = `
		${style.icon}
		<span class="flex-1 text-center">${escapeHtmlNav(announcement.message)}</span>
		<button onclick="dismissAnnouncement(${announcement.id})" class="p-1 hover:bg-black/20 rounded transition-colors" title="Dismiss">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
			</svg>
		</button>
		${activeAnnouncements.length > 1 ? `<span class="text-xs opacity-75">(+${activeAnnouncements.length - 1} more)</span>` : ''}
	`;

	document.body.appendChild(banner);

	// Add padding to prevent content overlap
	const currentPadding = parseInt(document.body.style.paddingTop) || 0;
	const sessionBannerHeight = sessionMonitor.warningShown ? 52 : 0;
	document.body.style.paddingTop = `${sessionBannerHeight + 52}px`;

	// Adjust session warning banner position if it exists
	const sessionBanner = document.getElementById('sessionWarningBanner');
	if (sessionBanner) {
		sessionBanner.style.top = '52px';
	}
}

/**
 * Dismiss an announcement (hides it locally via localStorage)
 * @param {number} announcementId - The ID of the announcement to dismiss
 */
function dismissAnnouncement(announcementId) {
	announcementState.dismissedIds.push(announcementId);
	localStorage.setItem('dismissedAnnouncements', JSON.stringify(announcementState.dismissedIds));
	displayAnnouncements();
}

/**
 * Clear dismissed announcements (useful when announcements expire)
 */
function clearDismissedAnnouncements() {
	announcementState.dismissedIds = [];
	localStorage.removeItem('dismissedAnnouncements');
	fetchAnnouncements();
}

/**
 * Initialize announcement monitoring
 */
function initAnnouncementMonitor() {
	// Fetch immediately
	fetchAnnouncements();

	// Set up periodic checking
	if (announcementState.checkInterval) {
		clearInterval(announcementState.checkInterval);
	}
	announcementState.checkInterval = setInterval(fetchAnnouncements, announcementState.CHECK_INTERVAL_MS);
}

/**
 * Simple HTML escape for announcement messages
 */
function escapeHtmlNav(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

// ============================================
// Theme Management
// ============================================

// Get the current theme
function getTheme() {
	return document.documentElement.getAttribute('data-theme') || 'light';
}

// Set theme and update UI
function setTheme(theme) {
	// Add transition class for smooth switching
	document.documentElement.classList.add('theme-transition');

	// Set the theme
	document.documentElement.setAttribute('data-theme', theme);

	// Update the toggle icon
	updateThemeToggleIcon(theme);

	// Remove transition class after animation completes
	setTimeout(() => {
		document.documentElement.classList.remove('theme-transition');
	}, 300);
}

// Toggle between light and dark themes
function toggleTheme() {
	const currentTheme = getTheme();
	const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
	setTheme(newTheme);
	localStorage.setItem('theme', newTheme);
}

// Update the theme toggle icon based on current theme
function updateThemeToggleIcon(theme) {
	const iconEl = document.getElementById('themeToggleIcon');
	if (iconEl) {
		// Show sun icon when in dark mode (to switch to light)
		// Show moon icon when in light mode (to switch to dark)
		iconEl.innerHTML = theme === 'dark' ? THEME_ICONS.sun : THEME_ICONS.moon;
	}
}

// Initialize theme on page load
function initTheme() {
	// Check localStorage first, then system preference
	const savedTheme = localStorage.getItem('theme');
	const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
	const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

	// Set theme without transition on initial load
	document.documentElement.setAttribute('data-theme', theme);
	updateThemeToggleIcon(theme);

	// Listen for system preference changes (if no saved preference)
	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
		if (!localStorage.getItem('theme')) {
			setTheme(e.matches ? 'dark' : 'light');
		}
	});
}

// Initialize theme immediately (before DOM is fully loaded to prevent flash)
initTheme();

// Export for use in other scripts
window.initNavigation = initNavigation;
window.toggleSidebar = toggleSidebar;
window.toggleMobileMenu = toggleMobileMenu;
window.navLogout = navLogout;
window.setHeaderActions = setHeaderActions;
window.navCurrentUser = () => navCurrentUser;
window.toggleTheme = toggleTheme;
window.setTheme = setTheme;
window.getTheme = getTheme;
window.initTheme = initTheme;
// Session monitoring exports
window.resetSessionTimer = resetSessionTimer;
window.extendSession = extendSession;
window.hideSessionWarning = hideSessionWarning;
// Announcement exports
window.dismissAnnouncement = dismissAnnouncement;
window.clearDismissedAnnouncements = clearDismissedAnnouncements;
window.fetchAnnouncements = fetchAnnouncements;

// Cleanup intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (sessionMonitor.checkInterval) {
		clearInterval(sessionMonitor.checkInterval);
	}
	if (announcementState.checkInterval) {
		clearInterval(announcementState.checkInterval);
	}
});
