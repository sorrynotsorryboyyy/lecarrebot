import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { config, validateConfig } from './lib/config.js';
import { log } from './lib/logger.js';

/**
 * Enregistrement des commandes slash auprès de Discord.
 *
 * Avec GUILD_ID : déploiement instantané sur ce seul serveur (développement).
 * Sans GUILD_ID : déploiement global, propagé par Discord en ~1 heure.
 */
validateConfig();

const __dirname = dirname(fileURLToPath(import.meta.url));

async function collectCommands() {
  const commands = [];
  const root = join(__dirname, 'commands');
  const groups = await readdir(root, { withFileTypes: true });

  for (const group of groups) {
    if (!group.isDirectory()) continue;

    const dir = join(root, group.name);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));

    for (const file of files) {
      const module = await import(pathToFileURL(join(dir, file)).href);
      if (!module.data) continue;

      commands.push(module.data.toJSON());
      log.info(`  • /${module.data.name}`);
    }
  }

  return commands;
}

async function main() {
  log.info('Collecte des commandes…');
  const commands = await collectCommands();

  const rest = new REST().setToken(config.token);

  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  log.info(
    config.guildId
      ? `Déploiement sur le serveur ${config.guildId}…`
      : 'Déploiement global (propagation ~1h)…',
  );

  const data = await rest.put(route, { body: commands });

  log.info(`✅ ${data.length} commande(s) déployée(s).`);
}

main().catch((err) => {
  log.error('Déploiement impossible', err);
  process.exit(1);
});
