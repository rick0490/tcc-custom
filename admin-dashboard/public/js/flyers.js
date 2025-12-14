// Flyer Management Page JavaScript

// State
let flyers = [];
let deleteTarget = null;
let deleteTargetOwner = null;
let statusRefreshInterval = null;
let currentActiveFlyer = null;
let wsConnected = false;
let currentUserId = null;
let isSuperadminView = false;

/**
 * Get the preview URL for a flyer based on its owner
 */
function getFlyerPreviewUrl(flyer) {
	const userId = flyer.ownerId || currentUserId;
	if (userId !== null && userId !== undefined) {
		return `/api/flyers/preview/${userId}/${encodeURIComponent(flyer.filename || flyer)}`;
	}
	// Legacy fallback for flyers without owner
	return `/api/flyers/preview/${encodeURIComponent(flyer.filename || flyer)}`;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
	FrontendDebug.log('Flyers', 'Initializing Flyer Management page');

	// Initialize last updated timestamp
	initLastUpdated('flyersLastUpdated', loadFlyers, { prefix: 'Updated', thresholds: { fresh: 30, stale: 120 } });

	await loadFlyers();
	await refreshStatus();
	setupUploadForm();

	// Initialize WebSocket for real-time updates
	initWebSocket();

	// Start polling with visibility awareness
	startPolling();
	setupVisibilityHandler(
		() => { startPolling(); },
		() => { stopPolling(); }
	);
});

// WebSocket initialization
function initWebSocket() {
	if (!WebSocketManager.init()) {
		FrontendDebug.warn('Flyers', 'WebSocket not available, using polling');
		return;
	}

	// Subscribe to flyer events
	WebSocketManager.subscribeMany({
		'flyers:update': handleFlyerUpdate,
		[WS_EVENTS.FLYER_UPLOADED]: handleFlyerEvent,
		[WS_EVENTS.FLYER_DELETED]: handleFlyerEvent,
		[WS_EVENTS.FLYER_ACTIVATED]: handleFlyerActivated
	});

	WebSocketManager.onConnection('connect', () => {
		FrontendDebug.ws('Flyers', 'WebSocket connected');
		wsConnected = true;
		// Reduce polling when connected
		stopPolling();
		startPolling(45000); // 45 second polling when WS connected
	});

	WebSocketManager.onConnection('disconnect', () => {
		FrontendDebug.ws('Flyers', 'WebSocket disconnected');
		wsConnected = false;
		// Increase polling when disconnected
		stopPolling();
		startPolling(15000); // Back to 15 second polling
	});
}

// Handle flyer update event
function handleFlyerUpdate(data) {
	FrontendDebug.ws('Flyers', 'Update received', { action: data.action });
	loadFlyers();
}

// Handle specific flyer events
function handleFlyerEvent(data) {
	FrontendDebug.ws('Flyers', 'Event received', data);
	loadFlyers();
}

// Handle flyer activation event
function handleFlyerActivated(data) {
	FrontendDebug.ws('Flyers', 'Flyer activated', { flyer: data.flyer });
	currentActiveFlyer = data.flyer;
	renderGallery();
	refreshStatus();
}

function startPolling(interval = 15000) {
	if (!statusRefreshInterval) {
		statusRefreshInterval = setInterval(refreshStatus, interval);
	}
}

function stopPolling() {
	if (statusRefreshInterval) {
		clearInterval(statusRefreshInterval);
		statusRefreshInterval = null;
	}
}

// Load flyers from API
async function loadFlyers() {
	// Show loading state
	const btn = document.getElementById('refreshFlyersBtn');
	const icon = document.getElementById('refreshFlyersIcon');
	const text = document.getElementById('refreshFlyersText');
	if (btn) btn.disabled = true;
	if (icon) icon.classList.add('animate-spin');
	if (text) text.textContent = 'Refreshing...';

	try {
		const response = await fetch('/api/flyers');
		if (!response.ok) throw new Error('Failed to load flyers');

		const data = await response.json();
		if (data.success) {
			flyers = data.flyers || [];
			currentUserId = data.currentUserId;
			isSuperadminView = data.isSuperadmin || false;
			renderGallery();
			document.getElementById('flyerCount').textContent = `${flyers.length} flyer${flyers.length !== 1 ? 's' : ''}`;
			// Update last refreshed timestamp
			setLastUpdated('flyersLastUpdated');
		}
	} catch (error) {
		FrontendDebug.error('Flyers', 'Failed to load flyers', error);
		showAlert('Failed to load flyers', 'error');
	} finally {
		// Reset loading state
		if (btn) btn.disabled = false;
		if (icon) icon.classList.remove('animate-spin');
		if (text) text.textContent = 'Refresh';
	}
}

// Refresh display status
async function refreshStatus() {
	try {
		const response = await fetch('/api/status');
		if (!response.ok) return;

		const data = await response.json();
		if (!data.success) return;

		// Flyer display status
		const flyerOnline = data.modules?.flyer?.status?.running;
		const flyerState = data.modules?.flyer?.state;
		const flyerIndicator = document.getElementById('flyerStatusIndicator');
		const flyerCurrent = document.getElementById('flyerDisplayCurrent');

		if (flyerIndicator) {
			flyerIndicator.classList.remove('online', 'offline', 'bg-gray-500');
			flyerIndicator.classList.add(flyerOnline ? 'online' : 'offline');
		}
		if (flyerCurrent) {
			flyerCurrent.textContent = flyerState?.flyer || 'None';
		}

		// Track active flyer and re-render gallery if changed
		const newActiveFlyer = flyerState?.flyer || null;
		if (newActiveFlyer !== currentActiveFlyer) {
			currentActiveFlyer = newActiveFlyer;
			renderGallery();
		}
	} catch (error) {
		FrontendDebug.error('Flyers', 'Status refresh failed', error);
	}
}

// Helper to check if a file is a video
function isVideoFile(filename) {
	return filename.toLowerCase().endsWith('.mp4');
}

// Render flyer gallery
function renderGallery() {
	const gallery = document.getElementById('flyerGallery');
	if (!gallery) return;

	if (flyers.length === 0) {
		gallery.innerHTML = `
			<div class="text-center py-8 text-gray-400 col-span-full">
				No flyers uploaded yet. Upload your first flyer above.
			</div>
		`;
		return;
	}

	gallery.innerHTML = flyers.map(flyer => {
		const filename = flyer.filename || flyer;
		const isActive = filename === currentActiveFlyer;
		const fileSize = flyer.size ? formatFileSize(flyer.size) : '';
		const modifiedDate = flyer.modified ? formatDate(flyer.modified) : '';
		const isVideo = flyer.type === 'video' || isVideoFile(filename);
		const ownerId = flyer.ownerId;
		const isLegacy = flyer.isLegacy || false;
		const previewUrl = getFlyerPreviewUrl(flyer);

		return `
		<div class="flyer-card group ${isActive ? 'ring-2 ring-green-500 ring-offset-2 ring-offset-gray-800' : ''}">
			${isActive ? `
				<div class="absolute top-2 left-2 z-10 bg-green-600 text-white text-xs px-2 py-1 rounded font-medium">
					Active
				</div>
			` : ''}
			${isVideo ? `
				<div class="absolute top-2 right-2 z-10 bg-purple-600 text-white text-xs px-2 py-1 rounded font-medium">
					Video
				</div>
			` : ''}
			${isSuperadminView && ownerId !== currentUserId ? `
				<div class="absolute ${isVideo ? 'top-10' : 'top-2'} right-2 z-10 bg-blue-600 text-white text-xs px-2 py-1 rounded font-medium">
					User ${ownerId || 'Legacy'}
				</div>
			` : ''}
			<div class="flyer-image-container cursor-pointer" onclick="previewFlyer('${escapeHtml(filename)}', ${isVideo}, ${ownerId || 'null'})">
				${isVideo ? `
					<div class="flex items-center justify-center h-full bg-gray-700">
						<svg class="w-16 h-16 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
						</svg>
					</div>
				` : `
					<img src="${previewUrl}"
						 alt="${escapeHtml(filename)}"
						 class="flyer-image-preview"
						 onload="this.style.opacity = 1; this.nextElementSibling.style.display = 'none';"
						 onerror="this.nextElementSibling.innerHTML = '<svg class=\\'w-8 h-8 text-gray-500\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'2\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\'></path></svg>'">
					<div class="flyer-loading">
						<div class="spinner"></div>
					</div>
				`}
			</div>
			<div class="flyer-info">
				<div class="flyer-filename truncate mb-1" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
				<div class="flex items-center justify-between text-xs text-gray-500 mb-2">
					<span>${fileSize}</span>
					<span>${modifiedDate}</span>
				</div>
				<div class="flex gap-2">
					${!isActive ? `
						<button onclick="event.stopPropagation(); setActiveFlyer('${escapeHtml(filename)}')"
								class="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs py-1.5 rounded transition font-medium">
							Set Active
						</button>
					` : `
						<div class="flex-1 bg-gray-600 text-gray-400 text-xs py-1.5 rounded text-center font-medium">
							Active
						</div>
					`}
					<button onclick="event.stopPropagation(); showDeleteModal('${escapeHtml(filename)}', ${ownerId || 'null'})"
							class="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition font-medium"
							title="Delete flyer">
						Delete
					</button>
				</div>
			</div>
		</div>
	`;
	}).join('');
}

// Setup upload form
function setupUploadForm() {
	const form = document.getElementById('uploadForm');
	if (!form) return;

	form.addEventListener('submit', async (e) => {
		e.preventDefault();

		const fileInput = document.getElementById('flyerFile');
		const customName = document.getElementById('customName');

		if (!fileInput.files || fileInput.files.length === 0) {
			showAlert('Please select a file to upload', 'warning');
			return;
		}

		const formData = new FormData();
		formData.append('flyer', fileInput.files[0]);
		if (customName.value.trim()) {
			formData.append('customName', customName.value.trim());
		}

		const submitBtn = form.querySelector('button[type="submit"]');
		const originalText = submitBtn.textContent;
		submitBtn.disabled = true;
		submitBtn.textContent = 'Uploading...';

		try {
			const response = await csrfFetch('/api/flyers/upload', {
				method: 'POST',
				body: formData
			});

			const data = await response.json();

			if (data.success) {
				showAlert(`Flyer "${data.filename}" uploaded successfully!`, 'success');
				form.reset();
				await loadFlyers();
			} else {
				showAlert(`Upload failed: ${data.error}`, 'error');
			}
		} catch (error) {
			showAlert(`Upload error: ${error.message}`, 'error');
		} finally {
			submitBtn.disabled = false;
			submitBtn.textContent = originalText;
		}
	});
}

// Preview flyer
function previewFlyer(filename, isVideo = false, ownerId = null) {
	const modal = document.getElementById('previewModal');
	const image = document.getElementById('previewImage');
	const video = document.getElementById('previewVideo');
	const name = document.getElementById('previewName');

	// Determine if video based on parameter or filename
	const showVideo = isVideo || isVideoFile(filename);

	// Build preview URL with owner ID
	const previewUrl = getFlyerPreviewUrl({ filename, ownerId });

	if (showVideo) {
		image.classList.add('hidden');
		video.classList.remove('hidden');
		video.src = previewUrl;
		video.play();
	} else {
		video.classList.add('hidden');
		video.pause();
		video.src = '';
		image.classList.remove('hidden');
		image.src = previewUrl;
	}

	name.textContent = filename;
	modal.classList.remove('hidden');
}

// Close preview modal
function closePreviewModal() {
	const video = document.getElementById('previewVideo');
	video.pause();
	video.src = '';
	document.getElementById('previewModal').classList.add('hidden');
}

// Show delete confirmation modal
function showDeleteModal(filename, ownerId = null) {
	deleteTarget = filename;
	deleteTargetOwner = ownerId;
	document.getElementById('deleteFileName').textContent = filename;
	document.getElementById('deleteModal').classList.remove('hidden');
}

// Close delete modal
function closeDeleteModal() {
	deleteTarget = null;
	deleteTargetOwner = null;
	document.getElementById('deleteModal').classList.add('hidden');
}

// Confirm delete
async function confirmDelete() {
	FrontendDebug.action('Flyers', 'Delete button clicked', { deleteTarget, deleteTargetOwner });

	if (!deleteTarget) {
		FrontendDebug.warn('Flyers', 'No deleteTarget set');
		return;
	}

	try {
		// Build delete URL with optional ownerId for superadmin
		let deleteUrl = `/api/flyers/${encodeURIComponent(deleteTarget)}`;
		if (deleteTargetOwner !== null && deleteTargetOwner !== undefined) {
			deleteUrl += `?ownerId=${deleteTargetOwner}`;
		} else if (deleteTargetOwner === null && isSuperadminView) {
			// Legacy flyer without owner
			deleteUrl += '?ownerId=legacy';
		}

		FrontendDebug.api('Flyers', 'Sending delete request', { filename: deleteTarget, ownerId: deleteTargetOwner });
		const response = await csrfFetch(deleteUrl, {
			method: 'DELETE'
		});

		const data = await response.json();
		FrontendDebug.api('Flyers', 'Delete response', { status: response.status, data });

		if (data.success) {
			showAlert(`Flyer "${deleteTarget}" deleted`, 'success');
			closeDeleteModal();
			await loadFlyers();
		} else {
			showAlert(`Delete failed: ${data.error}`, 'error');
		}
	} catch (error) {
		FrontendDebug.error('Flyers', 'Delete failed', error);
		showAlert(`Delete error: ${error.message}`, 'error');
	}
}

// Set a flyer as active on the display
async function setActiveFlyer(filename) {
	if (!filename) return;

	try {
		const response = await csrfFetch('/api/flyer/update', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ flyer: filename })
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Display updated to "${filename}"`, 'success');
			currentActiveFlyer = filename;
			renderGallery();
			await refreshStatus();
		} else {
			showAlert(`Update failed: ${data.error}`, 'error');
		}
	} catch (error) {
		showAlert(`Update error: ${error.message}`, 'error');
	}
}

// Note: escapeHtml, showAlert, formatDate, formatFileSize are now in utils.js

// Export functions
window.loadFlyers = loadFlyers;
window.previewFlyer = previewFlyer;
window.closePreviewModal = closePreviewModal;
window.showDeleteModal = showDeleteModal;
window.closeDeleteModal = closeDeleteModal;
window.confirmDelete = confirmDelete;
window.setActiveFlyer = setActiveFlyer;

// Cleanup all intervals on page unload to prevent memory leaks
window.addEventListener('beforeunload', () => {
	if (statusRefreshInterval) clearInterval(statusRefreshInterval);
});
