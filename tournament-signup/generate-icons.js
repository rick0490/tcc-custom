const fs = require('fs');
const path = require('path');

// Simple SVG icon generator
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

const generateSVGIcon = (size) => {
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" fill="url(#grad1)" rx="${size * 0.15}"/>

  <!-- Controller icon (simplified gamepad) -->
  <g transform="translate(${size * 0.5}, ${size * 0.5})">
    <!-- Main body -->
    <rect x="${-size * 0.3}" y="${-size * 0.15}" width="${size * 0.6}" height="${size * 0.3}"
          fill="white" rx="${size * 0.05}" opacity="0.95"/>

    <!-- D-pad (left) -->
    <rect x="${-size * 0.22}" y="${-size * 0.08}" width="${size * 0.08}" height="${size * 0.04}"
          fill="#667eea" rx="${size * 0.01}"/>
    <rect x="${-size * 0.20}" y="${-size * 0.10}" width="${size * 0.04}" height="${size * 0.08}"
          fill="#667eea" rx="${size * 0.01}"/>

    <!-- Buttons (right) -->
    <circle cx="${size * 0.15}" cy="${-size * 0.06}" r="${size * 0.03}" fill="#764ba2"/>
    <circle cx="${size * 0.20}" cy="${-size * 0.01}" r="${size * 0.03}" fill="#764ba2"/>
  </g>

  <!-- Text -->
  <text x="${size * 0.5}" y="${size * 0.82}"
        font-family="Arial, sans-serif"
        font-size="${size * 0.12}"
        font-weight="bold"
        fill="white"
        text-anchor="middle">NB</text>
</svg>`;
};

const iconsDir = path.join(__dirname, 'public', 'icons');

// Create icons directory if it doesn't exist
if (!fs.existsSync(iconsDir)) {
	fs.mkdirSync(iconsDir, { recursive: true });
}

// Generate SVG icons for each size
sizes.forEach(size => {
	const svg = generateSVGIcon(size);
	const filename = `icon-${size}x${size}.svg`;
	fs.writeFileSync(path.join(iconsDir, filename), svg);
	console.log(`Generated ${filename}`);
});

console.log('\nIcon generation complete!');
console.log('Note: SVG icons will work for PWA. For better compatibility, consider converting to PNG.');
console.log('You can use an online tool or ImageMagick to convert SVG to PNG.');
console.log('Example: convert icon-512x512.svg icon-512x512.png');
