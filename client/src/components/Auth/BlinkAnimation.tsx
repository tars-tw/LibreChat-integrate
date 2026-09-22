import { useEffect, useState } from 'react';

export const BlinkAnimation = ({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) => {
  const [showAnimation, setShowAnimation] = useState(active);

  useEffect(() => {
    if (active) {
      setShowAnimation(true);
      return;
    }

    const timer = setTimeout(() => {
      setShowAnimation(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, [active]);

  if (!showAnimation) {
    return <>{children}</>;
  }

  /**
   * Animation comes from the `blink` keyframes in the Tailwind config rather than an
   * inline `<style>` tag: stylesheet text rendered into the DOM becomes part of the
   * ancestor's `textContent` and leaks raw CSS into label readouts. `motion-reduce`
   * honours a user's reduced-motion preference.
   */
  return <div className="animate-logo-blink motion-reduce:animate-none">{children}</div>;
};
