import { ActivityType, Events } from 'discord.js';
import { log } from '../lib/logger.js';
import { startGiveawayScheduler } from '../handlers/giveaway.js';
import { reconcileTempChannels } from '../handlers/tempVoice.js';
import { expireVips } from '../commands/admin/vip.js';

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

  // Nettoie les salons vocaux temporaires vides restés après un
  // redémarrage : aucun événement ne viendrait plus les supprimer.
  await reconcileTempChannels(client).catch((err) =>
    log.warn(`Réconciliation des vocaux impossible : ${err.message}`));

  // Retire les statuts VIP expirés. Vérification horaire : la base fait
  // foi, pas des minuteries qui ne survivraient pas à un redémarrage.
  const expireTick = () => expireVips(client).catch((err) =>
    log.warn(`Expiration des VIP impossible : ${err.message}`));

  setInterval(expireTick, 60 * 60_000).unref();
  expireTick();

  log.info('CarréBot est prêt 🎮');
}
