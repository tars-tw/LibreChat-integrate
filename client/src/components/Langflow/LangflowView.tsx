import { useLocalize } from '~/hooks';

const LANGFLOW_URL = import.meta.env.VITE_LANGFLOW_URL || 'http://localhost:7860';

/**
 * Browsers that loaded an older Langflow build kept its index.html in the iframe's HTTP cache
 * (it was served without Cache-Control), and that shell points at hashed assets the current build
 * no longer has, so the embed renders blank. A new URL can't hit that cache entry. Langflow now
 * sends `Cache-Control: no-cache` for index.html, so this only needs bumping if a stale shell
 * ever gets cached again.
 */
const LANGFLOW_EMBED_VERSION = '2';

const langflowEmbedUrl = (() => {
  const url = new URL(LANGFLOW_URL, window.location.origin);
  url.searchParams.set('v', LANGFLOW_EMBED_VERSION);
  return url.toString();
})();

export default function LangflowView() {
  const localize = useLocalize();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-primary">
      <iframe
        src={langflowEmbedUrl}
        title={localize('com_ui_langflow')}
        className="h-full w-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
