import { GITHUB_ISSUES, MORE_FILE_PREVIEW_REQUEST_URL } from './url';

describe('file preview feedback URL', () => {
  it('points unsupported preview requests to the ChatHub issue tracker', () => {
    expect(MORE_FILE_PREVIEW_REQUEST_URL).toBe(GITHUB_ISSUES);
    expect(MORE_FILE_PREVIEW_REQUEST_URL).toBe(
      'https://github.com/lqdflying/chathub/issues/new/choose',
    );
  });
});
