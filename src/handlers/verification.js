import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { generateChallenge } from '../lib/captcha.js';
import { getGuildConfig, query } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { sendLog } from './logs.js';
import { countInvites, inviterOfMember } from './invites.js';

const MAX_ATTEMPTS = 3;

/**
 * Parcours d'arrivée en deux étapes :
 *   1. Captcha  → prouve que le membre est humain
 *   2. Règlement → l'acceptation débloque l'accès au reste du serveur
 *
 * Le rôle "vérifié" n'est attribué qu'à la fin des DEUX étapes : c'est lui
 * qui ouvre les salons, donc le donner après le seul captcha laisserait
 * entrer des membres qui n'ont jamais vu le règlement.
 */

/** Panneau permanent posté dans #🔐-verification (bouton de démarrage). */
export function buildVerifyPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔐 Vérification — CarréBot')
    .setDescription(
      'Bienvenue sur le serveur !\n\n' +
      'Pour accéder à la communauté, tu dois passer une **vérification rapide** :\n\n' +
      '**1.** Résous un petit défi anti-bot\n' +
      '**2.** Lis et accepte le règlement\n\n' +
      'Clique sur le bouton ci-dessous pour commencer.',
    )
    .setFooter({ text: 'Cette vérification protège le serveur des raids et des bots.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:start')
      .setLabel('Commencer la vérification')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
}

/** Étape 1 — envoie un défi captcha en message éphémère. */
export async function startVerification(interaction) {
  const { guild, user } = interaction;
  const cfg = await getGuildConfig(guild.id);

  // Déjà passé ? On évite de refaire tout le parcours.
  const existing = await query(
    'SELECT verified_at, rules_ok FROM verifications WHERE guild_id = $1 AND user_id = $2',
    [guild.id, user.id],
  );
  if (existing.rows[0]?.verified_at) {
    return interaction.reply({
      content: '✅ Tu es déjà vérifié ! Si tu n\'as pas accès aux salons, contacte un modérateur.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const challenge = generateChallenge();

  // On stocke la réponse côté serveur : le client ne doit jamais la connaître.
  await query(
    `INSERT INTO verifications (guild_id, user_id, answer, attempts, captcha_ok)
     VALUES ($1, $2, $3, 0, FALSE)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET answer = EXCLUDED.answer, attempts = 0,
                   captcha_ok = FALSE, created_at = NOW()`,
    [guild.id, user.id, challenge.answer],
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🧩 Étape 1/2 — Défi anti-bot')
    .setDescription(challenge.question)
    .setFooter({ text: `${MAX_ATTEMPTS} tentatives disponibles.` });

  if (challenge.attachment) embed.setImage('attachment://captcha.png');

  // Discord limite à 5 boutons par ligne : nos 4 propositions tiennent large.
  const row = new ActionRowBuilder().addComponents(
    challenge.choices.map((c) => {
      const btn = new ButtonBuilder()
        .setCustomId(`verify:answer:${c.id}`)
        .setLabel(c.label)
        .setStyle(ButtonStyle.Secondary);
      if (c.emoji) btn.setEmoji(c.emoji);
      return btn;
    }),
  );

  return interaction.reply({
    embeds: [embed],
    components: [row],
    files: challenge.attachment ? [challenge.attachment] : [],
    flags: MessageFlags.Ephemeral,
  });
}

/** Étape 1 (suite) — vérifie la réponse cliquée. */
export async function handleAnswer(interaction, given) {
  const { guild, user } = interaction;

  const { rows } = await query(
    'SELECT answer, attempts, captcha_ok FROM verifications WHERE guild_id = $1 AND user_id = $2',
    [guild.id, user.id],
  );
  const session = rows[0];

  if (!session) {
    return interaction.update({
      content: '⏱️ Cette session a expiré. Relance la vérification depuis le panneau.',
      embeds: [], components: [], files: [],
    });
  }

  // Le défi déjà résolu ne doit pas pouvoir être « rejoué » depuis un ancien
  // message éphémère : on renvoie directement à l'étape du règlement.
  if (session.captcha_ok) return showRules(interaction);

  if (given === session.answer) {
    await query(
      'UPDATE verifications SET captcha_ok = TRUE WHERE guild_id = $1 AND user_id = $2',
      [guild.id, user.id],
    );
    return showRules(interaction);
  }

  const attempts = session.attempts + 1;

  if (attempts >= MAX_ATTEMPTS) {
    await query(
      'DELETE FROM verifications WHERE guild_id = $1 AND user_id = $2',
      [guild.id, user.id],
    );
    await sendLog(guild, {
      color: COLORS.warning,
      title: '🧩 Captcha échoué',
      description: `${user} (\`${user.tag}\`) a épuisé ses ${MAX_ATTEMPTS} tentatives.`,
    });
    return interaction.update({
      content:
        '❌ Trop de mauvaises réponses.\n\n' +
        'Retourne sur le panneau de vérification pour réessayer avec un nouveau défi.',
      embeds: [], components: [], files: [],
    });
  }

  await query(
    'UPDATE verifications SET attempts = $3 WHERE guild_id = $1 AND user_id = $2',
    [guild.id, user.id, attempts],
  );

  return interaction.update({
    content: `❌ Mauvaise réponse. Il te reste **${MAX_ATTEMPTS - attempts}** tentative(s). Relance la vérification pour un nouveau défi.`,
    embeds: [], components: [], files: [],
  });
}

/** Étape 2 — affiche le règlement à accepter. */
async function showRules(interaction) {
  const cfg = await getGuildConfig(interaction.guild.id);

  const rules = cfg.rules_text || DEFAULT_RULES;

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('📜 Étape 2/2 — Règlement')
    .setDescription(
      '✅ Défi réussi !\n\nDernière étape : lis le règlement puis accepte-le pour ' +
      'débloquer l\'accès au serveur.\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━\n\n' + rules,
    )
    .setFooter({ text: 'En acceptant, tu t\'engages à respecter ces règles.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:rules:accept')
      .setLabel('J\'accepte le règlement')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('verify:rules:decline')
      .setLabel('Je refuse')
      .setStyle(ButtonStyle.Danger),
  );

  return interaction.update({
    content: '',
    embeds: [embed],
    components: [row],
    files: [],
  });
}

/** Étape 2 (suite) — acceptation : attribution du rôle vérifié. */
export async function acceptRules(interaction) {
  const { guild, user, member } = interaction;
  const cfg = await getGuildConfig(guild.id);

  const { rows } = await query(
    'SELECT captcha_ok FROM verifications WHERE guild_id = $1 AND user_id = $2',
    [guild.id, user.id],
  );

  // Le captcha doit avoir été résolu : sans ce contrôle, quelqu'un pourrait
  // fabriquer une interaction "accept" et sauter directement l'étape 1.
  if (!rows[0]?.captcha_ok) {
    return interaction.update({
      content: '⚠️ Tu dois d\'abord réussir le défi anti-bot. Relance la vérification.',
      embeds: [], components: [],
    });
  }

  const result = await grantVerified(interaction, cfg);

  if (!result.ok) {
    return interaction.update({ content: result.error, embeds: [], components: [] });
  }

  return interaction.update({ content: '', embeds: [result.embed], components: [] });
}

/**
 * Attribue le rôle membre et finalise la vérification.
 *
 * Partagée par le parcours en deux étapes et le panneau permanent du
 * règlement : deux chemins d'attribution divergents finiraient par ne plus
 * appliquer les mêmes contrôles.
 *
 * Renvoie { ok: true, embed } ou { ok: false, error } — l'appelant décide
 * comment répondre (update pour un message éphémère, reply pour un bouton
 * de salon public).
 */
async function grantVerified(interaction, cfg) {
  const { guild, user, member } = interaction;

  if (!cfg.verified_role_id) {
    log.warn(`Aucun rôle membre configuré sur ${guild.name} (${guild.id})`);
    return {
      ok: false,
      error:
        '⚠️ La vérification est réussie, mais aucun rôle n\'est configuré sur ce serveur.\n' +
        'Préviens un administrateur (`/setup`).',
    };
  }

  try {
    await member.roles.add(cfg.verified_role_id, 'Vérification CarréBot réussie');
    if (cfg.unverified_role_id && member.roles.cache.has(cfg.unverified_role_id)) {
      await member.roles.remove(cfg.unverified_role_id, 'Vérification réussie');
    }
  } catch (err) {
    log.error('Attribution du rôle membre impossible', err);
    return {
      ok: false,
      error:
        '⚠️ Impossible de t\'attribuer le rôle. Le bot manque probablement de permissions ' +
        '(son rôle doit être **au-dessus** du rôle membre dans la hiérarchie).\n' +
        'Préviens un administrateur.',
    };
  }

  await query(
    `INSERT INTO verifications (guild_id, user_id, answer, captcha_ok, rules_ok, verified_at)
     VALUES ($1, $2, '', TRUE, TRUE, NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET rules_ok = TRUE,
                   verified_at = COALESCE(verifications.verified_at, NOW())`,
    [guild.id, user.id],
  );

  await sendLog(guild, {
    color: COLORS.success,
    title: '✅ Nouveau membre vérifié',
    description: `${user} (\`${user.tag}\`) a réussi la vérification et accepté le règlement.`,
  });

  log.info(`${user.tag} vérifié sur ${guild.name}`);

  // Non bloquant : un salon de bienvenue supprimé ne doit jamais faire
  // échouer une vérification par ailleurs réussie.
  sendWelcomeCard(guild, member, cfg).catch(() => {});

  const rolesChannel = cfg.roles_channel_id ? `<#${cfg.roles_channel_id}>` : '`#🎭-roles`';

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🎉 Bienvenue dans la communauté !')
    .setDescription(
      'Tu as maintenant accès à l\'ensemble du serveur.\n\n' +
      `🎭 Choisis ton rang CS2 dans ${rolesChannel}\n` +
      '🎮 Trouve des mates en un clic dans le salon de recherche\n' +
      '👤 `/profil` — ta fiche et tes rangs\n' +
      '❓ `/aide` — le guide complet du serveur\n\n' +
      'Bon jeu !',
    );

  return { ok: true, embed };
}

/**
 * Carte de bienvenue publiée dans #👋-bienvenue au moment de la
 * vérification, et non à l'arrivée : le salon est réservé aux membres
 * vérifiés, un message posté plus tôt serait invisible de l'intéressé.
 */
async function sendWelcomeCard(guild, member, cfg) {
  if (!cfg.welcome_channel_id) return;

  const channel = await guild.channels.fetch(cfg.welcome_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('👋 Un nouveau membre nous rejoint !')
    .setDescription(`Bienvenue ${member} sur **${guild.name}** !`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Membre n°', value: `${guild.memberCount}`, inline: true },
      {
        name: 'Compte créé',
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
        inline: true,
      },
    );

  // Parrainage, quand il a pu être déterminé à l'arrivée. Le champ est
  // simplement absent sinon — une invitation supprimée juste après usage ou
  // deux arrivées simultanées rendent l'origine indécidable.
  const inviterId = await inviterOfMember(guild.id, member.id).catch(() => null);
  if (inviterId) {
    const total = await countInvites(guild.id, inviterId).catch(() => 0);
    embed.addFields({
      name: 'Invité par',
      value: `<@${inviterId}> · **${total}** invitation${total > 1 ? 's' : ''}`,
      inline: true,
    });
  }

  embed
    .setFooter({ text: 'Pense à choisir ton rang dans #🎭-roles' })
    .setTimestamp();

  await channel.send({ content: `${member}`, embeds: [embed] }).catch(() => {});
}

/** Étape 2 (suite) — refus. */
export async function declineRules(interaction) {
  return interaction.update({
    content:
      '❌ Tu as refusé le règlement.\n\n' +
      'Son acceptation est obligatoire pour accéder au serveur. ' +
      'Tu peux relancer la vérification quand tu veux depuis le panneau.',
    embeds: [], components: [],
  });
}

export const DEFAULT_RULES = [
  '**1.** Respecte tous les membres. Aucune insulte, harcèlement ou discrimination.',
  '**2.** Pas de spam, de flood ni de publicité non autorisée.',
  '**3.** Contenu NSFW, choquant ou illégal strictement interdit.',
  '**4.** Pas de triche, de cheat ni de partage de logiciels de triche.',
  '**5.** Utilise les salons pour ce à quoi ils servent.',
  '**6.** Le pseudo et l\'avatar doivent rester corrects.',
  '**7.** Les décisions du staff sont finales. Passe en MP pour contester.',
  '**8.** Respecte les [Conditions d\'utilisation de Discord](https://discord.com/terms).',
].join('\n\n');
