/**
 * Sponsor Overlay Manager for Bracket Display
 * Displays sponsor logos at configurable positions
 */
const SponsorOverlay = (function() {
	'use strict';

	// State
	let state = {
		enabled: false,
		sponsors: {},  // Keyed by position
		config: null,
		debugMode: false,
		adminUrl: ''
	};

	// All available positions
	const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner'];

	/**
	 * Initialize sponsor overlay manager
	 */
	function init(adminUrl, debugMode = false) {
		state.adminUrl = adminUrl;
		state.debugMode = debugMode;
		log('init', { adminUrl });
	}

	/**
	 * Debug logger
	 */
	function log(action, data = {}) {
		if (state.debugMode) {
			console.log(`%c[SponsorOverlay] ${action}`, 'color: #f59e0b', data);
		}
	}

	/**
	 * Show sponsors at specified positions
	 */
	function show(sponsors, config) {
		state.enabled = config ? config.enabled : true;
		state.config = config;

		log('show', { sponsors, config, enabled: state.enabled });

		if (!state.enabled) {
			hideAll();
			return;
		}

		// Create or update overlays for each position
		Object.keys(sponsors).forEach(position => {
			const sponsor = sponsors[position];
			if (sponsor && sponsor.active) {
				createOrUpdateOverlay(position, sponsor);
				state.sponsors[position] = sponsor;
			}
		});
	}

	/**
	 * Create or update a sponsor overlay
	 */
	function createOrUpdateOverlay(position, sponsor) {
		const overlayId = `sponsor-overlay-${position}`;
		let overlay = document.getElementById(overlayId);

		const isBanner = position === 'top-banner' || position === 'bottom-banner';
		const isCorner = !isBanner;

		if (!overlay) {
			overlay = document.createElement('div');
			overlay.id = overlayId;
			overlay.className = `sponsor-overlay sponsor-overlay--${position}`;

			if (isCorner) {
				overlay.classList.add('sponsor-overlay--corner');
			} else {
				overlay.classList.add('sponsor-overlay--banner');
			}

			overlay.classList.add('sponsor-overlay--entering');

			const container = document.getElementById('sponsor-container');
			if (container) {
				container.appendChild(overlay);
			} else {
				document.body.appendChild(overlay);
			}

			// Trigger visible animation
			requestAnimationFrame(() => {
				overlay.classList.remove('sponsor-overlay--entering');
				overlay.classList.add('sponsor-overlay--visible');
			});
		}

		// Update content
		overlay.innerHTML = '';

		// Build image URL
		const userId = sponsor.userId || '1';
		const imageUrl = `${state.adminUrl}/api/sponsors/preview/${userId}/${sponsor.filename}`;

		if (isBanner) {
			const bannerContainer = document.createElement('div');
			bannerContainer.className = 'sponsor-banner-logos';

			const img = document.createElement('img');
			img.className = 'sponsor-banner-logo';
			img.src = imageUrl;
			img.alt = sponsor.name || 'Sponsor';
			img.onerror = () => console.error(`[SponsorOverlay] Failed to load: ${sponsor.filename}`);

			// Apply size scaling
			const scale = (sponsor.size || 100) / 100;
			img.style.transform = `scale(${scale})`;

			// Apply opacity
			img.style.opacity = (sponsor.opacity || 100) / 100;

			bannerContainer.appendChild(img);
			overlay.appendChild(bannerContainer);
		} else {
			const img = document.createElement('img');
			img.className = 'sponsor-logo';
			img.src = imageUrl;
			img.alt = sponsor.name || 'Sponsor';
			img.onerror = () => console.error(`[SponsorOverlay] Failed to load: ${sponsor.filename}`);

			// Apply size scaling (base is 200x100px)
			const scale = (sponsor.size || 100) / 100;
			overlay.style.width = `${200 * scale}px`;
			overlay.style.height = `${100 * scale}px`;

			// Apply opacity
			img.style.opacity = (sponsor.opacity || 100) / 100;

			// Apply offset
			if (sponsor.offsetX !== undefined || sponsor.offsetY !== undefined) {
				const currentTransform = overlay.style.transform || '';
				const offsetX = sponsor.offsetX || 0;
				const offsetY = sponsor.offsetY || 0;
				overlay.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
			}

			overlay.appendChild(img);
		}

		log('createOrUpdateOverlay', { position, sponsor: sponsor.name });
	}

	/**
	 * Hide sponsor at specific position
	 */
	function hide(position) {
		const overlayId = `sponsor-overlay-${position}`;
		const overlay = document.getElementById(overlayId);

		if (overlay) {
			overlay.classList.remove('sponsor-overlay--visible');
			overlay.classList.add('sponsor-overlay--exiting');

			setTimeout(() => {
				if (overlay.parentNode) {
					overlay.parentNode.removeChild(overlay);
				}
			}, 500);
		}

		delete state.sponsors[position];
		log('hide', { position });
	}

	/**
	 * Hide all sponsor overlays
	 */
	function hideAll() {
		POSITIONS.forEach(position => hide(position));
		state.enabled = false;
		log('hideAll');
	}

	/**
	 * Rotate sponsor at position
	 */
	function rotate(position, sponsor) {
		if (!sponsor || !sponsor.active) {
			hide(position);
			return;
		}

		const overlayId = `sponsor-overlay-${position}`;
		const overlay = document.getElementById(overlayId);

		if (overlay) {
			overlay.classList.add('sponsor-overlay--exiting');

			setTimeout(() => {
				createOrUpdateOverlay(position, sponsor);
				state.sponsors[position] = sponsor;
			}, 500);
		} else {
			createOrUpdateOverlay(position, sponsor);
			state.sponsors[position] = sponsor;
		}

		log('rotate', { position, sponsor: sponsor.name });
	}

	/**
	 * Update sponsor configuration
	 */
	function updateConfig(config) {
		state.config = config;

		if (config && !config.enabled) {
			hideAll();
		}

		log('updateConfig', { config });
	}

	/**
	 * Get current state
	 */
	function getState() {
		return { ...state };
	}

	// Public API
	return {
		init,
		show,
		hide,
		hideAll,
		rotate,
		updateConfig,
		getState
	};
})();

// Export
window.SponsorOverlay = SponsorOverlay;
