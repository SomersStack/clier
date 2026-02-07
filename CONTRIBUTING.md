# Contributing to Clier

Thank you for your interest in contributing to Clier! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- PM2 (installed globally: `npm install -g pm2`)
- Git

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/yourusername/clier.git
   cd clier
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Run tests:
   ```bash
   npm test
   ```

## Development Workflow

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:ui

# Run specific test file
npm test -- tests/unit/core/orchestrator.test.ts

# Run with coverage
npm test -- --coverage
```

### Type Checking

```bash
npm run typecheck
```

### Linting and Formatting

```bash
# Check linting
npm run lint

# Check formatting
npm run format:check

# Fix formatting
npm run format
```

### Building

```bash
npm run build
```

## Project Structure

```
clier/
├── src/
│   ├── core/           # Core orchestration components
│   ├── config/         # Configuration schema and loader
│   ├── cli/            # CLI commands
│   ├── safety/         # Safety mechanisms (circuit breaker, rate limiter)
│   └── utils/          # Utilities (logger, etc.)
├── tests/
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   ├── e2e/            # End-to-end tests
│   ├── performance/    # Performance tests
│   └── platform/       # Platform-specific tests
├── examples/           # Example configurations
└── docs/               # Documentation
```

## Contribution Guidelines

### Code Style

- Use TypeScript with strict type checking
- Follow the existing code style
- Use ESLint and Prettier (configured in the project)
- Write JSDoc comments for public APIs
- Use meaningful variable and function names

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `test:` for test changes
- `refactor:` for code refactoring
- `perf:` for performance improvements
- `chore:` for maintenance tasks

Examples:
```
feat: add memory monitoring command
fix: handle PM2 reconnection errors
docs: update CLI usage guide
test: add performance tests for pattern matching
```

### Pull Requests

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. Make your changes with clear, logical commits

3. Add tests for new functionality

4. Ensure all tests pass:
   ```bash
   npm test
   npm run typecheck
   npm run lint
   ```

5. Update documentation if needed

6. Push to your fork and create a pull request

7. Provide a clear description of:
   - What the change does
   - Why it's needed
   - How to test it
   - Any breaking changes

### Testing Requirements

- All new features must include tests
- Aim for high test coverage (>80%)
- Include unit tests for isolated functionality
- Add integration tests for component interactions
- Consider edge cases and error conditions

### Documentation

- Update README.md if adding user-facing features
- Add JSDoc comments to all public APIs
- Update CLI.md for CLI changes
- Create examples for new features
- Update CHANGELOG.md

## Areas for Contribution

We welcome contributions in these areas:

### Features
- New CLI commands
- Additional safety mechanisms
- Enhanced logging capabilities
- Performance optimizations
- Platform-specific improvements

### Testing
- Increase test coverage
- Add edge case tests
- Performance benchmarks
- Platform compatibility tests

### Documentation
- Improve existing docs
- Add tutorials and guides
- Create video demonstrations
- Translate documentation

### Bug Fixes
- Check the issue tracker for reported bugs
- Reproduce and fix issues
- Add regression tests

## Performance Considerations

When contributing, keep these performance requirements in mind:

- Event processing: 100+ events/second
- Pattern matching: < 1ms per line
- Event loop lag: < 30ms average
- Memory usage: < 100MB for typical workloads
- No memory leaks

Add performance tests if your changes affect performance.

## Platform Compatibility

Clier supports:
- macOS (darwin)
- Linux
- Windows (win32)

Test on multiple platforms when possible. Add platform-specific tests if needed.

## Questions?

If you have questions:
- Check existing documentation
- Search existing issues
- Open a new issue with the `question` label

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to Clier!
