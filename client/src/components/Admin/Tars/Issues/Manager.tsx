import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TTarsTicket } from 'librechat-data-provider';
import type { LabelField } from './helpers';
import type { FieldOption } from './Form';
import {
  useTarsTicketQuery,
  useTarsTicketsQuery,
  useTarsTicketOptionsQuery,
} from '~/data-provider';
import { domainLabelKey } from './helpers';
import { useLocalize } from '~/hooks';
import History from './History';
import TicketForm from './Form';

export default function IssuesManager() {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const [selected, setSelected] = useState<TTarsTicket | null>(null);

  const ticketsQuery = useTarsTicketsQuery();
  const optionsQuery = useTarsTicketOptionsQuery();
  const detailQuery = useTarsTicketQuery(selected?.id ?? null);

  const tickets = ticketsQuery.data ?? [];

  /**
   * A domain value keeps its own label when this build has no translation for
   * it, so a value the Issue Tracker adds later still reads sensibly.
   */
  const labelOf = useCallback(
    (field: LabelField, value: string | null | undefined): string => {
      if (value == null || value === '') {
        return '—';
      }
      const key = domainLabelKey(field, value);
      return key != null ? localize(key) : value;
    },
    [localize],
  );

  const options = useMemo(() => {
    const data = optionsQuery.data;
    const toOptions = (field: LabelField, values: string[] = []): FieldOption[] =>
      values.map((value) => ({ value, label: labelOf(field, value) }));
    return {
      types: toOptions('types', data?.types),
      priorities: toOptions('priorities', data?.priorities),
      severities: toOptions('severities', data?.severities),
      components: (data?.components ?? []).map((component) => ({
        value: component.id,
        label: component.name,
      })),
    };
  }, [optionsQuery.data, labelOf]);

  /** Clicking the selected row again returns to the "new ticket" form. */
  const handleSelect = (ticket: TTarsTicket) =>
    setSelected((current) => (current?.id === ticket.id ? null : ticket));

  return (
    <div className="grid min-h-0 flex-1 items-stretch gap-6 lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)]">
      <div className="min-h-[34rem] lg:col-span-7 lg:min-h-0">
        <TicketForm
          ticket={selected}
          detail={detailQuery.data ?? null}
          detailLoading={detailQuery.isFetching}
          options={options}
          locale={i18n.language}
          onBackToNew={() => setSelected(null)}
          onCreated={() => setSelected(null)}
        />
      </div>
      <div className="min-h-[34rem] lg:col-span-5 lg:min-h-0">
        <History
          tickets={tickets}
          isLoading={ticketsQuery.isFetching}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          onRefresh={() => {
            void ticketsQuery.refetch();
            if (selected != null) {
              void detailQuery.refetch();
            }
          }}
          locale={i18n.language}
          labelOf={labelOf}
        />
      </div>
    </div>
  );
}
