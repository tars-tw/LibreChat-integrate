import { Tabs, TabsContent, TabsList, TabsTrigger } from '@librechat/client';
import { useTarsTokenPrepareDataQuery } from '~/data-provider';
import { TokenReport } from './Report';
import { useLocalize } from '~/hooks';
import Defaults from './Defaults';
import Quotas from './Quotas';

/** `TabsContent` ships with `mt-2 p-6`; each panel owns its own spacing instead. */
const TAB_PANEL = 'mt-3 p-0';

/**
 * Token quota administration and reporting (Token 配額與報表). The report leads
 * — what was actually spent — and the two quota tabs behind it are the layers
 * pwc_tars resolves in order: a person's own quota, then the per-provider
 * default beneath it. Groups are only a way to pick people in the quota form.
 */
export default function TokenQuotaManager() {
  const localize = useLocalize();
  const optionsQuery = useTarsTokenPrepareDataQuery();

  return (
    <Tabs defaultValue="report">
      <TabsList variant="underline">
        <TabsTrigger value="report" variant="underline">
          {localize('com_ui_tars_report_tab')}
        </TabsTrigger>
        <TabsTrigger value="quotas" variant="underline">
          {localize('com_ui_tars_quota_tab_users')}
        </TabsTrigger>
        <TabsTrigger value="defaults" variant="underline">
          {localize('com_ui_tars_quota_tab_defaults')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="report" className={TAB_PANEL}>
        <TokenReport options={optionsQuery.data} />
      </TabsContent>

      <TabsContent value="quotas" className={TAB_PANEL}>
        <Quotas options={optionsQuery.data} />
      </TabsContent>

      <TabsContent value="defaults" className={TAB_PANEL}>
        <Defaults />
      </TabsContent>
    </Tabs>
  );
}
