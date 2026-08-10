import { Events } from 'discord.js';
import { refreshGuildInvites } from '../handlers/invites.js';

export const name = Events.InviteCreate;

/**
 * Une invitation neuve doit entrer dans le cache immédiatement.
 *
 * Sans ce rafraîchissement, elle apparaîtrait au relevé suivant comme une
 * inconnue passée de « absente » à « 1 usage » — et le parrain de l'arrivant
 * serait bien détecté, mais seulement par chance. Le tenir à jour ici évite
 * de dépendre du hasard.
 */
export async function execute(invite) {
  if (!invite.guild) return;
  await refreshGuildInvites(invite.guild);
}
