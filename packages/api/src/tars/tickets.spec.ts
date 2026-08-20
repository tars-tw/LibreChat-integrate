jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  fetchTarsTickets,
  createTarsTicket,
  updateTarsTicket,
  fetchTarsTicketDetail,
  createTarsTicketComment,
  fetchTarsTicketComponents,
  fetchTarsTicketFieldOptions,
} from './tickets';
import type { TarsTicket } from './tickets';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

const ticket: TarsTicket = {
  id: 'ticket-1',
  title: 'Login fails',
  description: 'Cannot sign in',
  jira_ticket_key: 'TARS-42',
  status: 'synced',
};

const formOf = (fetchMock: jest.SpyInstance, call = 0): FormData =>
  (fetchMock.mock.calls[call][1] as RequestInit).body as FormData;

describe('fetchTarsTickets', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('unwraps the envelope', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: [ticket] }));
    await expect(fetchTarsTickets('7', BASE_URL)).resolves.toEqual([ticket]);
  });

  /** pwc_tars 400s without `user_id`, and only asks the remote when told to. */
  it('scopes the list to the operator and requests the live status', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: [] }));
    await fetchTarsTickets('7', BASE_URL);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('user_id=7');
    expect(url).toContain('with_remote_status=true');
  });

  it('returns [] when the operator has no tickets', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true, data: [] }));
    await expect(fetchTarsTickets('7', BASE_URL)).resolves.toEqual([]);
  });
});

describe('fetchTarsTicketDetail', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the enriched ticket', async () => {
    const detail = { ...ticket, editable: true, comments: [], remote_status: 'NEW' };
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: detail }));
    await expect(fetchTarsTicketDetail('ticket-1', BASE_URL)).resolves.toEqual(detail);
  });

  it('encodes the ticket id into the path', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: null }));
    await fetchTarsTicketDetail('a/b', BASE_URL);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/support_tickets/a%2Fb');
  });

  it('returns null when pwc_tars sends no ticket', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, { success: true }));
    await expect(fetchTarsTicketDetail('ticket-1', BASE_URL)).resolves.toBeNull();
  });
});

describe('fetchTarsTicketFieldOptions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fills in every domain that pwc_tars omitted', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { types: ['BUG'] } }));
    await expect(fetchTarsTicketFieldOptions(BASE_URL)).resolves.toEqual({
      types: ['BUG'],
      priorities: [],
      severities: [],
      warning: null,
    });
  });

  /** A degraded lookup still answers 200 so the form stays usable. */
  it('keeps the fallback warning', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: { types: [], priorities: [], severities: [], warning: 'openapi unreachable' },
      }),
    );
    const options = await fetchTarsTicketFieldOptions(BASE_URL);
    expect(options.warning).toBe('openapi unreachable');
  });
});

describe('fetchTarsTicketComponents', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** pwc_tars returns numeric ids; the form's dropdown compares strings. */
  it('stringifies the component ids', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      buildResponse(200, {
        success: true,
        data: [{ id: 12, name: 'Platform' }],
      }),
    );
    await expect(fetchTarsTicketComponents(BASE_URL)).resolves.toEqual([
      { id: '12', name: 'Platform' },
    ]);
  });
});

describe('ticket mutations', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the reporter and every field as multipart form data', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: ticket }));
    const file = { buffer: Buffer.from('log'), filename: 'app.log', mimetype: 'text/plain' };
    await createTarsTicket(
      { tarsId: '7', name: 'Ada', email: 'ada@example.com' },
      { title: 'Login fails', description: 'Cannot sign in', component_id: '12' },
      [file],
      BASE_URL,
    );

    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    const form = formOf(fetchMock);
    expect(form.get('title')).toBe('Login fails');
    expect(form.get('component_id')).toBe('12');
    expect(form.get('user_id')).toBe('7');
    expect(form.get('user_name')).toBe('Ada');
    expect(form.get('user_email')).toBe('ada@example.com');
    expect(form.getAll('attachments')).toHaveLength(1);
  });

  /** pwc_tars reads `type`/`priority`/`severity` unconditionally; send them empty. */
  it('sends the optional domains as empty strings when unset', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: ticket }));
    await createTarsTicket({ tarsId: '7' }, { title: 't', description: 'd' }, [], BASE_URL);
    const form = formOf(fetchMock);
    expect(form.get('type')).toBe('');
    expect(form.get('priority')).toBe('');
    expect(form.get('severity')).toBe('');
  });

  it('updates over PUT with the operator id attached', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: ticket }));
    await updateTarsTicket('7', 'ticket-1', { title: 't', description: 'd' }, [], BASE_URL);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PUT');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/support_tickets/ticket-1');
    expect(formOf(fetchMock).get('user_id')).toBe('7');
  });

  it('surfaces the pwc_tars message when a ticket edit is rejected', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(409, { message: '此工單已在處理中' }));
    await expect(
      updateTarsTicket('7', 'ticket-1', { title: 't', description: 'd' }, [], BASE_URL),
    ).rejects.toMatchObject({ status: 409, serverMessage: '此工單已在處理中' });
  });

  it('sends the reply body and operator, and returns the new comment id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(200, { success: true, data: { id: 'c-9' } }));
    await expect(createTarsTicketComment('7', 'ticket-1', 'any update?', BASE_URL)).resolves.toBe(
      'c-9',
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ body: 'any update?', user_id: '7' });
  });
});
