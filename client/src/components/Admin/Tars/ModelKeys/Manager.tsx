import { Tabs, TabsContent, TabsList, TabsTrigger } from '@librechat/client';
import { useLocalize } from '~/hooks';
import Usage from './Usage';
import Keys from './Keys';

/** `TabsContent` ships with `mt-2 p-6`; each panel owns its own spacing instead. */
const TAB_PANEL = 'mt-3 p-0';
/** The shared trigger only shifts the background when active, which reads as barely selected. */
const TAB_TRIGGER = 'data-[state=active]:text-brand-primary';

/** Model key management (模型金鑰管理): the credentials, then what they cost. */
export default function ModelKeysManager() {
  const localize = useLocalize();

  return (
    <Tabs defaultValue="keys">
      <TabsList className="w-fit">
        <TabsTrigger value="keys" className={TAB_TRIGGER}>
          {localize('com_ui_tars_keys_tab')}
        </TabsTrigger>
        <TabsTrigger value="usage" className={TAB_TRIGGER}>
          {localize('com_ui_tars_usage_tab')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="keys" className={TAB_PANEL}>
        <Keys />
      </TabsContent>

      <TabsContent value="usage" className={TAB_PANEL}>
        <Usage />
      </TabsContent>
    </Tabs>
  );
}
