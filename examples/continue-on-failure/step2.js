#!/usr/bin/env node

console.log('Step 2: This will NOT run because step1 failed (strict mode)');
console.log('Step 2: Would have done important work here...');
process.exit(0);
