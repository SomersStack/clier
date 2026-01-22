#!/usr/bin/env node

const shouldFail = process.argv.includes('fail');

console.log('Step 3: Running with continue_on_failure=true (lenient mode)');

setTimeout(() => {
  if (shouldFail) {
    console.log('FAILURE - Step 3 failed, but pipeline continues!');
    console.error('Error: Step 3 encountered an issue');
    process.exit(1);
  } else {
    console.log('SUCCESS - Step 3 completed');
    process.exit(0);
  }
}, 1000);
