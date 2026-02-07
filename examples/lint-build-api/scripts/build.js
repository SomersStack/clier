#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Starting build process...');

// Create dist directory
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy server.js to dist
const srcFile = path.join(__dirname, '..', 'src', 'server.js');
const distFile = path.join(distDir, 'server.js');

setTimeout(() => {
  console.log('Compiling files...');
  fs.copyFileSync(srcFile, distFile);
  console.log('Build completed successfully');
  process.exit(0);
}, 1500);
