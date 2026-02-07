#!/usr/bin/env node

console.log('='.repeat(60));
console.log('CIRCUIT BREAKER ALERT');
console.log('='.repeat(60));
console.log('A process has crashed too many times!');
console.log('The circuit breaker has been triggered.');
console.log('');
console.log('This would normally send a webhook/email/Slack notification.');
console.log('='.repeat(60));

// In a real scenario, you would send a webhook here:
// await fetch('https://hooks.slack.com/...', {
//   method: 'POST',
//   body: JSON.stringify({ text: 'Circuit breaker triggered!' })
// });

process.exit(0);
