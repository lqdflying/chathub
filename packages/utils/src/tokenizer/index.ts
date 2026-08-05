export const MAX_EXACT_TOKENIZER_INPUT_LENGTH = 10_000;

export const encodeAsync = async (str: string): Promise<number> => {
  if (str.length === 0) return 0;

  // use gpt-tokenizer under 10000 str
  // use approximation way if large then 10000
  if (str.length <= MAX_EXACT_TOKENIZER_INPUT_LENGTH) {
    const { clientEncodeAsync } = await import('./client');

    return await clientEncodeAsync(str);
  } else {
    const { estimatedEncodeAsync } = await import('./estimated');

    return await estimatedEncodeAsync(str);
  }
};
