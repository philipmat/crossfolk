// Usage: node scripts/build-wordnet.mjs /path/to/WordNet-3.0/dict
// Generates a licensed, local word/clue supplement. No network use at runtime.
import fs from 'node:fs';
import path from 'node:path';

const directory = process.argv[2];
if (!directory) throw new Error('Pass the WordNet 3.0 dict directory');
const data = fs.readFileSync(path.join(directory, 'data.noun'), 'utf8');
const license = data.split('\n').filter(l => /^\s/.test(l)).map(l => l.replace(/^\s*\d+\s?/, '')).join('\n');
fs.writeFileSync('public/WORDNET-LICENSE.txt', license + '\n');
const matchers = {
  ocean: /\b(marine|ocean|sea|seas|saltwater|tidal|coastal|coral|reef|ship|sail|nautical|seawater)\b/i,
  space: /\b(celestial|astronomical|astronomy|planet|solar|lunar|cosmic|orbit|galaxy|spacecraft|astronaut|sun|moon)\b/i,
  music: /\b(music|musical|melody|musician|singing|song|rhythmic|jazz|orchestra|singer|saxophone|guitar|piano)\b/i,
  sports: /\b(sport|sports|athlete|athletic|baseball|tennis|soccer|football|golf|hockey|rugby|basketball|cricket|skating|skiing|boxing|wrestling)\b/i,
  travel: /\b(travel|journey|tourist|vehicle|aircraft|railway|railroad|transportation|lodging|hotel|roadway|passport|sightseeing)\b/i,
  weather: /\b(weather|cloud|rain|snow|wind|frost|storm|humidity|meteorological|precipitation)\b/i,
  garden: /\b(garden|gardening|horticulture|cultivated|flower|shrub|seedling|weeding|fertilizer)\b/i,
};
const forbidden = /\b(heroin|cocaine|narcotic|offensive|vulgar|sexual|slur|derogatory|obscene|genital|penis|vagina|anus|semen|intercourse|copulat|excrement|defecat)\w*/i;
const blocked = new Set(['ASS', 'FAG', 'FAGS', 'COON', 'CUNT', 'DICK', 'DYKE', 'FUCK', 'SHIT', 'TITS', 'TURD', 'SLUT', 'WHORE', 'SPIC', 'KIKE', 'WOP', 'CHINK']);
const general = new Map(),
  themes = Object.fromEntries(['nature', 'ocean', 'space', 'food', 'music', 'travel', 'sports', 'animals', 'weather', 'garden'].map(k => [k, new Map()]));
for (const kind of ['noun', 'verb', 'adj', 'adv']) for (const line of fs.readFileSync(path.join(directory, 'data.' + kind), 'utf8').split('\n')) {
  if (!/^\d/.test(line)) continue;
  const [header, gloss = ''] = line.split('|');
  const tokens = header.trim().split(/\s+/);
  const lex = Number(tokens[1]), count = parseInt(tokens[3], 16);
  let clue = gloss.trim().split(/;\s*"/)[0].replace(/\s+/g, ' ');
  if (!clue || clue.length > 160 || forbidden.test(clue)) continue;
  clue = clue[0].toUpperCase() + clue.slice(1);
  for (let i = 0; i < count; i++) {
    const raw = tokens[4 + i * 2].replace(/\([aps]\)$/, '');
    if (!/^[a-z]{3,5}$/.test(raw)) continue;
    const answer = raw.toUpperCase();
    if (blocked.has(answer) || new RegExp('\\b' + raw + '\\b', 'i').test(clue)) continue;
    const entry = {answer, clue};
    if (!general.has(answer)) general.set(answer, entry);
    const memberships = [];
    if (lex === 5) memberships.push('animals', 'nature');
    if (lex === 20) memberships.push('nature', 'garden');
    if (lex === 13) memberships.push('food');
    for (const [theme, pattern] of Object.entries(matchers)) if (pattern.test(clue) && !(/\b(actor|actress|film|movie|television)\b/i.test(clue) && theme === 'space')) memberships.push(theme);
    for (const theme of memberships) if (!(theme === 'ocean' && /sea level/i.test(clue)) && !themes[theme].has(answer)) themes[theme].set(answer, entry);
  }
}
fs.writeFileSync('public/wordnet-words.js', '/*\nDerived from WordNet 3.0; modified by selecting short entries and definitions.\n' + license + '\n*/\nexport const dictionaryWords = ' + JSON.stringify([...general.values()]) + ';\nexport const dictionaryThemes = ' + JSON.stringify(Object.fromEntries(Object.entries(themes).map(([key, value]) => [key, [...value.values()]]))) + ';\n');
console.log('General words:', general.size, 'Theme counts:', Object.fromEntries(Object.entries(themes).map(([k, v]) => [k, v.size])));
