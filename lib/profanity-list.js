// lib/profanity-list.js
//
// Deliberately narrow list: real profanity/slurs/abuse ONLY. The goal is
// to block genuine bad language, NOT to soften or block harsh-but-honest
// negative reviews — "this product is garbage", "worst purchase ever",
// "completely useless", "waste of money" etc. must ALL still go through
// untouched. None of those words are in this list, on purpose.
//
// Covers common English profanity plus common Hindi/Hinglish (Roman-script
// transliterated) abusive words, since reviews on this site are realistically
// written in a mix of both.
//
// This is intentionally a starting list, not exhaustive — add to it over
// time as needed (Admin Panel doesn't expose this yet; it's a code-level
// list for now). Matching is done word-boundary-aware and tolerant of
// simple leetspeak substitutions (@ for a, 3 for e, 1/! for i, 0 for o) and
// repeated-letter stretching ("fuuuck") in lib/submit-review-guard.js.

export const PROFANITY_WORDS = [
  // English profanity/slurs (common core list)
  "fuck", "fucker", "fucking", "motherfucker", "shit", "bullshit", "bitch",
  "bastard", "asshole", "cunt", "dick", "pussy", "whore", "slut", "nigger",
  "nigga", "faggot", "fag", "retard", "rape", "rapist",

  // Common Hindi/Hinglish abusive words (Roman transliteration + common
  // spelling variants)
  "chutiya", "chutia", "madarchod", "behenchod", "bhenchod", "bhosdike",
  "bhosdiwala", "randi", "randwa", "gandu", "gaand", "harami", "haramzada",
  "kutta", "kutiya", "saala kutta", "lund", "loda", "lauda", "chodu",
  "chod", "bkl", "mc", "bc"
];
