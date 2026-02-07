#!/usr/bin/env node
/**
 * Benchmark Script
 *
 * Runs all performance tests and generates a report.
 * Compares results against baseline requirements.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface BenchmarkResult {
  name: string;
  status: 'pass' | 'fail';
  details: string;
}

const results: BenchmarkResult[] = [];

async function runBenchmarks() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           CLIER PERFORMANCE BENCHMARK SUITE               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();

  // Run event processing tests
  console.log('Running Event Processing Tests...');
  try {
    const { stdout } = await execAsync(
      'npm run test:run -- tests/performance/event-processing.test.ts'
    );
    results.push({
      name: 'Event Processing',
      status: 'pass',
      details: 'All event processing tests passed',
    });
    console.log('✓ Event Processing: PASS\n');
  } catch (error) {
    results.push({
      name: 'Event Processing',
      status: 'fail',
      details: error instanceof Error ? error.message : String(error),
    });
    console.log('✗ Event Processing: FAIL\n');
  }

  // Run pattern matching tests
  console.log('Running Pattern Matching Tests...');
  try {
    await execAsync('npm run test:run -- tests/performance/pattern-matching.test.ts');
    results.push({
      name: 'Pattern Matching',
      status: 'pass',
      details: 'All pattern matching tests passed',
    });
    console.log('✓ Pattern Matching: PASS\n');
  } catch (error) {
    results.push({
      name: 'Pattern Matching',
      status: 'fail',
      details: error instanceof Error ? error.message : String(error),
    });
    console.log('✗ Pattern Matching: FAIL\n');
  }

  // Run circuit breaker tests
  console.log('Running Circuit Breaker Tests...');
  try {
    await execAsync('npm run test:run -- tests/performance/circuit-breaker.test.ts');
    results.push({
      name: 'Circuit Breaker',
      status: 'pass',
      details: 'All circuit breaker tests passed',
    });
    console.log('✓ Circuit Breaker: PASS\n');
  } catch (error) {
    results.push({
      name: 'Circuit Breaker',
      status: 'fail',
      details: error instanceof Error ? error.message : String(error),
    });
    console.log('✗ Circuit Breaker: FAIL\n');
  }

  // Run memory leak tests
  console.log('Running Memory Leak Tests...');
  try {
    await execAsync('npm run test:run -- tests/performance/memory-leaks.test.ts', { maxBuffer: 10 * 1024 * 1024 });
    results.push({
      name: 'Memory Leaks',
      status: 'pass',
      details: 'No memory leaks detected',
    });
    console.log('✓ Memory Leaks: PASS\n');
  } catch (error) {
    results.push({
      name: 'Memory Leaks',
      status: 'fail',
      details: error instanceof Error ? error.message : String(error),
    });
    console.log('✗ Memory Leaks: FAIL\n');
  }

  // Generate report
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                     BENCHMARK REPORT                      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const total = results.length;

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log();

  if (failed > 0) {
    console.log('Failed Tests:');
    results
      .filter((r) => r.status === 'fail')
      .forEach((r) => {
        console.log(`  ✗ ${r.name}`);
        console.log(`    ${r.details}`);
      });
    console.log();
  }

  // Performance baseline requirements
  console.log('Performance Baseline Requirements:');
  console.log('  • Event Processing: 100+ events/second');
  console.log('  • Event Loop Lag: < 30ms average');
  console.log('  • Memory Usage: < 100MB for watcher + 10 processes');
  console.log('  • Pattern Matching: < 1ms per line for 10 patterns');
  console.log('  • Circuit Breaker Overhead: < 1ms per operation');
  console.log();

  // Exit with appropriate code
  if (failed > 0) {
    console.log('❌ Benchmark FAILED - Some performance requirements not met');
    process.exit(1);
  } else {
    console.log('✅ Benchmark PASSED - All performance requirements met');
    process.exit(0);
  }
}

// Run benchmarks
runBenchmarks().catch((error) => {
  console.error('Error running benchmarks:', error);
  process.exit(1);
});
