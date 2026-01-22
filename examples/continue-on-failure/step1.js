#!/usr/bin/env node

const shouldFail = process.argv.includes('fail');

console.log('Step 1: Running with continue_on_failure=false (strict mode)');

setTimeout(() => {
  if (shouldFail) {
    console.log('FAILURE - Step 1 failed!');
    console.error('Error: Something went wrong in step 1');
    process.exit(1);
  } else {
    console.log('SUCCESS - Step 1 completed');
    process.exit(0);
  }
}, 1000);
