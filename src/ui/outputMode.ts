/**
 * Output mode configuration for terminal UI
 *
 * Controls whether to use decorative box-drawing characters or plain text.
 * Plain mode outputs clipboard-friendly text without Unicode borders.
 * Automatically enabled in CI or non-interactive shells; override with AGI_PLAIN_OUTPUT=true.
 *
 * Environment Variables:
 * - AGI_PLAIN_OUTPUT: Set to 'true', '1', 'yes', or 'on' to force plain mode
 * - CI: Automatically enables plain mode when set
 * - TERM: Checked for 'dumb' terminals which get plain mode
 * - NO_COLOR: If set, enables plain mode (respects https://no-color.org/)
 */

let _plainMode: boolean | null = null;
let _colorEnabled: boolean | null = null;

/**
 * Check if plain output mode is enabled.
 * Plain mode outputs text without box-drawing characters for clean clipboard copying.
 */
export function isPlainOutputMode(): boolean {
  if (_plainMode !== null) {
    return _plainMode;
  }

  try {
    // Check explicit environment override first
    const envValue = process.env['AGI_PLAIN_OUTPUT'];
    if (envValue !== undefined) {
      const envEnabled = ['true', '1', 'yes', 'on'].includes(envValue.toLowerCase());
      if (envEnabled) {
        _plainMode = true;
        return _plainMode;
      }
      // Also check for explicit disable
      const envDisabled = ['false', '0', 'no', 'off'].includes(envValue.toLowerCase());
      if (envDisabled) {
        _plainMode = false;
        return _plainMode;
      }
    }

    // Check for dumb terminal
    const term = process.env['TERM'];
    if (term === 'dumb') {
      _plainMode = true;
      return _plainMode;
    }

    // Check for CI environments
    const isCi = Boolean(
      process.env['CI'] ||
      process.env['GITHUB_ACTIONS'] ||
      process.env['GITLAB_CI'] ||
      process.env['CIRCLECI'] ||
      process.env['TRAVIS'] ||
      process.env['JENKINS_URL']
    );

    // Check TTY status safely
    const isTty = Boolean(
      process.stdout?.isTTY &&
      process.stdin?.isTTY
    );

    // Default to plain logging in non-interactive/CI environments; rich UI only in TTY sessions.
    _plainMode = !isTty || isCi;
  } catch {
    // If anything fails, default to plain mode for safety
    _plainMode = true;
  }

  return _plainMode;
}

/**
 * Check if color output is enabled.
 * Respects NO_COLOR environment variable (https://no-color.org/)
 */
export function isColorEnabled(): boolean {
  if (_colorEnabled !== null) {
    return _colorEnabled;
  }

  try {
    // NO_COLOR takes precedence (https://no-color.org/)
    if (process.env['NO_COLOR'] !== undefined) {
      _colorEnabled = false;
      return _colorEnabled;
    }

    // FORCE_COLOR enables colors
    if (process.env['FORCE_COLOR'] !== undefined) {
      _colorEnabled = true;
      return _colorEnabled;
    }

    // Color enabled in TTY by default
    _colorEnabled = Boolean(process.stdout?.isTTY);
  } catch {
    _colorEnabled = false;
  }

  return _colorEnabled;
}

/**
 * Override the plain output mode setting (useful for testing)
 */
export function setPlainOutputMode(enabled: boolean): void {
  _plainMode = enabled;
}

/**
 * Override the color output mode setting (useful for testing)
 */
export function setColorEnabled(enabled: boolean): void {
  _colorEnabled = enabled;
}

/**
 * Reset plain output mode to check environment variable again
 */
export function resetPlainOutputMode(): void {
  _plainMode = null;
}

/**
 * Reset color mode to check environment variable again
 */
export function resetColorEnabled(): void {
  _colorEnabled = null;
}

/**
 * Reset all output mode settings
 */
export function resetOutputModes(): void {
  _plainMode = null;
  _colorEnabled = null;
}
