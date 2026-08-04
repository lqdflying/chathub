const SURROUNDING_MARKDOWN_EMPHASIS = /^(\*{1,3}|_{1,3})\s*([\s\S]*?)\s*\1$/u;

export const normalizeGenerationTopicTitle = (title: string): string => {
  const trimmedTitle = title.trim();
  const emphasisMatch = trimmedTitle.match(SURROUNDING_MARKDOWN_EMPHASIS);

  return emphasisMatch ? emphasisMatch[2].trim() : trimmedTitle;
};
