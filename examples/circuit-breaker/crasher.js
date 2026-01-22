#!/usr/bin/env node

console.log('Crasher process starting...');
console.log('This process will crash repeatedly to trigger the circuit breaker');

let crashCount = 0;

const crash = () => {
  crashCount++;
  console.error(`Crash #${crashCount} - This is intentional!`);

  // Exit with error code to simulate crash
  setTimeout(() => {
    process.exit(1);
  }, 500);
};

// Crash after a short delay
setTimeout(() => {
  crash();
}, 1000);
