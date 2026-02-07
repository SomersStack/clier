/**
 * Data Generator
 * Emits events every 2 seconds with generated data
 */

let counter = 0;

function generateData() {
  counter++;
  const data = {
    id: counter,
    value: Math.random() * 100,
    timestamp: Date.now(),
  };

  // This output will match the pattern and emit "data:generated" event
  console.log(`Generated data: ${JSON.stringify(data)}`);

  // Stop after 5 iterations
  if (counter >= 5) {
    console.log("Generator finished");
    process.exit(0);
  }
}

// Generate data every 2 seconds
console.log("Data generator started");
setInterval(generateData, 2000);
