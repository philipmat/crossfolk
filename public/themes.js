export const supportedThemes = Object.freeze([
  'nature', 'ocean', 'space', 'food', 'music', 'travel', 'sports', 'animals', 'weather', 'garden',
]);

export function selectedTheme(customTheme, presetTheme) {
  return String(customTheme ?? '').trim() || String(presetTheme ?? '').trim();
}

export function restoredThemeSelection(theme) {
  const savedTheme = String(theme ?? '').trim();
  const preset = supportedThemes.find(item => item.toLowerCase() === savedTheme.toLowerCase());

  return preset ? { preset, custom: '' } : { preset: '', custom: savedTheme };
}

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

export function resolveCuratedTheme(theme) {
  const normalized = String(theme ?? '').trim().toLowerCase();
  if (!normalized) return null;

  const tokens = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  let best = null;
  let score = 0;

  for (const [category, aliases] of Object.entries(THEME_ALIASES)) {
    const matches = aliases.reduce((sum, alias) => sum + Number(tokens.has(alias)), 0);
    if (matches > score) {
      best = category;
      score = matches;
    }
  }

  return best;
}
