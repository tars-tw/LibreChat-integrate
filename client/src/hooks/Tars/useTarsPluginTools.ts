import { useCallback, useEffect, useMemo, useRef } from 'react';
import isEqual from 'lodash/isEqual';
import { useRecoilState } from 'recoil';
import { Constants, LocalStorageKeys, enabledTarsPluginFunctions } from 'librechat-data-provider';
import type { TTarsPluginFunction } from 'librechat-data-provider';
import { useSelectedTarsDomain } from '~/components/Chat/Menus/Tars/domain';
import useLocalStorage from '~/hooks/useLocalStorageAlt';
import { useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { setTimestamp } from '~/utils/timestamps';
import { ephemeralAgentByConvoId } from '~/store';

export interface TarsPluginToolsControl {
  /** Plugin tools the active brain offers, in the admin's order. */
  tools: TTarsPluginFunction[];
  /** Plugin names switched on for this chat. */
  selected: string[];
  isSelected: (name: string) => boolean;
  toggle: (name: string) => void;
  isPinned: (name: string) => boolean;
  setPinned: (name: string, pinned: boolean) => void;
}

/**
 * What a chat remembers: the plugins switched on, plus the plugins the brain
 * offered at the time. The offered set is what lets an admin's newly
 * "on by default" plugin light up in a chat that already stored a selection —
 * without it a stored list would silently keep every new plugin off.
 */
interface StoredSelection {
  selected: string[];
  offered: string[];
}

const toStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const readStoredSelection = (storageKey: string): StoredSelection | null => {
  const raw = localStorage.getItem(storageKey);
  if (raw == null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { selected: toStringList(parsed), offered: toStringList(parsed) };
    }
    if (parsed != null && typeof parsed === 'object') {
      const record = parsed as Partial<Record<keyof StoredSelection, unknown>>;
      return { selected: toStringList(record.selected), offered: toStringList(record.offered) };
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Chat-scoped selection of the pwc_tars plugin tools (`tars_tool_sdk`) the
 * active brain offers. Mirrors pwc_tars' chat: the brain's `domain_functions`
 * decides which plugins appear at all and which start switched on, the user
 * flips them per chat, and the names ride to the backend as
 * `ephemeralAgent.tars_plugins` (the server re-checks the brain's allowlist).
 * Must be called inside ChatContext (BadgeRow).
 */
export default function useTarsPluginTools({
  conversationId,
  storageContextKey,
}: {
  conversationId?: string | null;
  storageContextKey?: string;
} = {}): TarsPluginToolsControl {
  const key = conversationId ?? Constants.NEW_CONVO;
  const isNewConvo = key === Constants.NEW_CONVO;
  /** Same storage-key derivation as the other toggles so new chats share defaults. */
  const storageSuffix = isNewConvo && storageContextKey ? storageContextKey : key;
  const storageKey = `${LocalStorageKeys.LAST_TARS_PLUGINS_}${storageSuffix}`;

  const { user } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();
  const isTarsUser = startupConfig?.tarsAuth === true && user?.provider === 'tars';
  const { selectedId, selectedDomain } = useSelectedTarsDomain();

  const tools = useMemo(
    () => (isTarsUser ? enabledTarsPluginFunctions(selectedDomain?.domain_functions) : []),
    [isTarsUser, selectedDomain?.domain_functions],
  );
  const offered = useMemo(() => new Set(tools.map((tool) => tool.name)), [tools]);

  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(ephemeralAgentByConvoId(key));
  const selected = useMemo(
    () => (ephemeralAgent?.tars_plugins ?? []).filter((name) => offered.has(name)),
    [ephemeralAgent?.tars_plugins, offered],
  );

  const write = useCallback(
    (next: string[]) => {
      setEphemeralAgent((prev) => {
        if (isEqual(prev?.tars_plugins, next)) {
          return prev;
        }
        return { ...(prev ?? {}), tars_plugins: next };
      });
      const stored: StoredSelection = { selected: next, offered: Array.from(offered) };
      localStorage.setItem(storageKey, JSON.stringify(stored));
      setTimestamp(storageKey);
      if (storageContextKey) {
        const envKey = `${LocalStorageKeys.LAST_TARS_PLUGINS_}${storageContextKey}`;
        localStorage.setItem(envKey, JSON.stringify(stored));
        setTimestamp(envKey);
      }
    },
    [setEphemeralAgent, storageKey, storageContextKey, offered],
  );

  /**
   * Seed once per conversation × brain. Revisiting a chat restores its stored
   * selection — plus any plugin the admin has since made "on by default" that
   * the chat had never been offered — or the brain's defaults when nothing is
   * stored; switching brain on a blank chat re-seeds from the new brain's
   * defaults, since the offered set changed with it. Afterwards only pruning
   * runs, so a plugin the brain stopped offering never reaches the server.
   */
  const seededRef = useRef<{ suffix: string; domainId: string } | null>(null);
  useEffect(() => {
    if (selectedDomain == null) {
      return;
    }
    const current = ephemeralAgent?.tars_plugins;
    const seeded = seededRef.current;
    if (seeded?.suffix === storageSuffix && seeded.domainId === selectedId) {
      if (current === undefined) {
        return;
      }
      const pruned = current.filter((name) => offered.has(name));
      if (pruned.length !== current.length) {
        write(pruned);
      }
      return;
    }
    const brainSwitched = seeded?.suffix === storageSuffix && seeded.domainId !== selectedId;
    seededRef.current = { suffix: storageSuffix, domainId: selectedId };
    const defaults = tools.filter((tool) => tool.default_value).map((tool) => tool.name);
    const carried: StoredSelection | null =
      current !== undefined ? { selected: current, offered: Array.from(offered) } : null;
    const stored = brainSwitched ? null : (carried ?? readStoredSelection(storageKey));
    const base =
      stored == null
        ? defaults
        : [...stored.selected, ...defaults.filter((name) => !stored.offered.includes(name))];
    const next = base.filter((name, index) => offered.has(name) && base.indexOf(name) === index);
    if (!isEqual(current, next)) {
      write(next);
    }
  }, [
    selectedDomain,
    selectedId,
    storageSuffix,
    storageKey,
    offered,
    tools,
    ephemeralAgent?.tars_plugins,
    write,
  ]);

  const isSelected = useCallback((name: string) => selected.includes(name), [selected]);

  const toggle = useCallback(
    (name: string) => {
      if (!offered.has(name)) {
        return;
      }
      write(
        selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name],
      );
    },
    [offered, selected, write],
  );

  const [pinned, setPinnedRaw] = useLocalStorage<string[]>(LocalStorageKeys.PIN_TARS_PLUGINS_, []);
  const isPinned = useCallback(
    (name: string) => Array.isArray(pinned) && pinned.includes(name),
    [pinned],
  );
  const setPinned = useCallback(
    (name: string, value: boolean) => {
      const current = Array.isArray(pinned) ? pinned : [];
      if (value === current.includes(name)) {
        return;
      }
      setPinnedRaw(value ? [...current, name] : current.filter((item) => item !== name));
    },
    [pinned, setPinnedRaw],
  );

  return { tools, selected, isSelected, toggle, isPinned, setPinned };
}
