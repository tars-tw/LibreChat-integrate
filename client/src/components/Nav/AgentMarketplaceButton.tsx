interface AgentMarketplaceButtonProps {
  /** Which way the tooltip opens: the desktop rail is a left edge, the mobile
   *  drawer header is a top edge. Ignored by the `row` layout, which has no
   *  tooltip to place. */
  side?: 'right' | 'bottom';
  /** Mobile dismisses the drawer on navigation; the desktop rail stays put. */
  onNavigate?: () => void;
  /**
   * `icon` is the rail's square, labelled by a tooltip. `row` is a full-width
   * entry carrying its own label, for the mobile drawer: an icon in a header
   * strip is the easiest thing there to miss, and the list it now heads is
   * where someone already looks for somewhere to go.
   */
  layout?: 'icon' | 'row';
}

/** Agent Marketplace entry in the sidebar. Hidden from the sidebar per product
 *  decision; the /agents route and model-selector marketplace entry stay unaffected. */
export default function AgentMarketplaceButton(_props: AgentMarketplaceButtonProps) {
  return null;
}
