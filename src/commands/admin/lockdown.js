import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getGuildConfig, updateGuildConfig } from '../../db/index.js';
import { liftLockdown, setChannelsLocked } from '../../handlers/antiraid.js';
import { COLORS } from '../../lib/config.js';
import { sendLog } from '../../handlers/logs.js';

export const data = new SlashCommandBuilder()
  .setName('lockdown')
  .setDescription('Mode urgence anti-raid')
  .addSubcommand((s) =>
    s.setName('on')
      .setDescription('Activer le lockdown (bloque les arrivées suspectes)'))
  .addSubcommand((s) =>
    s.setName('off')
      .setDescription('Désactiver le lockdown'))
  .addSubcommand((s) =>
    s.setName('salons')
      .setDescription('Verrouiller ou déverrouiller l\'écriture dans tous les salons')
      .addBooleanOption((o) =>
        o.setName('verrouiller')
          .setDescription('true = verrouiller, false = déverrouiller')
          .setRequired(true)))
  .addSubcommand((s) =>
    s.setName('statut')
      .setDescription('Voir l\'état de la protection'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'on') {
    await updateGuildConfig(interaction.guild.id, { lockdown_active: true });

    await sendLog(interaction.guild, {
      color: COLORS.danger,
      title: '🚨 Lockdown activé manuellement',
      description: `Activé par ${interaction.user}.\n\nLes comptes récents seront expulsés automatiquement.`,
    });

    return interaction.reply({
      content:
        '🚨 **Lockdown activé.**\n\n' +
        '• Les comptes trop récents sont expulsés à l\'arrivée\n' +
        '• Utilise `/lockdown salons verrouiller:true` pour couper aussi l\'écriture\n' +
        '• `/lockdown off` pour revenir à la normale',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'off') {
    await liftLockdown(interaction.guild);
    return interaction.reply({
      content: '✅ **Lockdown désactivé.** Le serveur est repassé en fonctionnement normal.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'salons') {
    const lock = interaction.options.getBoolean('verrouiller');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const count = await setChannelsLocked(interaction.guild, lock);

    await sendLog(interaction.guild, {
      color: lock ? COLORS.danger : COLORS.success,
      title: lock ? '🔒 Salons verrouillés' : '🔓 Salons déverrouillés',
      description: `${count} salon(s) modifié(s) par ${interaction.user}.`,
    });

    return interaction.editReply(
      lock
        ? `🔒 **${count}** salon(s) verrouillés — plus personne ne peut écrire.`
        : `🔓 **${count}** salon(s) déverrouillés.`,
    );
  }

  if (sub === 'statut') {
    const cfg = await getGuildConfig(interaction.guild.id);

    return interaction.reply({
      content:
        `🛡️ **État de la protection**\n\n` +
        `• Anti-raid : **${cfg.antiraid_enabled ? '✅ activé' : '❌ désactivé'}**\n` +
        `• Lockdown : **${cfg.lockdown_active ? '🚨 ACTIF' : 'inactif'}**\n` +
        `• Seuil de détection : **${cfg.antiraid_joins} arrivées / ${cfg.antiraid_window}s**\n` +
        `• Âge minimum du compte : **${cfg.antiraid_min_age} jour(s)**`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
