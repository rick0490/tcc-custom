// Flyer Management Page JavaScript

// State
let flyers = [];
let deleteTarget = null;
let statusRefreshInterval = null;
let currentActiveFlyer = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
	console.log('Flyer Management page loaded');

	// Initialize last updated timestamp
	initLastUpdated('flyersLastUpdated', loadFlyers, { prefix: 'Updated', thresholds: { fresh: 30, stale: 120 } });

	await loadFlyers();
	await refreshStatus();
	setupUploadForm();

	// Start polling with visibility awareness
	startPolling();
	setupVisibilityHandler(
		() => { startPolling(); },
		() => { stopPolling(); }
	);
});

function startPolling() {
	if (!statusRefreshInterval) {
		statusRefreshInterval = setInterval(refreshStatus, 15000);
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
			renderGallery();
			document.getElementById('flyerCount').textContent = `${flyers.length} flyer${flyers.length !== 1 ? 's' : ''}`;
			// Update last refreshed timestamp
			setLastUpdated('flyersLastUpdated');
		}
	} catch (error) {
		console.error('Failed to load flyers:', error);
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
		console.error('Status refresh failed:', error);
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
			<div class="flyer-image-container cursor-pointer" onclick="previewFlyer('${escapeHtml(filename)}', ${isVideo})">
				${isVideo ? `
					<div class="flex items-center justify-center h-full bg-gray-700">
						<svg class="w-16 h-16 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
						</svg>
					</div>
				` : `
					<img src="/api/flyers/preview/${encodeURIComponent(filename)}"
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
					<button onclick="event.stopPropagation(); showDeleteModal('${escapeHtml(filename)}')"
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
function previewFlyer(filename, isVideo = false) {
	const modal = document.getElementById('previewModal');
	const image = document.getElementById('previewImage');
	const video = document.getElementById('previewVideo');
	const name = document.getElementById('previewName');

	// Determine if video based on parameter or filename
	const showVideo = isVideo || isVideoFile(filename);

	if (showVideo) {
		image.classList.add('hidden');
		video.classList.remove('hidden');
		video.src = `/api/flyers/preview/${encodeURIComponent(filename)}`;
		video.play();
	} else {
		video.classList.add('hidden');
		video.pause();
		video.src = '';
		image.classList.remove('hidden');
		image.src = `/api/flyers/preview/${encodeURIComponent(filename)}`;
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
function showDeleteModal(filename) {
	deleteTarget = filename;
	document.getElementById('deleteFileName').textContent = filename;
	document.getElementById('deleteModal').classList.remove('hidden');
}

// Close delete modal
function closeDeleteModal() {
	deleteTarget = null;
	document.getElementById('deleteModal').classList.add('hidden');
}

// Confirm delete
async function confirmDelete() {
	if (!deleteTarget) return;

	try {
		const response = await csrfFetch(`/api/flyers/${encodeURIComponent(deleteTarget)}`, {
			method: 'DELETE'
		});

		const data = await response.json();

		if (data.success) {
			showAlert(`Flyer "${deleteTarget}" deleted`, 'success');
			closeDeleteModal();
			await loadFlyers();
		} else {
			showAlert(`Delete failed: ${data.error}`, 'error');
		}
	} catch (error) {
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
