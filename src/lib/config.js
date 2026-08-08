import 'dotenv/config';

/**
 * Configuration centralisée, validée au démarrage.
 * Mieux vaut crasher immédiatement avec un message clair qu'échouer
 * plus tard sur un `undefined` incompréhensible.
 */
export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  databaseUrl: process.env.DATABASE_URL,
  logLevel: process.env.LOG_LEVEL || 'info',
};

export function validateConfig({ requireGuild = false } = {}) {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (requireGuild && !config.guildId) missing.push('GUILD_ID');

  if (missing.length > 0) {
    console.error(
      `\n❌ Variables d'environnement manquantes : ${missing.join(', ')}\n` +
      `   → En local : copie .env.example en .env et remplis-le.\n` +
      `   → Sur Railway : onglet "Variables" de ton service.\n`,
    );
    process.exit(1);
  }
}

/** Couleurs de la charte du bot, pour des embeds cohérents. */
export const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger:  0xed4245,
  info:    0x2b2d31,
};
