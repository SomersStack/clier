#!/usr/bin/env node

const level = process.argv[2] || 'info';

console.log(`=== ${level.toUpperCase()} Logger Triggered ===`);
console.log(`Received a ${level} level log event`);
console.log(`Writing to ${level}.log file...`);
console.log(`Done!`);

process.exit(0);
