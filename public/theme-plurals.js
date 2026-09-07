// Plurals are explicit answer/clue pairs, and inherit only their noun's curated theme.
const source=`
SEA|SEAS|Saltwater expanses
EEL|EELS|Snakelike fish
ROE|ROES|Fish egg masses
FIN|FINS|Swimming appendages
NET|NETS|Mesh catching gear
RAY|RAYS|Flat cartilaginous fish
OAR|OARS|Rowers' blades
BAY|BAYS|Coastal inlets
COD|CODS|Atlantic food fishes
POD|PODS|Pea cases or whale groups
EGG|EGGS|What hens lay
GULL|GULLS|Coastal scavenging birds
KEEL|KEELS|Spines of ships
TIDE|TIDES|Lunar sea-level cycles
BOAT|BOATS|Small watercraft
SHIP|SHIPS|Large watercraft
SAIL|SAILS|Wind-catching canvases
REEF|REEFS|Shallow marine ridges
CLAM|CLAMS|Bivalves buried in sand
CRAB|CRABS|Sideways-moving crustaceans
WAVE|WAVES|Sea-surface oscillations
KELP|KELPS|Large brown algae
SEAL|SEALS|Flippered mammals
PORT|PORTS|Harbors
PIER|PIERS|Waterfront walkways
COVE|COVES|Sheltered inlets
ISLE|ISLES|Small islands
DIVE|DIVES|Underwater plunges
RAFT|RAFTS|Flat floating platforms
MAST|MASTS|Upright spars on ships
HULL|HULLS|Bodies of ships
SUN|SUNS|Stars at the centers of planetary systems
ION|IONS|Electrically charged particles
ORB|ORBS|Spherical bodies
GAS|GASES|Airlike forms of matter
STAR|STARS|Self-luminous celestial bodies
MOON|MOONS|Natural satellites
ATOM|ATOMS|Units of chemical elements
AXIS|AXES|Lines about which bodies rotate
RING|RINGS|Saturn's most distinctive features
CORE|CORES|Central regions of planets
ROCK|ROCKS|Solid mineral masses
LENS|LENSES|Optical elements that focus light
HALO|HALOS|Luminous rings
MASS|MASSES|Quantities of matter
SPOT|SPOTS|Dark features on the Sun's surface
TAIL|TAILS|Comet streamers
BELT|BELTS|Bands such as the asteroid belt
DAY|DAYS|Planetary rotation periods
OAK|OAKS|Acorn-bearing trees
ELM|ELMS|Trees of the genus Ulmus
FIR|FIRS|Needle-leaved conifers
YEW|YEWS|Evergreens with red arils
ANT|ANTS|Colony-building insects
BEE|BEES|Honey-making insects
BAT|BATS|Flying mammals
BUG|BUGS|Small insects
BUD|BUDS|Unopened flowers
DOE|DOES|Female deer
EMU|EMUS|Australian flightless birds
EWE|EWES|Female sheep
FOX|FOXES|Bushy-tailed canines
HEN|HENS|Female chickens
HOG|HOGS|Farm pigs
JAY|JAYS|Noisy crested birds
LOG|LOGS|Sections of tree trunks
NUT|NUTS|Hard-shelled edible seeds
OAT|OATS|Grains made into porridge
OWL|OWLS|Nocturnal birds of prey
PEA|PEAS|Small green vegetables
PIG|PIGS|Snouted farm animals
RAM|RAMS|Male sheep
RAT|RATS|Long-tailed rodents
WEB|WEBS|Spiders' silk traps
YAK|YAKS|Shaggy Himalayan bovines
YAM|YAMS|Starchy tubers
TREE|TREES|Woody perennials
LEAF|LEAVES|Photosynthetic plant blades
FERN|FERNS|Spore-bearing green plants
BIRD|BIRDS|Feathered vertebrates
BEAR|BEARS|Large furry omnivores
CROW|CROWS|Black cawing birds
DOVE|DOVES|Birds symbolic of peace
DUCK|DUCKS|Quacking waterbirds
FROG|FROGS|Croaking amphibians
GOAT|GOATS|Bearded farm animals
HARE|HARES|Long-eared runners
HAWK|HAWKS|Sharp-eyed birds of prey
HERB|HERBS|Flavorful culinary plants
HILL|HILLS|Small natural elevations
HIVE|HIVES|Homes of bee colonies
LAKE|LAKES|Inland bodies of water
LAMB|LAMBS|Young sheep
LARK|LARKS|Songbirds known for aerial singing
LION|LIONS|Maned big cats
MOLE|MOLES|Burrowing mammals
MOTH|MOTHS|Nocturnal winged insects
NEST|NESTS|Birds' homes
PINE|PINES|Needle-leaved evergreens
POND|PONDS|Small bodies of water
ROOT|ROOTS|Underground plant anchors
ROSE|ROSES|Thorny flowering plants
SEED|SEEDS|Plant embryos in protective coats
SLUG|SLUGS|Shell-less gastropods
STEM|STEMS|Supporting plant stalks
SWAN|SWANS|Long-necked waterbirds
TOAD|TOADS|Warty amphibians
VINE|VINES|Climbing plants
WEED|WEEDS|Unwanted garden plants
WORM|WORMS|Long soft-bodied invertebrates
PIE|PIES|Filled pastries
TEA|TEAS|Leaf-based infusions
JAM|JAMS|Sweet fruit preserves
JAR|JARS|Glass food containers
JUG|JUGS|Handled pouring vessels
FIG|FIGS|Fruits with many tiny seeds
ALE|ALES|Top-fermented beers
PAN|PANS|Shallow cooking vessels
POT|POTS|Deep cooking vessels
CUP|CUPS|Handled drinking vessels
RIB|RIBS|Barbecue cuts with bones
BUN|BUNS|Small bread rolls
BEAN|BEANS|Edible legume seeds
CAKE|CAKES|Layered birthday treats
SOUP|SOUPS|Broth-based dishes
MEAL|MEALS|Breakfast, lunch, and dinner
LIME|LIMES|Tart green citrus fruits
LOAF|LOAVES|Units of baked bread
PEEL|PEELS|Fruit skins
SALT|SALTS|Ionic compounds used as seasonings
STEW|STEWS|Slow-cooked mixed dishes
TART|TARTS|Small open pastries
WINE|WINES|Fermented grape drinks
BEET|BEETS|Dark red root vegetables
DATE|DATES|Sweet palm fruits
DISH|DISHES|Prepared foods or serving plates
LEEK|LEEKS|Mild long-stemmed onion relatives
PLUM|PLUMS|Smooth-skinned stone fruits
PEAR|PEARS|Bell-shaped fruits
AMP|AMPS|Stage sound boosters
KEY|KEYS|Piano parts pressed by fingers
BOW|BOWS|Tools drawn across violin strings
EAR|EARS|Organs used to listen
GIG|GIGS|Musicians' paid engagements
BEAT|BEATS|Rhythmic pulses
BAND|BANDS|Groups of musicians
BELL|BELLS|Hollow ringing instruments
CLEF|CLEFS|Symbols that set a staff's pitch range
DRUM|DRUMS|Instruments struck to keep rhythm
DUET|DUETS|Pieces for two performers
HARP|HARPS|Large plucked string instruments
HORN|HORNS|Coiled brass instruments
HYMN|HYMNS|Songs of praise
LUTE|LUTES|Rounded plucked instruments
LYRE|LYRES|Ancient U-shaped string instruments
NOTE|NOTES|Individual musical tones
OBOE|OBOES|Double-reed woodwinds
REST|RESTS|Written pauses in music
RIFF|RIFFS|Repeated musical phrases
SOLO|SOLOS|Pieces for individual performers
SONG|SONGS|Vocal compositions
TONE|TONES|Sounds of definite pitch
TRIO|TRIOS|Groups of three performers
TUBA|TUBAS|Large low brass instruments
TUNE|TUNES|Melodies
MAP|MAPS|Geographic guides
CAB|CABS|Cars for hire
VAN|VANS|Roomy passenger vehicles
BUS|BUSES|Public road transport vehicles
CAR|CARS|Passenger road vehicles
JET|JETS|Fast aircraft
INN|INNS|Travelers' lodgings
BAG|BAGS|Luggage items
SPA|SPAS|Places for restorative treatments
ZOO|ZOOS|Wildlife attractions
TIP|TIPS|Gratuities
BED|BEDS|Hotel-room sleeping places
ROAD|ROADS|Vehicle routes
TRIP|TRIPS|Journeys away from home
TOUR|TOURS|Guided sightseeing journeys
BIKE|BIKES|Two-wheeled pedal vehicles
CAMP|CAMPS|Outdoor overnight sites
FARE|FARES|Passenger transport charges
GATE|GATES|Airport boarding points
LANE|LANES|Narrow roads
MILE|MILES|Travel distance units
PARK|PARKS|Public recreation areas
PATH|PATHS|Walking routes
RIDE|RIDES|Trips on vehicles
ROOM|ROOMS|Hotel accommodations
SEAT|SEATS|Places to sit while traveling
STOP|STOPS|Scheduled breaks on a route
TENT|TENTS|Portable fabric shelters
TOWN|TOWNS|Urban communities
VISA|VISAS|Travel entry documents
WIN|WINS|Victories
FAN|FANS|Enthusiastic supporters
TIE|TIES|Games ending with equal scores
LAP|LAPS|Complete circuits of a track
LEG|LEGS|Runners' limbs
TOE|TOES|Foot digits
ACE|ACES|Unreturned tennis serves
BALL|BALLS|Round sporting implements
TEAM|TEAMS|Groups competing together
GOAL|GOALS|Scoring targets
RACE|RACES|Speed contests
GAME|GAMES|Sporting contests
CLUB|CLUBS|Golfers' implements
FLAG|FLAGS|Course markers
HOOP|HOOPS|Basketball targets
JUMP|JUMPS|Leaping events
KICK|KICKS|Foot strikes
LINE|LINES|Court boundary markings
PUCK|PUCKS|Ice-hockey discs
RANK|RANKS|Positions in a sporting hierarchy
RING|RINGS|Boxing arenas
SHOT|SHOTS|Attempts at scoring
SLED|SLEDS|Snow-racing vehicles
FUR|FURS|Thick animal coats
CAT|CATS|Purring companion animals
COW|COWS|Female bovines
CUB|CUBS|Young bears or lions
DOG|DOGS|Barking companion animals
PET|PETS|Companion animals
PAW|PAWS|Animal feet
BULL|BULLS|Male bovines
COLT|COLTS|Young male horses
DODO|DODOS|Extinct Mauritian birds
MARE|MARES|Female horses
MINK|MINKS|Sleek semiaquatic mustelids
MULE|MULES|Horse-donkey hybrids
NEWT|NEWTS|Small tailed amphibians
ORCA|ORCAS|Black-and-white toothed whales
PUMA|PUMAS|Large American wild cats
WASP|WASPS|Narrow-waisted stinging insects
GALE|GALES|Strong winds
GUST|GUSTS|Sudden wind bursts
RAIN|RAINS|Periods of falling water
WIND|WINDS|Moving air currents
DROP|DROPS|Small liquid quantities
FOG|FOGS|Low-lying cloud banks
DEW|DEWS|Deposits of condensed morning moisture
HOE|HOES|Soil-loosening tools
RAKE|RAKES|Tools for gathering fallen leaves
BULB|BULBS|Underground plant storage organs
CANE|CANES|Supporting sticks for climbing plants
HOSE|HOSES|Flexible watering tubes
YARD|YARDS|Areas around homes
`;
export const themedPlurals=source.trim().split('\n').map(line=>{const[base,answer,clue]=line.split('|');return{base,answer,clue};}).filter(w=>w.answer.length<=5);
