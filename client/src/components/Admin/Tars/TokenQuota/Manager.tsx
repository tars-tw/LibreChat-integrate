import { Tabs, TabsContent, TabsList, TabsTrigger } from '@librechat/client';
import { useTarsTokenPrepareDataQuery } from '~/data-provider';
import { TokenReport } from './Report';
import { useLocalize } from '~/hooks';
import Defaults from './Defaults';
import Configs from './Configs';
import Quotas from './Quotas';

/** `TabsContent` ships with `mt-2 p-6`; each panel owns its own spacing instead. */
const TAB_PANEL = 'mt-3 p-0';
/** The shared trigger only shifts the background when active, which reads as barely selected. */
const TAB_TRIGGER = 'data-[state=active]:text-brand-primary';

/**
 * Token quota administration and reporting (Token 配額與報表). The report leads
 * — what was actually spent — and the three quota tabs behind it are the layers
 * pwc_tars resolves in order: group rule, personal override, and the
 * per-provider fallback beneath both.
 */
export default function TokenQuotaManager() {
  const localize = useLocalize();
  const optionsQuery = useTarsTokenPrepareDataQuery();

  return (
    <Tabs defaultValue="report">
      <TabsList className="w-fit">
        <TabsTrigger value="report" className={TAB_TRIGGER}>
          {localize('com_ui_tars_report_tab')}
        </TabsTrigger>
        <TabsTrigger value="configs" className={TAB_TRIGGER}>
          {localize('com_ui_tars_quota_tab_configs')}
        </TabsTrigger>
        <TabsTrigger value="quotas" className={TAB_TRIGGER}>
          {localize('com_ui_tars_quota_tab_users')}
        </TabsTrigger>
        <TabsTrigger value="defaults" className={TAB_TRIGGER}>
          {localize('com_ui_tars_quota_tab_defaults')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="report" className={TAB_PANEL}>
        <TokenReport options={optionsQuery.data} />
      </TabsContent>

      <TabsContent value="configs" className={TAB_PANEL}>
        <Configs options={optionsQuery.data} />
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
