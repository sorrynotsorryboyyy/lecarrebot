import { config } from './config.js';
import { query } from '../db/index.js';
import { log } from './logger.js';

/**
 * Statistiques CS2 — Faceit et Steam.
 *
 * Deux sources complémentaires : Faceit donne le niveau et l'Elo compétitif,
 * Steam les heures de jeu et les statistiques générales. Valve n'expose
 * AUCUNE API publique pour la cote Premier — elle reste déclarative, via les
 * menus de #🎭-roles.
 *
 * Règle absolue : `/profil` lit le CACHE, jamais l'API. Un appel réseau à
 * chaque affichage épuiserait les quotas et rendrait la commande lente et
 * fragile. Le rafraîchissement se fait en arrière-plan, et des données
 * périmées valent mieux qu'une commande qui bloque.
 */

/** Durée de validité du cache. */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Au-delà, on abandonne : mieux vaut servir du périmé qu'attendre. */
const TIMEOUT_MS = 8000;

/** AppID de Counter-Strike 2 sur Steam. */
const CS2_APPID = 730;

export const isFaceitEnabled = () => Boolean(config.faceitApiKey);
export const isSteamEnabled = () => Boolean(config.steamApiKey);

/** Erreur porteuse d'un message déjà rédigé pour l'utilisateur. */
export class StatsError extends Error {}

/** Appel HTTP avec délai maximal. */
async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// ───────────────────────────── Faceit ─────────────────────────────

/**
 * Résout un pseudo Faceit et lit ses statistiques CS2.
 * Deux appels : le profil, puis les statistiques du jeu.
 */
export async function fetchFaceit(nickname) {
  if (!isFaceitEnabled()) {
    throw new StatsError('Les stats Faceit ne sont pas configurées sur ce bot.');
  }

  const headers = { Authorization: `Bearer ${config.faceitApiKey}` };

  let player;
  try {
    player = await fetchJson(
      `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}`,
      { headers },
    );
  } catch (err) {
    if (err.status === 404) {
      throw new StatsError(
        `Pseudo Faceit **${nickname}** introuvable.\n` +
        'Attention aux majuscules et aux caractères spéciaux — copie-le depuis ton profil.',
      );
    }
    throw new StatsError('Faceit ne répond pas pour le moment. Réessaie dans quelques minutes.');
  }

  const cs2 = player.games?.cs2;
  if (!cs2) {
    throw new StatsError(
      `**${player.nickname}** existe sur Faceit, mais n'a jamais joué à CS2.\n` +
      'Lance au moins une partie Faceit sur CS2 avant de lier ton compte.',
    );
  }

  // Les statistiques détaillées sont un bonus : leur absence ne doit pas
  // faire échouer la liaison.
  let stats = null;
  try {
    stats = await fetchJson(
      `https://open.faceit.com/data/v4/players/${player.player_id}/stats/cs2`,
      { headers },
    );
  } catch {
    log.debug(`Stats Faceit détaillées indisponibles pour ${player.nickname}`);
  }

  const lifetime = stats?.lifetime ?? {};

  return {
    playerId: player.player_id,
    nickname: player.nickname,
    country: player.country ?? null,
    level: cs2.skill_level ?? null,
    elo: cs2.faceit_elo ?? null,
    matches: Number(lifetime['Matches'] ?? 0) || null,
    winrate: Number(lifetime['Win Rate %'] ?? 0) || null,
    kd: Number(lifetime['Average K/D Ratio'] ?? 0) || null,
    hs: Number(lifetime['Average Headshots %'] ?? 0) || null,
  };
}

// ───────────────────────────── Steam ─────────────────────────────

/** Extrait un SteamID64 d'une URL, d'un identifiant ou d'un pseudo vanity. */
export async function resolveSteamId(input) {
  if (!isSteamEnabled()) {
    throw new StatsError('Les stats Steam ne sont pas configurées sur ce bot.');
  }

  const value = String(input).trim();

  // Déjà un SteamID64 : 17 chiffres.
  const direct = value.match(/(\d{17})/);
  if (direct) return direct[1];

  // URL de profil : /profiles/<id64> ou /id/<vanity>.
  const profileUrl = value.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profileUrl) return profileUrl[1];

  const vanityUrl = value.match(/steamcommunity\.com\/id\/([^/\s]+)/);
  const vanity = vanityUrl ? vanityUrl[1] : value;

  try {
    const data = await fetchJson(
      'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/' +
      `?key=${config.steamApiKey}&vanityurl=${encodeURIComponent(vanity)}`,
    );

    // `success: 42` signifie « aucune correspondance ».
    if (data.response?.success !== 1) {
      throw new StatsError(
        `Profil Steam **${vanity}** introuvable.\n` +
        'Colle plutôt l\'URL complète de ton profil (`https://steamcommunity.com/id/…`).',
      );
    }

    return data.response.steamid;
  } catch (err) {
    if (err instanceof StatsError) throw err;
    throw new StatsError('Steam ne répond pas pour le moment. Réessaie dans quelques minutes.');
  }
}

/**
 * Statistiques CS2 d'un compte Steam.
 *
 * Le cas d'échec le plus fréquent est de loin le profil privé : Steam
 * renvoie alors 403, ou un objet vide. On l'explique précisément, sinon
 * l'utilisateur croit à un bug du bot.
 */
export async function fetchSteam(steamId64) {
  if (!isSteamEnabled()) {
    throw new StatsError('Les stats Steam ne sont pas configurées sur ce bot.');
  }

  const key = config.steamApiKey;
  const result = { steamId: steamId64, name: null, hours: null, kills: null, wins: null };

  // Profil public : pseudo et avatar.
  try {
    const summary = await fetchJson(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${key}&steamids=${steamId64}`,
    );
    const player = summary.response?.players?.[0];
    if (player) {
      result.name = player.personaname ?? null;
      result.avatar = player.avatarfull ?? null;
    }
  } catch {
    log.debug(`Résumé Steam indisponible pour ${steamId64}`);
  }

  // Heures de jeu.
  try {
    const owned = await fetchJson(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${key}` +
      `&steamid=${steamId64}&include_appinfo=false&appids_filter[0]=${CS2_APPID}`,
    );
    const game = owned.response?.games?.find((g) => g.appid === CS2_APPID);
    if (game) result.hours = Math.round(game.playtime_forever / 60);
  } catch {
    log.debug(`Bibliothèque Steam privée pour ${steamId64}`);
  }

  // Statistiques de jeu — la partie la plus souvent bloquée.
  try {
    const stats = await fetchJson(
      `https://api.steampowered.com/ISteamUserStats/GetUserStatsForGame/v0002/` +
      `?appid=${CS2_APPID}&key=${key}&steamid=${steamId64}`,
    );

    const values = new Map(
      (stats.playerstats?.stats ?? []).map((s) => [s.name, s.value]),
    );

    result.kills = values.get('total_kills') ?? null;
    result.wins = values.get('total_wins') ?? null;
    result.deaths = values.get('total_deaths') ?? null;
    result.timePlayed = values.get('total_time_played')
      ? Math.round(values.get('total_time_played') / 3600)
      : null;
  } catch (err) {
    if (err.status === 403) {
      throw new StatsError(
        'Ton profil Steam est **privé**.\n\n' +
        'Sur Steam : **Profil → Modifier le profil → Confidentialité**, ' +
        'puis passe **« Détails du jeu »** sur **Public**. ' +
        'Réessaie ensuite avec `/lier actualiser`.',
      );
    }
    log.debug(`Stats CS2 indisponibles pour ${steamId64} : ${err.message}`);
  }

  // Rien du tout : le profil est privé de bout en bout.
  if (result.hours === null && result.kills === null && result.name === null) {
    throw new StatsError(
      'Impossible de lire ce profil Steam — il est probablement **privé**.\n\n' +
      'Passe **« Détails du jeu »** sur **Public** dans tes paramètres de confidentialité.',
    );
  }

  return result;
}

// ───────────────────────────── Cache ─────────────────────────────

/** Enregistre un jeu de statistiques. */
export async function saveStats(guildId, userId, source, payload) {
  await query(
    `INSERT INTO stats_cache (guild_id, user_id, source, payload, fetched_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (guild_id, user_id, source)
     DO UPDATE SET payload = EXCLUDED.payload, fetched_at = NOW()`,
    [guildId, userId, source, JSON.stringify(payload)],
  );
}

/** Lit le cache d'un membre. Renvoie `{ faceit, steam }`, valeurs ou null. */
export async function readStats(guildId, userId) {
  const { rows } = await query(
    'SELECT source, payload, fetched_at FROM stats_cache WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId],
  );

  const result = { faceit: null, steam: null };

  for (const row of rows) {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    result[row.source] = { ...payload, fetchedAt: row.fetched_at };
  }

  return result;
}

/** Comptes liés d'un membre. */
export async function readLinks(guildId, userId) {
  const { rows } = await query(
    'SELECT * FROM member_links WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId],
  );
  return rows[0] ?? null;
}

/**
 * Rafraîchit le cache d'un membre depuis ses comptes liés.
 *
 * Conçu pour être lancé SANS `await` depuis /profil : les erreurs sont
 * avalées, l'affichage ne doit jamais dépendre du réseau.
 */
export async function refreshStats(guildId, userId) {
  const links = await readLinks(guildId, userId);
  if (!links) return;

  if (links.faceit_nickname && isFaceitEnabled()) {
    try {
      const data = await fetchFaceit(links.faceit_nickname);
      await saveStats(guildId, userId, 'faceit', data);
    } catch (err) {
      log.debug(`Rafraîchissement Faceit impossible : ${err.message}`);
    }
  }

  if (links.steam_id64 && isSteamEnabled()) {
    try {
      const data = await fetchSteam(links.steam_id64);
      await saveStats(guildId, userId, 'steam', data);
    } catch (err) {
      log.debug(`Rafraîchissement Steam impossible : ${err.message}`);
    }
  }
}

/** Le cache d'une source est-il périmé ? */
export function isStale(entry) {
  if (!entry?.fetchedAt) return true;
  return Date.now() - new Date(entry.fetchedAt).getTime() > CACHE_TTL_MS;
}
