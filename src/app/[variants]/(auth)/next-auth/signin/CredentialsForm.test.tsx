import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { ChangeEvent, PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CredentialsForm from './CredentialsForm';

const { push, signIn } = vi.hoisted(() => ({
  push: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push,
  }),
}));

vi.mock('next-auth/react', () => ({
  signIn,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: {
      form: 'form',
      input: 'input',
      tab: 'tab',
    },
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Button: vi.fn(({ children, loading, type: _type, ...props }) => (
    <button aria-busy={loading} type="button" {...props}>
      {children}
    </button>
  )),
  Text: vi.fn(({ as: Component = 'span', children, ...props }) => <Component {...props}>{children}</Component>),
}));

vi.mock('antd', () => {
  const Flex = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const Divider = ({ children }: PropsWithChildren) => <div>{children}</div>;
  const Alert = ({ message }: { message: string }) => <div role="alert">{message}</div>;
  const Input = ({
    onChange,
    onPressEnter,
    placeholder,
    value,
  }: {
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    onPressEnter?: () => void;
    placeholder?: string;
    value?: string;
  }) => (
    <input
      onChange={onChange}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onPressEnter?.();
      }}
      placeholder={placeholder}
      value={value}
    />
  );

  Input.Password = Input;

  const Tabs = ({
    activeKey,
    items,
    onChange,
  }: {
    activeKey: string;
    items: { children: ReactNode; key: string; label: ReactNode }[];
    onChange: (key: string) => void;
  }) => (
    <div>
      {items.map((item) => (
        <button key={item.key} onClick={() => onChange(item.key)} type="button">
          {item.label}
        </button>
      ))}
      <div>{items.find((item) => item.key === activeKey)?.children}</div>
    </div>
  );

  return { Alert, Divider, Flex, Input, Tabs };
});

describe('CredentialsForm', () => {
  beforeEach(() => {
    push.mockReset();
    signIn.mockReset();
  });

  it('should use the validated NextAuth redirect for password login', async () => {
    signIn.mockResolvedValue({ url: '/safe-password-target' });

    render(<CredentialsForm callbackUrl="https://example.com/unsafe" />);

    fireEvent.change(screen.getByPlaceholderText('credentials.usernamePlaceholder'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByPlaceholderText('credentials.passwordPlaceholder'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'credentials.signIn' }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('credentials', {
        password: 'secret',
        redirect: false,
        redirectTo: 'https://example.com/unsafe',
        token: '',
        username: 'admin',
      });
      expect(push).toHaveBeenCalledWith('/safe-password-target');
    });
  });

  it('should use the validated NextAuth redirect for token login', async () => {
    signIn.mockResolvedValue({ url: '/safe-token-target' });

    render(<CredentialsForm callbackUrl="/chat" />);

    fireEvent.click(screen.getByRole('button', { name: 'credentials.tabToken' }));
    fireEvent.change(screen.getByPlaceholderText('credentials.tokenPlaceholder'), {
      target: { value: 'token-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'credentials.signIn' }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('credentials', {
        password: '',
        redirect: false,
        redirectTo: '/chat',
        token: 'token-123',
        username: '',
      });
      expect(push).toHaveBeenCalledWith('/safe-token-target');
    });
  });

  it('should fallback to / when signIn returns no url (prevents open redirect)', async () => {
    signIn.mockResolvedValue({ ok: true, url: '' });

    render(<CredentialsForm callbackUrl="https://evil.com/phish" />);

    fireEvent.change(screen.getByPlaceholderText('credentials.usernamePlaceholder'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByPlaceholderText('credentials.passwordPlaceholder'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'credentials.signIn' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/');
    });
  });

  it('should show an inline error when credentials login fails', async () => {
    signIn.mockResolvedValue({ error: 'CredentialsSignin' });

    render(<CredentialsForm callbackUrl="/chat" />);

    fireEvent.change(screen.getByPlaceholderText('credentials.usernamePlaceholder'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByPlaceholderText('credentials.passwordPlaceholder'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'credentials.signIn' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('credentials.errorInvalid');
    expect(push).not.toHaveBeenCalled();
  });
});
