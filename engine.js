import { generateDense } from './dense.js';
import { fillWords } from './fill-words.js';
import { themeVocabulary } from './theme-fill.js';
import { themedPlurals } from './theme-plurals.js';
import { themeClues } from './theme-clues.js';
import { dictionaryWords, dictionaryThemes } from './wordnet-words.js';
import { denseFallbacks } from './dense-fallbacks.js';

const BANKS = {
  nature: [
    ["OAK","An acorn-bearing tree","A hardwood with lobed leaves","A Quercus specimen"],
    ["ELM","A shady street tree","Tree once common along avenues","An Ulmus specimen"],
    ["IVY","A climbing plant","Evergreen wall climber","A Hedera vine"],
    ['TREE', 'A tall plant with a trunk', 'It has bark and branches', 'A woody perennial'],
    ['RIVER', 'Flowing natural water', 'It runs toward a lake or sea', 'A fluvial channel'],
    ['LEAF', 'Flat green part of a plant', 'It grows from a stem', 'Photosynthesis site'],
    ['MOSS', 'Soft green ground cover', 'A tiny plant found on damp rocks', 'A nonvascular bryophyte'],
    ['STONE', 'A small rock', 'A hard natural mineral piece', 'A weathered mineral fragment'],
    ['CLOUD', 'White shape in the sky', 'A visible mass of water droplets', 'An atmospheric aerosol'],
    ['TRAIL', 'A path through the woods', 'A marked outdoor route', 'A backcountry course'],
    ['BLOOM', 'A flower opening', 'A plant at its showiest', 'Anthesis, informally'],
    ['GROVE', 'A small group of trees', 'A little wooded area', 'A compact stand of trees'],
    ['CEDAR', 'An evergreen tree', 'A fragrant conifer', 'Tree of the genus Cedrus'],
    ['FERN', 'A feathery forest plant', 'A plant that grows from spores', 'A seedless vascular plant'],
    ['DEER', 'A woodland animal with hooves', 'An animal whose males may have antlers', 'A cervid'],
  ],
  ocean: [
    ["SEA","A large body of salt water","An expanse of ocean","A saline expanse"],
    ["EEL","A long slippery fish","A snakelike swimmer","An anguilliform fish"],
    ["COD","A fish used in fish and chips","Atlantic food fish","A Gadus species"],
    ['TIDE', 'The sea rising and falling', 'A change in sea level', 'A lunar-driven water cycle'],
    ['REEF', 'A rocky home for sea life', 'Coral may build this', 'A shallow marine ridge'],
    ['WAVE', 'A rolling swell of water', 'It may break on a beach', 'An oscillation at the surface'],
    ['CORAL', 'Colorful reef builder', 'A tiny animal that forms colonies', 'A marine cnidarian colony'],
    ['SHARK', 'A large fish with many teeth', 'A cartilaginous sea predator', 'A selachimorph fish'],
    ['WHALE', 'A giant sea mammal', 'It breathes through a blowhole', 'A marine cetacean'],
    ['PEARL', 'A jewel from an oyster', 'A smooth gem formed in a shell', 'A nacreous concretion'],
    ['KELP', 'Large brown seaweed', 'An underwater forest-forming algae', 'A laminarialean alga'],
    ['SEAL', 'A flippered sea mammal', 'It rests on rocks and swims', 'A pinniped'],
    ['SAND', 'Tiny grains on a beach', 'Loose grains along a shore', 'Granular silica sediment'],
    ['COAST', 'Land beside the sea', 'Where land meets ocean', 'A littoral boundary'],
    ['SHELL', 'A hard cover found on a beach', 'A mollusk may live inside it', 'A calcareous exoskeleton'],
  ],
  space: [
    ["SUN","The star that lights Earth","Our solar system’s central star","A G-type main-sequence star"],
    ["SKY","The space above us","Where constellations appear","The celestial vault"],
    ["ION","An electrically charged particle","Charged particle in the solar wind","A particle with unequal proton and electron counts"],
    ['STAR', 'A bright light in the night sky', 'A glowing ball of hot gas', 'A self-luminous celestial body'],
    ['MOON', 'Earth\'s night-sky neighbor', 'A natural satellite', 'A tidally locked companion'],
    ['MARS', 'The red planet', 'Fourth planet from the Sun', 'Home of Olympus Mons'],
    ['COMET', 'An icy object with a tail', 'It brightens near the Sun', 'A volatile-rich small body'],
    ['ORBIT', 'A path around a planet', 'A curved route caused by gravity', 'A gravitational trajectory'],
    ['NOVA', 'A suddenly bright star', 'A stellar outburst', 'A thermonuclear white-dwarf event'],
    ['VENUS', 'The bright second planet', 'Earth\'s very hot neighbor', 'A cloud-shrouded terrestrial planet'],
    ['EARTH', 'Our home planet', 'Third planet from the Sun', 'The pale blue dot'],
    ['SOLAR', 'Having to do with the Sun', 'Powered by sunlight, perhaps', 'Pertaining to our star'],
    ['LUNAR', 'Having to do with the Moon', 'Moon-related', 'Selenic'],
    ['ALIEN', 'A being from another world', 'An imagined visitor from space', 'An extraterrestrial'],
    ['ROCKET', 'A vehicle launched into space', 'It flies using thrust', 'A reaction-propelled craft'],
  ],
  food: [
    ["PIE","Pastry with a filling","A dessert with a crust","A filled pastry case"],
    ["TEA","A drink made by steeping leaves","A cup brewed from leaves","A Camellia sinensis infusion"],
    ["EGG","What a hen lays","An omelet ingredient","An oval breakfast staple"],
    ['TACO', 'A folded Mexican favorite', 'A filled tortilla', 'A tortilla-based antojito'],
    ['RICE', 'Small grains served with meals', 'A staple grain', 'Seed of Oryza sativa'],
    ['PEAR', 'A sweet bell-shaped fruit', 'A fruit related to the apple', 'Fruit of a Pyrus tree'],
    ['APPLE', 'A crisp red or green fruit', 'Fruit used in cider', 'A pome from Malus domestica'],
    ['PASTA', 'Noodles served with sauce', 'Italian dough shaped for boiling', 'An unleavened durum product'],
    ['BREAD', 'A baked loaf', 'Food made from flour and yeast', 'A leavened staple'],
    ['SPICE', 'Flavoring such as cumin', 'A fragrant cooking seasoning', 'An aromatic plant substance'],
    ['SALAD', 'A bowl of mixed greens', 'A cold dish often dressed', 'A composed raw-vegetable dish'],
    ['BEAN', 'A small edible seed', 'A legume used in chili', 'An edible pulse'],
    ['CAKE', 'A frosted birthday treat', 'A sweet baked dessert', 'A chemically leavened confection'],
    ['SOUP', 'A warm bowl eaten with a spoon', 'A liquid-based dish', 'A savory broth preparation'],
    ['TOAST', 'Bread browned by heat', 'Crisp breakfast bread', 'A Maillard-browned slice'],
  ],
  music: [
    ["AMP","A device that makes a guitar louder","Stage sound booster","An electronic signal-gain device"],
    ["RAP","Music with rhythmic spoken lyrics","A genre built on rhymed verses","A rhythmically delivered vocal form"],
    ["KEY","A piano part you press","A composition’s tonal center","A tonal framework"],
    ['NOTE', 'A single musical sound', 'A mark showing pitch and length', 'A notated tone'],
    ['SONG', 'Music with words', 'A piece meant to be sung', 'A vocal composition'],
    ['PIANO', 'A keyboard instrument', 'An instrument with black and white keys', 'A hammer-action keyboard'],
    ['CELLO', 'A large string instrument', 'An instrument played between the knees', 'A tenor-bass bowed chordophone'],
    ['DRUM', 'An instrument you strike', 'A beat-making percussion instrument', 'A membranophone'],
    ['BEAT', 'The pulse of a song', 'A steady musical unit', 'The metric pulse'],
    ['CHORD', 'Notes played together', 'A harmony of several pitches', 'A simultaneous pitch set'],
    ['OPERA', 'A drama that is sung', 'Theater set almost entirely to music', 'A staged lyric drama'],
    ['JAZZ', 'Music known for improvising', 'A style with swing and blue notes', 'An improvisatory American genre'],
    ['FLUTE', 'A high woodwind instrument', 'An instrument played by blowing across a hole', 'A transverse aerophone'],
    ['LYRIC', 'A song\'s words', 'One line of a song, perhaps', 'Text set to music'],
    ['CHOIR', 'A group of singers', 'An organized vocal ensemble', 'A choral body'],
  ],
  travel: [
    ["VAN","A vehicle with room for passengers","A roomy road-trip vehicle","A box-bodied road vehicle"],
    ["CAB","A taxi","A hired city ride","A metered conveyance"],
    ['MAP', 'A picture that shows where places are', 'A guide to roads and places', 'A cartographic representation'],
    ['ROAD', 'A way for cars to travel', 'A paved route between places', 'A vehicular thoroughfare'],
    ['TRAIN', 'A vehicle that runs on rails', 'Rail transportation', 'A linked set of railway cars'],
    ['HOTEL', 'A place to stay overnight', 'Lodging for travelers', 'A commercial hostelry'],
    ['PLANE', 'A vehicle that flies', 'A passenger aircraft', 'A fixed-wing craft'],
    ['TRIP', 'A journey away from home', 'Travel with a destination', 'An excursion'],
    ['TOUR', 'A sightseeing journey', 'A planned route through attractions', 'A circuitous excursion'],
    ['TAXI', 'A car you hire for a ride', 'A metered ride', 'A licensed vehicle for hire'],
    ['BEACH', 'A sandy vacation spot', 'A shore for sunbathing', 'A depositional shoreline'],
    ['GUIDE', 'A person who shows the way', 'A leader for visitors', 'A knowledgeable escort'],
    ['ROUTE', 'The way from here to there', 'A chosen travel path', 'An itinerary course'],
    ['SHIP', 'A large vessel for sea travel', 'An ocean-going vessel', 'A seagoing craft'],
  ],
  sports: [
    ["NET","A mesh barrier in tennis","It divides a tennis court","A court-spanning mesh"],
    ["SKI","A long board for gliding on snow","A snow sport’s runner","An alpine runner"],
    ["GYM","A place to exercise","An indoor training venue","A conditioning facility"],
    ['BALL', 'A round object used in games', 'It is kicked, hit, or thrown', 'A spherical game implement'],
    ['TEAM', 'Players on the same side', 'A group competing together', 'A coordinated sporting side'],
    ['GOLF', 'A sport played with clubs', 'A game aiming for small holes', 'An eighteen-hole links game'],
    ['TENNIS', 'A racket sport', 'A net game with serves and volleys', 'A racquet game scored love to forty'],
    ['SCORE', 'Points in a game', 'The current game total', 'A tally of competitive points'],
    ['COACH', 'A person who trains players', 'The leader on the sideline', 'A team tactician and trainer'],
    ['RACE', 'A contest to finish first', 'A competition of speed', 'A timed contest'],
    ['GOAL', 'A point-scoring target', 'What a soccer shot aims for', 'A scoring objective'],
    ['BAT', 'A club used to hit a ball', 'Baseball hitting equipment', 'A batter\'s implement'],
    ['SKATE', 'A boot with a blade or wheels', 'Footwear for gliding', 'A runner-mounted sports boot'],
    ['FIELD', 'An outdoor playing area', 'The ground where a game is played', 'The competitors collectively, too'],
    ['TRACK', 'An oval racing course', 'A marked path for runners', 'An athletics circuit'],
  ],
  animals: [
    ["ANT","A tiny six-legged insect","A colony-building insect","A formicid"],
    ["EMU","A large Australian bird","An Australian flightless bird","A Dromaius species"],
    ["OWL","A bird known for hooting","A nocturnal hunter","A strigiform bird"],
    ['BEAR', 'A large furry animal', 'A mammal that may hibernate', 'An ursid'],
    ['LION', 'A big cat with a mane', 'The so-called king of beasts', 'Panthera leo'],
    ['TIGER', 'A striped big cat', 'An orange-and-black predator', 'Panthera tigris'],
    ['OTTER', 'A playful swimming mammal', 'A sleek animal that may hold hands afloat', 'A mustelid of the subfamily Lutrinae'],
    ['HORSE', 'An animal people ride', 'A hoofed stable resident', 'Equus caballus'],
    ['MOUSE', 'A tiny animal with a long tail', 'A small rodent', 'A murine rodent'],
    ['EAGLE', 'A large bird of prey', 'A powerful raptor', 'A large accipitrid'],
    ['PANDA', 'A black-and-white bamboo eater', 'A bear native to China', 'Ailuropoda melanoleuca'],
    ['ZEBRA', 'A striped African animal', 'A black-and-white relative of a horse', 'A striped equid'],
    ['FROG', 'A jumping animal that says ribbit', 'A tailless amphibian', 'An anuran'],
    ['WOLF', 'A wild relative of the dog', 'A pack-hunting canine', 'Canis lupus'],
    ['DEER', 'An animal with hooves and often antlers', 'A graceful woodland cervid', 'A ruminant of family Cervidae'],
  ],
  weather: [
    ["FOG","A cloud near the ground","Visibility-reducing low cloud","A surface-level droplet suspension"],
    ["DEW","Morning water drops on grass","Moisture that forms overnight","Surface condensation"],
    ["ICE","Frozen water","Water in solid form","Crystalline H2O"],
    ['RAIN', 'Water falling from clouds', 'Wet weather', 'Liquid precipitation'],
    ['SNOW', 'Soft white winter flakes', 'Frozen precipitation', 'Ice crystals falling in flakes'],
    ['WIND', 'Moving air', 'It makes flags flutter', 'Bulk atmospheric motion'],
    ['STORM', 'Wild, rough weather', 'Weather with strong wind or precipitation', 'A severe atmospheric disturbance'],
    ['CLOUD', 'A white or gray shape overhead', 'A mass of airborne droplets', 'A visible atmospheric aerosol'],
    ['SUNNY', 'Bright with no clouds', 'Full of sunshine', 'Marked by high insolation'],
    ['FROST', 'Ice crystals on cold ground', 'A thin icy morning coating', 'Surface deposition of water vapor'],
    ['HAIL', 'Small balls of falling ice', 'Frozen pellets from a storm', 'Convective ice precipitation'],
    ['MIST', 'A thin fog', 'Tiny droplets hanging near the ground', 'A low-visibility aerosol'],
    ['HEAT', 'Very warm conditions', 'High temperature', 'Thermal energy'],
    ['FRONT', 'Boundary between air masses', 'A weather-map boundary', 'An atmospheric discontinuity'],
    ['BREEZE', 'A gentle wind', 'Light moving air', 'A mild current of air'],
  ],
  garden: [
    ["HOE","A tool for loosening soil","A long-handled weeding tool","A cultivation blade on a shaft"],
    ["PEA","A small green vegetable","A pod-grown vegetable","A Pisum sativum seed"],
    ["BUD","A flower before it opens","An unopened shoot","An embryonic plant outgrowth"],
    ['ROSE', 'A flower with thorns', 'A fragrant flowering shrub', 'A flower of genus Rosa'],
    ['SEED', 'The start of a new plant', 'What a gardener plants', 'A mature plant ovule'],
    ['SOIL', 'Earth where plants grow', 'The material filling a garden bed', 'The pedologic growth medium'],
    ['SPADE', 'A tool for digging', 'A flat-bladed garden tool', 'A digging implement with a tread'],
    ['TULIP', 'A bright cup-shaped spring flower', 'A flower grown from a bulb', 'A bulbous Tulipa perennial'],
    ['HERB', 'A flavorful garden plant', 'Basil or thyme, for example', 'An aromatic nonwoody plant'],
    ['VINE', 'A climbing plant', 'A plant that trails or climbs', 'A scandent growth form'],
    ['WATER', 'What thirsty plants need', 'Liquid from a watering can', 'H2O supplied by irrigation'],
    ['PRUNE', 'Trim a plant', 'Cut back unwanted branches', 'Selectively remove plant growth'],
    ['SHOVEL', 'A broad digging tool', 'A tool for moving soil', 'A concave-bladed implement'],
    ['BLOOM', 'An open flower', 'A blossom at its peak', 'A flower in anthesis'],
    ['GREEN', 'The color of healthy leaves', 'A common garden color', 'Chlorophyll-colored'],
  ],
};

export const supportedThemes = Object.freeze(Object.keys(BANKS));

const THEME_ALIASES = {
  nature: ['nature', 'forest', 'woods', 'outdoors', 'mountain', 'river', 'tree'],
  ocean: ['ocean', 'sea', 'beach', 'marine', 'underwater', 'coast', 'reef'],
  space: ['space', 'planet', 'stars', 'astronomy', 'cosmos', 'solar', 'galaxy'],
  food: ['food', 'cooking', 'kitchen', 'meal', 'fruit', 'restaurant', 'snack'],
  music: ['music', 'song', 'band', 'instrument', 'concert', 'jazz', 'orchestra'],
  travel: ['travel', 'trip', 'vacation', 'journey', 'tourism', 'roadtrip', 'flight'],
  sports: ['sports', 'sport', 'game', 'athletics', 'football', 'baseball', 'soccer'],
  animals: ['animals', 'animal', 'wildlife', 'zoo', 'pets', 'creatures', 'mammals'],
  weather: ['weather', 'climate', 'rain', 'storm', 'snow', 'forecast', 'wind'],
  garden: ['garden', 'gardening', 'flowers', 'plants', 'yard', 'botany', 'vegetables'],
};

const SIZE_MAP = { small: 5, medium: 9, large: 13 };
const DIRECTIONS = ['across', 'down'];

function resolveSize(value) {
  const size = typeof value === 'string' ? SIZE_MAP[value.toLowerCase()] : Number(value ?? 5);
  if (![5, 9, 13].includes(size)) throw new Error('Size must be small (5), medium (9), or large (13).');
  return size;
}

function resolveDifficulty(value) {
  const difficulty = String(value ?? 'easy').toLowerCase();
  if (!['easy', 'medium', 'hard'].includes(difficulty)) throw new Error('Difficulty must be easy, medium, or hard.');
  return difficulty;
}

function resolveTheme(theme) {
  const normalized = String(theme ?? '').trim().toLowerCase();
  if (!normalized) throw new Error(`Enter a theme. Supported themes: ${supportedThemes.join(', ')}.`);
  const tokens = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  let best = null;
  let score = 0;
  for (const [category, aliases] of Object.entries(THEME_ALIASES)) {
    const matches = aliases.reduce((sum, alias) => sum + (tokens.has(alias) ? 1 : 0), 0);
    if (matches > score) { best = category; score = matches; }
  }
  return best;
}

function normalizeCustomWords(words, difficulty) {
  if (!Array.isArray(words)) return [];
  return words.map((item) => {
    const raw = typeof item === 'string' ? { answer: item } : item;
    const answer = String(raw?.answer ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    const clue = typeof raw?.clue === 'string'
      ? raw.clue
      : raw?.clues?.[difficulty] ?? raw?.clues?.medium ?? raw?.clues?.easy;
    return { answer, clue: String(clue ?? `Theme word with ${answer.length} letters`) };
  }).filter(({ answer }) => answer.length >= 2);
}

function historyData(history) {
  const sets = [];
  const wordUses = new Map();
  for (const game of Array.isArray(history) ? history : []) {
    const source = Array.isArray(game) ? game : game?.answers ?? game?.entries ?? [];
    const answers = source.map((value) => String(value?.answer ?? value).toUpperCase()).filter(Boolean);
    if (!answers.length) continue;
    const signature = [...answers].sort().join('|');
    sets.push(signature);
    for (const answer of answers) wordUses.set(answer, (wordUses.get(answer) ?? 0) + 1);
  }
  return { sets: new Set(sets), wordUses };
}

function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function emptyBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function canPlace(board, directions, answer, row, col, direction, requireCrossing) {
  const size = board.length;
  const dr = direction === 'down' ? 1 : 0;
  const dc = direction === 'across' ? 1 : 0;
  const endRow = row + dr * (answer.length - 1);
  const endCol = col + dc * (answer.length - 1);
  if (row < 0 || col < 0 || endRow >= size || endCol >= size) return -1;
  const beforeRow = row - dr;
  const beforeCol = col - dc;
  const afterRow = endRow + dr;
  const afterCol = endCol + dc;
  if (beforeRow >= 0 && beforeCol >= 0 && beforeRow < size && beforeCol < size && board[beforeRow][beforeCol]) return -1;
  if (afterRow >= 0 && afterCol >= 0 && afterRow < size && afterCol < size && board[afterRow][afterCol]) return -1;

  let crossings = 0;
  for (let i = 0; i < answer.length; i += 1) {
    const r = row + dr * i;
    const c = col + dc * i;
    const existing = board[r][c];
    if (existing && existing !== answer[i]) return -1;
    if (existing) {
      if (directions[r][c].has(direction)) return -1;
      crossings += 1;
    } else if (direction === 'across') {
      if ((r > 0 && board[r - 1][c]) || (r + 1 < size && board[r + 1][c])) return -1;
    } else if ((c > 0 && board[r][c - 1]) || (c + 1 < size && board[r][c + 1])) return -1;
  }
  return requireCrossing && crossings === 0 ? -1 : crossings;
}

function placementOptions(board, directions, answer, entries) {
  const options = [];
  if (!entries.length) {
    for (const direction of DIRECTIONS) {
      const row = direction === 'across' ? Math.floor(board.length / 2) : Math.floor((board.length - answer.length) / 2);
      const col = direction === 'across' ? Math.floor((board.length - answer.length) / 2) : Math.floor(board.length / 2);
      if (canPlace(board, directions, answer, row, col, direction, false) >= 0) options.push({ row, col, direction, crossings: 0 });
    }
    return options;
  }
  for (let r = 0; r < board.length; r += 1) {
    for (let c = 0; c < board.length; c += 1) {
      if (!board[r][c]) continue;
      for (let i = 0; i < answer.length; i += 1) {
        if (answer[i] !== board[r][c]) continue;
        for (const direction of DIRECTIONS) {
          const row = r - (direction === 'down' ? i : 0);
          const col = c - (direction === 'across' ? i : 0);
          const crossings = canPlace(board, directions, answer, row, col, direction, true);
          if (crossings >= 0) options.push({ row, col, direction, crossings });
        }
      }
    }
  }
  return options;
}

function place(board, directions, answer, option) {
  const dr = option.direction === 'down' ? 1 : 0;
  const dc = option.direction === 'across' ? 1 : 0;
  for (let i = 0; i < answer.length; i += 1) {
    const row = option.row + dr * i;
    const col = option.col + dc * i;
    board[row][col] = answer[i];
    directions[row][col].add(option.direction);
  }
}

function buildCandidate(words, size, target) {
  const board = emptyBoard(size);
  const directions = Array.from({ length: size }, () => Array.from({ length: size }, () => new Set()));
  const entries = [];
  let remaining = [...words];
  while (remaining.length && entries.length < target) {
    let best = null;
    for (const word of remaining) {
      const options = placementOptions(board, directions, word.answer, entries);
      for (const option of options) {
        const centrality = -Math.abs(option.row - size / 2) - Math.abs(option.col - size / 2);
        const score = option.crossings * 24 - word.answer.length * 4 + centrality + Math.random() * 5;
        if (!best || score > best.score) best = { word, option, score };
      }
    }
    if (!best) break;
    place(board, directions, best.word.answer, best.option);
    entries.push({ ...best.word, ...best.option });
    remaining = remaining.filter((word) => word.answer !== best.word.answer);
  }
  return { board, entries };
}

function numberEntries(entries) {
  const starts = [...new Set(entries.map(({ row, col }) => `${row},${col}`))]
    .map((key) => key.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const numbers = new Map(starts.map(([row, col], index) => [`${row},${col}`, index + 1]));
  return entries
    .map(({ crossings: _crossings, ...entry }) => ({ ...entry, number: numbers.get(`${entry.row},${entry.col}`) }))
    .sort((a, b) => a.number - b.number || DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction));
}

export function generatePuzzle(options = {}) {
  const size = resolveSize(options.size);
  const difficulty = resolveDifficulty(options.difficulty);
  const customWords = normalizeCustomWords(options.words, difficulty).filter(({ answer }) => answer.length <= size);
  const category = resolveTheme(options.theme);
  if (!category && !customWords.length) {
    throw new Error(`Unsupported theme "${String(options.theme ?? '').trim()}". Try: ${supportedThemes.join(', ')}, or supply themed words.`);
  }
  const themedWords = category
    ? BANKS[category].map(([answer, easy, medium, hard]) => ({ answer, clue: { easy, medium, hard }[difficulty] }))
    : [];
  const related = new Set((themeVocabulary[category] || '').split(' '));
  const relatedWords = [...fillWords.filter(word => related.has(word.answer)), ...themedPlurals.filter(word=>related.has(word.base))];
  const byAnswer = new Map([...relatedWords, ...(dictionaryThemes[category] || []), ...themedWords, ...customWords].map((word) => [word.answer, word]));
  for(const [answer,clue] of Object.entries(themeClues[category] || {}))if(byAnswer.has(answer))byAnswer.set(answer,{answer,clue});
  const { sets, wordUses } = historyData(options.history);
  const words = [...byAnswer.values()]
    .filter(({ answer }) => answer.length <= size)
    .sort((a, b) => (wordUses.get(a.answer) ?? 0) - (wordUses.get(b.answer) ?? 0) || Math.random() - 0.5);
  if (words.length < 3) throw new Error(`Not enough usable themed words to build a ${size}x${size} crossword.`);

  const commonAnswers = new Set(fillWords.map(word=>word.answer));
  const denseOptions = { size, difficulty, theme: String(options.theme).trim(), themeWords: words.map(word=>({...word,common:commonAnswers.has(word.answer)})), fillWords: [...dictionaryWords, ...fillWords.map(word=>({...word,common:true})), ...themedPlurals.map(word=>({...word,common:true}))], history: options.history };
  let dense = generateDense({...denseOptions,timeLimitMs:2500});
  if (dense) return { ...dense, layoutVersion: 3 };
  if(size===5) {
    const available=(denseFallbacks[category] || []).filter(p=>!sets.has(p.entries.map(e=>e.answer).sort().join('|')));
    available.sort((a,b)=>a.entries.reduce((n,e)=>n+(wordUses.get(e.answer)||0),0)-b.entries.reduce((n,e)=>n+(wordUses.get(e.answer)||0),0));
    if(available.length) {
      const chosen=structuredClone(available[0]);
      chosen.entries=chosen.entries.map(entry=>({...entry,clue:byAnswer.get(entry.answer)?.clue || entry.clue,isTheme:byAnswer.has(entry.answer)}));
      if(chosen.entries.filter(e=>e.isTheme).length>chosen.entries.length/2)return{...chosen,theme:String(options.theme).trim(),layoutVersion:3};
    }
    if(difficulty==='hard') {
      dense=generateDense({...denseOptions,timeLimitMs:6500});
      if(dense)return{...dense,layoutVersion:3};
      throw new Error('Could not fit a new mostly themed mini with at least 90% crossed letters. Try another theme or generate again.');
    }
  }
  const target = size === 5 ? 7 : size === 9 ? 22 : 38;
  let best = null;
  let bestFresh = null;
  const placementDeadline=Date.now()+1500;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if(bestFresh && Date.now()>=placementDeadline)break;
    const pool = [...shuffle(words.filter(word=>word.answer.length<=4)).slice(0, Math.max(24,target*2)), ...shuffle(words.filter(word=>word.answer.length>4)).slice(0,6)];
    const candidate = buildCandidate(pool, size, target);
    const signature = candidate.entries.map(({ answer }) => answer).sort().join('|');
    const repeatPenalty = sets.has(signature) ? 100 : 0;
    const reusePenalty = candidate.entries.reduce((sum, entry) => sum + (wordUses.get(entry.answer) ?? 0), 0) * 1.5;
    const crossings = candidate.entries.reduce((sum, entry) => sum + entry.crossings, 0);
    const occupied = candidate.board.flat().filter(Boolean).length;
    const score = (crossings / occupied) * 200 + crossings * 15 + candidate.entries.length * 10 - repeatPenalty - reusePenalty + Math.random();
    if (!best || score > best.score) best = { ...candidate, score, signature };
    if (!sets.has(signature) && (!bestFresh || score > bestFresh.score)) bestFresh = { ...candidate, score, signature };
    if (candidate.entries.length >= target && !sets.has(signature) && reusePenalty === 0 && crossings / occupied >= 0.65) break;
  }
  if (!best || best.entries.length < 3) throw new Error('Could not build a connected crossword from these themed words. Try a broader theme or more candidate words.');
  if (sets.size) {
    if (!bestFresh || bestFresh.entries.length < 3) throw new Error('Every usable crossword from these words is already in the game history. Add more themed words or clear older history.');
    best = bestFresh;
  }
  return {
    size,
    theme: String(options.theme).trim(),
    entries: numberEntries(best.entries).map(entry=>({...entry,isTheme:true})),
    grid: best.board,
  };
}
