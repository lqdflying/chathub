import React from 'react';
import { App } from 'antd';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ApitestWorkspace from './index';

vi.stubGlobal('React', React);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'apitest.addHeader': 'Add Header',
        'apitest.addParam': 'Add Param',
        'apitest.apiKeyAddTo': 'Add To',
        'apitest.apiKeyInHeader': 'Header',
        'apitest.apiKeyInQuery': 'Query Params',
        'apitest.apiKeyName': 'Key Name',
        'apitest.apiKeyValue': 'Key Value',
        'apitest.auth': 'Auth',
        'apitest.authApiKey': 'API Key',
        'apitest.authBasic': 'Basic Auth',
        'apitest.authBearer': 'Bearer Token',
        'apitest.authNone': 'None',
        'apitest.authType': 'Auth Type',
        'apitest.body': 'Body',
        'apitest.bodyUnavailable':
          'Body is only available for POST, PUT, PATCH, DELETE, and OPTIONS requests.',
        'apitest.cancel': 'Cancel',
        'apitest.clearHistory': 'Clear All',
        'apitest.clearHistoryConfirm': 'Clear all history?',
        'apitest.contentType': 'Content-Type',
        'apitest.copyAsCurl': 'Copy as cURL',
        'apitest.deleteHistoryEntry': 'Delete history entry',
        'apitest.disableRow': 'Disable',
        'apitest.enableRow': 'Enable',
        'apitest.formatJson': 'Format JSON',
        'apitest.headerKey': 'Key',
        'apitest.headerValue': 'Value',
        'apitest.headers': 'Headers',
        'apitest.history': 'History',
        'apitest.historyEmpty': 'No requests yet',
        'apitest.importCurl': 'Import cURL',
        'apitest.importCurlConfirm': 'Import',
        'apitest.importCurlPlaceholder': 'curl https://example.com',
        'apitest.paramKey': 'Key',
        'apitest.paramValue': 'Value',
        'apitest.params': 'Params',
        'apitest.password': 'Password',
        'apitest.remove': 'Remove',
        'apitest.restore': 'Click to restore',
        'apitest.restoreHistoryEntry': 'Restore request',
        'apitest.send': 'Send',
        'apitest.sendShortcut': 'Ctrl / ⌘ + Enter',
        'apitest.title': 'API Tester',
        'apitest.token': 'Token',
        'apitest.username': 'Username',
      })[key] ?? key,
  }),
}));

describe('ApitestWorkspace', () => {
  it('does not send the underlying request when Ctrl+Enter is pressed in the import modal', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <App>
        <ApitestWorkspace />
      </App>,
    );

    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1/users'), {
      target: { value: 'https://api.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Import cURL/ }));

    const textarea = screen.getByPlaceholderText('curl https://example.com');
    fireEvent.change(textarea, { target: { value: 'curl https://example.com' } });
    fireEvent.keyDown(textarea, { ctrlKey: true, key: 'Enter' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
