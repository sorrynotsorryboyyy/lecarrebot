import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contrôle syntaxique de tous les fichiers du projet.
 *
 * Le bot est déployé par simple push sur Railway, sans intégration continue :
 * une erreur de syntaxe part directement en production et laisse le service
 * en boucle de redémarrage. Ce script est le garde-fou minimal — à lancer
 * avant chaque push, avec `npm run verify`.
 */

function collect(dir) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...collect(path));
    else if (path.endsWith('.js')) files.push(path);
  }

  return files;
}

const files = [...collect('src'), ...collect('scripts')];
const failures = [];

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    failures.push({ file, message: String(err.stderr ?? err.message).trim() });
  }
}

if (failures.length > 0) {
  for (const { file, message } of failures) {
    console.error(`\n❌ ${file}\n${message}`);
  }
  console.error(`\n${failures.length} fichier(s) en erreur sur ${files.length}.`);
  process.exit(1);
}

console.log(`✅ ${files.length} fichiers vérifiés, aucune erreur de syntaxe.`);
