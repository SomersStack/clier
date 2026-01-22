#!/usr/bin/env node

console.log('Circuit Breaker Monitor started');
console.log('This process was triggered by the circuit breaker event');
console.log('Monitoring for system recovery...');

let count = 0;
setInterval(() => {
  count++;
  console.log(`[Monitor ${count}] System is in degraded state - circuit breaker is open`);
}, 3000);
