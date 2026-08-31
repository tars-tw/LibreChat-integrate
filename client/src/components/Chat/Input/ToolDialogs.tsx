import React, { useMemo } from 'react';
import SearchApiKeyDialog from '~/components/SidePanel/Agents/Search/ApiKeyDialog';
import McpCredentialsDialog from '~/components/Tars/McpCredentialsDialog';
import { useBadgeRowContext } from '~/Providers';

function ToolDialogs() {
  const context = useBadgeRowContext();
  const { webSearch, searchApiKeyForm, tarsMcpTools } = context ?? {};
  const credentialsServer = tarsMcpTools?.credentialsServer ?? null;
  /** Rendered here rather than in the MCP menus, which unmount on close. */
  const tarsCredentialsDialog = credentialsServer && (
    <McpCredentialsDialog
      open={true}
      server={credentialsServer}
      onOpenChange={(open) => {
        if (!open) {
          tarsMcpTools?.closeCredentials();
        }
      }}
    />
  );
  const { authData: webSearchAuthData } = webSearch ?? {};
  const searchAuthTypes = useMemo(
    () => webSearchAuthData?.authTypes ?? [],
    [webSearchAuthData?.authTypes],
  );

  if (!searchApiKeyForm) {
    return tarsCredentialsDialog || null;
  }

  const {
    methods: searchMethods,
    onSubmit: searchOnSubmit,
    isDialogOpen: searchDialogOpen,
    setIsDialogOpen: setSearchDialogOpen,
    handleRevokeApiKey: searchHandleRevoke,
    badgeTriggerRef: searchBadgeTriggerRef,
    menuTriggerRef: searchMenuTriggerRef,
  } = searchApiKeyForm;

  return (
    <>
      {tarsCredentialsDialog}
      <SearchApiKeyDialog
        onSubmit={searchOnSubmit}
        authTypes={searchAuthTypes}
        isOpen={searchDialogOpen}
        onRevoke={searchHandleRevoke}
        register={searchMethods.register}
        setValue={searchMethods.setValue}
        onOpenChange={setSearchDialogOpen}
        handleSubmit={searchMethods.handleSubmit}
        triggerRefs={[searchMenuTriggerRef, searchBadgeTriggerRef]}
        isToolAuthenticated={webSearchAuthData?.authenticated ?? false}
        searchProvider={webSearchAuthData?.searchProvider}
        scraperProvider={webSearchAuthData?.scraperProvider}
        rerankerType={webSearchAuthData?.rerankerType}
      />
    </>
  );
}

export default ToolDialogs;
