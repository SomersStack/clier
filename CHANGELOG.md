# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `clier restart` - Full daemon restart with new PID (for when daemon itself is misbehaving)
- `clier status --watch` - Watch mode for live status updates with configurable refresh interval
- `clier reload --restart-manual` - Option to restart manually-started services during reload
- `clier input <process> <data>` - Send stdin input to running processes
- Alternate screen buffer for `status --watch` mode (cleaner terminal output)

### Fixed
- ESM `require()` error in watcher causing `clier reload` to fail with "require is not defined"
- Updated `clier reload` description to clarify it keeps same daemon PID but restarts all processes

### Changed
- Improved documentation explaining difference between `reload` (fast, same daemon PID) vs `restart` (thorough, new daemon PID)

## [0.1.0] - 2024-01-21

### Added

#### Core Features
- Event-driven process orchestration framework built on PM2
- Configuration schema with Zod validation
- Pipeline orchestrator for managing process dependencies
- Pattern matcher for log-based event detection
- Event bus for PM2 integration with automatic reconnection
- Process manager with PM2 abstraction layer

#### Safety Features
- Circuit breaker for failure detection and recovery
- Rate limiter using Bottleneck
- Debouncer for event throttling
- Comprehensive error handling across all modules
- Automatic PM2 reconnection with exponential backoff

#### CLI Tool
- `clier start` - Start pipeline from configuration
- `clier stop` - Stop all processes gracefully
- `clier status` - View process status
- `clier logs` - Stream process logs
- `clier reload` - Reload configuration
- `clier validate` - Validate configuration file

#### Logging
- Structured logging with Winston
- File logging with rotation (10MB max, 5 files)
- Context-aware loggers for different modules
- Separate error.log for error-level logs
- Configurable log levels via LOG_LEVEL environment variable

#### Testing
- 250+ unit tests covering all core modules
- Integration tests for CLI commands
- E2E tests for full pipeline scenarios
- Performance tests for throughput and latency
- Memory leak detection tests
- Platform-specific tests (macOS, Linux, Windows)

#### Documentation
- Comprehensive README with examples
- API documentation with JSDoc
- CLI usage guide
- Architecture documentation
- Example scenarios (lint-build-api, data-pipeline, multi-stage-build)

#### Performance
- Event processing: 100+ events/second
- Pattern matching: < 1ms per line for 10 patterns
- Event loop lag: < 30ms average
- Memory efficient: < 100MB for typical workloads
- Circuit breaker overhead: < 1ms per operation

### Technical Details
- TypeScript with full type safety
- ES modules (type: "module")
- Node.js 18+ required
- PM2 5.x integration
- Vitest for testing
- ESLint + Prettier for code quality

### Initial Release
This is the initial release of Clier, providing a solid foundation for PM2-based
process orchestration with event-driven pipelines.

[0.1.0]: https://github.com/yourusername/clier/releases/tag/v0.1.0
