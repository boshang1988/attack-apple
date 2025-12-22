import chalk from 'chalk';
import gradientString from 'gradient-string';

// Type for gradient function returned by gradientString
type GradientFunction = (text: string) => string;

/**
 * Theme system with advanced graphics for the AGI CLI
 * Enhanced with neon effects, dynamic gradients, and rich visual styling
 */

// Advanced color utilities


// Create a neon glow effect with bright colors
const createNeonStyle = (baseColor: string, glowColor?: string) => {
  const glow = glowColor || baseColor;
  return {
    text: chalk.hex(baseColor).bold,
    bright: chalk.hex(glow).bold,
    dim: chalk.hex(baseColor),
    bg: chalk.bgHex(baseColor).hex('#FFFFFF'),
  };
};

// Enhanced color palette with modern gradients and vibrancy
export const palette = {
  // Premium core colors (enhanced vibrancy)
  indigo: '#4F46E5',
  purple: '#7C3AED',
  violet: '#8B5CF6',
  pink: '#DB2777',
  rose: '#F472B6',
  fuchsia: '#C026D3',

  // Hyper-neon variants (brighter, more vibrant)
  neonBlue: '#00F7FF',
  neonPurple: '#CC00FF',
  neonPink: '#FF00CC',
  neonGreen: '#00FFAA',
  neonCyan: '#00FFFF',
  neonYellow: '#FFEE00',
  neonOrange: '#FF5500',
  neonMagenta: '#FF00FF',
  
  // Offensive security colors (enhanced intensity)
  attackRed: '#FF0022',
  exploitOrange: '#FF4400',
  persistencePurple: '#CC00FF',
  c2Green: '#00FF88',
  reconBlue: '#0088FF',
  destructionCrimson: '#FF0000',

  // Premium status colors
  emerald: '#00D68F',
  teal: '#00C7B3',
  cyan: '#00D4FF',
  sky: '#0095FF',
  blue: '#3D8BFF',
  amber: '#FFB224',
  orange: '#FF6B35',
  red: '#FF4757',

  // Modern neutrals with depth
  slate50: '#F8FAFF',
  slate100: '#F1F5FF',
  slate200: '#E2E8FF',
  slate300: '#CBD5FF',
  slate400: '#94A3FF',
  slate500: '#6474FF',
  slate600: '#4756FF',
  slate700: '#3341FF',
  slate800: '#1E29FF',
  slate900: '#0F17FF',

  // Metallic accents
  gold: '#FFD700',
  silver: '#C0C0C0',
  bronze: '#CD7F32',
  platinum: '#E5E4E2',
};

// Premium neon effect styles with enhanced glow
export const neon = {
  blue: createNeonStyle(palette.neonBlue, '#00F7FF'),
  purple: createNeonStyle(palette.neonPurple, '#CC00FF'),
  pink: createNeonStyle(palette.neonPink, '#FF00CC'),
  green: createNeonStyle(palette.neonGreen, '#00FFAA'),
  cyan: createNeonStyle(palette.neonCyan, '#00FFFF'),
  yellow: createNeonStyle(palette.neonYellow, '#FFEE00'),
  orange: createNeonStyle(palette.neonOrange, '#FF5500'),
  magenta: createNeonStyle(palette.neonMagenta, '#FF00FF'),
  // Premium holographic effects
  hologram: createNeonStyle('#00FFFF', '#FF00FF'),
  laser: createNeonStyle('#00FF00', '#FF0000'),
  plasma: createNeonStyle('#FF5500', '#00AAFF'),
};

export const theme = {
  // Premium primary colors
  primary: chalk.hex(palette.indigo).bold, // Indigo
  secondary: chalk.hex(palette.purple).bold, // Purple
  accent: chalk.hex(palette.pink).bold, // Pink
  success: chalk.hex(palette.emerald).bold, // Green
  warning: chalk.hex(palette.amber).bold, // Amber
  error: chalk.hex(palette.red).bold, // Red
  info: chalk.hex(palette.blue).bold, // Blue

  // Enhanced text styles
  dim: chalk.dim,
  bold: chalk.bold,
  italic: chalk.italic,
  underline: chalk.underline,
  inverse: chalk.inverse,
  strikethrough: chalk.strikethrough,

  // Premium UI components
  user: chalk.hex(palette.neonCyan).bold,
  assistant: chalk.hex(palette.neonPurple).bold,
  system: chalk.hex(palette.neonGreen).bold,
  highlight: chalk.bgHex(palette.slate900).hex(palette.neonCyan).bold,

  // Premium gradients with enhanced vibrancy and smooth transitions
  gradient: {
    primary: gradientString([palette.neonBlue, palette.neonPurple, palette.neonPink]) as GradientFunction,
    pro: gradientString([palette.gold, palette.neonCyan, palette.neonMagenta]) as GradientFunction,
    cyber: gradientString([palette.neonGreen, palette.neonCyan, palette.neonBlue, palette.neonPurple]) as GradientFunction,
    cool: gradientString([palette.cyan, palette.sky, palette.blue, palette.indigo]) as GradientFunction,
    warm: gradientString([palette.amber, palette.orange, palette.pink, palette.red]) as GradientFunction,
    success: gradientString([palette.neonGreen, palette.emerald, palette.teal]) as GradientFunction,
    // Premium neon gradients
    neon: gradientString([palette.neonCyan, palette.neonBlue, palette.neonPurple, palette.neonPink, palette.neonMagenta]) as GradientFunction,
    fire: gradientString([palette.attackRed, palette.destructionCrimson, palette.exploitOrange, palette.neonOrange, palette.neonYellow]) as GradientFunction,
    ocean: gradientString([palette.neonCyan, palette.cyan, palette.sky, palette.blue, palette.indigo]) as GradientFunction,
    sunset: gradientString([palette.neonPurple, palette.purple, palette.pink, palette.rose, palette.amber]) as GradientFunction,
    // Elite security gradients
    offensive: gradientString([palette.attackRed, palette.destructionCrimson, palette.exploitOrange, palette.neonOrange]) as GradientFunction,
    defensive: gradientString([palette.neonGreen, palette.c2Green, palette.reconBlue, palette.sky]) as GradientFunction,
    stealth: gradientString([palette.silver, palette.platinum, palette.slate400, palette.slate600]) as GradientFunction,
    // Metallic gradients
    gold: gradientString([palette.gold, '#FFEC8B', '#FFFACD']) as GradientFunction,
    silver: gradientString([palette.silver, '#E6E8FA', '#F0F8FF']) as GradientFunction,
    platinum: gradientString([palette.platinum, '#E8E8E8', '#F5F5F5']) as GradientFunction,
  } as Record<string, GradientFunction>,

  // Neon text styles for special effects
  neon: {
    blue: chalk.hex(palette.neonBlue).bold,
    purple: chalk.hex(palette.neonPurple).bold,
    pink: chalk.hex(palette.neonPink).bold,
    green: chalk.hex(palette.neonGreen).bold,
    cyan: chalk.hex(palette.neonCyan).bold,
    yellow: chalk.hex(palette.neonYellow).bold,
    orange: chalk.hex(palette.neonOrange).bold,
  },

  ui: {
    border: chalk.hex('#4B5563'),
    background: chalk.bgHex('#1F2937'),
    userPromptBackground: chalk.bgHex('#4C1D95'),
    muted: chalk.hex('#9CA3AF'),
    text: chalk.hex('#F3F4F6'),
    highlight: chalk.hex('#FCD34D').bold, // Important text
    emphasis: chalk.hex('#F472B6').bold, // Emphasized text
    code: chalk.hex('#A78BFA'), // Inline code
    number: chalk.hex('#60A5FA'), // Numbers
    string: chalk.hex('#34D399'), // Strings
    keyword: chalk.hex('#F472B6'), // Keywords
    operator: chalk.hex('#9CA3AF'), // Operators
  },

  metrics: {
    elapsedLabel: chalk.hex('#FBBF24').bold,
    elapsedValue: chalk.hex('#F472B6'),
  },

  fields: {
    label: chalk.hex('#FCD34D').bold,
    agent: chalk.hex('#F472B6'),
    profile: chalk.hex('#C084FC'),
    model: chalk.hex('#A855F7'),
    workspace: chalk.hex('#38BDF8'),
  },

  link: {
    label: chalk.hex('#F472B6').underline,
    url: chalk.hex('#38BDF8'),
  },

  diff: {
    header: chalk.hex('#FBBF24'),
    hunk: chalk.hex('#60A5FA'),
    added: chalk.hex('#10B981'),
    removed: chalk.hex('#EF4444'),
    meta: chalk.hex('#9CA3AF'),
  },

  // Thinking/reasoning block styling - distinct from regular output
  thinking: {
    icon: chalk.hex('#06B6D4'),        // Cyan for the 💭 icon
    text: chalk.hex('#67E8F9'),        // Light cyan for thinking content
    border: chalk.hex('#0E7490'),      // Darker cyan for borders
    label: chalk.hex('#22D3EE').bold,  // Bright cyan for "Thinking" label
  },

  // Badge styles for compact status indicators
  badge: {
    success: chalk.bgHex('#10B981').hex('#000000'),     // Green bg, dark text
    error: chalk.bgHex('#EF4444').hex('#FFFFFF'),       // Red bg, white text
    warning: chalk.bgHex('#F59E0B').hex('#000000'),     // Amber bg, dark text
    info: chalk.bgHex('#3B82F6').hex('#FFFFFF'),        // Blue bg, white text
    muted: chalk.bgHex('#4B5563').hex('#F3F4F6'),       // Gray bg, light text
    primary: chalk.bgHex('#6366F1').hex('#FFFFFF'),     // Indigo bg, white text
    accent: chalk.bgHex('#EC4899').hex('#FFFFFF'),      // Pink bg, white text
    cached: chalk.bgHex('#8B5CF6').hex('#FFFFFF'),      // Purple bg, white text
  },

  // Inline badge styles (lighter, no background)
  inlineBadge: {
    success: chalk.hex('#34D399'),    // Light green
    error: chalk.hex('#F87171'),      // Light red
    warning: chalk.hex('#FBBF24'),    // Light amber
    info: chalk.hex('#60A5FA'),       // Light blue
    muted: chalk.hex('#9CA3AF'),      // Gray
    primary: chalk.hex('#818CF8'),    // Light indigo
    accent: chalk.hex('#F472B6'),     // Light pink
  },

  // Progress indicators
  progress: {
    bar: chalk.hex('#6366F1'),         // Progress bar fill
    empty: chalk.hex('#374151'),       // Progress bar empty
    text: chalk.hex('#D1D5DB'),        // Progress text
    percentage: chalk.hex('#F59E0B'),  // Percentage number
  },

  // Status line styles
  status: {
    active: chalk.hex('#10B981'),      // Active/running status
    pending: chalk.hex('#6B7280'),     // Pending/waiting status
    completed: chalk.hex('#9CA3AF'),   // Completed status
    separator: chalk.hex('#4B5563'),   // Status separator
  },

  // File operation styles
  file: {
    path: chalk.hex('#38BDF8'),        // File paths
    additions: chalk.hex('#10B981'),   // +X additions
    removals: chalk.hex('#EF4444'),    // -X removals
    unchanged: chalk.hex('#6B7280'),   // Unchanged indicator
  },

  // Enhanced edit display styles
  edit: {
    header: chalk.hex('#FCD34D').bold,           // Edit header
    filePath: chalk.hex('#38BDF8').bold,         // File being edited
    lineNumber: chalk.hex('#6B7280'),            // Line numbers
    addedLine: chalk.hex('#10B981'),             // Added lines (green)
    addedBg: chalk.bgHex('#052e16').hex('#4ade80'),  // Added line background
    removedLine: chalk.hex('#EF4444'),           // Removed lines (red)
    removedBg: chalk.bgHex('#450a0a').hex('#f87171'), // Removed line background
    contextLine: chalk.hex('#9CA3AF'),           // Context lines
    separator: chalk.hex('#4B5563'),             // Separators
    summary: chalk.hex('#A78BFA'),               // Summary text
    badge: chalk.bgHex('#6366F1').hex('#FFFFFF').bold, // Edit badge
  },

  // Search result styles
  search: {
    match: chalk.hex('#FCD34D').bold,  // Matching text highlight
    context: chalk.hex('#9CA3AF'),     // Context lines
    lineNum: chalk.hex('#6B7280'),     // Line numbers
    filename: chalk.hex('#38BDF8'),    // File names in results
  },

  // Agent/task styles
  agent: {
    name: chalk.hex('#EC4899'),        // Agent name
    task: chalk.hex('#8B5CF6'),        // Task description
    result: chalk.hex('#10B981'),      // Task result
    duration: chalk.hex('#F59E0B'),    // Task duration
  },



  // Tool-specific colors for different categories
  toolColors: {
    // Bash/Execute - Orange/Amber for shell commands
    bash: chalk.hex('#F97316'),
    execute: chalk.hex('#F97316'),

    // Read/File operations - Cyan/Sky blue
    read: chalk.hex('#06B6D4'),
    file: chalk.hex('#38BDF8'),

    // Write/Edit - Green/Emerald
    write: chalk.hex('#10B981'),
    edit: chalk.hex('#34D399'),

    // Search/Grep - Yellow/Amber
    search: chalk.hex('#FBBF24'),
    grep: chalk.hex('#FCD34D'),
    glob: chalk.hex('#F59E0B'),

    // Web operations - Blue/Indigo
    web: chalk.hex('#6366F1'),
    fetch: chalk.hex('#818CF8'),

    // Task/Agent - Purple/Violet
    task: chalk.hex('#A855F7'),
    agent: chalk.hex('#C084FC'),

    // Todo - Pink
    todo: chalk.hex('#EC4899'),

    // Notebook - Teal
    notebook: chalk.hex('#14B8A6'),

    // User interaction - Rose
    ask: chalk.hex('#FB7185'),

    // Default - Green
    default: chalk.hex('#10B981'),
  },
};

/**
 * AGI CLI style icons
 * Following the official AGI CLI UI conventions:
 * - ⏺ (action): Used for tool calls, actions, and thinking/reasoning
 * - ⎿ (subaction): Used for results, details, and nested information
 * - ─ (separator): Horizontal lines for dividing sections (not in this object)
 * - > (user prompt): User input prefix (used in formatUserPrompt)
 */
export const icons = {
  // Status indicators
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  pending: '○',
  running: '◐',
  cached: '⚡',

  // Navigation & flow
  arrow: '→',
  arrowRight: '▸',
  arrowDown: '▾',
  bullet: '•',
  dot: '·',

  // Tool indicators
  thinking: '◐',
  tool: '⚙',
  action: '⏺',      // AGI CLI: tool actions and thoughts
  subaction: '⎿',   // AGI CLI: results and details

  // User/assistant
  user: '❯',
  assistant: '◆',
  sparkle: '✨',     // AGI branding

  // Progress & loading
  loading: '⣾',
  spinner: ['◐', '◓', '◑', '◒'],
  progress: ['░', '▒', '▓', '█'],

  // File operations
  file: '📄',
  folder: '📁',
  edit: '✏️',
  read: '📖',
  write: '💾',
  delete: '🗑️',

  // Search & find
  search: '🔍',
  match: '◉',
  noMatch: '○',

  // Grouping & hierarchy
  branch: '│',
  corner: '└',
  tee: '├',
  horizontal: '─',

  // Context & metrics
  context: '⊛',
  time: '⏱',
  memory: '◈',
};

/**
 * Spinner animation frames (braille dots style)
 */
export const spinnerFrames = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  circle: ['◐', '◓', '◑', '◒'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
  braille: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
};

/**
 * Progress bar characters
 */
export const progressChars = {
  filled: '█',
  empty: '░',
  partial: ['▏', '▎', '▍', '▌', '▋', '▊', '▉'],
};

/**
 * Box drawing characters for panels
 */
export const boxChars = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
  cross: '┼',
};

/**
 * Get the appropriate color function for a tool name
 * Returns different colors based on tool category
 */
export function getToolColor(toolName: string): (text: string) => string {
  const name = toolName.toLowerCase();

  // Bash/Execute commands - Orange
  if (name.includes('bash') || name.includes('execute') || name === 'killshell' || name === 'bashoutput') {
    return theme.toolColors.bash;
  }

  // Read/File operations - Cyan
  if (name.includes('read') || name === 'glob' || name === 'list_files') {
    return theme.toolColors.read;
  }

  // Write operations - Green
  if (name.includes('write')) {
    return theme.toolColors.write;
  }

  // Edit operations - Light green
  if (name.includes('edit')) {
    return theme.toolColors.edit;
  }

  // Search/Grep - Yellow
  if (name.includes('grep') || name.includes('search')) {
    return theme.toolColors.grep;
  }

  // Glob pattern search - Amber
  if (name === 'glob') {
    return theme.toolColors.glob;
  }

  // Web operations - Indigo
  if (name.includes('web') || name.includes('fetch')) {
    return theme.toolColors.web;
  }

  // Task/Agent - Purple
  if (name === 'task' || name.includes('agent')) {
    return theme.toolColors.task;
  }

  // Todo - Pink
  if (name.includes('todo')) {
    return theme.toolColors.todo;
  }

  // Notebook - Teal
  if (name.includes('notebook')) {
    return theme.toolColors.notebook;
  }

  // User interaction - Rose
  if (name.includes('ask') || name.includes('question')) {
    return theme.toolColors.ask;
  }

  // Security/Attack tools - Offensive colors
  if (name.includes('security') || name.includes('attack') || name.includes('exploit') || 
      name.includes('recon') || name.includes('scan') || name.includes('nmap') ||
      name.includes('phishing') || name.includes('c2') || name.includes('backdoor') ||
      name.includes('destruction') || name.includes('ddos') || name.includes('persistence')) {
    return theme.neon.orange; // Use neon orange for offensive tools
  }

  // Default - Green
  return theme.toolColors.default;
}

/**
 * Format a tool name with category-specific coloring
 */
export function formatToolName(toolName: string): string {
  const colorFn = getToolColor(toolName);
  return colorFn(`[${toolName}]`);
}

export function formatBanner(profileLabel: string, model: string): string {
  const name = profileLabel || 'Agent';
  const title = theme.gradient.primary(name);
  const subtitle = theme.ui.muted(`${model} • Interactive Shell`);

  return `\n${title}\n${subtitle}\n`;
}

export function formatUserPrompt(_profile?: string): string {
  // Always use '>' as the user input prefix for consistent look
  const glyph = theme.user('>');
  return `${glyph} `;
}

/**
 * Get the raw '>' prompt character for display consistency
 */
export const USER_PROMPT_PREFIX = '> ';

export function formatToolCall(name: string, status: 'running' | 'success' | 'error'): string {
  const statusIcon = status === 'running' ? icons.thinking :
                     status === 'success' ? icons.success : icons.error;
  const statusColor = status === 'running' ? theme.info :
                      status === 'success' ? theme.success : theme.error;

  // Use category-specific coloring for tool names
  const toolColor = getToolColor(name);
  return `${statusColor(statusIcon)} ${toolColor(`[${name}]`)}`;
}

export function formatMessage(role: 'user' | 'assistant' | 'system', content: string): string {
  switch (role) {
    case 'user':
      return `${theme.user('You:')} ${content}`;
    case 'assistant':
      return `${theme.assistant('Assistant:')} ${content}`;
    case 'system':
      return theme.system(`[System] ${content}`);
  }
}
