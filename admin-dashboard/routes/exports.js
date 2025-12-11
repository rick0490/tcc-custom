/**
 * Exports Routes
 *
 * Handles tournament data export: CSV standings, CSV matches, and PDF reports.
 */

const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');

// Module dependencies (injected via init)
let analyticsDb = null;
let challongeApi = null;
let requireAuthAPI = null;
let pdfHelpers = null;

// PDF color scheme
const PDF_COLORS = {
	primary: '#1a1a2e',
	secondary: '#ffffff',
	accent: '#e94560',
	muted: '#6b7280',
	border: '#e5e7eb',
	rowAlt: '#f9fafb'
};

/**
 * Initialize route dependencies
 * @param {Object} deps - Dependencies object
 */
function init(deps) {
	analyticsDb = deps.analyticsDb;
	challongeApi = deps.challongeApi;
	requireAuthAPI = deps.requireAuthAPI;
	pdfHelpers = deps.pdfHelpers || require('../helpers/pdf');
}

/**
 * GET /:tournamentId/standings/csv
 * Export standings as CSV
 */
router.get('/:tournamentId/standings/csv', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { tournamentId } = req.params;
			const { source } = req.query; // 'archive' or 'live'

			let standings = [];
			let tournamentName = 'tournament';

			if (source === 'archive') {
				// Get from SQLite analytics database (tournamentId is database ID)
				const data = analyticsDb.getTournamentById(parseInt(tournamentId));
				if (!data || !data.tournament) {
					return res.status(404).json({ success: false, error: 'Archived tournament not found' });
				}
				tournamentName = data.tournament.name;
				standings = data.standings.map(s => ({
					final_rank: s.final_rank,
					name: s.display_name || s.canonical_name,
					seed: s.seed
				}));
			} else {
				// Get live from Challonge API (tournamentId is Challonge URL slug)
				const [tournamentRes, participantsRes] = await Promise.all([
					challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}.json`),
					challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`)
				]);

				tournamentName = tournamentRes.data?.data?.attributes?.name || 'tournament';
				const participantsData = participantsRes.data?.data || [];
				standings = participantsData.map(p => ({
					final_rank: p.attributes.final_rank,
					name: p.attributes.name || p.attributes.display_name,
					seed: p.attributes.seed
				})).sort((a, b) => (a.final_rank || 999) - (b.final_rank || 999));
			}

			// Generate CSV
			const headers = ['Rank', 'Name', 'Seed'];
			const rows = standings.map(s => [
				s.final_rank || '-',
				`"${(s.name || '').replace(/"/g, '""')}"`,
				s.seed || '-'
			].join(','));

			const csv = [headers.join(','), ...rows].join('\n');
			const safeFilename = tournamentName.replace(/[^a-z0-9]/gi, '_').substring(0, 50);

			res.setHeader('Content-Type', 'text/csv');
			res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}_standings.csv"`);
			res.send(csv);
		} catch (error) {
			console.error('Error exporting standings:', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /:tournamentId/matches/csv
 * Export matches as CSV
 */
router.get('/:tournamentId/matches/csv', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { tournamentId } = req.params;
			const { source } = req.query;

			let matches = [];
			let tournamentName = 'tournament';

			if (source === 'archive') {
				// Get from SQLite analytics database
				const data = analyticsDb.getTournamentById(parseInt(tournamentId));
				if (!data || !data.tournament) {
					return res.status(404).json({ success: false, error: 'Archived tournament not found' });
				}
				tournamentName = data.tournament.name;
				matches = data.matches.map(m => ({
					round: m.round,
					identifier: m.match_identifier || '-',
					player1: m.player1_name || 'BYE',
					player2: m.player2_name || 'BYE',
					score: m.scores_csv || `${m.player1_score || 0}-${m.player2_score || 0}`,
					winner: m.winner_name || '-'
				}));
			} else {
				// Get live from Challonge API
				const [tournamentRes, matchesRes, participantsRes] = await Promise.all([
					challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}.json`),
					challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}/matches.json?page_size=256`),
					challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`)
				]);

				tournamentName = tournamentRes.data?.data?.attributes?.name || 'tournament';

				// Build participant lookup
				const participants = {};
				(participantsRes.data?.data || []).forEach(p => {
					participants[p.id] = p.attributes.name || p.attributes.display_name;
				});

				const matchesData = matchesRes.data?.data || [];
				matches = matchesData.map(m => {
					const attrs = m.attributes;
					return {
						round: attrs.round,
						identifier: attrs.identifier || '-',
						player1: participants[attrs.player1_id] || 'TBD',
						player2: participants[attrs.player2_id] || 'TBD',
						score: attrs.scores_csv || '-',
						winner: participants[attrs.winner_id] || '-'
					};
				}).sort((a, b) => a.round - b.round);
			}

			// Generate CSV
			const headers = ['Round', 'Match', 'Player 1', 'Player 2', 'Score', 'Winner'];
			const rows = matches.map(m => [
				m.round,
				`"${m.identifier}"`,
				`"${(m.player1 || '').replace(/"/g, '""')}"`,
				`"${(m.player2 || '').replace(/"/g, '""')}"`,
				`"${m.score}"`,
				`"${(m.winner || '').replace(/"/g, '""')}"`
			].join(','));

			const csv = [headers.join(','), ...rows].join('\n');
			const safeFilename = tournamentName.replace(/[^a-z0-9]/gi, '_').substring(0, 50);

			res.setHeader('Content-Type', 'text/csv');
			res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}_matches.csv"`);
			res.send(csv);
		} catch (error) {
			console.error('Error exporting matches:', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

/**
 * GET /:tournamentId/report/pdf
 * Export tournament report as PDF
 */
router.get('/:tournamentId/report/pdf', async (req, res) => {
	requireAuthAPI(req, res, async () => {
		try {
			const { tournamentId } = req.params;
			const { source } = req.query;

			let tournament, standings, matches;

			if (source === 'archive') {
				// Get from SQLite analytics database
				const data = analyticsDb.getTournamentById(parseInt(tournamentId));
				if (!data || !data.tournament) {
					return res.status(404).json({ success: false, error: 'Archived tournament not found' });
				}
				tournament = {
					name: data.tournament.name,
					game: data.tournament.game_name,
					type: data.tournament.tournament_type,
					participantCount: data.tournament.participant_count,
					completedAt: data.tournament.completed_at,
					startedAt: data.tournament.started_at
				};
				standings = data.standings.map(s => ({
					rank: s.final_rank,
					name: s.display_name || s.canonical_name,
					seed: s.seed
				}));
				matches = data.matches.filter(m => m.winner_name).map(m => ({
					round: m.round,
					player1: m.player1_name,
					player2: m.player2_name,
					score: m.scores_csv || `${m.player1_score || 0}-${m.player2_score || 0}`,
					winner: m.winner_name
				}));
			} else {
				// Get live from Challonge API
				const [tournamentRes, participantsRes, matchesRes] = await Promise.all([
					challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}.json`),
					challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}/participants.json?page_size=256`),
					challongeApi.challongeV2Request('GET', `/tournaments/${tournamentId}/matches.json?page_size=256`)
				]);

				const tAttrs = tournamentRes.data?.data?.attributes || {};
				tournament = {
					name: tAttrs.name || 'Tournament',
					game: tAttrs.game_name || '',
					type: tAttrs.tournament_type || '',
					participantCount: tAttrs.participants_count || 0,
					completedAt: tAttrs.timestamps?.completed_at,
					startedAt: tAttrs.timestamps?.started_at
				};

				// Build participant lookup
				const participants = {};
				(participantsRes.data?.data || []).forEach(p => {
					participants[p.id] = {
						name: p.attributes.name || p.attributes.display_name,
						rank: p.attributes.final_rank,
						seed: p.attributes.seed
					};
				});

				standings = Object.values(participants)
					.filter(p => p.rank)
					.sort((a, b) => a.rank - b.rank)
					.map(p => ({ rank: p.rank, name: p.name, seed: p.seed }));

				const matchesData = matchesRes.data?.data || [];
				matches = matchesData
					.filter(m => m.attributes.winner_id)
					.map(m => {
						const attrs = m.attributes;
						return {
							round: attrs.round,
							player1: participants[attrs.player1_id]?.name || 'TBD',
							player2: participants[attrs.player2_id]?.name || 'TBD',
							score: attrs.scores_csv || '-',
							winner: participants[attrs.winner_id]?.name || '-'
						};
					})
					.sort((a, b) => a.round - b.round);
			}

			// Create PDF document
			const doc = new PDFDocument({ margin: 50, size: 'LETTER', autoFirstPage: true });

			const safeFilename = tournament.name.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
			res.setHeader('Content-Type', 'application/pdf');
			res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}_results.pdf"`);

			doc.pipe(res);

			// Page dimensions (LETTER: 612 x 792)
			const PAGE_HEIGHT = 792;
			const PAGE_BOTTOM = PAGE_HEIGHT - 60;

			// Helper: Check if we need a new page
			function needsNewPage(currentY, neededSpace = 100) {
				return currentY + neededSpace > PAGE_BOTTOM;
			}

			// Helper: Add new page and return starting y position
			function addNewPage() {
				doc.addPage();
				return 50;
			}

			// === HEADER SECTION ===
			doc.rect(0, 0, 612, 100).fill(PDF_COLORS.primary);

			doc.fillColor(PDF_COLORS.secondary)
				.font('Helvetica-Bold').fontSize(22)
				.text(tournament.name, 50, 25, { width: 512, align: 'center' });

			const subtitle = `${tournament.game || ''}${tournament.type ? ` • ${tournament.type.replace(/_/g, ' ')}` : ''}`;
			if (subtitle.trim()) {
				doc.font('Helvetica').fontSize(11)
					.text(subtitle, 50, 80, { width: 512, align: 'center' });
			}

			doc.strokeColor(PDF_COLORS.accent).lineWidth(3)
				.moveTo(50, 95).lineTo(562, 95).stroke();

			// === STATS ROW ===
			let y = 115;
			doc.fillColor(PDF_COLORS.muted).font('Helvetica').fontSize(10);
			const statsText = [];
			if (tournament.participantCount) statsText.push(`Participants: ${tournament.participantCount}`);
			if (tournament.completedAt) {
				const date = new Date(tournament.completedAt).toLocaleDateString('en-US', {
					month: 'short', day: 'numeric', year: 'numeric'
				});
				statsText.push(`Completed: ${date}`);
			}
			if (statsText.length > 0) {
				doc.text(statsText.join('  •  '), 50, y, { width: 512, align: 'center' });
			}

			// === FINAL STANDINGS SECTION ===
			y = pdfHelpers.drawPdfSectionHeader(doc, 'FINAL STANDINGS', 145, PDF_COLORS);

			// Top 3 with medal circles
			const top3 = standings.slice(0, 3);
			top3.forEach((s, i) => {
				const rank = i + 1;
				pdfHelpers.drawPdfMedal(doc, 70, y + 10, rank);
				doc.fillColor(PDF_COLORS.primary).font('Helvetica-Bold').fontSize(12)
					.text(s.name, 95, y + 3, { width: 350 });
				doc.fillColor(PDF_COLORS.muted).font('Helvetica').fontSize(10)
					.text(`Seed: ${s.seed || '-'}`, 450, y + 5, { width: 100, align: 'right' });
				y += 28;
			});

			doc.strokeColor(PDF_COLORS.border).lineWidth(0.5)
				.moveTo(50, y + 5).lineTo(562, y + 5).stroke();
			y += 15;

			// Remaining standings (4-8)
			const restStandings = standings.slice(3, 8);
			restStandings.forEach((s, i) => {
				pdfHelpers.drawPdfTableRow(doc, y, i % 2 === 1, 22, PDF_COLORS);
				doc.fillColor(PDF_COLORS.primary).font('Helvetica').fontSize(10)
					.text(`${s.rank}.`, 60, y + 5, { width: 25 })
					.text(s.name, 95, y + 5, { width: 350 });
				doc.fillColor(PDF_COLORS.muted)
					.text(`Seed: ${s.seed || '-'}`, 450, y + 5, { width: 100, align: 'right' });
				y += 22;
			});

			// === NOTABLE MATCHES SECTION ===
			y += 20;

			if (needsNewPage(y, 150)) {
				y = addNewPage();
			}

			const notableMatches = matches.filter(m => {
				const absRound = Math.abs(m.round);
				return absRound >= Math.max(1, Math.floor(Math.log2(tournament.participantCount || 8)) - 1);
			}).slice(-5);

			if (notableMatches.length > 0) {
				y = pdfHelpers.drawPdfSectionHeader(doc, 'NOTABLE MATCHES', y, PDF_COLORS);

				doc.fillColor(PDF_COLORS.primary).rect(50, y, 510, 22).fill();
				doc.fillColor(PDF_COLORS.secondary).font('Helvetica-Bold').fontSize(9)
					.text('ROUND', 60, y + 6, { width: 60 })
					.text('MATCHUP', 130, y + 6, { width: 250 })
					.text('SCORE', 390, y + 6, { width: 60, align: 'center' })
					.text('WINNER', 460, y + 6, { width: 100 });
				y += 25;

				notableMatches.forEach((m, i) => {
					pdfHelpers.drawPdfTableRow(doc, y, i % 2 === 1, 20, PDF_COLORS);
					const roundLabel = m.round > 0 ? `W${m.round}` : `L${Math.abs(m.round)}`;
					doc.fillColor(PDF_COLORS.accent).font('Helvetica-Bold').fontSize(9)
						.text(roundLabel, 60, y + 5, { width: 60 });
					doc.fillColor(PDF_COLORS.primary).font('Helvetica').fontSize(9)
						.text(`${m.player1} vs ${m.player2}`, 130, y + 5, { width: 250 })
						.text(m.score || '-', 390, y + 5, { width: 60, align: 'center' })
						.text(m.winner, 460, y + 5, { width: 100 });
					y += 20;
				});
			}

			// === TOURNAMENT STATISTICS SECTION ===
			y += 25;

			if (needsNewPage(y, 120)) {
				y = addNewPage();
			}

			const matchStats = pdfHelpers.calculateMatchStats(matches);
			const duration = pdfHelpers.calculateDuration(tournament);

			y = pdfHelpers.drawPdfSectionHeader(doc, 'TOURNAMENT STATISTICS', y, PDF_COLORS);

			const statsBoxWidth = 115;
			const statsBoxHeight = 45;
			const statsStartX = 55;
			const statsGap = 10;

			const stats = [
				{ label: 'Total Matches', value: matchStats.total.toString() },
				{ label: 'Completed', value: matchStats.completed.toString() },
				{ label: 'Forfeits/DQs', value: matchStats.forfeits.toString() },
				{ label: 'Duration', value: duration || 'N/A' }
			];

			stats.forEach((stat, i) => {
				const x = statsStartX + (i * (statsBoxWidth + statsGap));
				doc.fillColor(PDF_COLORS.rowAlt).rect(x, y, statsBoxWidth, statsBoxHeight).fill();
				doc.fillColor(PDF_COLORS.muted).fontSize(8).font('Helvetica')
					.text(stat.label, x, y + 8, { width: statsBoxWidth, align: 'center' });
				doc.fillColor(PDF_COLORS.primary).fontSize(16).font('Helvetica-Bold')
					.text(stat.value, x, y + 22, { width: statsBoxWidth, align: 'center' });
			});
			y += statsBoxHeight + 20;

			// === MATCH HIGHLIGHTS SECTION ===
			const upsets = pdfHelpers.findUpsets(matches, standings);
			const closeMatches = pdfHelpers.findCloseMatches(matches);

			if (upsets.length > 0 || closeMatches.length > 0) {
				if (needsNewPage(y, 120)) {
					y = addNewPage();
				}
				y = pdfHelpers.drawPdfSectionHeader(doc, 'MATCH HIGHLIGHTS', y, PDF_COLORS);

				const leftColX = 55;
				const rightColX = 310;
				let leftY = y;
				let rightY = y;

				if (upsets.length > 0) {
					doc.fillColor(PDF_COLORS.accent).fontSize(10).font('Helvetica-Bold')
						.text('BIGGEST UPSETS', leftColX, leftY);
					leftY += 15;
					upsets.forEach(u => {
						doc.fillColor(PDF_COLORS.primary).fontSize(9).font('Helvetica')
							.text(`• Seed ${u.winnerSeed} beat Seed ${u.loserSeed} (${u.winner})`, leftColX, leftY);
						leftY += 12;
					});
				}

				if (closeMatches.length > 0) {
					doc.fillColor(PDF_COLORS.accent).fontSize(10).font('Helvetica-Bold')
						.text('CLOSEST MATCHES', rightColX, rightY);
					rightY += 15;
					closeMatches.forEach(m => {
						doc.fillColor(PDF_COLORS.primary).fontSize(9).font('Helvetica')
							.text(`• ${m.player1} vs ${m.player2} (${m.score})`, rightColX, rightY);
						rightY += 12;
					});
				}

				y = Math.max(leftY, rightY) + 15;
			}

			// === PLAYER ANALYTICS SECTION (archive only) ===
			if (source === 'archive') {
				const dbTournamentId = parseInt(tournamentId);
				const eloChanges = analyticsDb.getEloChangesForTournament(dbTournamentId);
				const attendance = analyticsDb.getNewVsReturningPlayers(dbTournamentId);

				if ((eloChanges && eloChanges.length > 0) || (attendance && attendance.total > 0)) {
					if (needsNewPage(y, 120)) {
						y = addNewPage();
					}
					y = pdfHelpers.drawPdfSectionHeader(doc, 'PLAYER ANALYTICS', y, PDF_COLORS);

					const leftColX = 55;
					const rightColX = 310;
					let leftY = y;
					let rightY = y;

					if (eloChanges && eloChanges.length > 0) {
						doc.fillColor(PDF_COLORS.accent).fontSize(10).font('Helvetica-Bold')
							.text('ELO CHANGES', leftColX, leftY);
						leftY += 15;

						const gainers = eloChanges.filter(e => e.rating_change > 0).slice(0, 3);
						gainers.forEach(e => {
							doc.fillColor('#27AE60').fontSize(9).font('Helvetica')
								.text(`[+] ${e.display_name || e.canonical_name}: +${e.rating_change} (${e.rating_before} -> ${e.rating_after})`, leftColX, leftY);
							leftY += 12;
						});

						const losers = eloChanges.filter(e => e.rating_change < 0).slice(-2).reverse();
						losers.forEach(e => {
							doc.fillColor(PDF_COLORS.accent).fontSize(9).font('Helvetica')
								.text(`[-] ${e.display_name || e.canonical_name}: ${e.rating_change} (${e.rating_before} -> ${e.rating_after})`, leftColX, leftY);
							leftY += 12;
						});
					}

					if (attendance && attendance.total > 0) {
						doc.fillColor(PDF_COLORS.accent).fontSize(10).font('Helvetica-Bold')
							.text('ATTENDANCE', rightColX, rightY);
						rightY += 15;
						doc.fillColor(PDF_COLORS.primary).fontSize(9).font('Helvetica')
							.text(`New Players: ${attendance.new}`, rightColX, rightY);
						rightY += 12;
						doc.text(`Returning: ${attendance.returning}`, rightColX, rightY);
						rightY += 12;
						doc.text(`Return Rate: ${attendance.returnRate}%`, rightColX, rightY);
						rightY += 12;
					}

					y = Math.max(leftY, rightY) + 10;
				}
			}

			// === FOOTER ===
			const footerY = Math.max(y + 30, PAGE_BOTTOM - 20);

			if (footerY < PAGE_HEIGHT - 20) {
				doc.fillColor(PDF_COLORS.muted).font('Helvetica').fontSize(8)
					.text(
						`Generated by Tournament Dashboard • ${new Date().toLocaleDateString()}`,
						50,
						footerY,
						{ width: 512, align: 'center' }
					);
			}

			doc.end();
		} catch (error) {
			console.error('Error exporting PDF:', error);
			res.status(500).json({ success: false, error: error.message });
		}
	});
});

module.exports = router;
module.exports.init = init;
