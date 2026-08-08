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
        '`/tournoi liste` — Voir les tournois ouverts\n' +
        '`/aide` — Afficher ce message',
    });

  if (isAdmin) {
    embed.addFields(
      {
        name: '⚙️ Configuration',
        value:
          '`/setup auto` — Configuration automatique complète\n' +
          '`/setup salons` — Définir les salons\n' +
          '`/setup roles` — Définir les rôles\n' +
          '`/setup panneau` — Republier le panneau de vérification\n' +
          '`/setup règlement` — Modifier le règlement\n' +
          '`/setup antiraid` — Régler la protection\n' +
          '`/setup voir` — Voir la configuration',
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
