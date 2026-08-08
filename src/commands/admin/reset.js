import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { COLORS } from '../../lib/config.js';
import { log } from '../../lib/logger.js';
import {
  checkResetPermissions,
  isRoleProtected,
  wipeData,
  wipeGuild,
} from '../../handlers/reset.js';

/**
 * /reset — remise à zéro complète du serveur.
 *
 * Nommée `reset` et non `purge` : `/mod purge` supprime déjà des messages,
 * et confondre les deux coûterait le serveur entier.
 *
 * Deux confirmations successives, parce que l'opération est définitive :
 * Discord ne restaure jamais un salon supprimé, ni son historique.
 */
export const data = new SlashCommandBuilder()
  .setName('reset')
  .setDescription('⚠️ Supprime TOUT le serveur et le reconstruit à neuf')
  .addBooleanOption((o) =>
    o.setName('effacer_donnees')
      .setDescription('Effacer aussi XP, vérifications, avertissements et tournois (défaut : oui)'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/** Options en attente de confirmation, par serveur et par utilisateur. */
const pending = new Map();

const key = (guildId, userId) => `${guildId}:${userId}`;

export async function execute(interaction) {
  const guild = interaction.guild;

  // Seul le propriétaire peut raser le serveur : la permission
  // Administrateur peut avoir été accordée largement, et cette action
  // est trop définitive pour être déléguée.
  if (interaction.user.id !== guild.ownerId) {
    return interaction.reply({
      content:
        '⛔ Seul le **propriétaire du serveur** peut utiliser cette commande.\n\n' +
        'Elle supprime l\'intégralité du serveur — c\'est irréversible.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const permError = checkResetPermissions(guild);
  if (permError) {
    return interaction.reply({ content: `❌ ${permError}`, flags: MessageFlags.Ephemeral });
  }

  const wipeDb = interaction.options.getBoolean('effacer_donnees') ?? true;

  pending.set(key(guild.id, interaction.user.id), { wipeDb });

  // Inventaire réel avant confirmation : annoncer des chiffres concrets
  // vaut mieux qu'un avertissement générique.
  await guild.channels.fetch();
  await guild.roles.fetch();

  const me = guild.members.me;
  const channelCount = guild.channels.cache.size;
  const roleCount = guild.roles.cache.filter((r) => !isRoleProtected(r, me)).size;

  const embed = new EmbedBuilder()
    .setColor(COLORS.danger)
    .setTitle('⚠️ Remise à zéro du serveur')
    .setDescription(
      '**Cette action est IRRÉVERSIBLE.**\n' +
      'Discord ne permet aucune restauration, et le support non plus.\n\n' +
      '**Vont être définitivement supprimés :**',
    )
    .addFields(
      {
        name: '📁 Salons et catégories',
        value: `**${channelCount}** — avec **tout l'historique des messages**`,
        inline: true,
      },
      {
        name: '🎭 Rôles',
        value: `**${roleCount}** — dont Fondateur, Amis et les rangs`,
        inline: true,
      },
      {
        name: '💾 Données',
        value: wipeDb
          ? '**Tout** : XP, vérifications, avertissements, tournois'
          : 'Conservées',
        inline: true,
      },
      {
        name: '🔧 Après le nettoyage',
        value:
          'Le salon d\'où tu lances cette commande sera **conservé**, pour te ' +
          'permettre d\'y taper `/setup` et reconstruire le serveur.',
      },
    )
    .setFooter({ text: 'Une seconde confirmation te sera demandée.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('reset:confirm:step1')
      .setLabel('Je comprends, continuer')
      .setEmoji('⚠️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('reset:cancel:x')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary),
  );

  return interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Deuxième confirmation : saisie du nom exact du serveur.
 * Un bouton seul se clique par réflexe ; recopier un nom, non.
 */
export async function confirmStep1(interaction) {
  if (!pending.has(key(interaction.guild.id, interaction.user.id))) {
    return interaction.update({
      content: '⏱️ Cette demande a expiré. Relance `/reset`.',
      embeds: [], components: [],
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('reset:modal:confirm')
    .setTitle('Confirmation définitive')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Recopie le nom exact du serveur')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder(interaction.guild.name.slice(0, 100)),
      ),
    );

  return interaction.showModal(modal);
}

/** Vérification du nom saisi, puis exécution. */
export async function confirmStep2(interaction) {
  const guild = interaction.guild;
  const pendingKey = key(guild.id, interaction.user.id);
  const options = pending.get(pendingKey);

  if (!options) {
    return interaction.reply({
      content: '⏱️ Cette demande a expiré. Relance `/reset`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const typed = interaction.fields.getTextInputValue('name').trim();

  if (typed !== guild.name) {
    pending.delete(pendingKey);
    return interaction.reply({
      content:
        `❌ Le nom saisi ne correspond pas à **${guild.name}**.\n\n` +
        'Opération annulée — rien n\'a été supprimé.',
      flags: MessageFlags.Ephemeral,
    });
  }

  pending.delete(pendingKey);

  // Le nettoyage dépasse largement les 3s d'une réponse directe.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  log.warn(
    `🔥 REMISE À ZÉRO de ${guild.name} (${guild.id}) demandée par ${interaction.user.tag}`,
  );

  let wiped;
  try {
    // Le salon d'exécution survit au nettoyage : le supprimer ferait
    // disparaître l'interaction avant de pouvoir rendre compte.
    wiped = await wipeGuild(guild, { keepChannelId: interaction.channelId });
  } catch (err) {
    log.error('Remise à zéro interrompue', err);
    return interaction.editReply(
      `❌ La remise à zéro s'est interrompue : ${err.message}\n\n` +
      'Relance `/reset` pour reprendre, ou `/setup` pour reconstruire l\'existant.',
    );
  }

  let dataCleared = 0;
  if (options.wipeDb) {
    dataCleared = await wipeData(guild.id);
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('🧹 Serveur nettoyé')
    .setDescription(
      `**${wiped.channels}** salon(s), **${wiped.categories}** catégorie(s) ` +
      `et **${wiped.roles}** rôle(s) supprimés.` +
      (options.wipeDb ? `\n**${dataCleared}** enregistrement(s) effacé(s) en base.` : ''),
    );

  if (wiped.failed.length > 0) {
    embed.addFields({
      name: `⚠️ Non supprimés (${wiped.failed.length})`,
      value: wiped.failed.slice(0, 5).map((f) => `• ${f}`).join('\n').slice(0, 1024),
    });
  }

  embed.addFields({
    name: '▶️ Suite',
    value:
      'Lance maintenant **`/setup`** pour reconstruire le serveur.\n' +
      'Ce salon a été conservé pour te permettre de le faire — tu pourras ' +
      'le supprimer ensuite.',
  });

  return interaction.editReply({ embeds: [embed] });
}

/** Abandon avant toute suppression. */
export function cancelReset(interaction) {
  pending.delete(key(interaction.guild.id, interaction.user.id));
  return interaction.update({
    content: '✅ Opération annulée — rien n\'a été supprimé.',
    embeds: [], components: [],
  });
}
