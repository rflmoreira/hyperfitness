// Teste de regressão do matching 4shared + backoff do player.
// Extrai as funções REAIS de src/player/player.js (sem réplicas) e valida:
//  - Similaridades (Dice, Levenshtein, Jaro-Winkler, score combinado)
//  - Rejeição automática de palavras proibidas (cover, live, karaoke...)
//  - Gate de artista divergente
//  - Componente de duração
//  - Limites do retry exponencial com jitter
//
// Uso: node tests/player-matching.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, '..', 'src', 'player', 'player.js'), 'utf8');

// --- Extração de trechos reais do player.js ---
// As funções do player estão no nível raiz do IIFE (indentação de 2 espaços),
// então o fechamento é a primeira linha "  }" após a declaração. Não usamos
// contagem de chaves porque regex literals contêm chaves desbalanceadas.
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Função não encontrada: ${name}`);
  const end = source.indexOf('\n  }', start);
  if (end === -1) throw new Error(`Fechamento não encontrado: ${name}`);
  return source.slice(start, end + 4);
}

function extractConst(name) {
  const re = new RegExp(`const ${name} = [^;]+;`, 's');
  const match = source.match(re);
  if (!match) throw new Error(`Const não encontrada: ${name}`);
  return match[0];
}

const code = [
  extractConst('AUDIO_MATCH_JUNK_TERMS'),
  extractConst('FOURSHARED_FORBIDDEN_TERMS'),
  extractConst('FOURSHARED_MIN_SCORE'),
  extractConst('FOURSHARED_MIN_TITLE_SIM'),
  extractConst('FOURSHARED_MIN_ARTIST_SIM'),
  extractFunction('normalizeForAudioMatch'),
  extractFunction('tokenDiceSimilarity'),
  extractFunction('levenshteinSimilarity'),
  extractFunction('jaroWinklerSimilarity'),
  extractFunction('textSimilarity'),
  extractFunction('findForbiddenTerm'),
  extractFunction('score4sharedCandidate'),
  extractFunction('backoffDelay'),
  `return { normalizeForAudioMatch, tokenDiceSimilarity, levenshteinSimilarity,
    jaroWinklerSimilarity, textSimilarity, findForbiddenTerm, score4sharedCandidate,
    backoffDelay, FOURSHARED_MIN_SCORE, FOURSHARED_MIN_TITLE_SIM, FOURSHARED_MIN_ARTIST_SIM };`
].join('\n\n');

const fns = new Function(code)();
const {
  tokenDiceSimilarity, levenshteinSimilarity, jaroWinklerSimilarity, textSimilarity,
  findForbiddenTerm, score4sharedCandidate, backoffDelay,
  FOURSHARED_MIN_SCORE, FOURSHARED_MIN_TITLE_SIM
} = fns;

// --- Casos de teste ---
let failures = 0;
const check = (name, cond) => {
  if (!cond) failures += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}`);
};
const accept = (r) => r.score >= FOURSHARED_MIN_SCORE && r.titleSim >= FOURSHARED_MIN_TITLE_SIM;

// Similaridades básicas
check('levenshtein typo beliver~believer > 0.85', levenshteinSimilarity('beliver', 'believer') > 0.85);
check('jaroWinkler prefixo believer~believers > 0.9', jaroWinklerSimilarity('believer', 'believers') > 0.9);
check('textSimilarity typo > dice puro', textSimilarity('beliver', 'believer') > tokenDiceSimilarity('beliver', 'believer'));
check('textSimilarity ordem invertida = 1', textSimilarity('yourself lose', 'lose yourself') === 1);

// Match correto aceito
const good = score4sharedCandidate('Eminem - Lose Yourself.mp3', 'Lose Yourself', 'Eminem');
check(`match correto aceito (${(good.score * 100).toFixed(0)}%)`, accept(good));

// Typo no arquivo ainda aceito
const typo = score4sharedCandidate('Eminem - Loose Yourself.mp3', 'Lose Yourself', 'Eminem');
check(`typo no arquivo aceito (${(typo.score * 100).toFixed(0)}%)`, accept(typo));

// Palavras proibidas rejeitadas automaticamente
const live = score4sharedCandidate('Eminem - Lose Yourself (Live).mp3', 'Lose Yourself', 'Eminem');
check(`versão live rejeitada [${live.rejectedBy}]`, live.score === 0);

const cover = score4sharedCandidate('Lose Yourself - Piano Cover.mp3', 'Lose Yourself', 'Eminem');
check(`cover rejeitado [${cover.rejectedBy}]`, cover.score === 0);

const karaoke = score4sharedCandidate('Lose Yourself Karaoke Version.mp3', 'Lose Yourself', 'Eminem');
check(`karaoke rejeitado [${karaoke.rejectedBy}]`, karaoke.score === 0);

// Termo proibido presente no PEDIDO não causa rejeição
const wantRemix = score4sharedCandidate('Calvin Harris - Song Remix.mp3', 'Song Remix', 'Calvin Harris');
check('remix pedido não rejeitado por termo proibido', !String(wantRemix.rejectedBy || '').includes('proibido'));

// Word-boundary: sem falsos positivos
check('deliver(ance) não dispara "live"', findForbiddenTerm('Deliverance.mp3', 'Deliverance') === null);
check('coverage não dispara "cover"', findForbiddenTerm('Full Coverage.mp3', 'Full Coverage') === null);

// Artista divergente rejeitado mesmo com título idêntico
const wrongArtist = score4sharedCandidate('Alicia Keys - Lose Yourself.mp3', 'Lose Yourself', 'Eminem');
check(`artista divergente rejeitado [${wrongArtist.rejectedBy}]`, wrongArtist.score === 0);

// Duração compatível mantém aceite; divergente reduz score
const withDur = score4sharedCandidate('Eminem - Lose Yourself.mp3', 'Lose Yourself', 'Eminem', { trackDurationMs: 326000, fileDurationSec: 328 });
check(`duração compatível mantém aceite (${(withDur.score * 100).toFixed(0)}%)`, accept(withDur));

const badDur = score4sharedCandidate('Eminem - Lose Yourself.mp3', 'Lose Yourself', 'Eminem', { trackDurationMs: 326000, fileDurationSec: 95 });
check(`duração divergente reduz score (${(badDur.score * 100).toFixed(0)}% < ${(withDur.score * 100).toFixed(0)}%)`, badDur.score < withDur.score);

// Backoff exponencial: 1s/2s/4s/8s com jitter 50–100%
let backoffOk = true;
for (let attempt = 0; attempt < 4; attempt++) {
  for (let i = 0; i < 200; i++) {
    const d = backoffDelay(attempt);
    const expected = Math.min(8000, 1000 * Math.pow(2, attempt));
    if (d < expected * 0.5 - 1 || d > expected + 1) { backoffOk = false; break; }
  }
}
check('backoff 1s/2s/4s/8s com jitter 50–100%', backoffOk);

console.log(failures ? `\n${failures} teste(s) falharam` : '\nTodos os testes passaram');
process.exit(failures ? 1 : 0);
