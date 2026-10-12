import { useCallback, useRef, useState } from 'react';
import Icon from './Icon';

/* Complementary fallback to the live stream — most cross-device updates
   already arrive live as activity rows (see KettleContext), but
   a manual "did I miss anything" gesture is still expected on Android and
   costs nothing to add. Mirrors SwipeRefreshLayout's feel: resisted drag,
   a threshold to commit, a spinning glyph while the refresh is in flight. */
const THRESHOLD = 64;
const MAX_PULL = 100;
const RESISTANCE = 0.5;

export default function PullToRefresh({ className = '', onRefresh, children }) {
  const mainRef = useRef(null);
  const startY = useRef(null);
  const dragging = useRef(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onTouchStart = useCallback((e) => {
    if (refreshing) return;
    if (!mainRef.current || mainRef.current.scrollTop > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0].clientY;
    dragging.current = true;
  }, [refreshing]);

  const onTouchMove = useCallback((e) => {
    if (!dragging.current || startY.current == null) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPull(0);
      return;
    }
    setPull(Math.min(MAX_PULL, delta * RESISTANCE));
  }, []);

  const settle = useCallback(async () => {
    dragging.current = false;
    startY.current = null;
    setPull((current) => {
      if (current >= THRESHOLD) {
        setRefreshing(true);
        Promise.resolve(onRefresh?.())
          .catch(() => {})
          .finally(() => {
            setRefreshing(false);
            setPull(0);
          });
        return THRESHOLD;
      }
      return 0;
    });
  }, [onRefresh]);

  const cancel = useCallback(() => {
    dragging.current = false;
    startY.current = null;
    setPull(0);
  }, []);

  const active = refreshing || pull > 0;
  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <main
      ref={mainRef}
      className={className}
      style={{ '--pull': `${active ? pull : 0}px` }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={settle}
      onTouchCancel={cancel}
    >
      <div className="pull-refresh-indicator">
        <span className={'pull-refresh-spinner' + (refreshing ? ' is-spinning' : '')} style={{ '--progress': progress }}>
          <Icon name="refresh" size={18} />
        </span>
      </div>
      {children}
    </main>
  );
}
