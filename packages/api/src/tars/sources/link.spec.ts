import { tarsSourceFileUrl, hasValidTarsSourceSignature } from './link';

const ref = {
  agentId: 'agent_AbC-123',
  knowledgeBaseId: '1ea10af6c442450eaa4775ef6717683c',
  documentId: 'e6b941ddc95f4f52829d057696d7b7df',
};

const signatureOf = (url: string | undefined) =>
  new URL(url ?? '', 'http://x').searchParams.get('sig') ?? undefined;

describe('tars source file links', () => {
  const secret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  afterAll(() => {
    process.env.JWT_SECRET = secret;
  });

  it('names the agent, knowledge base and document under the relay route', () => {
    const url = tarsSourceFileUrl(ref);
    expect(url).toMatch(
      /^\/api\/tars\/kb-files\/agent_AbC-123\/1ea10af6c442450eaa4775ef6717683c\/e6b941ddc95f4f52829d057696d7b7df\?sig=[\w-]{22}$/,
    );
    expect(hasValidTarsSourceSignature(ref, signatureOf(url))).toBe(true);
  });

  it('refuses a signature carried over to another file, agent or secret', () => {
    const signature = signatureOf(tarsSourceFileUrl(ref));
    expect(hasValidTarsSourceSignature({ ...ref, documentId: 'other' }, signature)).toBe(false);
    expect(hasValidTarsSourceSignature({ ...ref, agentId: 'agent_other' }, signature)).toBe(false);
    expect(hasValidTarsSourceSignature(ref, undefined)).toBe(false);

    process.env.JWT_SECRET = 'rotated';
    expect(hasValidTarsSourceSignature(ref, signature)).toBe(false);
  });

  it('signs nothing without a secret or for ids that are not plain', () => {
    expect(tarsSourceFileUrl({ ...ref, documentId: '../etc' })).toBeUndefined();
    expect(tarsSourceFileUrl({ ...ref, knowledgeBaseId: '' })).toBeUndefined();

    delete process.env.JWT_SECRET;
    expect(tarsSourceFileUrl(ref)).toBeUndefined();
  });
});
