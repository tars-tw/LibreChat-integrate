import { useLocalize } from '~/hooks';

const LANGFLOW_URL = import.meta.env.VITE_LANGFLOW_URL || 'http://localhost:7860';

export default function LangflowView() {
  const localize = useLocalize();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-primary">
      <iframe
        src={LANGFLOW_URL}
        title={localize('com_ui_langflow')}
        className="h-full w-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
