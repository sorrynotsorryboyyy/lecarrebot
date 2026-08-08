import { Events, MessageFlags } from 'discord.js';
import { log } from '../lib/logger.js';
import { getGuildConfig } from '../db/index.js';
import {
  acceptRules,
  declineRules,
  handleAnswer,
  startVerification,
} from '../handlers/verification.js';
import { closeLfg, joinLfg, leaveLfg } from '../handlers/lfg.js';
import { joinTournament, leaveTournament } from '../handlers/tournoi.js';
import { enterGiveaway } from '../handlers/giveaway.js';

export const name = Events.InteractionCreate;

export async function execute(interaction) {
  try {
    if (interaction.isChatInputCommand()) return await runCommand(interaction);
    if (interaction.isButton()) return await runButton(interaction);
  } catch (err) {
    log.error(`Erreur sur l'interaction ${interaction.id}`, err);
    await replyError(interaction);
  }
}

async function runCommand(interaction) {
  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    log.warn(`Commande inconnue : ${interaction.commandName}`);
    return;
  }

  // Les commandes sont conçues pour un serveur : en MP, `interaction.guild`
  // serait null et chaque handler planterait sur un accès à `.id`.
  if (!interaction.guild) {
    return interaction.reply({
      content: '⚠️ Cette commande n\'est utilisable que sur un serveur.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await command.execute(interaction);
}

/**
 * Routeur des boutons.
 * Convention de customId : `domaine:action[:argument]`
 */
async function runButton(interaction) {
  const [domain, action, arg] = interaction.customId.split(':');

  if (domain === 'verify') {
    // En lockdown, on gèle les nouvelles vérifications : un raid ne doit pas
    // pouvoir franchir la porte pendant que le staff réagit.
    const cfg = await getGuildConfig(interaction.guild.id);
    if (cfg.lockdown_active) {
      return interaction.reply({
        content:
          '🚨 Le serveur est en **protection anti-raid**.\n\n' +
          'Les vérifications sont temporairement suspendues. Réessaie dans quelques minutes.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'start') return startVerification(interaction);
    if (action === 'answer') return handleAnswer(interaction, arg);
    if (action === 'rules') {
      if (arg === 'accept') return acceptRules(interaction);
      if (arg === 'decline') return declineRules(interaction);
    }
    return;
  }

  if (domain === 'lfg') {
    const id = Number(arg);
    if (action === 'join') return joinLfg(interaction, id);
    if (action === 'leave') return leaveLfg(interaction, id);
    if (action === 'close') return closeLfg(interaction, id);
    return;
  }

  if (domain === 'tournoi') {
    const id = Number(arg);
    if (action === 'join') return joinTournament(interaction, id);
    if (action === 'leave') return leaveTournament(interaction, id);
    return;
  }

  if (domain === 'giveaway' && action === 'enter') {
    return enterGiveaway(interaction, Number(arg));
  }
}

/** Répond une erreur générique sans jamais lever une seconde exception. */
async function replyError(interaction) {
  const payload = {
    content: '❌ Une erreur est survenue. Si le problème persiste, préviens un administrateur.',
    flags: MessageFlags.Ephemeral,
  };

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    // L'interaction a expiré (3s) ou a déjà reçu une réponse : rien à faire.
  }
}
