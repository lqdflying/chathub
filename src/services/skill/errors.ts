export const DUPLICATE_SKILL_CONTENT_MESSAGE =
  'A skill with identical content is already installed under a different identifier';

export const isDuplicateSkillContentError = (error: unknown): boolean => {
  const cause =
    error && typeof error === 'object' && 'cause' in error
      ? (error as { cause?: unknown }).cause
      : undefined;

  return [error, cause].some((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const databaseError = candidate as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
    };

    return (
      databaseError.constraint === 'user_installed_skills_user_hash_unique' ||
      (databaseError.code === '23505' &&
        String(databaseError.message ?? '').includes('user_installed_skills_user_hash_unique'))
    );
  });
};

export const normalizeDuplicateSkillContentError = (error: unknown) =>
  isDuplicateSkillContentError(error)
    ? new Error(DUPLICATE_SKILL_CONTENT_MESSAGE, { cause: error })
    : error;
