import { $getRoot, $isLineBreakNode, $isParagraphNode, $isTextNode } from 'lexical';

// U+200B, the character Lexical itself parks in an empty block when a composition starts.
// ReplacementTextPlugin keeps one in a focused empty box for a thin-client IME to compose
// in, so a box that holds only this character is empty.
export const IME_PRIMER = '\u200B';

// Whether the document is the primer and nothing else: paragraphs only, and no text but
// the primer. Any other block or inline node is content, as it is without the primer.
export const $isPrimerOnly = (): boolean => {
  let text = '';

  for (const block of $getRoot().getChildren()) {
    if (!$isParagraphNode(block)) return false;

    for (const node of block.getChildren()) {
      if ($isTextNode(node)) text += node.getTextContent();
      else if (!$isLineBreakNode(node)) return false;
    }
  }

  return text.trim() === IME_PRIMER;
};
