import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import type { TTarsMcpParsedSpec } from 'librechat-data-provider';
import McpParsedTools from '../McpParsedTools';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const spec: TTarsMcpParsedSpec = {
  tool_count: 3,
  tools: [
    {
      name: 'login_auth_login',
      method: 'post',
      path: '/auth/login',
      description: '登入\n\n以 email 登入\n- 取得 JWT',
    },
    { name: 'me_auth_me', method: 'get', path: '/auth/me', description: '目前登入者' },
    {
      name: 'logout_auth_logout',
      method: 'post',
      path: '/auth/logout',
      description: '登出\r\n\r\n撤銷 refresh token',
    },
  ],
};

describe('McpParsedTools', () => {
  it('shows each tool endpoint and its summary without the details', () => {
    render(<McpParsedTools spec={spec} />);

    expect(screen.getAllByText('POST')).toHaveLength(2);
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('login_auth_login')).toBeInTheDocument();
    expect(screen.getByText('/auth/login')).toBeInTheDocument();
    expect(screen.getByText('登入')).toBeInTheDocument();
    expect(screen.queryByText(/以 email 登入/)).not.toBeInTheDocument();
  });

  it('expands and collapses the details of one tool', () => {
    render(<McpParsedTools spec={spec} />);
    const row = screen.getByRole('button', { name: /login_auth_login/ });

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/以 email 登入/)).toHaveTextContent('取得 JWT');
    expect(screen.queryByText('撤銷 refresh token')).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/以 email 登入/)).not.toBeInTheDocument();
  });

  it('offers no toggle for a tool that only has a summary', () => {
    render(<McpParsedTools spec={spec} />);

    expect(screen.queryByRole('button', { name: /me_auth_me/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('splits on a blank line written with CRLF', () => {
    render(<McpParsedTools spec={spec} />);

    fireEvent.click(screen.getByRole('button', { name: /logout_auth_logout/ }));

    expect(screen.getByText('登出')).toBeInTheDocument();
    expect(screen.getByText('撤銷 refresh token')).toBeInTheDocument();
  });
});
