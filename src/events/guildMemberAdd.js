import { Events } from 'discord.js';
import { getGuildConfig } from '../db/index.js';
import { inspectJoin } from '../handlers/antiraid.js';
import { resolveInviter } from '../handlers/invites.js';
import { log } from '../lib/logger.js';

export const name = Events.GuildMemberAdd;

export async function execute(member) {
  if (member.user.bot) return;

  try {
    // Avant tout le reste, y compris l'anti-raid : l'attribution se déduit de
    // l'écart entre deux relevés des compteurs d'invitation. Sauter cette
    // étape pour un compte expulsé laisserait le cache décalé, et la
    // prochaine arrivée serait attribuée au mauvais parrain.
    await resolveInviter(member).catch((e) =>
      log.debug(`Invitation non résolue : ${e.message}`));

    // L'anti-raid ensuite : inutile d'attribuer un rôle ou d'envoyer un
    // message d'accueil à un compte qu'on s'apprête à expulser.
    const kicked = await inspectJoin(member);
    if (kicked) return;

    const cfg = await getGuildConfig(member.guild.id);

    // Rôle "non vérifié" optionnel — certains serveurs préfèrent le modèle
    // inverse (tout est fermé par défaut, le rôle vérifié ouvre l'accès).
    if (cfg.unverified_role_id) {
      await member.roles.add(cfg.unverified_role_id, 'Nouvelle arrivée — en attente de vérification')
        .catch((e) => log.warn(`Attribution du rôle non-vérifié impossible : ${e.message}`));
    }

    if (cfg.verify_channel_id) {
      await member.send(
        `👋 Bienvenue sur **${member.guild.name}** !\n\n` +
        `Pour accéder au serveur, passe la vérification dans <#${cfg.verify_channel_id}>.\n` +
        `C'est rapide : un petit défi anti-bot, puis le règlement à accepter.`,
      ).catch(() => {
        // MP fermés : le panneau dans le salon reste accessible.
      });
    }

    log.debug(`Arrivée de ${member.user.tag} sur ${member.guild.name}`);
  } catch (err) {
    log.error('Erreur au traitement d\'une arrivée', err);
  }
}
