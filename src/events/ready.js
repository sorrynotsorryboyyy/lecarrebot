import { ActivityType, Events } from 'discord.js';
import { log } from '../lib/logger.js';
import { startGiveawayScheduler } from '../handlers/giveaway.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  log.info(`Connecté en tant que ${client.user.tag}`);
  log.info(`Actif sur ${client.guilds.cache.size} serveur(s)`);

  client.user.setPresence({
    activities: [{ name: 'CS2 · /aide', type: ActivityType.Playing }],
    status: 'online',
  });

  // Reprend les giveaways arrivés à échéance pendant une coupure.
  startGiveawayScheduler(client);

  log.info('CarréBot est prêt 🎮');
}
