/**
 * Data Processor
 * Processes data with event metadata from command-line arguments
 */

// Parse command-line arguments
const args = process.argv.slice(2);
const source = args.find((arg) => arg.startsWith("--source="))?.split("=")[1];
const event = args.find((arg) => arg.startsWith("--event="))?.split("=")[1];
const timestamp = args.find((arg) => arg.startsWith("--timestamp="))?.split("=")[1];

// Access environment variables with event metadata
const triggerSource = process.env.TRIGGER_SOURCE;
const triggerEvent = process.env.TRIGGER_EVENT;
const processorName = process.env.PROCESSOR_NAME;
const projectName = process.env.PROJECT_NAME;

console.log("Processor started with event templates:");
console.log(`  Command Args:`);
console.log(`    --source=${source}`);
console.log(`    --event=${event}`);
console.log(`    --timestamp=${timestamp}`);
console.log(`  Environment Variables:`);
console.log(`    TRIGGER_SOURCE=${triggerSource}`);
console.log(`    TRIGGER_EVENT=${triggerEvent}`);
console.log(`    PROCESSOR_NAME=${processorName}`);
console.log(`    PROJECT_NAME=${projectName}`);

// Simulate processing
console.log(`Processing data triggered by ${source}...`);
console.log("Processing complete!");
