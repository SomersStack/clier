#!/usr/bin/env node

console.log('Starting analysis...');

const messages = [
  '[INFO] Initializing system',
  '[INFO] Loading configuration',
  '[WARN] Cache miss - will fetch from source',
  '[INFO] Processing data batch 1/3',
  '[ERROR] Connection timeout on retry 1',
  '[WARN] Falling back to secondary endpoint',
  '[INFO] Processing data batch 2/3',
  '[INFO] Processing data batch 3/3',
  '[INFO] Finalizing results',
  'Analysis complete'
];

let index = 0;

const interval = setInterval(() => {
  if (index >= messages.length) {
    clearInterval(interval);
    process.exit(0);
    return;
  }

  console.log(messages[index]);
  index++;
}, 800);
