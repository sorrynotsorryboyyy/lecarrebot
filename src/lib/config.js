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
  // URL publique de la base. Nécessaire quand le bot et PostgreSQL sont dans
  // deux projets Railway distincts : le réseau privé ne les relie pas.
  databasePublicUrl: process.env.DATABASE_PUBLIC_URL,
  logLevel: process.env.LOG_LEVEL || 'info',
  // Clés de stats, toutes deux FACULTATIVES : sans elles, /lier répond que
  // la source n'est pas configurée, et tout le reste du bot fonctionne.
  // Elles ne figurent donc jamais dans validateConfig().
  faceitApiKey: process.env.FACEIT_API_KEY,
  steamApiKey: process.env.STEAM_API_KEY,
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
