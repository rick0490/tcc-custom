/* MagicMirror Module: MMM-SponsorOverlay
 * Handles sponsor logo overlays independently from other modules
 * Renders above all content using fullscreen_above position
 *
 * Shared module - used by both match and bracket views
 * Positioning is config-driven for per-instance customization
 */

Module.register("MMM-SponsorOverlay", {
	defaults: {
		apiPort: 2055,
		adminDashboardUrl: "http://localhost:3000",
		// Positioning config (pixels from screen edge)
		cornerOffset: 50,           // Default offset for corner logos
		bannerOffset: 25,           // Default offset for banners
		bottomCornerOffset: null    // Override for bottom corners (uses cornerOffset if null)
	},

	getStyles: function () {
		return ["MMM-SponsorOverlay.css"];
	},

	start: function () {
		Log.info("[MMM-SponsorOverlay] Starting module");

		// Sponsor overlay state
		this.sponsorState = {
			enabled: false,
			sponsors: {},
			config: null
		};

		// adminDashboardUrl will be set by node_helper (bypasses Cloudflare cache issues)
		this.adminDashboardUrl = this.config.adminDashboardUrl || "https://admin.despairhardware.com";

		// Request API server to start
		this.sendSocketNotification("INIT_SPONSOR_OVERLAY", {
			apiPort: this.config.apiPort,
			adminDashboardUrl: this.config.adminDashboardUrl
		});
	},

	socketNotificationReceived: function (notification, payload) {
		Log.info("[MMM-SponsorOverlay] Socket notification: " + notification);

		switch (notification) {
			case "API_SERVER_STARTED":
				Log.info("[MMM-SponsorOverlay] API server started on port " + payload.port);
				// Update adminDashboardUrl from server (bypasses Cloudflare cache)
				if (payload.adminDashboardUrl) {
					this.adminDashboardUrl = payload.adminDashboardUrl;
					Log.info("[MMM-SponsorOverlay] Using admin URL: " + this.adminDashboardUrl);
				}
				break;
			case "SPONSOR_SHOW":
				Log.info("[MMM-SponsorOverlay] SPONSOR_SHOW received");
				this.showSponsors(payload.sponsors, payload.config);
				break;
			case "SPONSOR_HIDE":
				Log.info("[MMM-SponsorOverlay] SPONSOR_HIDE received");
				if (payload && payload.position) {
					this.hideSponsor(payload.position);
				} else {
					this.hideAllSponsors();
				}
				break;
			case "SPONSOR_ROTATE":
				Log.info("[MMM-SponsorOverlay] SPONSOR_ROTATE received");
				this.rotateSponsor(payload.position, payload.sponsor, payload.transitionDelay);
				break;
			case "SPONSOR_CONFIG":
				Log.info("[MMM-SponsorOverlay] SPONSOR_CONFIG received");
				this.updateSponsorConfig(payload);
				break;
		}
	},

	getDom: function () {
		// Return empty wrapper - sponsors are appended to document.body
		var wrapper = document.createElement("div");
		wrapper.className = "mmm-sponsor-overlay-wrapper";
		return wrapper;
	},

	// ========================================
	// POSITIONING HELPERS
	// ========================================

	getCornerOffset: function () {
		return this.config.cornerOffset || 50;
	},

	getBottomCornerOffset: function () {
		return this.config.bottomCornerOffset || this.config.cornerOffset || 50;
	},

	getBannerOffset: function () {
		return this.config.bannerOffset || 25;
	},

	// ========================================
	// SPONSOR OVERLAY METHODS
	// ========================================

	showSponsors: function (sponsors, config) {
		var self = this;
		var sponsorCount = Object.keys(sponsors || {}).length;
		Log.info("[MMM-SponsorOverlay] showSponsors called with " + sponsorCount + " sponsors");

		this.sponsorState.enabled = config && config.enabled === false ? false : true;
		this.sponsorState.config = config;

		if (!this.sponsorState.enabled) {
			this.hideAllSponsors();
			return;
		}

		// Process each sponsor
		var positions = Object.keys(sponsors || {});

		positions.forEach(function (position) {
			var sponsor = sponsors[position];

			// Create overlay if sponsor has filename
			if (sponsor && sponsor.filename) {
				Log.info("[MMM-SponsorOverlay] Creating overlay at position: " + position);
				self.createOrUpdateSponsorOverlay(position, sponsor);
				self.sponsorState.sponsors[position] = sponsor;
			} else {
				Log.info("[MMM-SponsorOverlay] Skipping - no sponsor or no filename");
			}
		});
	},

	createOrUpdateSponsorOverlay: function (position, sponsor) {
		var self = this;
		var overlayId = "sponsor-overlay-" + position;
		var overlay = document.getElementById(overlayId);
		var isBanner = position === "top-banner" || position === "bottom-banner";
		var isCorner = !isBanner;

		Log.info("[MMM-SponsorOverlay] Creating/updating overlay: " + overlayId);

		if (!overlay) {
			overlay = document.createElement("div");
			overlay.id = overlayId;
			overlay.className = "sponsor-overlay sponsor-overlay--" + position;

			if (isCorner) {
				overlay.classList.add("sponsor-overlay--corner");
			} else {
				overlay.classList.add("sponsor-overlay--banner");
			}

			overlay.classList.add("sponsor-overlay--entering");
			document.body.appendChild(overlay);

			// Trigger visible animation after brief delay
			setTimeout(function () {
				overlay.classList.remove("sponsor-overlay--entering");
				overlay.classList.add("sponsor-overlay--visible");
			}, 50);
		} else {
			// Existing overlay - ensure it's visible (remove exiting class, add visible)
			overlay.classList.remove("sponsor-overlay--exiting");
			overlay.classList.remove("sponsor-overlay--entering");
			overlay.classList.add("sponsor-overlay--visible");
		}

		// Update overlay content
		overlay.innerHTML = "";

		// Apply high z-index and fixed positioning
		overlay.style.zIndex = "999999";
		overlay.style.position = "fixed";

		// Get positioning values from config
		var cornerOffset = this.getCornerOffset();
		var bottomCornerOffset = this.getBottomCornerOffset();
		var bannerOffset = this.getBannerOffset();

		// Get per-sponsor offsets (default to 0)
		// Relative offset mode: positive values move AWAY from anchored edge
		var offsetX = sponsor.offsetX || 0;
		var offsetY = sponsor.offsetY || 0;

		Log.info("[MMM-SponsorOverlay] Position: " + position + ", offsetX: " + offsetX + ", offsetY: " + offsetY);

		// Set position based on position name (using config values + per-sponsor offsets)
		if (position === "bottom-right") {
			// +offsetY moves up (away from bottom), +offsetX moves left (away from right)
			overlay.style.bottom = (bottomCornerOffset + offsetY) + "px";
			overlay.style.right = (cornerOffset + offsetX) + "px";
			overlay.style.top = "auto";
			overlay.style.left = "auto";
		} else if (position === "top-right") {
			// +offsetY moves down (away from top), +offsetX moves left (away from right)
			overlay.style.top = (cornerOffset + offsetY) + "px";
			overlay.style.right = (cornerOffset + offsetX) + "px";
			overlay.style.bottom = "auto";
			overlay.style.left = "auto";
		} else if (position === "bottom-left") {
			// +offsetY moves up (away from bottom), +offsetX moves right (away from left)
			overlay.style.bottom = (bottomCornerOffset + offsetY) + "px";
			overlay.style.left = (cornerOffset + offsetX) + "px";
			overlay.style.top = "auto";
			overlay.style.right = "auto";
		} else if (position === "top-left") {
			// +offsetY moves down (away from top), +offsetX moves right (away from left)
			overlay.style.top = (cornerOffset + offsetY) + "px";
			overlay.style.left = (cornerOffset + offsetX) + "px";
			overlay.style.bottom = "auto";
			overlay.style.right = "auto";
		} else if (position === "top-banner") {
			// +offsetY moves down (away from top)
			overlay.style.top = (bannerOffset + offsetY) + "px";
			overlay.style.left = "0";
			overlay.style.right = "0";
			overlay.style.bottom = "auto";
		} else if (position === "bottom-banner") {
			// +offsetY moves up (away from bottom)
			overlay.style.bottom = (bannerOffset + offsetY) + "px";
			overlay.style.left = "0";
			overlay.style.right = "0";
			overlay.style.top = "auto";
		}

		if (isBanner) {
			var bannerContainer = document.createElement("div");
			bannerContainer.className = "sponsor-banner-logos";

			var img = document.createElement("img");
			img.className = "sponsor-banner-logo";
			// Use admin dashboard URL for image proxy
			var adminUrl = self.adminDashboardUrl || "https://admin.despairhardware.com";
			img.src = adminUrl + "/api/sponsors/preview/" + encodeURIComponent(sponsor.filename);
			img.alt = sponsor.name || "Sponsor";
			img.onerror = function () {
				Log.error("[MMM-SponsorOverlay] Failed to load sponsor image: " + sponsor.filename);
			};

			var scale = (sponsor.size || 100) / 100;
			var bannerOffsetX = sponsor.offsetX || 0;
			// Combine scale and X offset into single transform for banners
			img.style.transform = "scale(" + scale + ") translateX(" + bannerOffsetX + "px)";
			// Set transformOrigin to anchor banner to top or bottom edge
			img.style.transformOrigin = (position === "top-banner") ? "top center" : "bottom center";
			img.style.opacity = (sponsor.opacity || 100) / 100;

			if (sponsor.borderRadius && sponsor.borderRadius > 0) {
				img.style.borderRadius = sponsor.borderRadius + "px";
			}

			bannerContainer.appendChild(img);
			overlay.appendChild(bannerContainer);
		} else {
			var img = document.createElement("img");
			img.className = "sponsor-logo";
			// Use admin dashboard URL for image proxy
			var adminUrl = self.adminDashboardUrl || "https://admin.despairhardware.com";
			img.src = adminUrl + "/api/sponsors/preview/" + encodeURIComponent(sponsor.filename);
			img.alt = sponsor.name || "Sponsor";
			img.onerror = function () {
				Log.error("[MMM-SponsorOverlay] Failed to load sponsor image: " + sponsor.filename);
			};

			var scale = (sponsor.size || 100) / 100;
			// Let the image determine container size, apply scale via transform
			img.style.opacity = (sponsor.opacity || 100) / 100;
			img.style.maxWidth = "400px";
			img.style.maxHeight = "200px";
			img.style.transform = "scale(" + scale + ")";
			img.style.transformOrigin = position.replace("-", " ");  // e.g., "bottom right"

			if (sponsor.borderRadius && sponsor.borderRadius > 0) {
				img.style.borderRadius = sponsor.borderRadius + "px";
			}

			overlay.appendChild(img);
		}
	},

	hideSponsor: function (position) {
		var overlayId = "sponsor-overlay-" + position;
		var overlay = document.getElementById(overlayId);

		Log.info("[MMM-SponsorOverlay] Hiding sponsor at position: " + position);

		if (overlay) {
			overlay.classList.remove("sponsor-overlay--visible");
			overlay.classList.add("sponsor-overlay--exiting");

			setTimeout(function () {
				if (overlay.parentNode) {
					overlay.parentNode.removeChild(overlay);
				}
			}, 500);
		}

		delete this.sponsorState.sponsors[position];
	},

	hideAllSponsors: function () {
		var self = this;
		var positions = ["top-left", "top-right", "bottom-left", "bottom-right", "top-banner", "bottom-banner"];

		Log.info("[MMM-SponsorOverlay] Hiding all sponsors");

		positions.forEach(function (position) {
			self.hideSponsor(position);
		});

		this.sponsorState.enabled = false;
	},

	rotateSponsor: function (position, sponsor, transitionDelay) {
		var self = this;
		var delay = transitionDelay || 500;

		Log.info("[MMM-SponsorOverlay] Rotating sponsor at position: " + position + " (delay: " + delay + "ms)");

		if (!sponsor || !sponsor.active) {
			this.hideSponsor(position);
			return;
		}

		var overlayId = "sponsor-overlay-" + position;
		var overlay = document.getElementById(overlayId);

		if (overlay) {
			overlay.classList.add("sponsor-overlay--exiting");
			setTimeout(function () {
				self.createOrUpdateSponsorOverlay(position, sponsor);
				self.sponsorState.sponsors[position] = sponsor;
			}, delay);
		} else {
			this.createOrUpdateSponsorOverlay(position, sponsor);
			this.sponsorState.sponsors[position] = sponsor;
		}
	},

	updateSponsorConfig: function (config) {
		Log.info("[MMM-SponsorOverlay] Updating sponsor config");
		this.sponsorState.config = config;
		if (config && !config.enabled) {
			this.hideAllSponsors();
		}
	}
});
