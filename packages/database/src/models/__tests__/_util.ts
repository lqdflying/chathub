export const getTestDB = async () => {
  const { getTestDBInstance } = await import('../../core/dbForTest');
  return getTestDBInstance();
};
