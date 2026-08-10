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
      logs_channel_id     TEXT,
      lfg_channel_id      TEXT,
      welcome_channel_id  TEXT,
      roles_channel_id    TEXT,
      unverified_role_id  TEXT,
      verified_role_id    TEXT,
      rank_roles          JSONB NOT NULL DEFAULT '{}'::jsonb,
      identity_roles      JSONB NOT NULL DEFAULT '{}'::jsonb,
      channel_ids         JSONB NOT NULL DEFAULT '{}'::jsonb,
      -- Surcharges pilotables par /config, sans redéploiement.
      media_policies      JSONB NOT NULL DEFAULT '{}'::jsonb,
      default_banners     JSONB NOT NULL DEFAULT '{}'::jsonb,
      vip_role_id         TEXT,
      losange_role_id     TEXT,
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
      vip_only    BOOLEAN NOT NULL DEFAULT FALSE,
      -- Texte libre affiché dans l'embed. Purement informatif : le bot ne
      -- vérifie pas ces conditions (« inviter 10 personnes » n'est pas
      -- mesurable de façon fiable), c'est le staff qui arbitre.
      conditions  TEXT,
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

    -- Comptes de jeu liés par les membres.
    CREATE TABLE IF NOT EXISTS member_links (
      guild_id        TEXT NOT NULL,
      user_id         TEXT NOT NULL,
      faceit_nickname TEXT,
      faceit_player_id TEXT,
      steam_id64      TEXT,
      linked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    -- Statistiques mises en cache.
    -- /profil lit ICI et jamais l'API : un appel réseau à chaque affichage
    -- épuiserait les quotas et rendrait la commande lente.
    CREATE TABLE IF NOT EXISTS stats_cache (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      source     TEXT NOT NULL,
      payload    JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id, source)
    );

    -- Tickets de support.
    CREATE TABLE IF NOT EXISTS tickets (
      id         SERIAL PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      channel_id TEXT UNIQUE,
      user_id    TEXT NOT NULL,
      subject    TEXT,
      status     TEXT NOT NULL DEFAULT 'open',
      closed_by  TEXT,
      closed_at  TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Index partiel : rend immédiate la garde « un seul ticket ouvert par
    -- membre ». Sans elle, un membre qui spamme le bouton créerait autant
    -- de salons que de clics.
    CREATE INDEX IF NOT EXISTS idx_tickets_open
      ON tickets (guild_id, user_id) WHERE status = 'open';

    -- Publications composées via le panneau staff.
    -- Sert à la fois de brouillon (published = FALSE, publish_at NULL) et
    -- de file d'attente pour les publications programmées. Les brouillons
    -- vivent en base et non en mémoire : un redéploiement Railway ne doit
    -- pas faire perdre une annonce en cours de rédaction.
    CREATE TABLE IF NOT EXISTS publications (
      id           SERIAL PRIMARY KEY,
      guild_id     TEXT NOT NULL,
      kind         TEXT NOT NULL,
      channel_id   TEXT,
      message_id   TEXT,
      title        TEXT NOT NULL DEFAULT '',
      body         TEXT,
      image_url    TEXT,
      link_url     TEXT,
      link_label   TEXT,
      color        INTEGER,
      mention      TEXT,
      fields       JSONB NOT NULL DEFAULT '[]'::jsonb,
      extra        JSONB NOT NULL DEFAULT '{}'::jsonb,
      ref_id       INTEGER,
      publish_at   TIMESTAMPTZ,
      published    BOOLEAN NOT NULL DEFAULT FALSE,
      created_by   TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Index partiel : le scheduler ne balaie que ce qui reste à publier.
    CREATE INDEX IF NOT EXISTS idx_pub_pending
      ON publications (guild_id, publish_at) WHERE published = FALSE;
    -- Un seul brouillon en cours par rédacteur : le retrouver doit être
    -- immédiat à chaque clic sur l'aperçu.
    CREATE INDEX IF NOT EXISTS idx_pub_draft
      ON publications (guild_id, created_by) WHERE published = FALSE;

    -- Qui a invité qui.
    -- La clé primaire porte sur l'ARRIVANT : un membre ne peut être crédité
    -- qu'une fois, même s'il quitte le serveur et y revient.
    CREATE TABLE IF NOT EXISTS invite_credits (
      guild_id   TEXT NOT NULL,
      member_id  TEXT NOT NULL,
      inviter_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, member_id)
    );
    -- Classement des parrains : compte par invitant au sein d'un serveur.
    CREATE INDEX IF NOT EXISTS idx_invite_credits_inviter
      ON invite_credits (guild_id, inviter_id);

    -- Salons vocaux créés à la demande
    CREATE TABLE IF NOT EXISTS temp_voice_channels (
      channel_id TEXT PRIMARY KEY,
      guild_id   TEXT NOT NULL,
      owner_id   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Membres VIP / Elite
    CREATE TABLE IF NOT EXISTS vip_members (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    -- Stratégies et line-ups publiés par le staff
    CREATE TABLE IF NOT EXISTS strats (
      id          SERIAL PRIMARY KEY,
      guild_id    TEXT NOT NULL,
      message_id  TEXT,
      map         TEXT NOT NULL,
      side        TEXT,
      title       TEXT NOT NULL,
      description TEXT,
      link        TEXT,
      created_by  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Giveaways réservés aux VIP (colonne ajoutée en migration ci-dessous)
  `);

  // Migrations additives.
  // `CREATE TABLE IF NOT EXISTS` ne touche pas une table déjà créée : sans
  // ces ALTER, un serveur déployé avant l'ajout d'une colonne planterait.
  await query(`
    ALTER TABLE verifications ADD COLUMN IF NOT EXISTS captcha_ok BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS welcome_channel_id TEXT;
    ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS roles_channel_id   TEXT;
    ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS rank_roles JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS identity_roles JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS channel_ids JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS vip_role_id TEXT;
    ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS losange_role_id TEXT;
    ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS media_policies JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS default_banners JSONB NOT NULL DEFAULT '{}'::jsonb;

    -- Fenêtre d'inscription réservée aux Elite. NULL = ouvert à tous d'emblée.
    ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS public_signups_at TIMESTAMPTZ;
    -- Bannière et lien des tournois et giveaways, alimentés par le panneau.
    ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS image_url TEXT;
    ALTER TABLE giveaways   ADD COLUMN IF NOT EXISTS image_url TEXT;

    ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS vip_only BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE giveaways ADD COLUMN IF NOT EXISTS conditions TEXT;

    -- Le système d'XP a été abandonné : la table n'a jamais reçu la moindre
    -- écriture (aucun INSERT nulle part dans le code). On la retire pour que
    -- le schéma cesse de décrire une fonctionnalité inexistante.
    DROP TABLE IF EXISTS member_xp;
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
  'verify_channel_id', 'logs_channel_id', 'lfg_channel_id',
  'welcome_channel_id', 'roles_channel_id',
  'unverified_role_id', 'verified_role_id',
  'rank_roles', 'identity_roles', 'channel_ids', 'vip_role_id', 'losange_role_id',
  'media_policies', 'default_banners',
  'rules_text',
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
