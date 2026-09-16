import { generateLayout } from './layouts/registry.js';
import { fillWords } from './fill-words.js';
import { themeVocabulary } from './theme-fill.js';
import { themedPlurals } from './theme-plurals.js';
import { themeClues } from './theme-clues.js';
import { dictionaryWords, dictionaryThemes } from './wordnet-words.js';
import { resolveCuratedTheme, supportedThemes } from './themes.js';

export { supportedThemes } from './themes.js';

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

const SIZE_MAP = { small: 5, medium: 9, large: 13 };

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

  return resolveCuratedTheme(normalized);
}

// A theme outside the curated families has no local vocabulary, so generation can only
// proceed with caller-supplied (AI) words. The `code` lets the client explain that the AI
// endpoint is unconfigured instead of repeating this message to the player.
function themeWordsError(theme) {
  const error = new Error(`No built-in words for "${String(theme ?? '').trim()}". Built-in themes: ${supportedThemes.join(', ')}. Other themes need AI-generated words.`);
  error.code = 'theme-words-unavailable';
  return error;
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

export function generatePuzzle(options = {}) {
  const size = resolveSize(options.size);
  const difficulty = resolveDifficulty(options.difficulty);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const customWords = normalizeCustomWords(options.words, difficulty).filter(({ answer }) => answer.length <= size);
  const category = resolveTheme(options.theme);
  if (!category && !customWords.length) throw themeWordsError(options.theme);
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
    .sort((a, b) => (wordUses.get(a.answer) ?? 0) - (wordUses.get(b.answer) ?? 0) || random() - 0.5);
  if (words.length < 3) throw new Error(`Not enough usable themed words to build a ${size}x${size} crossword.`);

  const commonAnswers = new Set(fillWords.map(word=>word.answer));
  // One dispatch, and no `if (style === ...)` here: the registry validates the id and the
  // size, calls exactly one generator, and stamps the authoritative style and version. An
  // omitted style is Free form, which is what every puzzle saved before styles existed was.
  const layoutStyle = String(options.layoutStyle ?? '').trim() || 'freeform';

  return generateLayout(layoutStyle, {
    size,
    difficulty,
    theme: options.theme,
    category,
    themeCategory: category,
    words,
    byAnswer,
    sets,
    wordUses,
    themeWords: words.map(word=>({...word,common:commonAnswers.has(word.answer)})),
    fillWords: [...dictionaryWords, ...fillWords.map(word=>({...word,common:true})), ...themedPlurals.map(word=>({...word,common:true}))],
    history: options.history,
    deadline: options.deadline,
    random,
  });
}
