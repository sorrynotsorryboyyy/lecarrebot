import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config, validateConfig } from './lib/config.js';
import { log } from './lib/logger.js';
import { initDatabase, pool } from './db/index.js';

validateConfig();

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,   // requiert l'intent privilégié "Server Members"
    GatewayIntentBits.GuildMessages,
  ],
  // Permet de répondre aux interactions sur des membres non mis en cache.
  partials: [Partials.GuildMember, Partials.Channel],
});

client.commands = new Collection();

/** Charge toutes les commandes de src/commands/**. */
async function loadCommands() {
  const root = join(__dirname, 'commands');
  const groups = await readdir(root, { withFileTypes: true });

  for (const group of groups) {
    if (!group.isDirectory()) continue;

    const dir = join(root, group.name);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));

    for (const file of files) {
      const module = await import(pathToFileURL(join(dir, file)).href);

      if (!module.data || !module.execute) {
        log.warn(`Commande ignorée (data/execute manquant) : ${group.name}/${file}`);
        continue;
      }

      client.commands.set(module.data.name, module);
      log.debug(`Commande chargée : /${module.data.name}`);
    }
  }

  log.info(`${client.commands.size} commande(s) chargée(s)`);
}

/** Branche tous les événements de src/events/**. */
async function loadEvents() {
  const dir = join(__dirname, 'events');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const event = await import(pathToFileURL(join(dir, file)).href);

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }

    log.debug(`Événement branché : ${event.name}`);
  }

  log.info(`${files.length} événement(s) branché(s)`);
}

/** Arrêt propre : Railway envoie SIGTERM à chaque redéploiement. */
async function shutdown(signal) {
  log.info(`${signal} reçu — arrêt en cours…`);
  try {
    await client.destroy();
    await pool.end();
  } catch (err) {
    log.error('Erreur pendant l\'arrêt', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Un rejet non géré ne doit pas tuer le bot : on le journalise et on continue.
process.on('unhandledRejection', (reason) => {
  log.error('Rejet de promesse non géré', reason);
});

async function main() {
  await initDatabase();
  await loadCommands();
  await loadEvents();
  await client.login(config.token);
}

main().catch((err) => {
  log.error('Démarrage impossible', err);
  process.exit(1);
});
