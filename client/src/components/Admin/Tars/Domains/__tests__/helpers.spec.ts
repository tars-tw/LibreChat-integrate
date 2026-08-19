import { domainRoleIds, parseDomainFunctions, disabledDomainFunctions } from '../helpers';

describe('parseDomainFunctions', () => {
  it('reads each capability pair and skips the model settings block', () => {
    const raw = JSON.stringify({
      web_search: { enabled: false, default_value: false },
      rag_search: { enabled: true, default_value: true },
      rag_source_download: { enabled: true },
      model_settings: { default_model: '7', available_models: ['7'] },
    });

    expect(parseDomainFunctions(raw)).toEqual({
      web_search: { enabled: false, default_value: false },
      rag_search: { enabled: true, default_value: true },
      rag_source_download: { enabled: true, default_value: undefined },
    });
  });

  it('returns an empty map for missing or malformed json', () => {
    expect(parseDomainFunctions(null)).toEqual({});
    expect(parseDomainFunctions('not json')).toEqual({});
  });
});

describe('disabledDomainFunctions', () => {
  /** pwc_tars replaces the block wholesale, so nothing may be left switched on. */
  it('switches every known capability off and clears the model settings', () => {
    const result = JSON.parse(
      disabledDomainFunctions(
        JSON.stringify({
          web_search: { enabled: true, default_value: true },
          file_upload: { enabled: true },
          model_settings: { default_model: '5', available_models: ['5', '6'] },
        }),
      ),
    );

    expect(result.web_search).toEqual({ enabled: false, default_value: false });
    expect(result.rag_search).toEqual({ enabled: false, default_value: false });
    expect(result.file_upload).toEqual({ enabled: false });
    expect(result.mcp_manage).toEqual({ enabled: false });
    expect(result.model_settings).toEqual({ default_model: '', available_models: [] });
  });

  /** A newer pwc_tars build may add keys this editor has never heard of. */
  it('disables unknown keys instead of dropping them', () => {
    const result = JSON.parse(
      disabledDomainFunctions(
        JSON.stringify({ future_feature: { enabled: true, default_value: true } }),
      ),
    );

    expect(result.future_feature).toEqual({ enabled: false, default_value: false });
  });

  it('still produces a full disabled block when there is nothing stored', () => {
    const result = JSON.parse(disabledDomainFunctions(null));

    expect(result.suggested_questions).toEqual({ enabled: false, default_value: false });
    expect(result.my_prompts).toEqual({ enabled: false });
  });
});

describe('domainRoleIds', () => {
  /** pwc_tars keeps the binding on both sides; the role side is authoritative. */
  it('reads the binding from the roles, not from domain.role_ids', () => {
    const domain = { id: 2, role_ids: '99' } as Parameters<typeof domainRoleIds>[0];
    const roles = [
      { id: 1, name: 'A', domain_ids: '2,3' },
      { id: 2, name: 'B', domain_ids: '3' },
      { id: 3, name: 'C', domain_ids: null },
    ];

    expect(domainRoleIds(domain, roles)).toEqual(['1']);
  });
});
