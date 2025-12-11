/**
 * Joi Validation Schemas
 *
 * Centralized input validation schemas for the Tournament Control Center.
 * All API inputs should be validated using these schemas.
 */

const Joi = require('joi');

// =============================================================================
// AUTHENTICATION SCHEMAS
// =============================================================================

const loginSchema = Joi.object({
	username: Joi.string()
		.alphanum()
		.min(3)
		.max(50)
		.required()
		.messages({
			'string.min': 'Username must be at least 3 characters',
			'string.max': 'Username cannot exceed 50 characters',
			'string.alphanum': 'Username must contain only letters and numbers'
		}),
	password: Joi.string()
		.min(8)
		.max(128)
		.required()
		.messages({
			'string.min': 'Password must be at least 8 characters',
			'string.max': 'Password cannot exceed 128 characters'
		})
});

const changePasswordSchema = Joi.object({
	currentPassword: Joi.string().required(),
	newPassword: Joi.string()
		.min(8)
		.max(128)
		.required()
		.messages({
			'string.min': 'New password must be at least 8 characters'
		}),
	confirmPassword: Joi.string()
		.valid(Joi.ref('newPassword'))
		.required()
		.messages({
			'any.only': 'Passwords do not match'
		})
});

const createUserSchema = Joi.object({
	username: Joi.string()
		.alphanum()
		.min(3)
		.max(50)
		.required(),
	password: Joi.string()
		.min(8)
		.max(128)
		.required(),
	role: Joi.string()
		.valid('admin', 'user')
		.default('user')
});

// =============================================================================
// TOURNAMENT SCHEMAS
// =============================================================================

const createTournamentSchema = Joi.object({
	name: Joi.string()
		.min(3)
		.max(100)
		.required()
		.messages({
			'string.min': 'Tournament name must be at least 3 characters',
			'string.max': 'Tournament name cannot exceed 100 characters'
		}),
	tournamentType: Joi.string()
		.valid('single elimination', 'double elimination', 'round robin', 'swiss')
		.required(),
	gameName: Joi.string().max(100).allow(''),
	description: Joi.string().max(1000).allow(''),
	startAt: Joi.date().iso().allow(null, ''),
	checkInDuration: Joi.number().integer().min(0).max(1440).default(0),
	signupCap: Joi.number().integer().min(0).max(512).allow(null),
	openSignup: Joi.boolean().default(false),
	privateTournament: Joi.boolean().default(false),
	hideForum: Joi.boolean().default(true),
	hideSeeds: Joi.boolean().default(false),
	sequentialPairings: Joi.boolean().default(false),
	showRounds: Joi.boolean().default(true),
	acceptAttachments: Joi.boolean().default(false),
	quickAdvance: Joi.boolean().default(true),
	notifyMatchOpen: Joi.boolean().default(false),
	notifyTournamentEnd: Joi.boolean().default(false),
	autoAssign: Joi.boolean().default(false),
	// Single elimination options
	holdThirdPlaceMatch: Joi.boolean().default(false),
	// Double elimination options
	grandFinalsModifier: Joi.string().valid('', 'single', 'skip').allow(null),
	// Round robin options
	rrIterations: Joi.number().integer().min(1).max(3).default(1),
	rankedBy: Joi.string().valid('match wins', 'game wins', 'points scored', 'points difference', 'custom').allow(''),
	rrMatchWin: Joi.number().min(0).max(100),
	rrMatchTie: Joi.number().min(0).max(100),
	rrGameWin: Joi.number().min(0).max(100),
	rrGameTie: Joi.number().min(0).max(100),
	// Swiss options
	swissRounds: Joi.number().integer().min(1).max(20),
	swissMatchWin: Joi.number().min(0).max(100),
	swissMatchTie: Joi.number().min(0).max(100),
	swissBye: Joi.number().min(0).max(100),
	swissGameWin: Joi.number().min(0).max(100),
	swissGameTie: Joi.number().min(0).max(100),
	// Group stage options
	groupStageEnabled: Joi.boolean().default(false),
	groupStageOptions: Joi.object({
		stageType: Joi.string().valid('round robin', 'swiss'),
		groupSize: Joi.number().integer().min(2).max(16),
		participantCountToAdvance: Joi.number().integer().min(1).max(16),
		rankedBy: Joi.string().valid('match wins', 'game wins', 'points scored', 'points difference')
	}).allow(null)
}).options({ stripUnknown: true });

const updateTournamentSchema = Joi.object({
	name: Joi.string().min(3).max(100),
	gameName: Joi.string().max(100).allow(''),
	description: Joi.string().max(1000).allow(''),
	startAt: Joi.date().iso().allow(null, ''),
	checkInDuration: Joi.number().integer().min(0).max(1440),
	signupCap: Joi.number().integer().min(0).max(512).allow(null),
	openSignup: Joi.boolean(),
	privateTournament: Joi.boolean(),
	hideForum: Joi.boolean(),
	hideSeeds: Joi.boolean(),
	sequentialPairings: Joi.boolean(),
	showRounds: Joi.boolean(),
	acceptAttachments: Joi.boolean(),
	quickAdvance: Joi.boolean(),
	notifyMatchOpen: Joi.boolean(),
	notifyTournamentEnd: Joi.boolean(),
	holdThirdPlaceMatch: Joi.boolean(),
	grandFinalsModifier: Joi.string().valid('', 'single', 'skip').allow(null),
	rankedBy: Joi.string().allow(''),
	swissRounds: Joi.number().integer().min(1).max(20),
	// Point values for RR/Swiss
	rrMatchWin: Joi.number().min(0).max(100),
	rrMatchTie: Joi.number().min(0).max(100),
	rrGameWin: Joi.number().min(0).max(100),
	rrGameTie: Joi.number().min(0).max(100),
	swissMatchWin: Joi.number().min(0).max(100),
	swissMatchTie: Joi.number().min(0).max(100),
	swissBye: Joi.number().min(0).max(100),
	swissGameWin: Joi.number().min(0).max(100),
	swissGameTie: Joi.number().min(0).max(100)
}).options({ stripUnknown: true });

// =============================================================================
// MATCH SCHEMAS
// =============================================================================

const scoreSchema = Joi.object({
	player1Score: Joi.number()
		.integer()
		.min(0)
		.max(999)
		.required()
		.messages({
			'number.min': 'Score cannot be negative',
			'number.max': 'Score cannot exceed 999'
		}),
	player2Score: Joi.number()
		.integer()
		.min(0)
		.max(999)
		.required()
});

const winnerSchema = Joi.object({
	winnerId: Joi.alternatives()
		.try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/))
		.required(),
	player1Score: Joi.number().integer().min(0).max(999),
	player2Score: Joi.number().integer().min(0).max(999)
});

const dqSchema = Joi.object({
	winnerId: Joi.alternatives()
		.try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/))
		.required(),
	loserId: Joi.alternatives()
		.try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/))
		.required()
});

const stationAssignSchema = Joi.object({
	stationId: Joi.alternatives()
		.try(Joi.number().integer().positive(), Joi.string(), null)
		.allow(null)
});

// =============================================================================
// PARTICIPANT SCHEMAS
// =============================================================================

const participantSchema = Joi.object({
	name: Joi.string()
		.min(1)
		.max(50)
		.required()
		.messages({
			'string.min': 'Name is required',
			'string.max': 'Name cannot exceed 50 characters'
		}),
	email: Joi.string()
		.email()
		.max(100)
		.allow('', null),
	challongeUsername: Joi.string().max(50).allow('', null),
	seed: Joi.number().integer().min(1).max(512).allow(null),
	instagram: Joi.string().max(50).allow('', null),
	misc: Joi.string().max(255).allow('', null)
});

const bulkParticipantsSchema = Joi.object({
	participants: Joi.array()
		.items(Joi.object({
			name: Joi.string().min(1).max(50).required(),
			email: Joi.string().email().max(100).allow('', null),
			seed: Joi.number().integer().min(1).max(512).allow(null),
			misc: Joi.string().max(255).allow('', null)
		}))
		.min(1)
		.max(512)
		.required()
});

// =============================================================================
// STATION SCHEMAS
// =============================================================================

const createStationSchema = Joi.object({
	name: Joi.string()
		.min(1)
		.max(50)
		.required()
		.messages({
			'string.min': 'Station name is required',
			'string.max': 'Station name cannot exceed 50 characters'
		})
});

const stationSettingsSchema = Joi.object({
	autoAssign: Joi.boolean().required()
});

// =============================================================================
// TICKER & TIMER SCHEMAS
// =============================================================================

const tickerSchema = Joi.object({
	message: Joi.string()
		.min(1)
		.max(200)
		.required()
		.messages({
			'string.max': 'Message cannot exceed 200 characters'
		}),
	duration: Joi.number()
		.integer()
		.min(3)
		.max(30)
		.default(10)
});

const dqTimerSchema = Joi.object({
	tv: Joi.string()
		.valid('TV 1', 'TV 2')
		.required(),
	duration: Joi.number()
		.integer()
		.min(10)
		.max(600)
		.default(180)
});

const tournamentTimerSchema = Joi.object({
	duration: Joi.number()
		.integer()
		.min(10)
		.max(3600)
		.required()
		.messages({
			'number.min': 'Duration must be at least 10 seconds',
			'number.max': 'Duration cannot exceed 1 hour'
		})
});

const hideTimerSchema = Joi.object({
	type: Joi.string()
		.valid('dq', 'tournament', 'all')
		.default('all'),
	tv: Joi.string()
		.valid('TV 1', 'TV 2')
		.when('type', {
			is: 'dq',
			then: Joi.required(),
			otherwise: Joi.optional()
		})
});

// =============================================================================
// QR CODE SCHEMAS
// =============================================================================

const qrShowSchema = Joi.object({
	url: Joi.string()
		.uri()
		.required()
		.messages({
			'string.uri': 'Must be a valid URL'
		}),
	label: Joi.string().max(100).allow('', null),
	duration: Joi.number().integer().min(5).max(300).allow(null)
});

// =============================================================================
// DISPLAY SCHEMAS
// =============================================================================

const displayRegisterSchema = Joi.object({
	displayId: Joi.string().required(),
	hostname: Joi.string().max(100).allow('', null),
	ip: Joi.string().ip().allow('', null),
	currentView: Joi.string().valid('match', 'bracket', 'flyer').allow('', null),
	mac: Joi.string().max(20).allow('', null)
});

const displayHeartbeatSchema = Joi.object({
	uptimeSeconds: Joi.number().integer().min(0),
	cpuTemp: Joi.number().min(0).max(150),
	memoryUsage: Joi.number().min(0).max(100),
	wifiQuality: Joi.number().min(0).max(100),
	wifiSignal: Joi.number().min(-100).max(0),
	ssid: Joi.string().max(50).allow('', null),
	voltage: Joi.number().min(0).max(10),
	currentView: Joi.string().valid('match', 'bracket', 'flyer').allow('', null),
	ip: Joi.string().ip().allow('', null),
	externalIp: Joi.string().ip().allow('', null),
	mac: Joi.string().max(20).allow('', null),
	hostname: Joi.string().max(100).allow('', null)
});

const displayConfigSchema = Joi.object({
	assignedView: Joi.string()
		.valid('match', 'bracket', 'flyer')
		.required()
});

const displayDebugSchema = Joi.object({
	enabled: Joi.boolean().required()
});

// =============================================================================
// SPONSOR SCHEMAS
// =============================================================================

const sponsorUpdateSchema = Joi.object({
	name: Joi.string().min(1).max(100),
	position: Joi.string().valid('top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-banner', 'bottom-banner', null),
	size: Joi.number().integer().min(10).max(300),
	opacity: Joi.number().integer().min(10).max(100),
	active: Joi.boolean()
});

const sponsorConfigSchema = Joi.object({
	enabled: Joi.boolean(),
	rotationInterval: Joi.number().integer().min(5).max(300)
});

// =============================================================================
// GAME CONFIG SCHEMAS
// =============================================================================

const gameConfigSchema = Joi.object({
	name: Joi.string().min(1).max(100).required(),
	shortName: Joi.string().min(1).max(10).allow('', null),
	rules: Joi.array().items(Joi.object({
		title: Joi.string().max(100).required(),
		description: Joi.string().max(500).required()
	})).default([]),
	prizes: Joi.array().items(Joi.object({
		place: Joi.number().integer().min(1).max(100).required(),
		position: Joi.string().max(50).required(),
		emoji: Joi.string().max(10).allow('', null),
		amount: Joi.number().min(0).max(100000),
		gradient: Joi.string().allow('', null),
		extras: Joi.array().items(Joi.string().max(100)).default([])
	})).default([]),
	additionalInfo: Joi.array().items(Joi.string().max(500)).default([])
});

// =============================================================================
// RATE LIMIT SCHEMAS
// =============================================================================

const rateModeSchema = Joi.object({
	mode: Joi.string()
		.valid('IDLE', 'UPCOMING', 'ACTIVE', 'auto')
		.required()
});

// =============================================================================
// ACTIVITY SCHEMAS
// =============================================================================

const externalActivitySchema = Joi.object({
	action: Joi.string().required(),
	source: Joi.string().max(50).default('external'),
	details: Joi.object().allow(null)
});

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
	// Auth
	loginSchema,
	changePasswordSchema,
	createUserSchema,

	// Tournament
	createTournamentSchema,
	updateTournamentSchema,

	// Match
	scoreSchema,
	winnerSchema,
	dqSchema,
	stationAssignSchema,

	// Participant
	participantSchema,
	bulkParticipantsSchema,

	// Station
	createStationSchema,
	stationSettingsSchema,

	// Ticker & Timer
	tickerSchema,
	dqTimerSchema,
	tournamentTimerSchema,
	hideTimerSchema,

	// QR
	qrShowSchema,

	// Display
	displayRegisterSchema,
	displayHeartbeatSchema,
	displayConfigSchema,
	displayDebugSchema,

	// Sponsor
	sponsorUpdateSchema,
	sponsorConfigSchema,

	// Game
	gameConfigSchema,

	// Rate Limit
	rateModeSchema,

	// Activity
	externalActivitySchema
};
