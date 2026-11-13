// U+200B, the character Lexical itself parks in an empty block when a composition starts.
// ReplacementTextPlugin keeps one in a focused empty box for a thin-client IME to compose
// in, so a box that holds only this character is empty.
export const IME_PRIMER = '​';
