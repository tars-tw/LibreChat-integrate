import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import type { TranslationKeys } from '~/hooks';
import {
  Login,
  VerifyEmail,
  Registration,
  ResetPassword,
  ApiErrorWatcher,
  TwoFactorScreen,
  RequestPasswordReset,
} from '~/components/Auth';
import { MarketplaceProvider } from '~/components/Agents/MarketplaceContext';
import AgentMarketplace from '~/components/Agents/Marketplace';
import { OAuthSuccess, OAuthError } from '~/components/OAuth';
import AdminPlaceholder from '~/components/Admin/Placeholder';
import LangflowView from '~/components/Langflow/LangflowView';
import { AuthContextProvider } from '~/hooks/AuthContext';
import RouteErrorBoundary from './RouteErrorBoundary';
import StartupLayout from './Layouts/Startup';
import LoginLayout from './Layouts/Login';
import dashboardRoutes from './Dashboard';
import WithRum from '~/lib/rum/WithRum';
import ShareRoute from './ShareRoute';
import ChatRoute from './ChatRoute';
import Search from './Search';
import Root from './Root';

const AuthLayout = () => (
  <AuthContextProvider>
    <WithRum>
      <Outlet />
    </WithRum>
    <ApiErrorWatcher />
  </AuthContextProvider>
);

const loadInlinePromptsView = () =>
  import('~/components/Prompts/layouts/InlinePromptsView').then((m) => ({
    Component: m.default,
  }));

const loadSkillsView = () =>
  import('~/components/Skills/layouts/SkillsView').then((m) => ({
    Component: m.default,
  }));

const loadInsightsView = () =>
  import('~/components/Insights').then((m) => ({
    Component: m.default,
  }));

const loadProjectsView = () =>
  import('~/components/Projects').then((m) => ({
    Component: m.ProjectsView,
  }));

const loadProjectWorkspace = () =>
  import('~/components/Projects').then((m) => ({
    Component: m.ProjectWorkspace,
  }));

const loadKnowledgeBasesView = () =>
  import('~/components/Admin/Tars/Knowledge').then((m) => ({
    Component: m.KnowledgeView,
  }));

const loadKnowledgeBaseDetail = () =>
  import('~/components/Admin/Tars/Knowledge/Detail').then((m) => ({
    Component: m.KnowledgeDetailView,
  }));

const loadSystemSettingsView = () =>
  import('~/components/Admin/Tars/SystemSettings').then((m) => ({
    Component: m.SystemSettingsView,
  }));

const loadAuditMessagesView = () =>
  import('~/components/Admin/Tars/Audit').then((m) => ({
    Component: m.AuditView,
  }));

const loadAuditOperationsView = () =>
  import('~/components/Admin/Tars/Operations').then((m) => ({
    Component: m.OperationsView,
  }));

const loadIssuesView = () =>
  import('~/components/Admin/Tars/Issues').then((m) => ({
    Component: m.IssuesView,
  }));

const loadDatabasesView = () =>
  import('~/components/Admin/Tars/Databases').then((m) => ({
    Component: m.DatabaseView,
  }));

const loadFileSystemsView = () =>
  import('~/components/Admin/Tars/FileSystems').then((m) => ({
    Component: m.FileSystemView,
  }));

const loadWebsitesView = () =>
  import('~/components/Admin/Tars/Websites').then((m) => ({
    Component: m.WebsiteView,
  }));

const loadSchedulesView = () =>
  import('~/components/Admin/Tars/Schedules').then((m) => ({
    Component: m.SchedulesView,
  }));

const loadSysConfigView = () =>
  import('~/components/Admin/Tars/SysConfig').then((m) => ({
    Component: m.SysConfigView,
  }));

const loadMcpSettingsView = () =>
  import('~/components/McpSettings').then((m) => ({
    Component: m.McpSettingsView,
  }));

const loadRolesView = () =>
  import('~/components/Admin/Tars/Roles').then((m) => ({
    Component: m.RolesView,
  }));

const loadGroupsView = () =>
  import('~/components/Admin/Tars/Groups').then((m) => ({
    Component: m.GroupsView,
  }));

const loadUsersView = () =>
  import('~/components/Admin/Tars/Users').then((m) => ({
    Component: m.UsersView,
  }));

const loadModelKeysView = () =>
  import('~/components/Admin/Tars/ModelKeys').then((m) => ({
    Component: m.ModelKeysView,
  }));

const loadTokenQuotaView = () =>
  import('~/components/Admin/Tars/TokenQuota').then((m) => ({
    Component: m.TokenQuotaView,
  }));

const loadDomainsView = () =>
  import('~/components/Admin/Tars/Domains').then((m) => ({
    Component: m.DomainsView,
  }));

const placeholderRoute = (path: string, titleKey: TranslationKeys) => ({
  path,
  element: <AdminPlaceholder titleKey={titleKey} />,
});

const baseEl = document.querySelector('base');
const baseHref = baseEl?.getAttribute('href') || '/';

export const router = createBrowserRouter(
  [
    {
      path: 'share/:shareId',
      element: <ShareRoute />,
      errorElement: <RouteErrorBoundary />,
    },
    {
      path: 'oauth',
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          path: 'success',
          element: <OAuthSuccess />,
        },
        {
          path: 'error',
          element: <OAuthError />,
        },
      ],
    },
    {
      path: '/',
      element: <StartupLayout />,
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          path: 'register',
          element: <Registration />,
        },
        {
          path: 'forgot-password',
          element: <RequestPasswordReset />,
        },
        {
          path: 'reset-password',
          element: <ResetPassword />,
        },
      ],
    },
    {
      path: 'verify',
      element: <VerifyEmail />,
      errorElement: <RouteErrorBoundary />,
    },
    {
      element: <AuthLayout />,
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          path: '/',
          element: <LoginLayout />,
          children: [
            {
              path: 'login',
              element: <Login />,
            },
            {
              path: 'login/2fa',
              element: <TwoFactorScreen />,
            },
          ],
        },
        dashboardRoutes,
        {
          path: '/',
          element: <Root />,
          children: [
            {
              index: true,
              element: <Navigate to="/c/new" replace={true} />,
            },
            {
              path: 'c/:conversationId?',
              element: <ChatRoute />,
            },
            {
              path: 'search',
              element: <Search />,
            },
            {
              path: 'langflow',
              element: <LangflowView />,
            },
            {
              path: 'prompts',
              element: <Navigate to="/c/new" replace={true} />,
            },
            {
              /** Prompts are created from a dialog, so there is no "new" page to land on */
              path: 'prompts/new',
              element: <Navigate to="/c/new" replace={true} />,
            },
            {
              path: 'prompts/:promptId',
              lazy: loadInlinePromptsView,
            },
            {
              path: 'skills',
              lazy: loadSkillsView,
            },
            {
              path: 'insights',
              lazy: loadInsightsView,
            },
            {
              path: 'skills/new',
              lazy: loadSkillsView,
            },
            {
              path: 'skills/:skillId',
              lazy: loadSkillsView,
            },
            {
              path: 'skills/:skillId/edit',
              lazy: loadSkillsView,
            },
            {
              path: 'projects',
              lazy: loadProjectsView,
            },
            {
              path: 'projects/:projectId',
              lazy: loadProjectWorkspace,
            },
            {
              path: 'knowledge-bases',
              lazy: loadKnowledgeBasesView,
            },
            {
              path: 'knowledge-bases/:kbId',
              lazy: loadKnowledgeBaseDetail,
            },
            {
              path: 'system-config',
              lazy: loadSysConfigView,
            },
            {
              path: 'mcp-settings',
              lazy: loadMcpSettingsView,
            },
            {
              path: 'admin/domains',
              lazy: loadDomainsView,
            },
            {
              path: 'kb-schedules',
              lazy: loadSchedulesView,
            },
            {
              path: 'data-sources/databases',
              lazy: loadDatabasesView,
            },
            {
              path: 'data-sources/documents',
              lazy: loadFileSystemsView,
            },
            {
              path: 'data-sources/websites',
              lazy: loadWebsitesView,
            },
            {
              path: 'admin/users',
              lazy: loadUsersView,
            },
            {
              path: 'admin/groups',
              lazy: loadGroupsView,
            },
            {
              path: 'admin/permissions',
              lazy: loadRolesView,
            },
            {
              path: 'admin/system-settings',
              lazy: loadSystemSettingsView,
            },
            {
              path: 'admin/model-keys',
              lazy: loadModelKeysView,
            },
            {
              path: 'admin/issues',
              lazy: loadIssuesView,
            },
            placeholderRoute('admin/about', 'com_ui_tars_nav_about'),
            {
              path: 'audit/messages',
              lazy: loadAuditMessagesView,
            },
            {
              path: 'audit/operations',
              lazy: loadAuditOperationsView,
            },
            {
              path: 'audit/tokens',
              lazy: loadTokenQuotaView,
            },
            placeholderRoute('audit/governance', 'com_ui_tars_nav_audit_governance'),
            {
              path: 'agents',
              element: (
                <MarketplaceProvider>
                  <AgentMarketplace />
                </MarketplaceProvider>
              ),
            },
            {
              path: 'agents/:category',
              element: (
                <MarketplaceProvider>
                  <AgentMarketplace />
                </MarketplaceProvider>
              ),
            },
          ],
        },
      ],
    },
  ],
  { basename: baseHref },
);
