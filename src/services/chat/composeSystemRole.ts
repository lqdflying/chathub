export const composeSystemRole = (
  generalInstruction?: string,
  assistantRole?: string,
): string | undefined => {
  const sections = [generalInstruction, assistantRole]
    .map((section) => section?.trim())
    .filter((section): section is string => section !== undefined && section !== '');

  return sections.length > 0 ? sections.join('\n\n') : undefined;
};
