import { Events } from 'discord.js';
import { getGuildConfig } from '../db/index.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';
import { log } from '../lib/logger.js';
import {
  createTempChannel,
  deleteTempChannel,
  findTempChannel,
  transferOwnership,
} from '../handlers/tempVoice.js';

export const name = Events.VoiceStateUpdate;

/**
 * Salons vocaux à la demande.
 *
 * Rejoindre le salon « générateur » crée un vocal personnel ; le quitter
 * le supprime dès qu'il se vide.
 */
export async function execute(oldState, newState) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const guild = newState.guild ?? oldState.guild;

  try {
    const cfg = await getGuildConfig(guild.id);
    const channelIds = parseJsonColumn(cfg.channel_ids);

    // Départ d'un salon.
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      await handleLeave(oldState, member);
    }

    // Arrivée dans un salon.
    if (newState.channelId && newState.channelId !== oldState.channelId) {
      await handleJoin(newState, member, channelIds);
    }
  } catch (err) {
    log.debug(`Traitement vocal impossible : ${err.message}`);
  }
}

/**
 * Salons « générateurs ». Chaque espace a le sien : le salon créé hérite des
 * permissions de la catégorie du hub rejoint, ce qui garde un vocal Losange
 * dans l'espace Losange et un vocal public dans l'espace public.
 */
const VOICE_HUB_KEYS = ['voice-hub', 'losange-voice-hub'];

/** Arrivée : création du salon personnel si c'est un générateur. */
async function handleJoin(state, member, channelIds) {
  // Le générateur ne sert qu'à déclencher la création : personne n'y reste.
  const isHub = VOICE_HUB_KEYS.some((key) => channelIds[key] === state.channelId);

  if (isHub) {
    await createTempChannel(member, state.channel);
  }
}

/** Départ : suppression du salon vidé, ou transfert de propriété. */
async function handleLeave(state, member) {
  const channel = state.channel;
  if (!channel) return;

  const temp = await findTempChannel(channel.id);
  if (!temp) return;

  const remaining = channel.members.filter((m) => !m.user.bot);

  if (remaining.size === 0) {
    await deleteTempChannel(channel);
    return;
  }

  // Le propriétaire est parti mais le salon vit encore : on cède la
  // propriété au plus ancien présent, sinon plus personne ne peut le gérer.
  if (temp.owner_id === member.id) {
    const heir = remaining.first();
    if (heir) {
      await transferOwnership(channel, heir.id);
      await channel.send({
        content: `👑 ${heir} devient propriétaire de ce salon.`,
      }).catch(() => {});
    }
  }
}
