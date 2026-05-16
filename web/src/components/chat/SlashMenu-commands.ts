export interface SlashCommand { cmd: string; desc: string; }

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/news', desc: 'Latest crypto news summary' },
  { cmd: '/analyze', desc: 'Analyze current market' },
  { cmd: '/alerts', desc: 'List active price alerts' },
  { cmd: '/help', desc: 'Show available commands' },
];

export const NO_PARAM_COMMANDS = new Set([
  '/news', '/analyze', '/alerts', '/help',
]);
