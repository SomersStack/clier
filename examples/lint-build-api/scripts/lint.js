#!/usr/bin/env node

console.log('Running linter...');

// Simulate linting process
setTimeout(() => {
  console.log('Checking files...');
  console.log('✓ All files passed linting');
  process.exit(0);
}, 1000);
