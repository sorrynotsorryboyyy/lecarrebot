import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLORS } from '../../lib/config.js';

export const data = new SlashCommandBuilder()
  .setName('aide')
  .setDescription('Afficher les commandes du CarréBot');

export async function execute(interaction) {
  const isAdmin = interaction.memberPermissions?.has('ManageGuild');

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🎮 CarréBot — Commandes')
    .addFields({
      name: '👥 Membres',
      value:
        '`/lfg` — Chercher des mates pour jouer\n' +
        '`/profil` — Ta fiche : rangs, arrivée, activité\n' +
        '`/stats` — Répartition des rangs du serveur\n' +
        '`/tournoi liste` — Voir les tournois ouverts\n' +
        '`/aide` — Afficher ce message\n\n' +
        '🎭 Choisis ton rang CS2 dans **#🎭-roles**',
    });

  if (isAdmin) {
    embed.addFields(
      {
        name: '⚙️ Configuration',
        value:
          '`/setup` — **Crée tout le serveur** (rôles, catégories, salons, panneau)\n' +
          '`/config voir` — Voir la configuration\n' +
          '`/config salons` · `roles` — Réaffecter salons et rôles\n' +
          '`/config règlement` — Modifier le règlement\n' +
          '`/config antiraid` — Régler la protection\n' +
          '`/config panneau` — Republier le panneau',
      },
      {
        name: '🛡️ Protection',
        value:
          '`/lockdown on` / `off` — Mode urgence\n' +
          '`/lockdown salons` — Verrouiller l\'écriture\n' +
          '`/lockdown statut` — État de la protection',
      },
      {
        name: '🔨 Modération',
        value:
          '`/mod warn` · `/mod warns` · `/mod unwarn`\n' +
          '`/mod mute` · `/mod unmute`\n' +
          '`/mod kick` · `/mod ban` · `/mod purge`',
      },
      {
        name: '🏆 Événements',
        value:
          '`/tournoi créer` · `/tournoi participants` · `/tournoi fermer`\n' +
          '`/giveaway lancer` · `/giveaway terminer` · `/giveaway relancer`',
      },
    );
  }

  embed.setFooter({ text: 'CarréBot — communauté gaming' });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
