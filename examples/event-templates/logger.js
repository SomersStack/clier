/**
 * Event Logger
 * Logs all event template variables from environment
 */

// Access all event template variables from environment
const eventSource = process.env.EVENT_SOURCE;
const eventName = process.env.EVENT_NAME;
const eventType = process.env.EVENT_TYPE;
const eventTimestamp = process.env.EVENT_TIMESTAMP;
const processName = process.env.PROCESS_NAME;
const processType = process.env.PROCESS_TYPE;
const projectName = process.env.PROJECT_NAME;
const currentTimestamp = process.env.CURRENT_TIMESTAMP;

console.log("=".repeat(60));
console.log("EVENT LOGGER - All Template Variables");
console.log("=".repeat(60));
console.log("");
console.log("Event Metadata:");
console.log(`  event.source      = ${eventSource}`);
console.log(`  event.name        = ${eventName}`);
console.log(`  event.type        = ${eventType}`);
console.log(`  event.timestamp   = ${eventTimestamp}`);
console.log("");
console.log("Process Metadata:");
console.log(`  process.name      = ${processName}`);
console.log(`  process.type      = ${processType}`);
console.log("");
console.log("Clier Metadata:");
console.log(`  clier.project     = ${projectName}`);
console.log(`  clier.timestamp   = ${currentTimestamp}`);
console.log("");
console.log("Timestamp Difference:");
const diff = parseInt(currentTimestamp || "0") - parseInt(eventTimestamp || "0");
console.log(`  Time since event  = ${diff}ms`);
console.log("=".repeat(60));
