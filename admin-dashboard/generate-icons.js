#!/usr/bin/env node
/**
 * Generate PWA icons from SVG
 *
 * Usage: node generate-icons.js
 *
 * Requires: npm install sharp
 */

const fs = require('fs');
const path = require('path');

// Check for sharp
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('Sharp not installed. Installing...');
  const { execSync } = require('child_process');
  execSync('npm install sharp', { stdio: 'inherit' });
  sharp = require('sharp');
}

const ICONS_DIR = path.join(__dirname, 'public', 'icons');
const SVG_PATH = path.join(ICONS_DIR, 'icon.svg');

// Icon sizes for PWA
const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

// Maskable icon padding (adds safe zone)
const MASKABLE_SIZES = [192, 512];

async function generateIcons() {
  console.log('Generating PWA icons...');

  // Ensure icons directory exists
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  // Read SVG
  const svgBuffer = fs.readFileSync(SVG_PATH);

  // Generate standard icons
  for (const size of SIZES) {
    const outputPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`  Created: icon-${size}.png`);
  }

  // Generate maskable icons (with padding for safe zone)
  for (const size of MASKABLE_SIZES) {
    const outputPath = path.join(ICONS_DIR, `icon-maskable-${size}.png`);
    // Maskable icons need content in the center 80% (safe zone)
    const innerSize = Math.floor(size * 0.8);
    const padding = Math.floor((size - innerSize) / 2);

    await sharp(svgBuffer)
      .resize(innerSize, innerSize)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 30, g: 64, b: 175, alpha: 1 } // Match gradient start color
      })
      .png()
      .toFile(outputPath);
    console.log(`  Created: icon-maskable-${size}.png`);
  }

  // Generate Apple Touch Icon (180x180)
  const appleTouchPath = path.join(ICONS_DIR, 'apple-touch-icon.png');
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(appleTouchPath);
  console.log('  Created: apple-touch-icon.png');

  // Generate favicon (32x32 and 16x16)
  const favicon32Path = path.join(ICONS_DIR, 'favicon-32x32.png');
  const favicon16Path = path.join(ICONS_DIR, 'favicon-16x16.png');

  await sharp(svgBuffer)
    .resize(32, 32)
    .png()
    .toFile(favicon32Path);
  console.log('  Created: favicon-32x32.png');

  await sharp(svgBuffer)
    .resize(16, 16)
    .png()
    .toFile(favicon16Path);
  console.log('  Created: favicon-16x16.png');

  console.log('\nAll icons generated successfully!');
  console.log(`Icons saved to: ${ICONS_DIR}`);
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
