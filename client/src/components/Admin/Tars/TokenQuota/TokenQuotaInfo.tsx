import { useState } from 'react';
import { OGDialog, OGDialogTemplate } from '@librechat/client';
import { ChevronLeft, ChevronRight, Target, User, CalendarDays, Bell } from 'lucide-react';
import { useLocalize } from '~/hooks';

type QuotaPyramidProps = {
  activeLayer: 0 | 1 | 2;
  color: string;
  labels: [string, string, string];
};

function QuotaPyramid({ activeLayer, color, labels }: QuotaPyramidProps) {
  const layers = [
    { idx: 0, points: '10,280 290,280 243.5,200 56.5,200', label: labels[0], labelPos: [150, 250] },
    {
      idx: 1,
      points: '56.5,200 243.5,200 196.5,115 103.5,115',
      label: labels[1],
      labelPos: [150, 165],
    },
    { idx: 2, points: '103.5,115 196.5,115 150,30', label: labels[2], labelPos: [150, 80] },
  ] as const;

  const inactiveColors = ['#B9C0C9', '#CDD2D8', '#DDE1E5'];

  return (
    <svg viewBox="0 0 300 300" className="h-auto w-full max-w-[300px]">
      {layers.map((l) => {
        const isActive = l.idx === activeLayer;
        return (
          <g key={l.idx}>
            <polygon
              points={l.points}
              fill={isActive ? color : inactiveColors[l.idx]}
              stroke="#fff"
              strokeWidth="7"
              strokeLinejoin="round"
              style={{ transition: 'fill 0.3s ease' }}
            />
            <text
              x={l.labelPos[0]}
              y={l.labelPos[1]}
              textAnchor="middle"
              fontSize="15"
              fontWeight="700"
              fill={isActive ? '#fff' : '#212529'}
              stroke={isActive ? color : 'none'}
              strokeWidth={isActive ? 2 : 0}
              paintOrder="stroke"
            >
              {l.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function FieldInfoCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Target;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-orange-50 p-4 dark:bg-orange-950/20">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-orange-600 dark:bg-surface-primary dark:text-orange-400">
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-text-secondary">{desc}</div>
      </div>
    </div>
  );
}

type Slide =
  | {
      key: string;
      type: 'pyramid';
      layer: 0 | 1 | 2;
      title: string;
      scope: string;
      desc: string;
      color: string;
    }
  | { key: string; type: 'fields' };

export default function TokenQuotaInfo({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const [slide, setSlide] = useState(0);

  const slides: Slide[] = [
    {
      key: 'personal',
      type: 'pyramid',
      layer: 2,
      title: localize('com_ui_tars_quota_info_personal_title'),
      scope: localize('com_ui_tars_quota_info_personal_scope'),
      desc: localize('com_ui_tars_quota_info_personal_desc'),
      color: '#F5A623',
    },
    {
      key: 'group',
      type: 'pyramid',
      layer: 1,
      title: localize('com_ui_tars_quota_info_group_title'),
      scope: localize('com_ui_tars_quota_info_group_scope'),
      desc: localize('com_ui_tars_quota_info_group_desc'),
      color: '#FE7C39',
    },
    {
      key: 'system',
      type: 'pyramid',
      layer: 0,
      title: localize('com_ui_tars_quota_info_system_title'),
      scope: localize('com_ui_tars_quota_info_system_scope'),
      desc: localize('com_ui_tars_quota_info_system_desc'),
      color: '#FF5722',
    },
    { key: 'fields', type: 'fields' },
  ];

  const pyramidLabels: [string, string, string] = [
    localize('com_ui_tars_quota_info_system_title'),
    localize('com_ui_tars_quota_info_group_title'),
    localize('com_ui_tars_quota_info_personal_title'),
  ];

  const fieldGroups = [
    {
      label: localize('com_ui_tars_quota_info_fields_group_partial'),
      fields: [
        {
          icon: Target,
          title: localize('com_ui_tars_quota_info_fields_system_total_title'),
          desc: localize('com_ui_tars_quota_info_fields_system_total_desc'),
        },
        {
          icon: User,
          title: localize('com_ui_tars_quota_info_fields_default_user_title'),
          desc: localize('com_ui_tars_quota_info_fields_default_user_desc'),
        },
      ],
    },
    {
      label: localize('com_ui_tars_quota_info_fields_group_all'),
      fields: [
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

  const current = slides[slide];

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setSlide(0);
  };

  return (
    <OGDialog open={open} onOpenChange={handleOpenChange}>
      <OGDialogTemplate
        title={
          current.type === 'fields'
            ? localize('com_ui_tars_quota_info_fields_title')
            : localize('com_ui_tars_quota_info_title')
        }
        className="w-11/12 max-w-2xl"
        showCloseButton={true}
        main={
          <div>
            {current.type === 'pyramid' && (
              <p className="mb-4 text-sm text-text-secondary">
                {localize('com_ui_tars_quota_info_priority_label')}
                {localize('com_ui_tars_quota_info_priority_full', {
                  personal: localize('com_ui_tars_quota_info_personal_title'),
                  group: localize('com_ui_tars_quota_info_group_title'),
                  system: localize('com_ui_tars_quota_info_system_title'),
                })}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={localize('com_ui_tars_quota_info_prev')}
                onClick={() => setSlide((s) => Math.max(0, s - 1))}
                disabled={slide === 0}
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border-light text-text-secondary transition-colors hover:border-orange-500 hover:bg-orange-500 hover:text-white disabled:opacity-30 disabled:hover:border-border-light disabled:hover:bg-transparent disabled:hover:text-text-secondary"
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>

              <div className="flex min-h-[300px] flex-1 items-center">
                {current.type === 'pyramid' ? (
                  <div className="flex w-full flex-col items-center gap-6 sm:flex-row sm:items-center">
                    <div className="w-full flex-1 rounded-xl bg-orange-50 p-5 dark:bg-orange-950/20">
                      <div className="mb-3 text-base font-bold text-text-primary">
                        {current.title}
                      </div>
                      <div className="mb-0.5 mt-2 text-xs text-text-secondary">
                        {localize('com_ui_tars_quota_info_scope_label')}
                      </div>
                      <div className="text-sm text-text-primary">{current.scope}</div>
                      <div className="mb-0.5 mt-3 text-xs text-text-secondary">
                        {localize('com_ui_tars_quota_info_desc_label')}
                      </div>
                      <div className="text-sm leading-relaxed text-text-primary">
                        {current.desc}
                      </div>
                    </div>
                    <div className="flex flex-1 justify-center">
                      <QuotaPyramid
                        activeLayer={current.layer}
                        color={current.color}
                        labels={pyramidLabels}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="w-full space-y-5">
                    {fieldGroups.map((group) => (
                      <div key={group.label}>
                        <div className="mb-2.5 text-sm text-text-secondary">{group.label}</div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {group.fields.map((f) => (
                            <FieldInfoCard
                              key={f.title}
                              icon={f.icon}
                              title={f.title}
                              desc={f.desc}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                aria-label={localize('com_ui_tars_quota_info_next')}
                onClick={() => setSlide((s) => Math.min(slides.length - 1, s + 1))}
                disabled={slide === slides.length - 1}
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border-light text-text-secondary transition-colors hover:border-orange-500 hover:bg-orange-500 hover:text-white disabled:opacity-30 disabled:hover:border-border-light disabled:hover:bg-transparent disabled:hover:text-text-secondary"
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>

            <div className="mt-5 flex justify-center gap-2">
              {slides.map((s, i) => (
                <span
                  key={s.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSlide(i)}
                  className={`h-2 cursor-pointer rounded-full transition-all ${
                    i === slide ? 'w-5 bg-orange-500' : 'w-2 bg-border-light'
                  }`}
                />
              ))}
            </div>
          </div>
        }
      />
    </OGDialog>
  );
}
