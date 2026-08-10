import { Events, MessageFlags } from 'discord.js';
import { log } from '../lib/logger.js';
import { getGuildConfig } from '../db/index.js';
import {
  acceptRules,
  declineRules,
  handleAnswer,
  startVerification,
} from '../handlers/verification.js';
import { setRank } from '../handlers/ranks.js';
import {
  handleVoiceButton,
  handleVoiceMemberSelect,
  handleVoiceModal,
} from '../handlers/tempVoice.js';
import { saveRules } from '../commands/admin/config.js';
import { closeTicket, createTicket, openTicketModal } from '../handlers/tickets.js';
import {
  cancelDraft,
  openComposer,
  openFieldEditor,
  openStratSidePicker,
  publishDraft,
  receiveComposer,
  receiveEvent,
  receiveFieldEditor,
  receiveSelectEditor,
} from '../handlers/panel.js';
import { openStratComposer, receiveStrat } from '../commands/admin/strat.js';
import { finishLfg, openLfgComposer, publishLfg } from '../handlers/lfgPanel.js';
import { cancelReset, confirmStep1, confirmStep2 } from '../commands/admin/reset.js';
import { closeLfg, joinLfg, leaveLfg } from '../handlers/lfg.js';
import { joinTournament, leaveTournament } from '../handlers/tournoi.js';
import { enterGiveaway } from '../handlers/giveaway.js';

export const name = Events.InteractionCreate;

/**
 * Codes d'erreur Discord qui ne traduisent pas un bug applicatif :
 *   40060 — interaction déjà acquittée (deux instances du bot écoutent la
 *           même interaction ; typique de `node --watch`, qui redémarre le
 *           process sans fermer la connexion précédente).
 *   10062 — interaction inconnue : le délai de 3s est dépassé.
 */
const BENIGN_CODES = new Set([40060, 10062]);

export async function execute(interaction) {
  try {
    if (interaction.isChatInputCommand()) return await runCommand(interaction);
    if (interaction.isButton()) return await runButton(interaction);
    if (interaction.isStringSelectMenu()) return await runSelectMenu(interaction);
    if (interaction.isUserSelectMenu()) return await runUserSelect(interaction);
    if (interaction.isModalSubmit()) return await runModal(interaction);
  } catch (err) {
    if (BENIGN_CODES.has(err.code)) {
      log.warn(
        `Interaction ${interaction.id} déjà traitée (code ${err.code}). ` +
        'Une autre instance du bot tourne probablement en parallèle — ' +
        'ferme les anciens processus, ou utilise `npm start` plutôt que `npm run dev`.',
      );
      return;
    }

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

  if (domain === 'voice') {
    return handleVoiceButton(interaction, action);
  }

  if (domain === 'panel') {
    if (action === 'publish') return publishDraft(interaction);
    if (action === 'cancel') return cancelDraft(interaction);
    // `edit` couvre deux cas : un type publiable rouvre le formulaire
    // principal, un nom de champ ouvre le réglage correspondant.
    if (action === 'edit') return openFieldEditor(interaction, arg);
    return;
  }

  // Un bouton de mode ouvre directement le formulaire : showModal() ne
  // peut pas suivre un defer.
  if (domain === 'lfgpanel' && action === 'mode') {
    return openLfgComposer(interaction, arg);
  }

  if (domain === 'reset') {
    // showModal() ne peut pas suivre un defer : confirmStep1 répond
    // directement par le formulaire de confirmation.
    if (action === 'confirm') return confirmStep1(interaction);
    if (action === 'cancel') return cancelReset(interaction);
    return;
  }

  if (domain === 'ticket') {
    // Ouverture : formulaire du motif, donc pas de defer.
    if (action === 'open') return openTicketModal(interaction);
    if (action === 'close') return closeTicket(interaction, Number(arg));
    return;
  }
}

/**
 * Routeur des menus déroulants.
 * Même convention de customId que les boutons : `domaine:action[:argument]`.
 * La valeur choisie arrive dans `interaction.values`, jamais dans le customId.
 */
async function runSelectMenu(interaction) {
  // Les handlers accèdent tous à `interaction.guild.id` : en MP, ils
  // planteraient sur un accès à `null`.
  if (!interaction.guild) return;

  const [domain, action, arg] = interaction.customId.split(':');

  if ((domain === 'ranks' || domain === 'identity') && action === 'set') {
    const cfg = await getGuildConfig(interaction.guild.id);
    return setRank(interaction, arg, cfg, domain);
  }

  if (domain === 'panel') {
    // showModal() ne peut pas suivre un defer : on ouvre directement.
    if (action === 'type') return openComposer(interaction, interaction.values[0]);
    if (action === 'strat') return openStratSidePicker(interaction);
    // `arg` porte la carte, la valeur choisie porte le côté.
    if (action === 'stratside') {
      return openStratComposer(interaction, arg, interaction.values[0]);
    }
    // Réglages de l'aperçu qui passent par un menu plutôt qu'un formulaire.
    if (action === 'setcolor' || action === 'setmention') {
      return receiveSelectEditor(interaction, action);
    }
    return;
  }

  // Dernière étape d'une recherche de mates : qui notifier.
  if (domain === 'lfgpanel' && action === 'ping') {
    return finishLfg(interaction, arg);
  }
}

/** Menus de sélection de membre (gestion des salons vocaux). */
async function runUserSelect(interaction) {
  if (!interaction.guild) return;

  const [domain, action, arg] = interaction.customId.split(':');

  if (domain === 'voice' && action === 'member') {
    return handleVoiceMemberSelect(interaction, arg);
  }
}

/**
 * Routeur des formulaires.
 * Les valeurs saisies arrivent via `interaction.fields`, un troisième
 * espace de nommage après les customId et `interaction.values`.
 */
async function runModal(interaction) {
  if (!interaction.guild) return;

  const [domain, action, arg] = interaction.customId.split(':');

  if (domain === 'voice' && action === 'modal') {
    return handleVoiceModal(interaction, arg);
  }

  if (domain === 'panel' && action === 'submit') {
    return receiveComposer(interaction, arg);
  }

  if (domain === 'panel' && action === 'event') {
    return receiveEvent(interaction, arg);
  }

  // Réglages ponctuels depuis l'aperçu : image, lien, champ, programmation.
  if (domain === 'panel' && action === 'setfield') {
    return receiveFieldEditor(interaction, arg);
  }

  if (domain === 'config' && action === 'rules') {
    return saveRules(interaction);
  }

  if (domain === 'ticket' && action === 'submit') {
    return createTicket(interaction);
  }

  if (domain === 'strat' && action === 'submit') {
    return receiveStrat(interaction, arg);
  }

  if (domain === 'reset' && action === 'modal') {
    return confirmStep2(interaction);
  }

  if (domain === 'lfgpanel' && action === 'submit') {
    return publishLfg(interaction, arg);
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
  } catch (err) {
    // L'interaction a expiré (3s) ou a déjà reçu une réponse : rien à faire.
    if (!BENIGN_CODES.has(err.code)) {
      log.debug(`Réponse d'erreur impossible : ${err.message}`);
    }
  }
}
