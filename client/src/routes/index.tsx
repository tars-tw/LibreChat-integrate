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
import LangflowView from '~/components/Langflow/LangflowView';

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
  import('~/components/KnowledgeBases').then((m) => ({
    Component: m.KnowledgeBasesView,
  }));

const loadKnowledgeBaseDetail = () =>
  import('~/components/KnowledgeBases').then((m) => ({
    Component: m.KnowledgeBaseDetail,
  }));

const loadSystemConfigView = () =>
  import('~/components/SystemConfig').then((m) => ({
    Component: m.SystemConfigView,
  }));

const loadMcpSettingsView = () =>
  import('~/components/McpSettings').then((m) => ({
    Component: m.McpSettingsView,
  }));

const loadDomainsView = () =>
  import('~/components/Admin/Tars/DomainsView').then((m) => ({
    Component: m.default,
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
              lazy: loadSystemConfigView,
            },
            {
              path: 'mcp-settings',
              lazy: loadMcpSettingsView,
            },
            {
              path: 'admin/domains',
              lazy: loadDomainsView,
            },
            placeholderRoute('kb-schedules', 'com_ui_tars_nav_kb_schedule'),
            placeholderRoute('data-sources/databases', 'com_ui_tars_nav_app_db'),
            placeholderRoute('data-sources/documents', 'com_ui_tars_nav_doc_groups'),
            placeholderRoute('data-sources/websites', 'com_ui_tars_nav_websites'),
            placeholderRoute('admin/users', 'com_ui_tars_nav_users'),
            placeholderRoute('admin/groups', 'com_ui_tars_nav_groups'),
            placeholderRoute('admin/permissions', 'com_ui_tars_nav_permissions'),
            placeholderRoute('admin/system-settings', 'com_ui_tars_nav_system_settings'),
            placeholderRoute('admin/model-keys', 'com_ui_tars_nav_model_keys'),
            placeholderRoute('admin/issues', 'com_ui_tars_nav_issues'),
            placeholderRoute('admin/about', 'com_ui_tars_nav_about'),
            placeholderRoute('audit/messages', 'com_ui_tars_nav_audit_messages'),
            placeholderRoute('audit/operations', 'com_ui_tars_nav_audit_operations'),
            placeholderRoute('audit/tokens', 'com_ui_tars_nav_audit_tokens'),
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
