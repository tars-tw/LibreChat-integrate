interface AgentMarketplaceButtonProps {
  /** Which way the tooltip opens: the desktop rail is a left edge, the mobile
   *  drawer header is a top edge. */
  side?: 'right' | 'bottom';
  /** Mobile dismisses the drawer on navigation; the desktop rail stays put. */
  onNavigate?: () => void;
}

/** Agent Marketplace entry in the sidebar. Hidden from the sidebar per product
 *  decision; the /agents route and model-selector marketplace entry stay unaffected. */
export default function AgentMarketplaceButton(_props: AgentMarketplaceButtonProps) {
  return null;
}
