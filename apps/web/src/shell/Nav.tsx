import { Icon, Sprout, type IconName } from '@cue/ui';
import { mascotFor } from '@cue/core';
import { hrefFor, type Route } from '../router';
import { callStore } from '../state/call';
import { useStore } from '../state/store';

export interface NavItem {
  route: Route['name'];
  label: string;
  icon: IconName;
}

export const NAV: NavItem[] = [
  { route: 'live', label: 'Live', icon: 'phone' },
  { route: 'practice', label: 'Practice', icon: 'mic' },
  { route: 'playbook', label: 'Playbook', icon: 'leaf' },
  { route: 'model', label: 'Model', icon: 'sprout' },
  { route: 'history', label: 'History', icon: 'clock' },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

function isActive(item: NavItem, route: Route): boolean {
  if (route.name === 'debrief') return item.route === 'history';
  return item.route === route.name;
}

/** Slim left rail on desktop. */
export function Rail({ route }: { route: Route }) {
  const { view, connection } = useStore(callStore);
  const live = view?.status === 'live';
  return (
    <nav className="web-rail" aria-label="Cue">
      <a className="web-rail__brand" href={hrefFor({ name: 'live' })} aria-label="Cue home">
        <Sprout state={mascotFor(view, connection)} size={34} decorative />
      </a>
      <ul className="web-rail__list">
        {NAV.map((item) => {
          const active = isActive(item, route);
          return (
            <li key={item.route}>
              <a className={`web-rail__item${active ? ' is-active' : ''}`} href={hrefFor({ name: item.route } as Route)} aria-current={active ? 'page' : undefined}>
                <span className="web-rail__icon">
                  <Icon name={item.icon} size={20} />
                  {item.route === 'live' && live && <span className="web-live-dot" aria-label="Call in progress" />}
                </span>
                <span className="web-rail__label">{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Bottom tab bar on phones. */
export function TabBar({ route }: { route: Route }) {
  const live = useStore(callStore, (s) => s.view?.status === 'live');
  return (
    <nav className="web-tabs" aria-label="Cue">
      {NAV.map((item) => {
        const active = isActive(item, route);
        return (
          <a key={item.route} className={`web-tabs__item${active ? ' is-active' : ''}`} href={hrefFor({ name: item.route } as Route)} aria-current={active ? 'page' : undefined}>
            <span className="web-tabs__icon">
              <Icon name={item.icon} size={20} />
              {item.route === 'live' && live && <span className="web-live-dot" aria-label="Call in progress" />}
            </span>
            <span className="web-tabs__label">{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
