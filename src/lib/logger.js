import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emit(level, icon, args) {
  if (LEVELS[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(`${stamp()} ${icon}`, ...args);
}

export const log = {
  debug: (...a) => emit('debug', '·', a),
  info:  (...a) => emit('info',  'ℹ', a),
  warn:  (...a) => emit('warn',  '⚠', a),
  error: (...a) => emit('error', '✖', a),
};
