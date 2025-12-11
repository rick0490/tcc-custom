/* node_helper.js for MMM-SponsorOverlay
 * Backend API server and WebSocket client for sponsor overlay control
 */

const NodeHelper = require("node_helper");
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

module.exports = NodeHelper.create({
	start: function () {
		console.log("[MMM-SponsorOverlay] Node helper started");
		this.apiServer = null;
		this.apiPort = null;
		this.adminDashboardUrl = null;
		this.wsSocket = null;
		this.wsConnected = false;
		this.wsReconnectAttempts = 0;
		this.wsMaxReconnectAttempts = 10;
		this.wsReconnectDelay = 5000;
		this.initialized = false;

		// Auto-initialize from config file (for server-only mode)
		this.autoInitialize();
	},

	autoInitialize: function () {
		var self = this;

		// Wait for MagicMirror to be ready
		setTimeout(() => {
			if (self.initialized) return;

			// Read config file to get our module's config
			// Use process.cwd() since __dirname doesn't resolve correctly through symlinks
			try {
				const configPath = path.resolve(process.cwd(), "config/config.js");
				delete require.cache[require.resolve(configPath)];
				const config = require(configPath);

				// Find our module's config
				const moduleConfig = config.modules?.find(m => m.module === "MMM-SponsorOverlay");
				if (moduleConfig && moduleConfig.config) {
					self.apiPort = moduleConfig.config.apiPort || 2055;
					self.adminDashboardUrl = moduleConfig.config.adminDashboardUrl || "http://localhost:3000";

					console.log("[MMM-SponsorOverlay] Auto-initializing from config file");
					console.log("[MMM-SponsorOverlay] Port:", self.apiPort);
					console.log("[MMM-SponsorOverlay] Admin URL:", self.adminDashboardUrl);

					self.initializeServer();
				}
			} catch (err) {
				console.error("[MMM-SponsorOverlay] Error reading config:", err.message);
			}
		}, 3000);
	},

	initializeServer: function () {
		if (this.initialized) return;
		this.initialized = true;

		// Start API server
		if (!this.apiServer) {
			this.startApiServer(this.apiPort);
		}

		// Connect to admin dashboard WebSocket
		setTimeout(() => {
			this.connectWebSocket();
		}, 1000);

		// Register image proxy on main MagicMirror server
		setTimeout(() => {
			this.registerImageProxy();
		}, 500);
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "INIT_SPONSOR_OVERLAY") {
			// If we get a notification from frontend, use those settings
			this.apiPort = payload.apiPort || this.apiPort || 2055;
			this.adminDashboardUrl = payload.adminDashboardUrl || this.adminDashboardUrl || "http://localhost:3000";

			console.log("[MMM-SponsorOverlay] Frontend init with port:", this.apiPort);

			// Initialize if not already done
			if (!this.initialized) {
				this.initializeServer();
			}
		}
	},

	registerImageProxy: function () {
		var self = this;

		// Register sponsor image proxy route on main MagicMirror server
		if (this.expressApp) {
			this.expressApp.get("/api/sponsors/image/:filename", async (req, res) => {
				const { filename } = req.params;

				try {
					const adminUrl = self.adminDashboardUrl || "http://localhost:3000";
					const imageUrl = `${adminUrl}/api/sponsors/preview/${encodeURIComponent(filename)}`;

					const response = await fetch(imageUrl);

					if (!response.ok) {
						return res.status(response.status).send("Image not found");
					}

					const contentType = response.headers.get("content-type");
					if (contentType) {
						res.set("Content-Type", contentType);
					}
					res.set("Cache-Control", "public, max-age=3600");

					const arrayBuffer = await response.arrayBuffer();
					res.send(Buffer.from(arrayBuffer));
				} catch (error) {
					console.error("[MMM-SponsorOverlay] Error proxying sponsor image:", error.message);
					res.status(500).send("Error loading sponsor image");
				}
			});
			console.log("[MMM-SponsorOverlay] Image proxy registered on main MagicMirror server");
		} else {
			console.warn("[MMM-SponsorOverlay] expressApp not available for image proxy registration");
		}
	},

	startApiServer: function (port) {
		var self = this;

		console.log("[MMM-SponsorOverlay] Starting API server on port:", port);

		if (this.apiServer) {
			console.log("[MMM-SponsorOverlay] API server already running");
			return;
		}

		const app = express();
		app.use(bodyParser.json());

		// CORS headers
		app.use((req, res, next) => {
			res.header("Access-Control-Allow-Origin", "*");
			res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			res.header("Access-Control-Allow-Headers", "Content-Type");
			if (req.method === "OPTIONS") {
				return res.sendStatus(200);
			}
			next();
		});

		// Health check endpoint
		app.get("/api/sponsor/status", (req, res) => {
			res.json({
				success: true,
				message: "MMM-SponsorOverlay API is running",
				port: port,
				websocket: {
					connected: self.wsConnected,
					reconnectAttempts: self.wsReconnectAttempts
				}
			});
		});

		// Show sponsor(s)
		app.post("/api/sponsor/show", (req, res) => {
			const { sponsors, config } = req.body;

			console.log("[MMM-SponsorOverlay] API: POST /api/sponsor/show");
			console.log("[MMM-SponsorOverlay] Sponsors:", sponsors ? Object.keys(sponsors) : []);
			// Log sponsor data with offsets for debugging
			if (sponsors) {
				Object.keys(sponsors).forEach(pos => {
					const s = sponsors[pos];
					console.log(`[MMM-SponsorOverlay] ${pos}: offsetX=${s.offsetX}, offsetY=${s.offsetY}, size=${s.size}`);
				});
			}

			if (!sponsors || typeof sponsors !== "object") {
				return res.status(400).json({ success: false, error: "Sponsors object is required" });
			}

			self.sendSocketNotification("SPONSOR_SHOW", { sponsors, config: config || {} });

			res.json({
				success: true,
				message: "Sponsor overlays displayed",
				positions: Object.keys(sponsors)
			});
		});

		// Hide sponsor(s)
		app.post("/api/sponsor/hide", (req, res) => {
			const { position, all } = req.body;

			console.log("[MMM-SponsorOverlay] API: POST /api/sponsor/hide");
			console.log("[MMM-SponsorOverlay] Position:", position || "all");

			self.sendSocketNotification("SPONSOR_HIDE", { position: position || null });

			res.json({
				success: true,
				message: position ? `Sponsor hidden at ${position}` : "All sponsors hidden"
			});
		});

		// Rotate sponsor at position
		app.post("/api/sponsor/rotate", (req, res) => {
			const { position, sponsor, transitionDelay } = req.body;

			console.log("[MMM-SponsorOverlay] API: POST /api/sponsor/rotate");

			if (!position) {
				return res.status(400).json({ success: false, error: "Position is required" });
			}

			self.sendSocketNotification("SPONSOR_ROTATE", { position, sponsor, transitionDelay: transitionDelay || 500 });

			res.json({ success: true, message: `Sponsor rotated at ${position}` });
		});

		// Image proxy endpoint - serves sponsor images from admin dashboard
		app.get("/api/sponsors/image/:filename", async (req, res) => {
			const { filename } = req.params;

			try {
				const adminUrl = self.adminDashboardUrl || "http://localhost:3000";
				const imageUrl = `${adminUrl}/api/sponsors/preview/${encodeURIComponent(filename)}`;

				const response = await fetch(imageUrl);

				if (!response.ok) {
					return res.status(response.status).send("Image not found");
				}

				const contentType = response.headers.get("content-type");
				if (contentType) {
					res.setHeader("Content-Type", contentType);
				}
				res.setHeader("Cache-Control", "public, max-age=3600");

				const buffer = await response.arrayBuffer();
				res.send(Buffer.from(buffer));
			} catch (error) {
				console.error("[MMM-SponsorOverlay] Error proxying sponsor image:", error.message);
				res.status(500).send("Error loading sponsor image");
			}
		});

		// Start server
		try {
			this.apiServer = app.listen(port, () => {
				console.log("[MMM-SponsorOverlay] API server started on port:", port);
				this.sendSocketNotification("API_SERVER_STARTED", {
					port: port,
					adminDashboardUrl: self.adminDashboardUrl
				});
			});

			this.apiServer.on("error", (err) => {
				console.error("[MMM-SponsorOverlay] API server error:", err.message);
				if (err.code === "EADDRINUSE") {
					console.error("[MMM-SponsorOverlay] Port", port, "is already in use");
				}
			});
		} catch (error) {
			console.error("[MMM-SponsorOverlay] Failed to start API server:", error.message);
		}
	},

	connectWebSocket: function () {
		var self = this;

		// Dynamically import socket.io-client
		import("socket.io-client").then(({ io }) => {
			console.log("[MMM-SponsorOverlay] Connecting to WebSocket:", this.adminDashboardUrl);

			this.wsSocket = io(this.adminDashboardUrl, {
				reconnection: true,
				reconnectionAttempts: this.wsMaxReconnectAttempts,
				reconnectionDelay: this.wsReconnectDelay,
				reconnectionDelayMax: 30000,
				timeout: 20000,
				transports: ["websocket", "polling"]
			});

			this.wsSocket.on("connect", () => {
				console.log("[MMM-SponsorOverlay] WebSocket connected");
				self.wsConnected = true;
				self.wsReconnectAttempts = 0;

				// Register as sponsor overlay display
				self.wsSocket.emit("display:register", {
					displayType: "sponsor-overlay",
					displayId: "sponsor-overlay-" + self.apiPort
				});
			});

			// Handle sponsor events from admin dashboard
			this.wsSocket.on("sponsor:show", (data) => {
				console.log("[MMM-SponsorOverlay] WebSocket: sponsor:show");
				self.sendSocketNotification("SPONSOR_SHOW", {
					sponsors: data.sponsors || {},
					config: data.config || {}
				});
			});

			this.wsSocket.on("sponsor:hide", (data) => {
				console.log("[MMM-SponsorOverlay] WebSocket: sponsor:hide");
				self.sendSocketNotification("SPONSOR_HIDE", {
					position: data.position || null
				});
			});

			this.wsSocket.on("sponsor:rotate", (data) => {
				console.log("[MMM-SponsorOverlay] WebSocket: sponsor:rotate");
				self.sendSocketNotification("SPONSOR_ROTATE", {
					position: data.position,
					sponsor: data.sponsor,
					transitionDelay: data.transitionDelay || 500
				});
			});

			this.wsSocket.on("sponsor:config", (data) => {
				console.log("[MMM-SponsorOverlay] WebSocket: sponsor:config");
				self.sendSocketNotification("SPONSOR_CONFIG", data);
			});

			this.wsSocket.on("disconnect", (reason) => {
				console.log("[MMM-SponsorOverlay] WebSocket disconnected:", reason);
				self.wsConnected = false;
			});

			this.wsSocket.on("reconnect_attempt", (attempt) => {
				console.log("[MMM-SponsorOverlay] WebSocket reconnect attempt:", attempt);
				self.wsReconnectAttempts = attempt;
			});

			this.wsSocket.on("connect_error", (error) => {
				console.error("[MMM-SponsorOverlay] WebSocket connection error:", error.message);
			});
		}).catch((err) => {
			console.error("[MMM-SponsorOverlay] Failed to load socket.io-client:", err.message);
			console.log("[MMM-SponsorOverlay] WebSocket disabled - HTTP API will still work");
		});
	},

	stop: function () {
		console.log("[MMM-SponsorOverlay] Stopping node helper");
		if (this.wsSocket) {
			this.wsSocket.disconnect();
		}
		if (this.apiServer) {
			this.apiServer.close();
		}
	}
});
