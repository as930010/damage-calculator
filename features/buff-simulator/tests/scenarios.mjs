import { createHash } from 'node:crypto';

export function edit(h, selector, value, type = 'input') {
  const input = h.query(selector);
  if (typeof value === 'boolean') input.checked = value;
  else input.value = String(value);
  h.event(input, type);
  return input;
}

export const scenarios = {
  defaultSingle() {},
  configuredSingle(h) {
    const members = h.app.querySelectorAll('[data-member]');
    edit(h, '[data-member][data-team="single"]', 'DaB');
    members[1].value = 'NP'; h.event(members[1]);
    edit(h, '[data-option="green-beast"]', false);
    edit(h, '[data-option-value="skill-damage-gloves"]', 25);
    edit(h, '[data-option-value="movement-speed-shoes"]', 30);
    h.reset(); edit(h, '#boss-reduction', 80);
  },
  configuredChallenge(h) {
    h.clickMode('challenge');
    const first = h.app.querySelectorAll('[data-member][data-team="first"]');
    const second = h.app.querySelectorAll('[data-member][data-team="second"]');
    for (const [input, value] of [[first[0], 'DaB'], [first[1], 'NP'], [second[0], 'NP'], [second[1], 'SU']]) {
      input.value = value; h.event(input);
    }
    edit(h, '[data-option="wind-ball-defense-break"][data-team="first"]', false);
    edit(h, '[data-option-value="skill-damage-gloves"][data-team="second"]', 30);
    h.reset(); edit(h, '#boss-reduction', 95.5);
  },
  invalidInputs(h) {
    edit(h, '[data-member]', '<不存在&>');
    h.reset(); edit(h, '#boss-reduction', 100);
  },
};

export function capture(h) {
  return {
    results: JSON.parse(JSON.stringify(h.teamResults)),
    resultHtmlHash: createHash('sha256').update(h.query('#results').innerHTML).digest('hex'),
    skillHtmlHash: createHash('sha256').update(h.query('[data-skill-results]').innerHTML).digest('hex'),
    saved: h.saved(),
  };
}
