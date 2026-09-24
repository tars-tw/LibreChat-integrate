import { toToolDraft, toolDraftToStored } from '../McpToolEditorModal';

const storedTool = {
  name: 'create_ticket',
  method: 'POST',
  path: '/tickets',
  parameters: [
    {
      name: 'X-Requester',
      in: 'header',
      required: true,
      schema: { type: 'string' },
      value: '{{TARS_CURRENT_LOGINID}}',
    },
    { name: 'priority', in: 'query', required: false, schema: { type: 'string' } },
  ],
  request_body: {
    content_type: 'application/json',
    properties: [
      { name: 'reporter', type: 'string', required: true, value: '{{TARS_CURRENT_USER_EMAIL}}' },
      { name: 'summary', type: 'string', required: true },
    ],
  },
};

describe('custom_api tool fixed values', () => {
  it('round-trips bound values and leaves unbound fields to the model', () => {
    expect(toolDraftToStored(toToolDraft(storedTool))).toEqual(storedTool);
  });

  it('drops a blank fixed value instead of storing an empty binding', () => {
    const draft = toToolDraft(storedTool);
    draft.parameters[0].value = '   ';
    draft.bodyProperties[0].value = ' {{TARS_CURRENT_USER_ID}} ';

    const stored = toolDraftToStored(draft) as typeof storedTool;
    expect(stored.parameters[0]).not.toHaveProperty('value');
    expect(stored.request_body.properties[0].value).toBe('{{TARS_CURRENT_USER_ID}}');
  });
});
