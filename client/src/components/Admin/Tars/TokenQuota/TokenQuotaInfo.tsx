
import { useState } from 'react';
import { OGDialog, OGDialogTemplate } from '@librechat/client';
import {
  ChevronLeft,
  ChevronRight,
  User,
  CalendarDays,
  Bell,
  Settings2,  
  type LucideIcon,
} from 'lucide-react';
import { useLocalize } from '~/hooks';

function FieldInfoRow({
  icon: Icon,
  title,
  desc,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400">
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-text-primary text-sm font-semibold">{title}</div>
        <div className="text-text-secondary mt-0.5 text-xs leading-relaxed">
          {desc}
        </div>
      </div>
    </div>
  );
}

type QuotaSlide = {
  key: string;
  title: string;
  scope: string;
  desc: string;
};

export default function TokenQuotaInfo({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const [slide, setSlide] = useState(0);

  const quotaSlides: QuotaSlide[] = [
    {
      key: 'personal',
      title: localize('com_ui_tars_quota_info_personal_title'),
      scope: localize('com_ui_tars_quota_info_personal_scope'),
      desc: localize('com_ui_tars_quota_info_personal_desc'),
    },
    {
      key: 'system',
      title: localize('com_ui_tars_quota_info_system_title'),
      scope: localize('com_ui_tars_quota_info_system_scope'),
      desc: localize('com_ui_tars_quota_info_system_desc'),
    },
  ];

  const fieldGroups = [
    {
      label: localize('com_ui_tars_quota_info_fields_group_all'),
      fields: [
        {
          icon: User,
          title: localize('com_ui_tars_quota_info_fields_default_user_title'),
          desc: localize('com_ui_tars_quota_info_fields_default_user_desc'),
        },
        {
          icon: CalendarDays,
          title: localize('com_ui_tars_quota_info_fields_reset_title'),
          desc: localize('com_ui_tars_quota_info_fields_reset_desc'),
        },
        {
          icon: Bell,
          title: localize('com_ui_tars_quota_info_fields_warning_title'),
          desc: localize('com_ui_tars_quota_info_fields_warning_desc'),
        },
      ],
    },
  ];

  const totalSlides = 3;
  const isFieldsSlide = slide === 2;
  const current = quotaSlides[slide];

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setSlide(0);
  };

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <OGDialogTemplate
        title={
          isFieldsSlide
            ? localize('com_ui_tars_quota_info_fields_title')
            : localize('com_ui_tars_quota_info_title')
        }
        className="w-[calc(100%-2rem)] max-w-md"
        showCloseButton={true}
        main={
          <div className="space-y-4">
            {!isFieldsSlide ? (
              <>
                {/* 套用順序 */}
                <div className="rounded-lg bg-surface-secondary px-3 py-2.5">
                  <div className="text-text-secondary mb-2 text-xs">
                    {localize('com_ui_tars_quota_info_priority_label')}
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <span
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        slide === 0
                          ? 'bg-orange-500 text-white'
                          : 'bg-surface-primary text-text-secondary'
                      }`}
                    >
                      {localize('com_ui_tars_quota_info_personal_title')}
                    </span>
                    <ChevronRight className="text-text-secondary size-4 shrink-0" />
                    <span
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                        slide === 1
                          ? 'bg-orange-500 text-white'
                          : 'bg-surface-primary text-text-secondary'
                      }`}
                    >
                      {localize('com_ui_tars_quota_info_system_title')}
                    </span>
                  </div>
                </div>

                {/* 說明內容 */}
                <div className="rounded-lg border border-border-light p-4">
                  <div className="text-text-primary mb-3 flex items-center gap-2 text-base font-semibold">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400">
                      {slide === 0 ? (
                        <User className="size-4" aria-hidden />
                      ) : (
                        <Settings2 className="size-4" aria-hidden />
                      )}
                    </div>
                    {current.title}
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-text-secondary text-xs">
                      {localize('com_ui_tars_quota_info_scope_label')}
                    </div>
                    <div className="text-text-primary text-sm">
                      {current.scope}
                    </div>
                  </div>

                  <div className="bg-border-light my-3 h-px" />

                  <div className="space-y-1.5">
                    <div className="text-text-secondary text-xs">
                      {localize('com_ui_tars_quota_info_desc_label')}
                    </div>
                    <div className="text-text-primary text-sm leading-relaxed">
                      {current.desc}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="divide-y divide-border-light">
                {fieldGroups.map((group) => (
                  <div key={group.label} className="py-1">
                    <div className="text-text-secondary pt-2 text-xs font-medium">
                      {group.label}
                    </div>
                    {group.fields.map((field) => (
                      <FieldInfoRow
                        key={field.title}
                        icon={field.icon}
                        title={field.title}
                        desc={field.desc}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* 頁面切換 */}
            <div className="flex items-center justify-between border-t border-border-light pt-3">
              <button
                type="button"
                onClick={() => setSlide((s) => Math.max(0, s - 1))}
                disabled={slide === 0}
                className="text-text-secondary flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="size-4" aria-hidden />
                {localize('com_ui_tars_quota_info_prev')}
              </button>

              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalSlides }, (_, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-label={`${index + 1}`}
                    aria-current={index === slide ? 'step' : undefined}
                    onClick={() => setSlide(index)}
                    className={`h-1.5 rounded-full transition-all ${
                      index === slide
                        ? 'w-5 bg-orange-500'
                        : 'w-1.5 bg-border-medium'
                    }`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  setSlide((s) => Math.min(totalSlides - 1, s + 1))
                }
                disabled={slide === totalSlides - 1}
                className="text-text-secondary flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-30"
              >
                {localize('com_ui_tars_quota_info_next')}
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        }
      />
    </OGDialog>
  );
}
