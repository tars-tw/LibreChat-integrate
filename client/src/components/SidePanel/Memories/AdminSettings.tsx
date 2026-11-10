import { useToastContext } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type { PermissionConfig } from '~/components/ui';
import { useUpdateMemoryPermissionsMutation } from '~/data-provider';
import { AdminSettingsDialog } from '~/components/ui';
import { useLocalize } from '~/hooks';

const permissions: PermissionConfig[] = [
  {
    permission: Permissions.USE,
    labelKey: 'com_ui_memories_allow_use',
    descriptionKey: 'com_ui_tars_memory_admin_use_hint',
    hideForAdmin: true,
  },
  {
    permission: Permissions.CREATE,
    labelKey: 'com_ui_memories_allow_create',
    descriptionKey: 'com_ui_tars_memory_admin_create_hint',
  },
  {
    permission: Permissions.UPDATE,
    labelKey: 'com_ui_memories_allow_update',
    descriptionKey: 'com_ui_tars_memory_admin_update_hint',
  },
  {
    permission: Permissions.READ,
    labelKey: 'com_ui_memories_allow_read',
    descriptionKey: 'com_ui_tars_memory_admin_read_hint',
    hideForAdmin: true,
  },
  {
    permission: Permissions.OPT_OUT,
    labelKey: 'com_ui_memories_allow_opt_out',
    descriptionKey: 'com_ui_tars_memory_admin_opt_out_hint',
  },
];

const AdminSettings = ({ trigger }: { trigger?: React.ReactNode }) => {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const mutation = useUpdateMemoryPermissionsMutation({
    onSuccess: () => {
      showToast({ status: 'success', message: localize('com_ui_saved') });
    },
    onError: () => {
      showToast({ status: 'error', message: localize('com_ui_error_save_admin_settings') });
    },
  });

  return (
    <AdminSettingsDialog
      permissionType={PermissionTypes.MEMORIES}
      sectionKey="com_ui_memories"
      roleDescriptionKey="com_ui_tars_memory_admin_role_hint"
      permissions={permissions}
      menuId="memory-role-dropdown"
      mutation={mutation}
      trigger={trigger}
    />
  );
};

export default AdminSettings;
