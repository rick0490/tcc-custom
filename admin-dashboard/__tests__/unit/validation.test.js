/**
 * Validation Unit Tests
 *
 * Tests for input validation logic used across the application.
 * These are pure unit tests that don't require the server.
 */

describe('Input Validation', () => {
	describe('Username Validation', () => {
		const isValidUsername = (username) => {
			if (!username || typeof username !== 'string') return false;
			if (username.length < 3 || username.length > 50) return false;
			// Alphanumeric and underscores only
			return /^[a-zA-Z0-9_]+$/.test(username);
		};

		test('accepts valid usernames', () => {
			expect(isValidUsername('admin')).toBe(true);
			expect(isValidUsername('user123')).toBe(true);
			expect(isValidUsername('test_user')).toBe(true);
			expect(isValidUsername('ABC')).toBe(true);
		});

		test('rejects empty username', () => {
			expect(isValidUsername('')).toBe(false);
			expect(isValidUsername(null)).toBe(false);
			expect(isValidUsername(undefined)).toBe(false);
		});

		test('rejects too short usernames', () => {
			expect(isValidUsername('ab')).toBe(false);
			expect(isValidUsername('a')).toBe(false);
		});

		test('rejects usernames with special characters', () => {
			expect(isValidUsername('user@name')).toBe(false);
			expect(isValidUsername('user name')).toBe(false);
			expect(isValidUsername('user-name')).toBe(false);
			expect(isValidUsername('user.name')).toBe(false);
		});
	});

	describe('Password Validation', () => {
		const isValidPassword = (password) => {
			if (!password || typeof password !== 'string') return false;
			return password.length >= 8;
		};

		test('accepts valid passwords', () => {
			expect(isValidPassword('password123')).toBe(true);
			expect(isValidPassword('12345678')).toBe(true);
			expect(isValidPassword('very long password with spaces')).toBe(true);
		});

		test('rejects short passwords', () => {
			expect(isValidPassword('short')).toBe(false);
			expect(isValidPassword('1234567')).toBe(false);
		});

		test('rejects empty passwords', () => {
			expect(isValidPassword('')).toBe(false);
			expect(isValidPassword(null)).toBe(false);
		});
	});

	describe('Score Validation', () => {
		const isValidScore = (score) => {
			if (score === null || score === undefined) return false;
			const num = parseInt(score, 10);
			return !isNaN(num) && num >= 0 && num <= 999;
		};

		test('accepts valid scores', () => {
			expect(isValidScore(0)).toBe(true);
			expect(isValidScore(1)).toBe(true);
			expect(isValidScore(10)).toBe(true);
			expect(isValidScore(999)).toBe(true);
			expect(isValidScore('5')).toBe(true);
		});

		test('rejects negative scores', () => {
			expect(isValidScore(-1)).toBe(false);
			expect(isValidScore(-100)).toBe(false);
		});

		test('rejects scores over maximum', () => {
			expect(isValidScore(1000)).toBe(false);
			expect(isValidScore(9999)).toBe(false);
		});

		test('rejects non-numeric scores', () => {
			expect(isValidScore('abc')).toBe(false);
			expect(isValidScore(null)).toBe(false);
			expect(isValidScore(undefined)).toBe(false);
		});
	});

	describe('Tournament URL Validation', () => {
		const isValidTournamentUrl = (url) => {
			if (!url || typeof url !== 'string') return false;
			// Tournament URLs should be alphanumeric with underscores
			return /^[a-zA-Z0-9_]+$/.test(url) && url.length <= 60;
		};

		test('accepts valid tournament URLs', () => {
			expect(isValidTournamentUrl('my_tournament_2024')).toBe(true);
			expect(isValidTournamentUrl('ssbu_weekly_dec25')).toBe(true);
			expect(isValidTournamentUrl('test123')).toBe(true);
		});

		test('rejects URLs with special characters', () => {
			expect(isValidTournamentUrl('my-tournament')).toBe(false);
			expect(isValidTournamentUrl('my.tournament')).toBe(false);
			expect(isValidTournamentUrl('my tournament')).toBe(false);
		});

		test('rejects empty URLs', () => {
			expect(isValidTournamentUrl('')).toBe(false);
			expect(isValidTournamentUrl(null)).toBe(false);
		});
	});

	describe('Ticker Message Validation', () => {
		const isValidTickerMessage = (message, duration) => {
			if (!message || typeof message !== 'string') return false;
			if (message.length > 200) return false;
			if (duration !== undefined) {
				const dur = parseInt(duration, 10);
				if (isNaN(dur) || dur < 3 || dur > 30) return false;
			}
			return true;
		};

		test('accepts valid ticker messages', () => {
			expect(isValidTickerMessage('Hello World', 5)).toBe(true);
			expect(isValidTickerMessage('Short', 3)).toBe(true);
			expect(isValidTickerMessage('Maximum duration', 30)).toBe(true);
		});

		test('rejects messages too long', () => {
			const longMessage = 'x'.repeat(201);
			expect(isValidTickerMessage(longMessage, 5)).toBe(false);
		});

		test('rejects invalid durations', () => {
			expect(isValidTickerMessage('Message', 2)).toBe(false);
			expect(isValidTickerMessage('Message', 31)).toBe(false);
			expect(isValidTickerMessage('Message', 0)).toBe(false);
		});

		test('accepts message without duration', () => {
			expect(isValidTickerMessage('No duration specified')).toBe(true);
		});
	});

	describe('Timer Validation', () => {
		const isValidDQTimer = (duration) => {
			const dur = parseInt(duration, 10);
			return !isNaN(dur) && dur >= 10 && dur <= 600;
		};

		const isValidTournamentTimer = (duration) => {
			const dur = parseInt(duration, 10);
			return !isNaN(dur) && dur >= 10 && dur <= 3600;
		};

		test('accepts valid DQ timer durations', () => {
			expect(isValidDQTimer(10)).toBe(true);
			expect(isValidDQTimer(180)).toBe(true);
			expect(isValidDQTimer(600)).toBe(true);
		});

		test('rejects invalid DQ timer durations', () => {
			expect(isValidDQTimer(9)).toBe(false);
			expect(isValidDQTimer(601)).toBe(false);
		});

		test('accepts valid tournament timer durations', () => {
			expect(isValidTournamentTimer(10)).toBe(true);
			expect(isValidTournamentTimer(1800)).toBe(true);
			expect(isValidTournamentTimer(3600)).toBe(true);
		});

		test('rejects invalid tournament timer durations', () => {
			expect(isValidTournamentTimer(9)).toBe(false);
			expect(isValidTournamentTimer(3601)).toBe(false);
		});
	});
});

describe('Data Transformations', () => {
	describe('Score Parsing', () => {
		const parseScores = (scoresCsv) => {
			if (!scoresCsv) return { player1Score: 0, player2Score: 0 };
			const parts = scoresCsv.split('-');
			return {
				player1Score: parseInt(parts[0], 10) || 0,
				player2Score: parseInt(parts[1], 10) || 0
			};
		};

		test('parses simple scores', () => {
			expect(parseScores('3-1')).toEqual({ player1Score: 3, player2Score: 1 });
			expect(parseScores('2-0')).toEqual({ player1Score: 2, player2Score: 0 });
			expect(parseScores('0-3')).toEqual({ player1Score: 0, player2Score: 3 });
		});

		test('handles empty scores', () => {
			expect(parseScores('')).toEqual({ player1Score: 0, player2Score: 0 });
			expect(parseScores(null)).toEqual({ player1Score: 0, player2Score: 0 });
		});
	});

	describe('Time Formatting', () => {
		const formatUptime = (seconds) => {
			if (!seconds || seconds < 0) return '0m';
			const days = Math.floor(seconds / 86400);
			const hours = Math.floor((seconds % 86400) / 3600);
			const minutes = Math.floor((seconds % 3600) / 60);

			if (days > 0) return `${days}d ${hours}h ${minutes}m`;
			if (hours > 0) return `${hours}h ${minutes}m`;
			return `${minutes}m`;
		};

		test('formats seconds to readable uptime', () => {
			expect(formatUptime(0)).toBe('0m');
			expect(formatUptime(60)).toBe('1m');
			expect(formatUptime(3600)).toBe('1h 0m');
			expect(formatUptime(3660)).toBe('1h 1m');
			expect(formatUptime(86400)).toBe('1d 0h 0m');
			expect(formatUptime(90061)).toBe('1d 1h 1m');
		});

		test('handles invalid input', () => {
			expect(formatUptime(null)).toBe('0m');
			expect(formatUptime(-100)).toBe('0m');
		});
	});

	describe('Name Normalization', () => {
		const normalizePlayerName = (name) => {
			if (!name) return '';
			return name
				.toLowerCase()
				.trim()
				.replace(/[^a-z0-9]/g, '');
		};

		test('normalizes player names for matching', () => {
			expect(normalizePlayerName('Player One')).toBe('playerone');
			expect(normalizePlayerName('PLAYER_123')).toBe('player123');
			expect(normalizePlayerName('  Test  ')).toBe('test');
		});

		test('handles special characters', () => {
			expect(normalizePlayerName('Player@Name!')).toBe('playername');
			expect(normalizePlayerName('日本語')).toBe('');
		});
	});
});
