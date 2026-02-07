/**
 * Pattern Matcher for log output
 *
 * Applies regex patterns to log output and returns all matching event names.
 * Supports multiple patterns per process and emits ALL matching events.
 */

/**
 * Pattern entry stored internally
 */
interface PatternEntry {
  /** Pattern name (e.g., process name) */
  name: string;
  /** Regex pattern to match */
  pattern: RegExp;
  /** Event name to emit when pattern matches */
  emit: string;
}

/**
 * PatternMatcher class
 *
 * Manages regex pattern matching for log output and emits events
 * when patterns match.
 *
 * @example
 * ```ts
 * const matcher = new PatternMatcher();
 * matcher.addPattern('backend', /Server listening/, 'backend:ready');
 * matcher.addPattern('backend', /Database connected/, 'backend:db-connected');
 *
 * const events = matcher.match('Server listening on port 3000');
 * // Returns: ['backend:ready']
 * ```
 */
export class PatternMatcher {
  private patterns: PatternEntry[] = [];

  /**
   * Add a pattern to match against
   *
   * @param name - Pattern name (typically the process name)
   * @param pattern - Regular expression to match
   * @param emit - Event name to emit when pattern matches
   *
   * @example
   * ```ts
   * matcher.addPattern('backend', /Server ready/, 'backend:ready');
   * ```
   */
  addPattern(name: string, pattern: RegExp, emit: string): void {
    this.patterns.push({ name, pattern, emit });
  }

  /**
   * Match text against all registered patterns
   *
   * Returns an array of event names for ALL patterns that match.
   * Each event name is included only once even if the pattern matches
   * multiple times in the text.
   *
   * @param text - Text to match against patterns
   * @returns Array of event names to emit
   *
   * @example
   * ```ts
   * const events = matcher.match('Server listening on port 3000');
   * // Returns: ['backend:ready'] if pattern matches
   * ```
   */
  match(text: string): string[] {
    if (!text) {
      return [];
    }

    const matchedEvents = new Set<string>();

    for (const { pattern, emit } of this.patterns) {
      if (pattern.test(text)) {
        matchedEvents.add(emit);
      }
    }

    return Array.from(matchedEvents);
  }

  /**
   * Remove all patterns for a given name
   *
   * @param name - Pattern name to remove
   *
   * @example
   * ```ts
   * matcher.removePatterns('backend');
   * ```
   */
  removePatterns(name: string): void {
    this.patterns = this.patterns.filter((p) => p.name !== name);
  }

  /**
   * Clear all patterns
   *
   * @example
   * ```ts
   * matcher.clear();
   * ```
   */
  clear(): void {
    this.patterns = [];
  }

  /**
   * Get the total number of patterns registered
   *
   * @returns Number of patterns
   *
   * @example
   * ```ts
   * const count = matcher.getPatternCount();
   * ```
   */
  getPatternCount(): number {
    return this.patterns.length;
  }
}
