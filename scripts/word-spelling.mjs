// The spelling check shared by the vocabulary build and its tests.
//
// The vendored WordNet subset stores lemmas, so a curated plural or past tense will not
// appear in it verbatim. A regular inflection of a known lemma is still a confirmed
// spelling; anything matching neither is not. Keeping this in one place means the test
// asserts exactly the rule the build enforces, rather than a proxy for it.

import {dictionaryThemes, dictionaryWords} from '../public/wordnet-words.js';
import {fillWords} from '../public/fill-words.js';

const known = new Set(dictionaryWords.map(({answer}) => answer));
for (const entries of Object.values(dictionaryThemes)) for (const {answer} of entries) known.add(answer);
for (const {answer} of fillWords) known.add(answer);

export function baseForms(answer) {
  const forms = [answer];
  if (answer.endsWith('IES')) forms.push(`${answer.slice(0, -3)}Y`);
  if (answer.endsWith('ES')) forms.push(answer.slice(0, -2));
  if (answer.endsWith('S')) forms.push(answer.slice(0, -1));
  if (answer.endsWith('ED')) {
    forms.push(answer.slice(0, -1), answer.slice(0, -2));
    if (answer.endsWith('IED')) forms.push(`${answer.slice(0, -3)}Y`);
    if (answer.length > 4 && answer.at(-3) === answer.at(-4)) forms.push(answer.slice(0, -3));
  }
  if (answer.endsWith('ING')) {
    forms.push(answer.slice(0, -3), `${answer.slice(0, -3)}E`);
    if (answer.length > 5 && answer.at(-4) === answer.at(-5)) forms.push(answer.slice(0, -4));
  }
  if (answer.endsWith('LY')) forms.push(answer.slice(0, -2));
  if (answer.endsWith('NESS')) forms.push(answer.slice(0, -4));

  return forms;
}

export function isKnownSpelling(answer) {
  return baseForms(answer).some((form) => known.has(form));
}
