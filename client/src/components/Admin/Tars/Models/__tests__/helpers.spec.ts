import type { TTarsModelProfile } from 'librechat-data-provider';
import {
  formatConfig,
  isValidConfig,
  summarizeSync,
  joinDescription,
  splitDescription,
  collectModelTypes,
  displayDescription,
} from '../helpers';

const profile = (type: string | null): TTarsModelProfile => ({
  id: type ?? 'none',
  name: 'm',
  version: null,
  type,
  description: null,
  status: 1,
  config: null,
  endpoint: null,
  api_version: null,
});

describe('collectModelTypes', () => {
  it('offers every selectable type plus any legacy one still in use', () => {
    expect(collectModelTypes([profile('OPEN_AI'), profile(' VLLM '), profile(null)])).toEqual([
      'CLOUD',
      'GOOGLE_VERTEX',
      'OPEN_AI',
      'VLLM',
    ]);
  });
});

describe('description', () => {
  const stored = '{"zh-TW":"雲端模型","en-US":"Cloud model"}';

  it('splits the per-locale JSON into the two editor fields', () => {
    expect(splitDescription(stored)).toEqual({ zh: '雲端模型', en: 'Cloud model' });
  });

  it('puts legacy plain text in the Chinese field', () => {
    expect(splitDescription('[GPT] 綜合能力最強')).toEqual({ zh: '[GPT] 綜合能力最強', en: '' });
    expect(splitDescription(null)).toEqual({ zh: '', en: '' });
  });

  it('writes the edited languages back and keeps other locales', () => {
    expect(JSON.parse(joinDescription('{"ja":"クラウド","zh-TW":"舊"}', '新', 'New'))).toEqual({
      ja: 'クラウド',
      'zh-TW': '新',
      'en-US': 'New',
    });
  });

  it('drops an emptied language and clears the field once nothing is left', () => {
    expect(JSON.parse(joinDescription(stored, '雲端模型', ' '))).toEqual({ 'zh-TW': '雲端模型' });
    expect(joinDescription(stored, '', '')).toBe('');
    expect(joinDescription('plain text', '', '')).toBe('');
  });

  it('shows the UI language first and falls back to the other one', () => {
    expect(displayDescription(stored, 'zh-Hant')).toBe('雲端模型');
    expect(displayDescription(stored, 'en-US')).toBe('Cloud model');
    expect(displayDescription('{"zh-TW":"只有中文"}', 'en-US')).toBe('只有中文');
  });

  it('strips the legacy `[tag]` prefix from plain text', () => {
    expect(displayDescription('[GPT] 綜合能力最強', 'en-US')).toBe('綜合能力最強');
  });
});

describe('config', () => {
  it('accepts an empty config or a JSON object, nothing else', () => {
    expect(isValidConfig('')).toBe(true);
    expect(isValidConfig('{"max_token": 8192}')).toBe(true);
    expect(isValidConfig('[1, 2]')).toBe(false);
    expect(isValidConfig('"text"')).toBe(false);
    expect(isValidConfig('{max_token: 1}')).toBe(false);
  });

  it('pretty-prints valid JSON and leaves anything else as typed', () => {
    expect(formatConfig('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatConfig('{broken')).toBe('{broken');
  });
});

describe('summarizeSync', () => {
  it('totals the moved references and names their new model', () => {
    expect(
      summarizeSync({
        target: { id: 'd', name: 'default' },
        knowledge_base: 1,
        sys_model: 2,
        sys_rag_model: 0,
        sys_domain: 3,
      }),
    ).toEqual({ count: 6, name: 'default' });
  });

  it('reports nothing when no reference moved', () => {
    expect(summarizeSync(null)).toBeNull();
    expect(
      summarizeSync({
        target: { id: 'd', name: 'default' },
        knowledge_base: 0,
        sys_model: 0,
        sys_rag_model: 0,
        sys_domain: 0,
      }),
    ).toBeNull();
  });
});
