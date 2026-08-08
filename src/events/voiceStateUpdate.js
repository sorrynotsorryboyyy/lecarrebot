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
import { grantVoiceXp } from '../handlers/xp.js';

export const name = Events.VoiceStateUpdate;

/**
 * Horodatage d'entrée en vocal, par membre.
 *
 * En mémoire volontairement : c'est une donnée à durée de vie de quelques
 * minutes. Un redémarrage fait perdre la session en cours, ce qui est
 * préférable à une écriture en base à chaque connexion.
 */
const voiceSessions = new Map();

const sessionKey = (guildId, userId) => `${guildId}:${userId}`;

export async function execute(oldState, newState) {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const guild = newState.guild ?? oldState.guild;

  try {
    const cfg = await getGuildConfig(guild.id);
    const channelIds = parseJsonColumn(cfg.channel_ids);

    // ─── Départ d'un salon ───────────────────────────────────────
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      await handleLeave(oldState, member, cfg, channelIds);
    }

    // ─── Arrivée dans un salon ───────────────────────────────────
    if (newState.channelId && newState.channelId !== oldState.channelId) {
      await handleJoin(newState, member, cfg, channelIds);
    }
  } catch (err) {
    log.debug(`Traitement vocal impossible : ${err.message}`);
  }
}

/** Arrivée : création du salon personnel, ou démarrage du compteur d'XP. */
async function handleJoin(state, member, cfg, channelIds) {
  const hubId = channelIds['voice-hub'];

  if (hubId && state.channelId === hubId) {
    // Le générateur ne sert qu'à déclencher la création : personne n'y reste.
    await createTempChannel(member, state.channel);
    return;
  }

  // L'XP vocal ne compte ni dans le salon AFK, ni dans le générateur.
  if (state.channelId === channelIds['voice-afk']) return;
  if (state.channelId === state.guild.afkChannelId) return;

  voiceSessions.set(sessionKey(state.guild.id, member.id), Date.now());
}

/** Départ : XP gagnée, suppression ou transfert du salon quitté. */
async function handleLeave(state, member, cfg, channelIds) {
  await creditVoiceTime(state, member, cfg);

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

/**
 * Crédite le temps passé en vocal.
 *
 * Le temps n'est compté que si le membre n'était pas seul et n'avait pas
 * coupé son micro : rester connecté la nuit dans un salon vide ne doit
 * rien rapporter.
 */
async function creditVoiceTime(state, member, cfg) {
  const key = sessionKey(state.guild.id, member.id);
  const startedAt = voiceSessions.get(key);
  voiceSessions.delete(key);

  if (!startedAt) return;

  const minutes = (Date.now() - startedAt) / 60_000;
  if (minutes < 1) return;

  // Micro coupé par le membre lui-même : présence passive, pas d'XP.
  if (state.selfMute && state.selfDeaf) return;

  // Seul dans le salon : on ne récompense pas la connexion permanente.
  const others = state.channel?.members?.filter((m) => !m.user.bot && m.id !== member.id);
  if (!others || others.size === 0) return;

  await grantVoiceXp(state.guild, member, minutes, cfg);
}
