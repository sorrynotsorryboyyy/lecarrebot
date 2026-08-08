import pg from 'pg';
import { config } from '../lib/config.js';
import { log } from '../lib/logger.js';

const { Pool } = pg;

/**
 * Railway fournit DATABASE_URL avec SSL activé mais un certificat interne
 * non vérifiable par la chaîne système, d'où `rejectUnauthorized: false`.
 * En local (localhost), on désactive SSL entièrement.
 */
const isLocal = /localhost|127\.0\.0\.1/.test(config.databaseUrl ?? '');

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
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
