import dns from 'node:dns';
import pg from 'pg';
import { config } from '../lib/config.js';
import { log } from '../lib/logger.js';

const { Pool } = pg;

// Le réseau privé Railway est exclusivement IPv6. Node privilégie IPv4 par
// défaut depuis la v17, ce qui fait échouer la résolution de *.railway.internal.
dns.setDefaultResultOrder('verbatim');

const url = config.databaseUrl ?? '';
const isLocal = /localhost|127\.0\.0\.1/.test(url);
const isPrivateHost = /\.railway\.internal/.test(url);

/**
 * Le réseau privé Railway (*.railway.internal) n'est joignable qu'entre
 * services d'un MÊME projet. Quand la base vit dans un autre projet, ce
 * hostname est irrésolvable : il faut l'URL publique.
 *
 * On bascule donc automatiquement sur DATABASE_PUBLIC_URL si elle est
 * fournie et que DATABASE_URL pointe vers le réseau privé.
 */
const effectiveUrl = isPrivateHost && config.databasePublicUrl
  ? config.databasePublicUrl
  : config.databaseUrl;

const usingPublicFallback = effectiveUrl !== config.databaseUrl;
if (usingPublicFallback) {
  log.info('DATABASE_URL pointe vers le réseau privé — bascule sur DATABASE_PUBLIC_URL');
}

// SSL est requis sur les hôtes publics Railway (proxy.rlwy.net), inutile sur
// le réseau privé (déjà isolé, pas de TLS) et en local.
const needsSsl = !isLocal && !/\.railway\.internal/.test(effectiveUrl);

export const pool = new Pool({
  connectionString: effectiveUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // Une erreur sur un client inactif ne doit jamais tuer le process :
  // le pool remplacera la connexion morte tout seul.
  log.error('Erreur inattendue sur un client PostgreSQL inactif', err);
});

/** Raccourci pour une requête simple. */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Attend que PostgreSQL réponde, avec backoff exponentiel.
 *
 * Sur Railway, le DNS du réseau privé met quelques secondes à se propager
 * après un déploiement : le conteneur du bot démarre souvent avant que
 * `postgres.railway.internal` soit résolvable. Sans cette attente, le bot
 * crashe, redémarre aussitôt, et boucle sans jamais laisser le DNS répondre.
 */
export async function waitForDatabase({ retries = 10, baseDelayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      if (attempt > 1) log.info(`Base joignable après ${attempt} tentative(s)`);
      return;
    } catch (err) {
      const transient = ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ETIMEDOUT'];

      // Un hostname privé qui ne résout pas n'est jamais transitoire : c'est
      // une erreur de configuration. Inutile d'attendre 30s pour rien.
      if (err.code === 'ENOTFOUND' && /\.railway\.internal/.test(err.hostname ?? '')) {
        throw new Error(
          `Le hostname privé « ${err.hostname} » est introuvable.\n\n` +
          '  Le réseau privé Railway ne fonctionne qu\'entre services d\'un MÊME projet.\n' +
          '  Si PostgreSQL est dans un autre projet, il faut l\'URL publique :\n\n' +
          '    1. Service Postgres → onglet Variables → copie DATABASE_PUBLIC_URL\n' +
          '       (host en .proxy.rlwy.net, avec un port à 5 chiffres)\n' +
          '    2. Service du bot → Variables → colle-la dans DATABASE_URL\n\n' +
          '  Autre option : déplacer les deux services dans le même projet.',
          { cause: err },
        );
      }

      if (!transient.includes(err.code) || attempt === retries) throw err;

      // 1s, 2s, 4s… plafonné à 8s : ~30s d'attente cumulée sur 10 essais.
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 8000);
      log.warn(
        `Base injoignable (${err.code}) — nouvelle tentative dans ${delay / 1000}s ` +
        `[${attempt}/${retries}]`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/** Exécute un ensemble de requêtes dans une transaction. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Crée les tables si elles n'existent pas. Idempotent : appelé à chaque
 * démarrage, ce qui rend les redéploiements Railway sans effet de bord.
 */
export async function initDatabase() {
  await query(`
    -- Configuration par serveur (salons, rôles, réglages)
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id            TEXT PRIMARY KEY,
      verify_channel_id   TEXT,
      rules_channel_id    TEXT,
      logs_channel_id     TEXT,
      lfg_channel_id      TEXT,
      unverified_role_id  TEXT,
      verified_role_id    TEXT,
      member_role_id      TEXT,
      rules_text          TEXT,
      antiraid_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      antiraid_joins      INTEGER NOT NULL DEFAULT 5,
      antiraid_window     INTEGER NOT NULL DEFAULT 10,
      antiraid_min_age    INTEGER NOT NULL DEFAULT 7,
      lockdown_active     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Sessions de captcha en cours (une par membre non vérifié)
    CREATE TABLE IF NOT EXISTS verifications (
      guild_id     TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      answer       TEXT NOT NULL,
      attempts     INTEGER NOT NULL DEFAULT 0,
      captcha_ok   BOOLEAN NOT NULL DEFAULT FALSE,
      rules_ok     BOOLEAN NOT NULL DEFAULT FALSE,
      verified_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    -- Sanctions
    CREATE TABLE IF NOT EXISTS warnings (
      id          SERIAL PRIMARY KEY,
      guild_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason      TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_warnings_guild_user
      ON warnings (guild_id, user_id);

    -- Tournois et events
    CREATE TABLE IF NOT EXISTS tournaments (
      id           SERIAL PRIMARY KEY,
      guild_id     TEXT NOT NULL,
      channel_id   TEXT NOT NULL,
      message_id   TEXT,
      name         TEXT NOT NULL,
      description  TEXT,
      game         TEXT NOT NULL DEFAULT 'CS2',
      format       TEXT NOT NULL DEFAULT '5v5',
      max_teams    INTEGER,
      starts_at    TIMESTAMPTZ,
      status       TEXT NOT NULL DEFAULT 'open',
      created_by   TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tournament_signups (
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL,
      team_name     TEXT,
      signed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tournament_id, user_id)
    );

    -- Giveaways
    CREATE TABLE IF NOT EXISTS giveaways (
      id          SERIAL PRIMARY KEY,
      guild_id    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      message_id  TEXT,
      prize       TEXT NOT NULL,
      winners     INTEGER NOT NULL DEFAULT 1,
      ends_at     TIMESTAMPTZ NOT NULL,
      ended       BOOLEAN NOT NULL DEFAULT FALSE,
      created_by  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS giveaway_entries (
      giveaway_id INTEGER NOT NULL REFERENCES giveaways(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL,
      entered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (giveaway_id, user_id)
    );

    -- Annonces de recherche de mates (LFG)
    CREATE TABLE IF NOT EXISTS lfg_posts (
      id          SERIAL PRIMARY KEY,
      guild_id    TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      message_id  TEXT,
      user_id     TEXT NOT NULL,
      game        TEXT NOT NULL DEFAULT 'CS2',
      mode        TEXT NOT NULL,
      rank        TEXT,
      slots       INTEGER NOT NULL DEFAULT 1,
      note        TEXT,
      closed      BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lfg_joins (
      post_id   INTEGER NOT NULL REFERENCES lfg_posts(id) ON DELETE CASCADE,
      user_id   TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    );
  `);

  // Migrations additives.
  // `CREATE TABLE IF NOT EXISTS` ne touche pas une table déjà créée : sans
  // ces ALTER, un serveur déployé avant l'ajout d'une colonne planterait.
  await query(`
    ALTER TABLE verifications ADD COLUMN IF NOT EXISTS captcha_ok BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  log.info('Base de données initialisée');
}

/** Récupère (ou crée) la configuration d'un serveur. */
export async function getGuildConfig(guildId) {
  const { rows } = await query(
    `INSERT INTO guild_config (guild_id) VALUES ($1)
     ON CONFLICT (guild_id) DO UPDATE SET guild_id = EXCLUDED.guild_id
     RETURNING *`,
    [guildId],
  );
  return rows[0];
}

/**
 * Met à jour une partie de la config d'un serveur.
 * Les clés sont validées contre une liste blanche : `patch` peut venir
 * d'une commande, il ne doit jamais pouvoir viser une colonne arbitraire.
 */
const UPDATABLE_FIELDS = new Set([
  'verify_channel_id', 'rules_channel_id', 'logs_channel_id', 'lfg_channel_id',
  'unverified_role_id', 'verified_role_id', 'member_role_id', 'rules_text',
  'antiraid_enabled', 'antiraid_joins', 'antiraid_window', 'antiraid_min_age',
  'lockdown_active',
]);

export async function updateGuildConfig(guildId, patch) {
  const entries = Object.entries(patch).filter(([k]) => UPDATABLE_FIELDS.has(k));
  if (entries.length === 0) return getGuildConfig(guildId);

  await getGuildConfig(guildId); // garantit que la ligne existe

  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const values = entries.map(([, v]) => v);

  const { rows } = await query(
    `UPDATE guild_config SET ${sets}, updated_at = NOW()
     WHERE guild_id = $1 RETURNING *`,
    [guildId, ...values],
  );
  return rows[0];
}
