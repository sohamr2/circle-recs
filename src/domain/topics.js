/**
 * Editorial topic knowledge. Small on purpose: this is a hand-curated starting point that a
 * production system would replace/augment with relationships learned from co-membership.
 */

/** Topics that members who care about one commonly care about the other. Symmetric. */
const RELATED_PAIRS = [
  ['negotiation', 'getting-promoted'],
  ['negotiation', 'confidence'],
  ['getting-promoted', 'visibility-recognition'],
  ['getting-promoted', 'managing-up'],
  ['getting-promoted', 'sponsorship-mentorship'],
  ['confidence', 'imposter-syndrome'],
  ['confidence', 'public-speaking'],
  ['leadership-skills', 'managing-a-team'],
  ['leadership-skills', 'public-speaking'],
  ['leadership-skills', 'visibility-recognition'],
  ['managing-a-team', 'giving-feedback'],
  ['giving-feedback', 'difficult-conversations'],
  ['communication', 'difficult-conversations'],
  ['communication', 'public-speaking'],
  ['networking', 'sponsorship-mentorship'],
  ['networking', 'visibility-recognition'],
  ['stress-burnout', 'resilience'],
  ['stress-burnout', 'work-life-integration'],
  ['working-motherhood', 'work-life-integration'],
  ['working-motherhood', 'career-breaks'],
  ['gender-bias', 'allyship'],
  ['gender-bias', 'being-the-only-one'],
  ['imposter-syndrome', 'being-the-only-one'],
];

export const RELATED_TOPICS = (() => {
  const map = new Map();
  const add = (a, b) => map.set(a, [...(map.get(a) ?? []), b]);
  for (const [a, b] of RELATED_PAIRS) { add(a, b); add(b, a); }
  return map;
})();

/**
 * Keyword -> topic hints from a member's free-text bio. Only used as a last resort when a
 * member has stated no interests and belongs to no Circles. Conservative: a miss is fine.
 */
const BIO_RULES = [
  [/career break|returning to work|return to work/i, 'career-breaks'],
  [/first-time manager|new manager|managing a team|team lead/i, 'managing-a-team'],
  [/leadership|executive presence|women leaders/i, 'leadership-skills'],
  [/promotion|next level|ready for the next/i, 'getting-promoted'],
  [/pay equity|comp conversation|salary|negotiat/i, 'negotiation'],
  [/mentor|sponsor/i, 'sponsorship-mentorship'],
  [/confidence/i, 'confidence'],
  [/burnout|overwhelm/i, 'stress-burnout'],
  [/public speaking|speak up/i, 'public-speaking'],
];

/** @param {string|null|undefined} bio @returns {string[]} topic slugs */
export function topicsFromBio(bio) {
  if (!bio) return [];
  return [...new Set(BIO_RULES.filter(([re]) => re.test(bio)).map(([, slug]) => slug))];
}
