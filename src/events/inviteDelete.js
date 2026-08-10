import { Events } from 'discord.js';
import { refreshGuildInvites } from '../handlers/invites.js';

export const name = Events.InviteDelete;

/**
 * Une invitation supprimée doit sortir du cache.
 *
 * Le comparateur ne réagit qu'aux compteurs qui AUGMENTENT : une entrée
 * périmée ne fausserait donc pas l'attribution. Mais la laisser ferait
 * grossir le cache indéfiniment sur un serveur qui crée et révoque
 * beaucoup d'invitations.
 */
export async function execute(invite) {
  if (!invite.guild) return;
  await refreshGuildInvites(invite.guild);
}
